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
//   4. `--check-only` não toca em nada.
//
// Método: `docker` e `gh` são SUBSTITUÍDOS por scripts no PATH que registram
// cada chamada (o `gh` fake sempre falha — sem ele um `gh` real autenticado na
// máquina do dev dispararia um workflow de verdade). O registry também é fake
// (node:http em 127.0.0.1) e a conexão com ele é REAL.
//
// Usage:
//   bunx vitest run --config vitest.config.unit.ts src/lib/__tests__/gitea-bring-up.test.ts
// =============================================================================

import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

function makeEnvFile(registryUrl: string): string {
  const path = join(makeTmp("env"), "gitea.env")
  writeFileSync(
    path,
    [
      `IMAGE_REGISTRY=${registryUrl}`,
      "IMAGE_NAMESPACE=severinno",
      "BUN_VERSION=1.3.14",
      "RUNNER_TOKEN=fake",
      "",
    ].join("\n"),
  )
  return path
}

interface RunResult {
  status: number | null
  out: string
}

function runBringUp(
  args: string[],
  opts: { pathPrefix: string; env?: Record<string, string> },
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(resolveBash(), [BRING_UP, ...args], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // node/curl/dirname seguem reais; docker e gh vêm do bin fake.
        PATH: `${opts.pathPrefix}:${process.env.PATH ?? ""}`,
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
