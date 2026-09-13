// =============================================================================
// gitea-bring-up.test.ts
//
// Testes de EXECUÇÃO do deploy/gitea-up.sh — o comando que faz da imagem do
// runner um PRÉ-REQUISITO da subida da stack da forja.
//
// O que precisa ser provado (o script pode "parecer" certo e não bloquear):
//   1. tag AUSENTE no registry → exit 4 e **nenhum** comando de subida é
//      executado (o `docker` não é chamado para `compose up`) — é o bloqueio;
//   2. tentou publicar e a releitura não confirmou → exit 5 e a stack continua
//      NÃO subida (o `up -d runner` nunca acontece);
//   3. tag presente → a ORDEM é garantida + runner: a imagem é conferida ANTES
//      dos `compose up`, e o runner sobe DEPOIS do Gitea;
//   4. `--check-only` não toca em nada;
//   5. a PRONTIDÃO (doctor) recusa a subida: exit 1 (BLOQUEADA) e exit >=3 (não
//      rodou) param ANTES de qualquer `compose up`; exit 2 (INDETERMINADA)
//      segue, porque "não consegui provar" não é violação — e com
//      `--re-register` o doctor é isentado do fato que aquele modo conserta.
//
// Método: `docker` e `gh` são SUBSTITUÍDOS por scripts no PATH que registram
// cada chamada (o `gh` fake sempre falha — sem ele um `gh` real autenticado na
// máquina do dev dispararia um workflow de verdade). O registry também é fake
// (node:http em 127.0.0.1) e a conexão com ele é REAL. O doctor é um dublê
// (`DOCTOR_SCRIPT`) que REGISTRA os argumentos e devolve o código escolhido —
// é assim que se vê se a decisão é tomada pelo código dele, e não pela prosa.
//
// Usage:
//   bunx vitest run --config vitest.config.unit.ts src/lib/__tests__/gitea-bring-up.test.ts
// =============================================================================

import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { resolveBash } from "./helpers/bash-resolver"

const ROOT = process.cwd()
const BRING_UP = join(ROOT, "deploy", "gitea-up.sh")
const EXIT = { OK: 0, USAGE: 1, ENV: 2, UNKNOWN: 3, MISSING: 4, PUBLISH_FAILED: 5 }

const tmpDirs: string[] = []

function makeTmp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `gitea-up-${name}-`))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Registry OCI fake: 200 (existe) ou 404 (ausente). */
function startRegistry(
  mode: "exists" | "missing",
): Promise<{ url: string; port: string; close: () => Promise<void> }> {
  const server = createServer((_req, res) => {
    res.writeHead(mode === "exists" ? 200 : 404, { "content-type": "application/json" })
    res.end("{}")
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? String(addr.port) : "0"
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

const RUNNER_VOLUME = "gitea-runner-data"

interface FakeCli {
  binDir: string
  dockerLog: string
  dockerCalls: () => string[]
  volumes: () => string[]
}

interface FakeCliOptions {
  /**
   * Semente do estado de volumes. Default: o volume do registro JÁ existe —
   * que é o caso do re-registro (há um registro gravado a ser apagado).
   */
  volumes?: string[]
  /**
   * Modela o volume que "não sai" (em uso): `volume rm` falha e o estado não
   * muda. Sem isso o dublê não consegue distinguir "apagado" de "não apagado",
   * e o teste do re-registro não provaria nada.
   */
  stickyVolume?: boolean
}

/**
 * Instala `docker` e `gh` FAKE no PATH (prepend). O `docker` registra cada
 * chamada; `manifest` falha (a tag não é conhecida por ele), `build`/`push`
 * "funcionam" (para exercitar o caminho de publicação), o resto sai 0.
 * O `gh` fake SEMPRE falha (--version incluso): sem gh autenticado o ensure não
 * pode escolher o workflow — e nenhum workflow de verdade é disparado.
 *
 * O `docker` fake também mantém um ARQUIVO de volumes (`inspect` consulta,
 * `rm` remove) — é o mínimo para que o re-registro tenha um efeito observável.
 */
function makeFakeCli(opts: FakeCliOptions = {}): FakeCli {
  const binDir = join(makeTmp("bin"), "bin")
  mkdirSync(binDir, { recursive: true })
  const dockerLog = join(binDir, "docker.log")
  const volumeState = join(binDir, "volumes.state")
  writeFileSync(dockerLog, "")
  writeFileSync(volumeState, (opts.volumes ?? [RUNNER_VOLUME]).map((v) => `${v}\n`).join(""))

  // O ramo `volume rm`: ou remove do estado, ou (sticky) falha sem mexer nele.
  const removeBranch = opts.stickyVolume
    ? 'echo "Error response from daemon: volume is in use" >&2; exit 1'
    : `grep -vx -- "$3" "${volumeState}" > "${volumeState}.tmp"; mv "${volumeState}.tmp" "${volumeState}"; exit 0`

  writeFileSync(
    join(binDir, "docker"),
    [
      "#!/usr/bin/env bash",
      `echo "$*" >> "${dockerLog}"`,
      'case "$1" in',
      '  --version) echo "Docker version 27.0.0, build fake"; exit 0 ;;',
      "  manifest) exit 1 ;;",
      "  volume)",
      '    case "$2" in',
      `      inspect) grep -qx -- "$3" "${volumeState}" && exit 0; exit 1 ;;`,
      `      rm) ${removeBranch} ;;`,
      "    esac",
      "    ;;",
      "esac",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  )
  writeFileSync(
    join(binDir, "gh"),
    ["#!/usr/bin/env bash", 'echo "gh: indisponivel (fake)" >&2', "exit 1", ""].join("\n"),
    { mode: 0o755 },
  )

  return {
    binDir,
    dockerLog,
    dockerCalls: () =>
      readFileSync(dockerLog, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    volumes: () =>
      readFileSync(volumeState, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
  }
}

/**
 * O env do HOST do teste. Ele aponta para um registry LOCAL — e por isso DIVERGE
 * do template comitado (o template não tem como declarar a porta efêmera). O
 * irmão `<path>.template` reproduz os MESMOS valores EXCETO o segredo, e o
 * `runBringUp` o injeta em `TEMPLATE_FILE`: assim o passo 0 (espelho) do bring-up
 * passa com o par coerente, sem desligar a checagem. O bloqueio REAL — env do
 * host x template COMITADO — é provado num teste à parte, que NÃO o injeta.
 *
 * O SEGREDO é a única diferença de propósito: a regra tem ASSIMETRIA — numa
 * variável comum DIVERGIR é o defeito, num segredo IGUALAR é (o template é
 * comitado e tem o placeholder; o host tem o valor real). Um gêmeo idêntico
 * reprovaria por isso.
 */
function makeEnvFile(registryUrl: string): string {
  const path = join(makeTmp("env"), "gitea.env")
  const content = [
    `IMAGE_REGISTRY=${registryUrl}`,
    "IMAGE_NAMESPACE=severinno",
    "BUN_VERSION=1.3.14",
    "RUNNER_TOKEN=fake",
    "",
  ].join("\n")
  writeFileSync(path, content)
  writeFileSync(
    `${path}.template`,
    content.replace("RUNNER_TOKEN=fake", "RUNNER_TOKEN=COLE_O_TOKEN_AQUI"),
  )
  return path
}

interface RunResult {
  status: number | null
  out: string
}

interface FakeDoctor {
  path: string
  calls: () => string[]
}

/**
 * Doctor DUBLÊ: registra os argumentos e sai com o código escolhido.
 *
 * `.mjs` E NÃO `.sh`: o bring-up invoca o doctor com `node` (ele é um script
 * Node). Um dublê em bash morreria no parser do Node (`SyntaxError` → exit 1) e
 * o teste leria "BLOQUEADA" de um dublê quebrado — medido na prova do bloqueio.
 */
function makeFakeDoctor(code = 0): FakeDoctor {
  const dir = makeTmp("doctor")
  const logPath = join(dir, "doctor.log")
  const path = join(dir, "forge-doctor-stub.mjs")
  writeFileSync(logPath, "")
  writeFileSync(
    path,
    [
      'import { appendFileSync } from "node:fs"',
      `appendFileSync(${JSON.stringify(logPath)}, process.argv.slice(2).join(" ") + "\\n")`,
      `process.exit(${code})`,
      "",
    ].join("\n"),
  )
  return {
    path,
    calls: () =>
      readFileSync(logPath, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
  }
}

function runBringUp(
  args: string[],
  opts: {
    pathPrefix: string
    env?: Record<string, string>
    template?: false
    doctor?: FakeDoctor
  },
): Promise<RunResult> {
  const doctor = opts.doctor ?? makeFakeDoctor(0)
  // O passo 0 compara o env do host com o TEMPLATE COMITADO. O env do teste
  // aponta para o registry local, então o teste injeta o template gêmeo
  // (escrito por `makeEnvFile`) — EXCETO quando o próprio teste mede a
  // divergência (`template: false`, que deixa o default do repositório).
  const envIdx = args.indexOf("--env-file")
  const envPath = envIdx === -1 ? null : args[envIdx + 1]
  const twin = envPath ? `${envPath}.template` : null
  const templateFile = opts.template === false || !twin || !existsSync(twin) ? null : twin
  return new Promise((resolve) => {
    const child = spawn(resolveBash(), [BRING_UP, ...args], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // node/curl/dirname seguem reais; docker e gh vêm do bin fake.
        PATH: `${opts.pathPrefix}:${process.env.PATH ?? ""}`,
        ...(templateFile ? { TEMPLATE_FILE: templateFile } : {}),
        // O doctor dublê: a prontidão é medida pelo CÓDIGO que ele devolve.
        DOCTOR_SCRIPT: doctor.path,
        ...opts.env,
      },
    })
    let out = ""
    child.stdout?.on("data", (c) => (out += c))
    child.stderr?.on("data", (c) => (out += c))
    child.on("close", (code) => resolve({ status: code, out }))
  })
}

describe("deploy/gitea-up.sh — a imagem é pré-requisito da subida", () => {
  it("tag AUSENTE → publica, a releitura não confirma, exit 5 e NENHUM 'compose up' (a stack não sobe)", async () => {
    const reg = await startRegistry("missing")
    const fake = makeFakeCli()
    try {
      // Sem --check: o script TENTA publicar (build+push locais "funcionam"),
      // re-consulta o registry (404 de novo) e para antes de qualquer `compose`.
      const { status, out } = await runBringUp(
        ["--env-file", makeEnvFile(reg.url), "--source", "local"],
        {
          pathPrefix: fake.binDir,
        },
      )
      expect(status).toBe(EXIT.PUBLISH_FAILED)
      expect(out).toContain("NADA foi subido")
      const calls = fake.dockerCalls()
      expect(calls.some((c) => c.startsWith("build"))).toBe(true)
      expect(calls.some((c) => c.startsWith("push"))).toBe(true)
      expect(calls.filter((c) => c.startsWith("compose"))).toEqual([])
    } finally {
      await reg.close()
    }
  })

  it("--check-only com a tag ausente → exit 4 e não toca em nada", async () => {
    const reg = await startRegistry("missing")
    const fake = makeFakeCli()
    try {
      const { status } = await runBringUp(["--env-file", makeEnvFile(reg.url), "--check-only"], {
        pathPrefix: fake.binDir,
      })
      expect(status).toBe(EXIT.MISSING)
      expect(fake.dockerCalls()).toEqual([])
    } finally {
      await reg.close()
    }
  })

  it("tag presente → confere a imagem ANTES e sobe gitea/caddy e DEPOIS o runner", async () => {
    const reg = await startRegistry("exists")
    const fake = makeFakeCli()
    try {
      const { status, out } = await runBringUp(["--env-file", makeEnvFile(reg.url)], {
        pathPrefix: fake.binDir,
        // sem esperar o healthcheck (não há Gitea de verdade neste teste)
        env: { HEALTH_TIMEOUT: "1" },
      })
      expect(status).toBe(EXIT.OK)
      expect(out).toContain("stack no ar")

      const calls = fake.dockerCalls()
      const gitea = calls.findIndex((c) => c.includes("up -d gitea caddy"))
      const runner = calls.findIndex((c) => c.includes("up -d runner"))
      expect(gitea).toBeGreaterThanOrEqual(0)
      expect(runner).toBeGreaterThan(gitea)
      // nada de publicar quando a tag já existe
      expect(calls.some((c) => c.startsWith("build") || c.startsWith("push"))).toBe(false)
    } finally {
      await reg.close()
    }
  })

  it("--check-only com a tag presente → exit 0 sem subir nada", async () => {
    const reg = await startRegistry("exists")
    const fake = makeFakeCli()
    try {
      const { status, out } = await runBringUp(
        ["--env-file", makeEnvFile(reg.url), "--check-only"],
        {
          pathPrefix: fake.binDir,
        },
      )
      expect(status).toBe(EXIT.OK)
      expect(out).toContain("stack NÃO foi tocada")
      expect(fake.dockerCalls()).toEqual([])
    } finally {
      await reg.close()
    }
  })

  it("--no-runner sobe só gitea+caddy (não exige a imagem do runner)", async () => {
    const reg = await startRegistry("missing")
    const fake = makeFakeCli()
    try {
      const { status } = await runBringUp(["--env-file", makeEnvFile(reg.url), "--no-runner"], {
        pathPrefix: fake.binDir,
        env: { HEALTH_TIMEOUT: "1" },
      })
      expect(status).toBe(EXIT.OK)
      const calls = fake.dockerCalls()
      expect(calls.some((c) => c.includes("up -d gitea caddy"))).toBe(true)
      expect(calls.some((c) => c.includes("up -d runner"))).toBe(false)
    } finally {
      await reg.close()
    }
  })

  it("env do host DIVERGE do template comitado → exit 1, com o remédio, e NENHUM 'compose' (nada sobe)", async () => {
    const reg = await startRegistry("exists")
    const fake = makeFakeCli()
    try {
      // `template: false` = NÃO injeta o gêmeo: o bring-up usa o template
      // COMITADO, e o env de teste aponta para o registry local — divergência
      // de IMAGE_REGISTRY. É o pré-requisito mecânico: sem rodar nenhum gate à
      // mão, a subida recusa.
      const { status, out } = await runBringUp(["--env-file", makeEnvFile(reg.url)], {
        pathPrefix: fake.binDir,
        template: false,
        env: { HEALTH_TIMEOUT: "1" },
      })
      expect(status).toBe(EXIT.USAGE)
      expect(out).toContain("NÃO espelha o template comitado")
      expect(out).toContain("NADA foi subido")
      // O bloqueio é TOTAL: nem o Gitea sobe, nem a imagem é conferida/puxada.
      expect(fake.dockerCalls()).toEqual([])
    } finally {
      await reg.close()
    }
  })

  it("env ausente → exit 1 com o caminho e o remédio (nada é subido)", async () => {
    const fake = makeFakeCli()
    const { status, out } = await runBringUp(["--env-file", "deploy/nao-existe.env"], {
      pathPrefix: fake.binDir,
    })
    expect(status).toBe(EXIT.USAGE)
    expect(out).toContain("env não encontrado")
    expect(out).toContain("env.gitea.example")
    expect(fake.dockerCalls()).toEqual([])
  })

  it("flag desconhecida → exit 1 com a usage", async () => {
    const fake = makeFakeCli()
    const { status, out } = await runBringUp(["--turbo"], { pathPrefix: fake.binDir })
    expect(status).toBe(EXIT.USAGE)
    expect(out).toContain("desconhecido")
  })
})

// ── Re-registro: trocar a label é quando a tag pode faltar ────────────────
// O re-registro é o OUTRO caminho que sobe o runner. Ele precisa da mesma
// garantia: se a tag não existir (ou não der para confirmar), o runner não
// sobe — é justamente na troca de versão que a tag tem mais chance de faltar.

describe("deploy/gitea-up.sh --re-register — a garantia vale no re-registro", () => {
  it("tag presente → confere a imagem, remove o registro ANTES e sobe o runner com os labels novos", async () => {
    const reg = await startRegistry("exists")
    const fake = makeFakeCli({ volumes: [RUNNER_VOLUME] })
    try {
      const { status, out } = await runBringUp(
        ["--env-file", makeEnvFile(reg.url), "--re-register"],
        { pathPrefix: fake.binDir, env: { HEALTH_TIMEOUT: "1" } },
      )
      expect(status).toBe(EXIT.OK)
      expect(out).toContain("RE-REGISTRADO")

      const calls = fake.dockerCalls()
      const gitea = calls.findIndex((c) => c.includes("up -d gitea caddy"))
      const remove = calls.findIndex((c) => c.includes("rm -sf runner"))
      const up = calls.findIndex((c) => c.includes("up -d runner"))
      expect(gitea).toBeGreaterThanOrEqual(0)
      expect(remove).toBeGreaterThan(gitea)
      expect(up).toBeGreaterThan(remove)
      // o registro gravado foi apagado de fato (o dublê consulta o estado)
      expect(fake.volumes()).not.toContain(RUNNER_VOLUME)
    } finally {
      await reg.close()
    }
  })

  it("volume do registro que NÃO sai → exit 1 e o runner NÃO sobe (senão voltaria com labels velhos)", async () => {
    const reg = await startRegistry("exists")
    const fake = makeFakeCli({ volumes: [RUNNER_VOLUME], stickyVolume: true })
    try {
      const { status, out } = await runBringUp(
        ["--env-file", makeEnvFile(reg.url), "--re-register"],
        { pathPrefix: fake.binDir, env: { HEALTH_TIMEOUT: "1" } },
      )
      expect(status).toBe(EXIT.USAGE)
      expect(out).toContain("ainda existe")
      expect(out).toContain("labels NÃO seriam aplicados")
      expect(fake.dockerCalls().some((c) => c.includes("up -d runner"))).toBe(false)
    } finally {
      await reg.close()
    }
  })

  it("tag AUSENTE no modo re-registro → exit 5 e NENHUM 'compose' é executado", async () => {
    const reg = await startRegistry("missing")
    const fake = makeFakeCli({ volumes: [RUNNER_VOLUME] })
    try {
      const { status, out } = await runBringUp(
        ["--env-file", makeEnvFile(reg.url), "--re-register", "--source", "local"],
        { pathPrefix: fake.binDir },
      )
      expect(status).toBe(EXIT.PUBLISH_FAILED)
      expect(out).toContain("NADA foi subido")
      // Nem sequer o `rm -sf runner` rodou: a garantia vem antes de tudo.
      expect(fake.dockerCalls().filter((c) => c.startsWith("compose"))).toEqual([])
      // e o registro continua lá (nada foi apagado pela metade)
      expect(fake.volumes()).toContain(RUNNER_VOLUME)
    } finally {
      await reg.close()
    }
  })

  it("--re-register com --check-only ou --no-runner → exit 1 (contraditórios)", async () => {
    const fake = makeFakeCli()
    for (const combo of [
      ["--re-register", "--check-only"],
      ["--re-register", "--no-runner"],
    ]) {
      const { status, out } = await runBringUp(combo, { pathPrefix: fake.binDir })
      expect(status).toBe(EXIT.USAGE)
      expect(out).toContain("contraditórios")
    }
    expect(fake.dockerCalls()).toEqual([])
  })
})

// ── a PRONTIDÃO como pré-requisito, não como lembrete ───────────────────────
//
// O doctor já responde à pergunta inteira; o que se prova AQUI é a decisão da
// subida a partir do código que ele devolve. Sem estes casos, inserir o passo
// não mudaria nada: um doctor chamado e ignorado teria a mesma aparência de um
// doctor que recusa.

describe("deploy/gitea-up.sh — a prontidão (doctor) é pré-requisito da subida", () => {
  it("doctor BLOQUEADA (exit 1) → exit 1 e NENHUM 'compose up' (a stack não sobe)", async () => {
    const reg = await startRegistry("exists")
    const fake = makeFakeCli()
    const doctor = makeFakeDoctor(1)
    try {
      const { status, out } = await runBringUp(["--env-file", makeEnvFile(reg.url)], {
        pathPrefix: fake.binDir,
        env: { HEALTH_TIMEOUT: "1" },
        doctor,
      })
      expect(status).toBe(EXIT.USAGE)
      expect(out).toContain("BLOQUEADA")
      expect(out).toContain("NADA foi subido")
      // Nem Gitea/Caddy nem runner: nada é criado depois de um veredito ruim.
      expect(fake.dockerCalls().filter((c) => c.startsWith("compose"))).toEqual([])
    } finally {
      await reg.close()
    }
  })

  it("o doctor recebe o ENV desta subida e morre com o código que ele devolver", async () => {
    const reg = await startRegistry("exists")
    const fake = makeFakeCli()
    const doctor = makeFakeDoctor(0)
    try {
      const envFile = makeEnvFile(reg.url)
      const { status, out } = await runBringUp(["--env-file", envFile], {
        pathPrefix: fake.binDir,
        env: { HEALTH_TIMEOUT: "1" },
        doctor,
      })
      expect(status).toBe(EXIT.OK)
      expect(out).toContain("PRONTA")
      const calls = doctor.calls()
      expect(calls).toHaveLength(1)
      // O MESMO arquivo que o compose vai ler — senão o veredito mediria outro estado.
      expect(calls[0]).toContain(`--gitea-env ${envFile}`)
      // A prova do bloqueio do doctor EXECUTA este script: chamá-la daqui é recursão.
      expect(calls[0]).toContain("--no-proof")
    } finally {
      await reg.close()
    }
  })

  it("doctor INDETERMINADA (exit 2) → NÃO recusa: a stack sobe com o aviso", async () => {
    const reg = await startRegistry("exists")
    const fake = makeFakeCli()
    const doctor = makeFakeDoctor(2)
    try {
      const { status, out } = await runBringUp(["--env-file", makeEnvFile(reg.url)], {
        pathPrefix: fake.binDir,
        env: { HEALTH_TIMEOUT: "1" },
        doctor,
      })
      // "não consegui provar agora" (registry fora, sem token) não é violação:
      // recusar aqui tornaria a subida impossível offline, e a forja ficaria
      // sem como voltar.
      expect(status).toBe(EXIT.OK)
      expect(out).toContain("INDETERMINADA")
      const calls = fake.dockerCalls()
      expect(calls.some((c) => c.includes("up -d gitea caddy"))).toBe(true)
      expect(calls.some((c) => c.includes("up -d runner"))).toBe(true)
    } finally {
      await reg.close()
    }
  })

  it("doctor que nem rodou (exit 3) → exit 1 e nada sobe (sem veredito não há prontidão)", async () => {
    const reg = await startRegistry("exists")
    const fake = makeFakeCli()
    const doctor = makeFakeDoctor(3)
    try {
      const { status, out } = await runBringUp(["--env-file", makeEnvFile(reg.url)], {
        pathPrefix: fake.binDir,
        env: { HEALTH_TIMEOUT: "1" },
        doctor,
      })
      expect(status).toBe(EXIT.USAGE)
      expect(out).toContain("não conseguiu rodar")
      expect(fake.dockerCalls().filter((c) => c.startsWith("compose"))).toEqual([])
    } finally {
      await reg.close()
    }
  })

  it("--check-only com doctor BLOQUEADA → exit 1 e nada é tocado", async () => {
    const reg = await startRegistry("exists")
    const fake = makeFakeCli()
    const doctor = makeFakeDoctor(1)
    try {
      const { status, out } = await runBringUp(
        ["--env-file", makeEnvFile(reg.url), "--check-only"],
        { pathPrefix: fake.binDir, doctor },
      )
      // "--check-only" agora responde "dá para subir?" inteiro: ele também
      // recusa com o veredito bloqueado, em vez de dizer "imagem em ordem" e
      // deixar a subida real quebrar depois.
      expect(status).toBe(EXIT.USAGE)
      expect(out).toContain("BLOQUEADA")
      expect(fake.dockerCalls()).toEqual([])
    } finally {
      await reg.close()
    }
  })

  it("--re-register isenta o doctor do fato que ELE conserta (--no-runner-labels)", async () => {
    const reg = await startRegistry("exists")
    const fake = makeFakeCli()
    // INDETERMINADA é o que o doctor devolve com --no-runner-labels: o registro
    // gravado sai da conta, e por isso o remédio não fica travado pelo estado
    // que ele cura.
    const doctor = makeFakeDoctor(2)
    try {
      const { status, out } = await runBringUp(
        ["--env-file", makeEnvFile(reg.url), "--re-register"],
        { pathPrefix: fake.binDir, env: { HEALTH_TIMEOUT: "1" }, doctor },
      )
      expect(status).toBe(EXIT.OK)
      expect(doctor.calls()[0]).toContain("--no-runner-labels")
      // e o re-registro de fato aconteceu (o remédio não foi bloqueado)
      const calls = fake.dockerCalls()
      expect(calls.some((c) => c.includes("rm -sf runner"))).toBe(true)
      expect(calls.some((c) => c.includes("up -d runner"))).toBe(true)
      expect(out).toContain("RE-REGISTRADO")
    } finally {
      await reg.close()
    }
  })

  it("--no-runner NÃO chama o doctor (nada desta seção é pré-requisito de nada)", async () => {
    const reg = await startRegistry("missing")
    const fake = makeFakeCli()
    const doctor = makeFakeDoctor(1)
    try {
      const { status, out } = await runBringUp(
        ["--env-file", makeEnvFile(reg.url), "--no-runner"],
        { pathPrefix: fake.binDir, env: { HEALTH_TIMEOUT: "1" }, doctor },
      )
      expect(status).toBe(EXIT.OK)
      expect(out).toContain("pulando o veredito de prontidão")
      expect(doctor.calls()).toEqual([])
    } finally {
      await reg.close()
    }
  })
})
