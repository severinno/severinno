// =============================================================================
// prove-forge-runtime.test.ts
//
// Testes do scripts/prove-forge-runtime.mjs — o ENSAIO da forja no runtime: a
// imagem do runner construída, o contrato provado DENTRO dela e o job `guards`
// inteiro executado no container, antes de publicar a imagem.
//
// O que precisa ser provado sobre o ensaio (e é o ponto todo):
//   1. a BATERIA não é uma segunda lista: sai do job `guards` da pipeline dona do
//      merge (`forgeGates`). Renomear um gate na pipeline muda o que é ensaiado,
//      e um gate cujo `run:` sumiu faz o ensaio RECUSAR em vez de rodar meia
//      bateria (um ensaio que prova menos do que diz é pior que nenhum);
//   2. o COMANDO vem da linha `run:`, não do rótulo — `rotate-secrets.mjs --check`
//      roda COM a flag (o rótulo a descarta). Executar o rótulo rodaria a
//      modalidade de EFEITO do script;
//   3. o contrato só é `proven` com a MARCA do bloco do Dockerfile, e o probe roda
//      contra a referência DECLARADA (a mesma que o compose pede) — não contra
//      uma tag solta;
//   4. `unavailable` (sem docker, sem build, imagem ausente) nunca vira "está
//      pronto": é exit 2, e o relatório declara o que o ensaio NÃO cobriu;
//   5. o job só roda DEPOIS do contrato: ensaiar a bateria contra um artefato
//      suspeito diria "os gates passam lá" sobre a imagem errada;
//   6. o parser não conta como verde um gate que não emitiu `code=`: um gate que
//      morreu antes do relatório é NÃO EXECUTADO, não sucesso.
//
// SEM docker e SEM rede: o `run` (spawnSync) é dublado por roteamento de argv, e
// o único processo externo é o `node` da CLI (para provar os exit codes).
// =============================================================================

import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { describe, expect, it } from "vitest"

import { CONTRACT_OK_MARK, DOCKERFILE } from "../../../scripts/check-runner-base.mjs"
import {
  DEFAULT_DOCKER_SOCK,
  DEFAULT_ENV_FILE,
  ENV_PROBE,
  EXIT,
  MARK,
  MERGE_OWNER_FILE,
  USAGE,
  WORKSPACE,
  assertContractInImage,
  buildRunnerImage,
  containerScript,
  exitCodeFor,
  forgeGatesForRuntime,
  lastNonEmpty,
  parseArgs,
  parseContainerOutput,
  rehearse,
  rehearsalResult,
  renderReport,
  resolveDockerSock,
  runGuardsInImage,
  summarizeRehearsal,
} from "../../../scripts/prove-forge-runtime.mjs"
// O env de referência é o TEMPLATE COMITADO: a ref esperada sai dele (o mesmo
// arquivo que o ensaio lê), e não de um literal que envelhece no registry velho.
import { parseEnvFile } from "../../../scripts/ensure-runner-image.mjs"

// ── fixtures ────────────────────────────────────────────────────────────────

/** A pipeline REAL — é dela que a bateria do ensaio é derivada em produção. */
const REAL_PIPELINE = readFileSync(join(process.cwd(), MERGE_OWNER_FILE), "utf8")

/** O env REAL de referência (o template comitado). */
const REAL_ENV = readFileSync(join(process.cwd(), DEFAULT_ENV_FILE), "utf8")

/** O Dockerfile REAL — o ensaio lê o bloco do contrato dele. */
const REAL_DOCKERFILE = readFileSync(join(process.cwd(), DOCKERFILE), "utf8")

/** O fonte do ensaio, para as invariantes estruturais (sem segunda lista). */
const SRC = readFileSync(join(process.cwd(), "scripts/prove-forge-runtime.mjs"), "utf8")

/** Linhas EXECUTÁVEIS do fonte (sem comentário) — onde uma segunda lista apareceria. */
const SRC_CODE = SRC.split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join("\n")

/** Um sandbox com o que o ensaio lê: a pipeline, o env e o Dockerfile. */
function sandbox({
  pipeline = REAL_PIPELINE,
  env = REAL_ENV,
  dockerfile = REAL_DOCKERFILE,
}: { pipeline?: string | null; env?: string | null; dockerfile?: string | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "forge-runtime-"))
  mkdirSync(join(dir, dirname(MERGE_OWNER_FILE)), { recursive: true })
  mkdirSync(join(dir, "deploy"), { recursive: true })
  if (pipeline !== null) writeFileSync(join(dir, MERGE_OWNER_FILE), pipeline)
  if (env !== null) writeFileSync(join(dir, DEFAULT_ENV_FILE), env)
  if (dockerfile !== null) writeFileSync(join(dir, DOCKERFILE), dockerfile)
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Uma pipeline mínima com um job `guards` — para isolar comportamentos. */
const MINI_PIPELINE = `name: ci
on: [push]
jobs:
  guards:
    name: Repo Guards
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/check-registry-source.mjs
`

// ── o dublê do `run` (spawnSync) ────────────────────────────────────────────

type StubResult = { status?: number | null; stdout?: string; stderr?: string }

/** Envolve um roteador de argv num dublê de `spawnSync` que registra as chamadas. */
function makeRun(router: (bin: string, args: string[], opts: unknown) => StubResult) {
  const calls: { bin: string; args: string[]; opts: unknown }[] = []
  const run = (bin: string, args: string[], opts?: unknown): StubResult => {
    calls.push({ bin, args, opts })
    const res = router(bin, args, opts)
    // `?? 0` seria o dublê MENTINDO: `status: null` (processo que nem rodou) é 125
    // no código real, e o teste do catálogo depende dessa distinção.
    return {
      status: res.status === undefined ? 0 : res.status,
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
    }
  }
  return { run, calls }
}

const isContractCall = (args: string[]) => args[0] === "run" && !args.includes("-w")
const isJobCall = (args: string[]) => args[0] === "run" && args.includes("-w")
/** O script passado em `-c` é o ÚLTIMO argumento — é dele que sai a bateria. */
const scriptOf = (args: string[]) => String(args[args.length - 1] ?? "")

/** Os rótulos que o script do container vai anunciar (na ordem em que ele os roda). */
function scriptLabels(script: string) {
  return [...script.matchAll(/printf "::gate (.+?) start\\n"/g)].map((m) => m[1])
}

const ENV_LINES = [
  "user=runner",
  `cwd=${WORKSPACE}`,
  "shell=/bin/bash",
  "node=v20.0.0",
  "bun=1.3.14",
  "bun-path=/usr/local/bin/bun",
  "docker=/usr/bin/docker",
  "compose=Docker Compose version v2.29.0",
  "git=git version 2.43.0",
  "node_modules=presente",
  "docker-sock=montado",
]

/**
 * A saída que o container produziria: o ambiente, e cada gate com a sua
 * delimitação. `codes[label] === null` simula o gate que NUNCA emitiu `code=`
 * (morreu antes de reportar) — o desfecho que o parser não pode contar como verde.
 */
function containerOutput(script: string, codes: Record<string, number | null> = {}) {
  const out = [...ENV_LINES]
  for (const label of scriptLabels(script)) {
    out.push(`::gate ${label} start`)
    out.push(`saida do gate ${label}`)
    const code = label in codes ? codes[label] : 0
    if (code === null) continue
    out.push(`::gate ${label} code=${code} secs=1`)
  }
  return out.join("\n")
}

/** Um roteador que atende build, contrato e o job do container. */
function forgeRun(
  overrides: {
    build?: number
    buildStderr?: string
    contract?: StubResult
    job?: number
    codes?: Record<string, number | null>
  } = {},
) {
  return makeRun((_bin, args) => {
    if (args[0] === "build") return { status: overrides.build ?? 0, stderr: overrides.buildStderr }
    if (isJobCall(args))
      return {
        status: overrides.job ?? 0,
        stdout: containerOutput(scriptOf(args), overrides.codes),
      }
    if (isContractCall(args)) return overrides.contract ?? { status: 0, stdout: CONTRACT_OK_MARK }
    return { status: 0 }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. parseArgs — o contrato da CLI
// ═══════════════════════════════════════════════════════════════════════════

describe("parseArgs", () => {
  it("os defaults são os do ensaio real (constrói, sem install, 300s por gate)", () => {
    const opts = parseArgs([])
    expect(opts).toMatchObject({
      build: true,
      install: false,
      only: null,
      envFile: DEFAULT_ENV_FILE,
      bunVersion: null,
      timeoutS: 300,
      docker: "docker",
      json: false,
      help: false,
    })
    expect(opts.error).toBeUndefined()
  })

  it("as flags booleanas são reconhecidas", () => {
    const opts = parseArgs(["--no-build", "--install", "--json", "-h"])
    expect(opts).toMatchObject({ build: false, install: true, json: true, help: true })
  })

  it("o socket é montado por padrão (é o que o runner da forja tem)", () => {
    expect(parseArgs([]).dockerSock).toBe(DEFAULT_DOCKER_SOCK)
    expect(parseArgs(["--no-docker-sock"]).dockerSock).toBe(false)
    expect(parseArgs(["--docker-sock", "/tmp/x.sock"]).dockerSock).toBe("/tmp/x.sock")
    expect(parseArgs(["--docker-sock"]).error).toBeTruthy()
    expect(parseArgs(["--docker-sock", "--json"]).error).toBeTruthy()
  })

  it("as flags com valor passam o valor", () => {
    const opts = parseArgs([
      "--only",
      "check:registry-source",
      "--gitea-env",
      "deploy/.env.gitea",
      "--bun-version",
      "1.3.14",
      "--docker",
      "nerdctl",
      "--timeout",
      "42",
    ])
    expect(opts).toMatchObject({
      only: "check:registry-source",
      envFile: "deploy/.env.gitea",
      bunVersion: "1.3.14",
      docker: "nerdctl",
      timeoutS: 42,
    })
    expect(opts.error).toBeUndefined()
  })

  it("a flag sem valor é ERRO, não um valor engolido", () => {
    // O pior desfecho seria `--only --json` virar `only: "--json"` e o ensaio
    // rodar zero gates cantando sucesso.
    for (const argv of [
      ["--only"],
      ["--only", "--json"],
      ["--gitea-env"],
      ["--bun-version"],
      ["--docker"],
    ]) {
      expect(parseArgs(argv).error, argv.join(" ")).toBeTruthy()
    }
  })

  it("um timeout não numérico (ou zero) é ERRO", () => {
    expect(parseArgs(["--timeout", "abc"]).error).toBeTruthy()
    expect(parseArgs(["--timeout", "0"]).error).toBeTruthy()
    expect(parseArgs(["--timeout", "-5"]).error).toBeTruthy()
    expect(parseArgs(["--timeout"]).error).toBeTruthy()
  })

  it("argumento desconhecido é ERRO", () => {
    expect(parseArgs(["--nope"]).error).toContain("--nope")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. O script do container e o parser
// ═══════════════════════════════════════════════════════════════════════════

describe("containerScript", () => {
  const gates = [
    { label: "bun run check:registry-source", command: "bun run check:registry-source" },
    { label: "scripts/rotate-secrets.mjs", command: "bun scripts/rotate-secrets.mjs --check" },
  ]

  it("roda cada gate com timeout próprio e delimitação (o log concatenado não serve)", () => {
    const script = containerScript({ gates, timeoutS: 300 })
    expect(script).toContain('printf "::gate bun run check:registry-source start\\n"')
    expect(script).toContain("timeout 300 bun run check:registry-source 2>&1")
    expect(script).toContain('printf "::gate bun run check:registry-source code=%s secs=%s\\n"')
  })

  it("roda o COMANDO da pipeline, não o rótulo — a flag `--check` é preservada", () => {
    // O rótulo é uma identidade para classificar; o comando carrega as flags.
    // Executar o rótulo rodaria o script na modalidade de EFEITO.
    const script = containerScript({ gates, timeoutS: 300 })
    expect(script).toContain("timeout 300 bun scripts/rotate-secrets.mjs --check 2>&1")
    expect(script).not.toMatch(/^timeout 300 scripts\/rotate-secrets\.mjs$/m)
  })

  it("o `install` é decidido por VARIÁVEL: o mesmo script serve aos dois modos", () => {
    // Decidir por texto do script faria dois geradores — e o modo executado
    // deixaria de estar no log.
    const script = containerScript({ gates, timeoutS: 300 })
    expect(script).toContain('if [ "${SKIP_INSTALL:-1}" != "1" ]; then')
    expect(script).toContain("bun install --frozen-lockfile")
    expect(SRC_CODE).toContain("SKIP_INSTALL")
  })

  it("mede o AMBIENTE do job (é onde a diferença entre as máquinas aparece)", () => {
    const script = containerScript({ gates, timeoutS: 300 })
    for (const probe of [
      "user=",
      "cwd=",
      "bun=",
      "bun-path=",
      "docker=",
      "compose=",
      "git=",
      "node_modules=",
      "docker-sock=",
    ]) {
      expect(script, probe).toContain(probe)
    }
    expect(ENV_PROBE).toContain("docker compose version")
    expect(ENV_PROBE).toContain("/var/run/docker.sock")
  })

  it("um timeout maior para o install (ele baixa; os gates não)", () => {
    const script = containerScript({ gates, timeoutS: 10 })
    expect(script).toContain("timeout 900 bun install --frozen-lockfile")
  })
})

describe("parseContainerOutput", () => {
  const gates = [
    { label: "bun run a", command: "bun run a" },
    { label: "bun run b", command: "bun run b" },
  ]

  it("lê o ambiente e um resultado por gate, com a saída DO gate", () => {
    const script = containerScript({ gates, timeoutS: 300 })
    const parsed = parseContainerOutput(
      containerOutput(script),
      gates.map((g) => g.label),
    )
    expect(parsed.env.user).toBe("runner")
    expect(parsed.env["bun-path"]).toBe("/usr/local/bin/bun")
    expect(parsed.env.node_modules).toBe("presente")
    expect(parsed.env["docker-sock"]).toBe("montado")
    expect(parsed.gates.map((g) => [g.label, g.code])).toEqual([
      ["bun run a", 0],
      ["bun run b", 0],
    ])
    expect(parsed.gates[0].output).toContain("saida do gate bun run a")
    expect(parsed.gates[0].output).not.toContain("saida do gate bun run b")
  })

  it("um gate que NÃO emitiu `code=` é NÃO EXECUTADO (null), nunca verde", () => {
    const script = containerScript({ gates, timeoutS: 300 })
    const parsed = parseContainerOutput(
      containerOutput(script, { "bun run b": null }),
      gates.map((g) => g.label),
    )
    expect(parsed.gates.find((g) => g.label === "bun run a")?.code).toBe(0)
    expect(parsed.gates.find((g) => g.label === "bun run b")?.code).toBeNull()
  })

  it("um gate que nem apareceu na saída entra como NÃO EXECUTADO", () => {
    const parsed = parseContainerOutput("user=x", ["bun run sumiu"])
    expect(parsed.gates).toEqual([
      { label: "bun run sumiu", code: null, seconds: null, output: "" },
    ])
  })

  it("lê o bloco do install quando ele rodou", () => {
    const out = ["::install start", "bun install v1.3.14", "::install code=0", "user=r"].join("\n")
    const parsed = parseContainerOutput(out, [])
    expect(parsed.install?.code).toBe(0)
    expect(parsed.install?.output).toContain("bun install v1.3.14")
  })

  it("saída ausente/vazia não explode: vira tudo NÃO EXECUTADO", () => {
    const parsed = parseContainerOutput("", ["a", "b"])
    expect(parsed.gates.every((g) => g.code === null)).toBe(true)
    expect(parsed.env).toEqual({})
    expect(parsed.install).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. A bateria vem da pipeline (fonte única) — e só ela
// ═══════════════════════════════════════════════════════════════════════════

describe("forgeGatesForRuntime", () => {
  it("deriva a bateria REAL do job `guards`, com comando para cada gate", () => {
    const derived = forgeGatesForRuntime()
    expect(derived.ok).toBe(true)
    expect(derived.gates.length).toBeGreaterThan(10)
    expect(derived.gates.every((g) => g.command)).toBe(true)
    expect(derived.detail).toContain("job 'guards'")
    // Um gate conhecido está lá — e com o comando CANÔNICO da LINHA, não o
    // rótulo (que é a identidade do gate, sem lançador nem argumentos).
    expect(derived.gates.some((g) => g.command === "node scripts/check-registry-source.mjs")).toBe(
      true,
    )
  })

  it("o ensaio NÃO tem uma segunda lista: o fonte não cita gate algum", () => {
    // Se alguém cravar a bateria aqui, ela envelhece em silêncio enquanto a
    // pipeline ganha gates novos — e o ensaio passa a provar menos do que diz.
    expect(SRC_CODE).not.toMatch(/bun run check:[a-z]/)
    expect(SRC).not.toMatch(/const\s+GATES\s*=/)
  })

  it("renomear um gate na pipeline muda a bateria ensaiada (mutação)", () => {
    const mutated = MINI_PIPELINE.replace("check-registry-source.mjs", "check-inventado.mjs")
    const { dir, cleanup } = sandbox({ pipeline: mutated })
    try {
      const derived = forgeGatesForRuntime(dir)
      expect(derived.ok).toBe(true)
      expect(derived.gates.map((g) => g.command)).toEqual(["node scripts/check-inventado.mjs"])
    } finally {
      cleanup()
    }
  })

  it("gate sem linha `run:` executável faz o ensaio RECUSAR (não roda meia bateria)", () => {
    // Um workflow reutilizável vira rótulo mas não tem `run:` — se o ensaio o
    // ignorasse em silêncio, ele diria "os gates passam" sem tê-lo rodado.
    const pipeline = `${MINI_PIPELINE}      - uses: ./.github/workflows/reusable.yml\n`
    const { dir, cleanup } = sandbox({ pipeline })
    try {
      const derived = forgeGatesForRuntime(dir)
      expect(derived.ok).toBe(false)
      expect(derived.gates).toEqual([])
      expect(derived.detail).toContain("sem linha executável")
      expect(derived.detail).toContain("reusable.yml")
    } finally {
      cleanup()
    }
  })

  it("pipeline ausente é `ok: false` nomeando o arquivo", () => {
    const { dir, cleanup } = sandbox({ pipeline: null })
    try {
      const derived = forgeGatesForRuntime(dir)
      expect(derived.ok).toBe(false)
      expect(derived.detail).toContain(MERGE_OWNER_FILE)
    } finally {
      cleanup()
    }
  })

  it("job `guards` inexistente é `ok: false` (a bateria não tem de onde sair)", () => {
    const { dir, cleanup } = sandbox({
      pipeline: "name: ci\non: [push]\njobs:\n  outro:\n    steps:\n      - run: ls\n",
    })
    try {
      const derived = forgeGatesForRuntime(dir)
      expect(derived.ok).toBe(false)
      expect(derived.detail).toContain("guards")
    } finally {
      cleanup()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. Etapa 1 — o build marca a imagem com a referência DECLARADA
// ═══════════════════════════════════════════════════════════════════════════

describe("buildRunnerImage", () => {
  const REF = "ghcr.io/severinno/ubuntu-bun:1.3.14"

  it("constrói com o BUN_VERSION declarado e marca com a referência que o compose pede", () => {
    const { run, calls } = forgeRun()
    const res = buildRunnerImage({ ref: REF, version: "1.3.14", run })
    expect(res.ok).toBe(true)
    const args = calls[0].args
    expect(args.slice(0, 2)).toEqual(["build", "--build-arg"])
    expect(args).toContain("BUN_VERSION=1.3.14")
    expect(args).toContain("-f")
    expect(args).toContain(DOCKERFILE)
    expect(args).toContain("-t")
    expect(args).toContain(REF)
  })

  it("build que falha para o ensaio (sem artefato não há ensaio)", () => {
    const { run } = forgeRun({ build: 1, buildStderr: "ERROR: failed to solve" })
    const res = buildRunnerImage({ ref: REF, version: "1.3.14", run })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(1)
    expect(res.detail).toContain("FALHOU")
    expect(res.output).toContain("failed to solve")
  })

  it("--no-build reusa a imagem local e DIZ que reusou", () => {
    const { run, calls } = forgeRun()
    const res = buildRunnerImage({ ref: REF, version: "1.3.14", run, build: false })
    expect(res.ok).toBe(true)
    expect(res.skipped).toBe(true)
    expect(res.detail).toContain("--no-build")
    expect(calls[0].args).toEqual(["image", "inspect", REF])
  })

  it("--no-build sem a imagem local é falha com o remédio escrito", () => {
    const { run } = makeRun((_b, args) => (args[0] === "image" ? { status: 1 } : { status: 0 }))
    const res = buildRunnerImage({ ref: REF, version: "1.3.14", run, build: false })
    expect(res.ok).toBe(false)
    expect(res.detail).toContain("NÃO existe localmente")
    expect(res.detail).toContain("sem a flag")
  })

  it("o catálogo do docker é de onde sai o status (sem status = 125, nunca 0)", () => {
    const { run } = makeRun(() => ({ status: null }))
    expect(buildRunnerImage({ ref: REF, version: "1.3.14", run }).code).toBe(125)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. Etapa 2 — o contrato é provado por EXECUÇÃO dentro do artefato
// ═══════════════════════════════════════════════════════════════════════════

describe("assertContractInImage", () => {
  const REF = "ghcr.io/severinno/ubuntu-bun:1.3.14"

  it("`proven` só com a MARCA do bloco do contrato no stdout", () => {
    const { run } = forgeRun()
    return assertContractInImage({ ref: REF, version: "1.3.14", run }).then((res) => {
      expect(res.ok).toBe(true)
      expect(res.state).toBe("proven")
      expect(res.detail).toContain(CONTRACT_OK_MARK)
    })
  })

  it("sair 0 SEM a marca é VIOLADO — o bloco não é o do contrato", () => {
    const { run } = forgeRun({ contract: { status: 0, stdout: "tudo certo, confia" } })
    return assertContractInImage({ ref: REF, version: "1.3.14", run }).then((res) => {
      expect(res.state).toBe("violated")
      expect(res.ok).toBe(false)
      expect(res.detail).toContain("NAO cumpre o contrato")
    })
  })

  it("o docker que não roda as asserções é `unavailable` (não acusação)", () => {
    const { run } = forgeRun({
      contract: { status: 125, stderr: "docker: Error response from daemon: pull access denied" },
    })
    return assertContractInImage({ ref: REF, version: "1.3.14", run }).then((res) => {
      expect(res.state).toBe("unavailable")
      expect(res.ok).toBe(false)
      expect(res.detail).toContain("nao rodou as assercoes")
    })
  })

  it("executa o BLOCO real do Dockerfile, com a versão esperada — não um comando inventado", () => {
    const { run, calls } = forgeRun()
    return assertContractInImage({ ref: REF, version: "1.3.14", run }).then(() => {
      const args = calls[0].args
      expect(args.slice(0, 4)).toEqual(["run", "--rm", "--entrypoint", "bash"])
      expect(args).toContain("BUN_VERSION=1.3.14")
      expect(args).toContain(REF)
      expect(args[args.length - 1]).toContain(CONTRACT_OK_MARK)
      expect(args[args.length - 1]).toContain("docker compose version")
    })
  })

  it("Dockerfile sem o RUN do contrato é `unavailable` (não dá para provar o que sumiu)", () => {
    const { run } = forgeRun()
    return assertContractInImage({
      ref: REF,
      version: "1.3.14",
      run,
      text: "FROM base\nRUN ls\n",
    }).then((res) => {
      expect(res.state).toBe("unavailable")
      expect(res.detail).toContain("nenhum RUN")
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. Etapa 3 — o job `guards` inteiro dentro da imagem
// ═══════════════════════════════════════════════════════════════════════════

describe("runGuardsInImage", () => {
  const REF = "ghcr.io/severinno/ubuntu-bun:1.3.14"
  const gates = [{ label: "bun run a", command: "bun run a" }]

  it("monta o repo no workspace, roda COMO a imagem e exporta o que o step exporta", () => {
    const { run, calls } = forgeRun()
    runGuardsInImage({
      ref: REF,
      gates,
      version: "1.3.14",
      registry: "ghcr.io",
      namespace: "severinno",
      run,
    })
    const args = calls[0].args
    expect(args).toContain("--rm")
    expect(args.slice(1, 4)).toEqual(["--rm", "--entrypoint", "bash"])
    expect(args).toContain("-v")
    expect(args).toContain(`${process.cwd()}:${WORKSPACE}`)
    expect(args).toContain("-w")
    expect(args).toContain(WORKSPACE)
    for (const env of [
      "BUN_VERSION=1.3.14",
      "CI=true",
      "IMAGE_REGISTRY=ghcr.io",
      "IMAGE_NAMESPACE=severinno",
    ]) {
      expect(args, env).toContain(env)
    }
  })

  it("o workspace montado pertence a OUTRO uid: `safe.directory` entra de propósito", () => {
    // Sem isso o git recusa o repositório por "dubious ownership" — um gate que
    // usa o git falharia por um motivo que NÃO existe na forja.
    const { run, calls } = forgeRun()
    runGuardsInImage({ ref: REF, gates, version: "1.3.14", run })
    const args = calls[0].args
    expect(args).toContain("GIT_CONFIG_KEY_0=safe.directory")
    expect(args).toContain(`GIT_CONFIG_VALUE_0=${WORKSPACE}`)
  })

  it("sem registry/namespace não inventa variável (o guard leria um valor falso)", () => {
    const { run, calls } = forgeRun()
    runGuardsInImage({ ref: REF, gates, version: "1.3.14", run })
    expect(calls[0].args.some((a) => a.startsWith("IMAGE_REGISTRY="))).toBe(false)
    expect(calls[0].args.some((a) => a.startsWith("IMAGE_NAMESPACE="))).toBe(false)
  })

  it("o install é LIGADO por variável, e o log diz se ele rodou", () => {
    const { run, calls } = forgeRun()
    runGuardsInImage({ ref: REF, gates, version: "1.3.14", run, install: true })
    expect(calls[0].args).toContain("SKIP_INSTALL=0")
    const { run: r2, calls: c2 } = forgeRun()
    runGuardsInImage({ ref: REF, gates, version: "1.3.14", run: r2, install: false })
    expect(c2[0].args).toContain("SKIP_INSTALL=1")
  })

  it("devolve o resultado POR GATE (com a saída do gate que falhou)", () => {
    const { run } = forgeRun({ codes: { "bun run a": 1 } })
    const res = runGuardsInImage({ ref: REF, gates, version: "1.3.14", run })
    expect(res.code).toBe(0) // o container em si saiu 0
    expect(res.parsed.gates[0].code).toBe(1)
    expect(res.parsed.gates[0].output).toContain("saida do gate bun run a")
    expect(res.target).toBe(REF)
  })

  it("docker que não roda o container (sem status) é 125 — não é 'os gates passaram'", () => {
    const { run } = makeRun(() => ({ status: null }))
    const res = runGuardsInImage({ ref: REF, gates, version: "1.3.14", run })
    expect(res.code).toBe(125)
    expect(res.parsed.gates[0].code).toBeNull()
  })

  it("monta o socket do docker quando ele existe — como o runner da forja", () => {
    const { run, calls } = forgeRun()
    runGuardsInImage({
      ref: REF,
      gates,
      version: "1.3.14",
      run,
      dockerSock: DEFAULT_DOCKER_SOCK,
    })
    const args = calls[0].args
    const at = args.indexOf(`${DEFAULT_DOCKER_SOCK}:${DEFAULT_DOCKER_SOCK}`)
    expect(at).toBeGreaterThan(0)
    expect(args[at - 1]).toBe("-v")
  })

  it("sem socket NÃO monta nada (não inventa um -v que o host não tem)", () => {
    const { run, calls } = forgeRun()
    runGuardsInImage({ ref: REF, gates, version: "1.3.14", run, dockerSock: null })
    // O caminho do socket aparece no script (a sonda o mede); o que não pode
    // aparecer é o MOUNT.
    expect(calls[0].args).not.toContain(`${DEFAULT_DOCKER_SOCK}:${DEFAULT_DOCKER_SOCK}`)
  })
})

describe("resolveDockerSock", () => {
  it("monta quando o socket existe", () => {
    expect(resolveDockerSock({ exists: () => true }).sock).toBe(DEFAULT_DOCKER_SOCK)
  })

  it("--no-docker-sock desliga — e o relatório diz QUEM desligou", () => {
    const res = resolveDockerSock({ requested: false, exists: () => true })
    expect(res.sock).toBeNull()
    expect(res.detail).toContain("--no-docker-sock")
  })

  it("socket inexistente desliga, mas DIZENDO o caminho (um vermelho se lê diferente)", () => {
    const res = resolveDockerSock({ exists: () => false })
    expect(res.sock).toBeNull()
    expect(res.detail).toContain("nao existe neste host")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. O veredito — três estados, e o do meio é o que evita a mentira
// ═══════════════════════════════════════════════════════════════════════════

describe("summarizeRehearsal", () => {
  const gates = [{ label: "bun run a" }, { label: "bun run b" }]
  const okBuild = { ok: true, detail: "construída" }
  const okContract = { ok: true, state: "proven", detail: "contrato ok" }
  const jobWith = (codes: (number | null)[]) => ({
    code: 0,
    output: "",
    target: "ref",
    parsed: {
      env: {},
      install: null,
      gates: gates.map((g, i) => ({ label: g.label, code: codes[i], seconds: 1, output: "" })),
    },
  })

  it("build falhou → unavailable com o detalhe do build (ausência de prova)", () => {
    const res = summarizeRehearsal({
      build: { ok: false, detail: "o build FALHOU" },
      contract: okContract,
      job: null,
      gates,
      install: false,
    })
    expect(res.verdict).toBe("unavailable")
    expect(res.blockers).toEqual([])
    expect(res.detail).toContain("build FALHOU")
  })

  it("contrato VIOLADO → failed com blocker (não é 'não deu para ensaiar')", () => {
    const res = summarizeRehearsal({
      build: okBuild,
      contract: { ok: false, state: "violated", detail: "falta o plugin compose" },
      job: null,
      gates,
      install: false,
    })
    expect(res.verdict).toBe("failed")
    expect(res.blockers).toEqual(["falta o plugin compose"])
  })

  it("contrato que não deu para rodar → unavailable, sem blocker", () => {
    const res = summarizeRehearsal({
      build: okBuild,
      contract: { ok: false, state: "unavailable", detail: "sem daemon" },
      job: null,
      gates,
      install: false,
    })
    expect(res.verdict).toBe("unavailable")
    expect(res.blockers).toEqual([])
  })

  it("um gate que FALHOU no container nomeia o gate e o exit", () => {
    const res = summarizeRehearsal({
      build: okBuild,
      contract: okContract,
      job: jobWith([0, 1]),
      gates,
      install: false,
    })
    expect(res.verdict).toBe("failed")
    expect(res.blockers[0]).toContain("bun run b")
    expect(res.blockers[0]).toContain("exit 1")
    expect(res.detail).toContain("1 de 2")
  })

  it("um gate que NÃO EXECUTOU também derruba o ensaio", () => {
    const res = summarizeRehearsal({
      build: okBuild,
      contract: okContract,
      job: jobWith([null, 0]),
      gates,
      install: false,
    })
    expect(res.verdict).toBe("failed")
    expect(res.blockers[0]).toContain("NAO EXECUTOU")
  })

  it("tudo verde → proven, e SEM --install o relatório admite o node_modules do host", () => {
    const res = summarizeRehearsal({
      build: okBuild,
      contract: okContract,
      job: jobWith([0, 0]),
      gates,
      install: false,
    })
    expect(res.verdict).toBe("proven")
    expect(res.detail).toContain("2 gate(s)")
    expect(res.detail).toContain("--install")
    const withInstall = summarizeRehearsal({
      build: okBuild,
      contract: okContract,
      job: jobWith([0, 0]),
      gates,
      install: true,
    })
    expect(withInstall.detail).not.toContain("--install")
  })

  it("sem a etapa 3 (job null) o veredito é INDETERMINADO, não provado", () => {
    const res = summarizeRehearsal({
      build: okBuild,
      contract: okContract,
      job: null,
      gates,
      install: false,
    })
    expect(res.verdict).toBe("unavailable")
    expect(res.detail).toContain("nao foram executados")
  })
})

describe("exitCodeFor", () => {
  it("proven=0 · failed=1 · unavailable=2 · uso=3", () => {
    expect(exitCodeFor("proven")).toBe(EXIT.OK)
    expect(exitCodeFor("failed")).toBe(EXIT.FAILED)
    expect(exitCodeFor("unavailable")).toBe(EXIT.UNAVAILABLE)
    expect(EXIT.USAGE).toBe(3)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8. A orquestração — e a ORDEM das etapas
// ═══════════════════════════════════════════════════════════════════════════

describe("rehearse", () => {
  it("env de referência ausente é unavailable com o remédio (--gitea-env)", async () => {
    const { dir, cleanup } = sandbox({ env: null })
    try {
      const res = await rehearse({ cwd: dir })
      expect(res.verdict).toBe("unavailable")
      expect(res.detail).toContain(DEFAULT_ENV_FILE)
      expect(res.detail).toContain("--gitea-env")
    } finally {
      cleanup()
    }
  })

  it("pipeline ilegível é unavailable — nada é construído", async () => {
    const { dir, cleanup } = sandbox({ pipeline: null })
    try {
      const { run } = forgeRun()
      const res = await rehearse({ cwd: dir, run })
      expect(res.verdict).toBe("unavailable")
      expect(res.detail).toContain(MERGE_OWNER_FILE)
    } finally {
      cleanup()
    }
  })

  it("--only que não casa com nenhum gate é unavailable (não é ensaio de zero gates verdes)", async () => {
    const { dir, cleanup } = sandbox()
    try {
      const res = await rehearse({ cwd: dir, only: "check:nao-existe" })
      expect(res.verdict).toBe("unavailable")
      expect(res.detail).toContain("--only")
    } finally {
      cleanup()
    }
  })

  it("o caminho feliz: build + contrato + a bateria real inteira em 0 → proven, exit 0", async () => {
    const { dir, cleanup } = sandbox()
    try {
      const { run, calls } = forgeRun()
      const res = await rehearse({ cwd: dir, run })
      expect(res.verdict).toBe("proven")
      expect(exitCodeFor(res.verdict)).toBe(0)
      expect(res.ref).toContain("ubuntu-bun:1.3.14")
      expect(res.pipeline).toBe(MERGE_OWNER_FILE)
      expect(res.gates.length).toBe(forgeGatesForRuntime(dir).gates.length)
      // as três etapas rodaram, nesta ordem
      expect(calls.map((c) => c.args[0])).toEqual(["build", "run", "run"])
      expect(res.job?.parsed.gates.every((g) => g.code === 0)).toBe(true)
    } finally {
      cleanup()
    }
  })

  it("--bun-version sobrescreve a versão declarada (o que `vars.BUN_VERSION` daria)", async () => {
    const { dir, cleanup } = sandbox()
    try {
      const { run, calls } = forgeRun()
      const res = await rehearse({ cwd: dir, run, bunVersion: "9.9.9" })
      expect(res.verdict).toBe("proven")
      expect(res.version).toBe("9.9.9")
      expect(calls[0].args).toContain("BUN_VERSION=9.9.9")
    } finally {
      cleanup()
    }
  })

  it("contrato NÃO provado: o job nem roda (ensaiar a bateria contra artefato suspeito mentiria)", async () => {
    const { dir, cleanup } = sandbox()
    try {
      const { run, calls } = forgeRun({ contract: { status: 0, stdout: "sem a marca" } })
      const res = await rehearse({ cwd: dir, run })
      expect(res.verdict).toBe("failed")
      expect(res.job).toBeNull()
      expect(calls.map((c) => c.args[0])).toEqual(["build", "run"])
    } finally {
      cleanup()
    }
  })

  it("um gate que FALHA dentro da imagem derruba o ensaio, com o nome do gate", async () => {
    const { dir, cleanup } = sandbox()
    try {
      const first = forgeGatesForRuntime(dir).gates[0]
      const { run } = forgeRun({ codes: { [first.label]: 3 } })
      const res = await rehearse({ cwd: dir, run })
      expect(res.verdict).toBe("failed")
      expect(res.blockers.join(" ")).toContain(first.label)
      expect(res.blockers.join(" ")).toContain("exit 3")
    } finally {
      cleanup()
    }
  })

  it("--only reduz a bateria — e o relatório diz quantos gates ensaiou", async () => {
    const { dir, cleanup } = sandbox()
    try {
      const { run, calls } = forgeRun()
      // `--only` casa o RÓTULO (a identidade do gate = o caminho do script).
      const res = await rehearse({ cwd: dir, run, only: "check-runner-base" })
      expect(res.verdict).toBe("proven")
      expect(res.gates.map((g) => g.command)).toEqual(["node scripts/check-runner-base.mjs"])
      expect(res.job?.parsed.gates.length).toBe(1)
      // e o container recebeu só esse gate (a marca do script é o RÓTULO — a
      // identidade do gate; a linha executada é o `command`).
      expect(scriptLabels(scriptOf(calls[2].args))).toEqual(["scripts/check-runner-base.mjs"])
    } finally {
      cleanup()
    }
  })

  it("o socket do host entra no job (sem ele um gate que use o docker falharia por engano)", async () => {
    const { dir, cleanup } = sandbox()
    try {
      const { run, calls } = forgeRun()
      const res = await rehearse({
        cwd: dir,
        run,
        dockerSock: "/tmp/sock-de-teste",
        exists: () => true,
      })
      expect(res.dockerSock).toBe("/tmp/sock-de-teste")
      expect(res.sockDetail).toContain("montado")
      expect(calls[2].args).toContain(`/tmp/sock-de-teste:${DEFAULT_DOCKER_SOCK}`)
      expect(res.verdict).toBe("proven")
    } finally {
      cleanup()
    }
  })

  it("sem socket, o ensaio continua — e o resultado DECLARA que não tinha", async () => {
    const { dir, cleanup } = sandbox()
    try {
      const { run, calls } = forgeRun()
      const res = await rehearse({ cwd: dir, run, dockerSock: false })
      expect(res.dockerSock).toBeNull()
      expect(res.sockDetail).toContain("--no-docker-sock")
      expect(calls[2].args).not.toContain(`${DEFAULT_DOCKER_SOCK}:${DEFAULT_DOCKER_SOCK}`)
    } finally {
      cleanup()
    }
  })

  it("build que falha é unavailable (exit 2) e não roda asserção nenhuma", async () => {
    const { dir, cleanup } = sandbox()
    try {
      const { run, calls } = forgeRun({ build: 1 })
      const res = await rehearse({ cwd: dir, run })
      expect(res.verdict).toBe("unavailable")
      expect(exitCodeFor(res.verdict)).toBe(2)
      expect(calls.length).toBe(1)
    } finally {
      cleanup()
    }
  })
})

describe("rehearsalResult", () => {
  it("todo desfecho tem o MESMO formato (o --json de um indeterminado não muda de shape)", async () => {
    const { dir, cleanup } = sandbox()
    try {
      const ok = await rehearse({ cwd: dir, run: forgeRun().run })
      const failed = await rehearse({ cwd: dir, run: forgeRun({ build: 1 }).run })
      const missing = await rehearse({ cwd: join(dir, "nao-existe") })
      const keys = Object.keys(rehearsalResult()).sort()
      expect(Object.keys(ok).sort()).toEqual(keys)
      expect(Object.keys(failed).sort()).toEqual(keys)
      expect(Object.keys(missing).sort()).toEqual(keys)
      // e os campos que não se aplicam vêm NULOS/vazios, não ausentes
      expect(missing.ref).toBeNull()
      expect(missing.gates).toEqual([])
      expect(failed.job).toBeNull()
      expect(missing.blockers).toEqual([])
      expect(missing.pipeline).toBe(MERGE_OWNER_FILE)
    } finally {
      cleanup()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9. O relatório
// ═══════════════════════════════════════════════════════════════════════════

describe("renderReport", () => {
  const gates = [{ label: "bun run a", command: "bun run a" }]

  function render(result: object) {
    const lines: string[] = []
    renderReport({ ...baseResult(), ...result }, { emit: (s) => lines.push(s ?? "") })
    return lines.join("\n")
  }

  function baseResult() {
    return {
      ref: "ghcr.io/severinno/ubuntu-bun:1.3.14",
      version: "1.3.14",
      pipeline: MERGE_OWNER_FILE,
      gates,
      install: false,
      build: { ok: true, detail: "construída", skipped: false, output: "" },
      contract: { ok: true, state: "proven", detail: "contrato ok" },
      job: {
        parsed: {
          env: {
            user: "runner",
            cwd: WORKSPACE,
            node: "v20",
            bun: "1.3.14",
            "bun-path": "/usr/local/bin/bun",
            docker: "/usr/bin/docker",
            compose: "Docker Compose version v2.29.0",
            git: "git version 2.43.0",
            node_modules: "presente",
          },
          gates: [{ ...gates[0], code: 0, seconds: 2, output: "ok" }],
          install: null,
        },
      },
      verdict: "proven",
      detail: "1 gate saiu 0",
      blockers: [],
      dockerSock: DEFAULT_DOCKER_SOCK,
      sockDetail: `${DEFAULT_DOCKER_SOCK} montado (o job da forja tem o socket)`,
    }
  }

  it("mostra as três etapas, o ambiente do job e o veredito", () => {
    const text = render({})
    expect(text).toContain("ENSAIO DA FORJA NO RUNTIME")
    expect(text).toContain("1/3")
    expect(text).toContain("2/3")
    expect(text).toContain("3/3")
    expect(text).toContain("RUNTIME PROVADO")
    expect(text).toContain("ambiente:")
    expect(text).toContain("(/usr/local/bin/bun)")
    expect(text).toContain("compose=Docker Compose version")
  })

  it("um gate que falhou mostra a SAÍDA dele (senão o diagnóstico se perde no log)", () => {
    const job = baseResult().job
    const text = render({
      verdict: "failed",
      detail: "1 de 1 nao passaram",
      blockers: ["gate 'bun run a' FALHOU dentro da imagem (exit 1)"],
      job: {
        parsed: {
          ...job.parsed,
          gates: [{ ...gates[0], code: 1, seconds: 3, output: "erro: campo sensivel vazou\n" }],
        },
      },
    })
    expect(text).toContain("O RUNTIME QUEBRA")
    expect(text).toContain("exit 1")
    expect(text).toContain("erro: campo sensivel vazou")
  })

  it("declara o que NÃO cobre — inclusive o node_modules do host sem --install", () => {
    const text = render({})
    expect(text).toContain("O QUE O ENSAIO NÃO COBRE")
    expect(text).toContain("RUNNER")
    expect(text).toContain("vars.BUN_VERSION")
    expect(text).toContain("node_modules da forja")
    expect(text).toContain("socket    : /var/run/docker.sock montado")
  })

  it("sem o socket, o relatório diz que o docker DENTRO do job não foi provado", () => {
    const text = render({ dockerSock: null, sockDetail: "desligado por --no-docker-sock" })
    expect(text).toContain("desligado por --no-docker-sock")
    expect(text).toContain("o docker DENTRO do job")
    expect(text).toContain("--docker-sock")
  })

  it("com --install a linha do node_modules sai do 'não cobre'", () => {
    const text = render({ install: true })
    expect(text).not.toContain("node_modules da forja")
  })

  it("indeterminado é declarado como tal (nunca verde por omissão)", () => {
    const text = render({ verdict: "unavailable", detail: "sem docker", blockers: [] })
    expect(text).toContain("ENSAIO INDETERMINADO")
    expect(MARK.warn()).toBe("⚠️")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 10. A CLI (os exit codes são o contrato; o resto é cosmético)
// ═══════════════════════════════════════════════════════════════════════════

describe("CLI", () => {
  function cli(args: string[]) {
    const res = spawnSync("node", ["scripts/prove-forge-runtime.mjs", ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 60_000,
    })
    return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" }
  }

  it("--help sai 0 e imprime o contrato do comando", () => {
    const res = cli(["--help"])
    expect(res.status).toBe(0)
    expect(res.stdout.toLowerCase()).toContain("exit codes")
    expect(res.stdout).toContain(USAGE.split("\n")[0])
  })

  it("uso inválido sai 3 (não 1: não é falha do runtime)", () => {
    const res = cli(["--inventado"])
    expect(res.status).toBe(EXIT.USAGE)
    expect(res.stderr).toContain("--inventado")
  })

  it("sem docker a CLI é INDETERMINADA (exit 2), com JSON quando pedido", () => {
    // `--docker /bin/false` é o dublê mais honesto: o binário existe e falha,
    // como um daemon que não responde. `--no-build` evita um build de verdade.
    const res = cli(["--no-build", "--docker", "/bin/false", "--json"])
    expect(res.status).toBe(EXIT.UNAVAILABLE)
    const json = JSON.parse(res.stdout)
    expect(json.exitCode).toBe(2)
    expect(json.verdict).toBe("unavailable")
    expect(json.build.ok).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 11. Utilitários
// ═══════════════════════════════════════════════════════════════════════════

describe("lastNonEmpty", () => {
  it("devolve as últimas linhas não vazias, em uma linha", () => {
    expect(lastNonEmpty("a\n\nb\n\nc\n", 2)).toBe("b · c")
    expect(lastNonEmpty("", 3)).toBe("")
    expect(lastNonEmpty(null, 3)).toBe("")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 12. Invariante estrutural: a referência ensaiada é a DECLARADA
// ═══════════════════════════════════════════════════════════════════════════

describe("a imagem ensaiada é a que o compose pede", () => {
  it("resolve a referência pelo MESMO `resolveImageRef` do ensure/compose (fonte única)", async () => {
    const { dir, cleanup } = sandbox()
    try {
      const { run, calls } = forgeRun()
      const res = await rehearse({ cwd: dir, run })
      const env = parseEnvFile(REAL_ENV)
      expect(res.ref).toBe(`${env.IMAGE_REGISTRY}/${env.IMAGE_NAMESPACE}/ubuntu-bun:1.3.14`)
      expect(SRC_CODE).toContain("resolveImageRef")
      // as três etapas apontam para o MESMO alvo: uma build marcada, duas runs
      const [build, contract, job] = calls
      expect(build.args[build.args.indexOf("-t") + 1]).toBe(res.ref)
      expect(contract.args[6]).toBe(res.ref) // run --rm --entrypoint bash -e BUN_VERSION <ref>
      expect(job.args[job.args.length - 3]).toBe(res.ref) // … <ref> -c <script>
    } finally {
      cleanup()
    }
  })
})
