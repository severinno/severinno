#!/usr/bin/env node
// =============================================================================
// scripts/prove-runner-image-gate.mjs — PROVA, contra um registry de TESTE, que
// o runner NÃO sobe quando a tag da imagem não existe.
//
// POR QUE ESTA PROVA EXISTE (e por que o guard estático não basta):
//   O `checkGiteaBringUp` prova a ORDEM no texto do script ('up -d runner' vem
//   depois do ensure) e o ensure tem testes unitários dos seus estados. Nada
//   disso prova a ÚNICA coisa que importa em produção: que, com a tag ausente
//   no registry, a stack NÃO sobe o runner. Uma asserção sobre o texto não
//   distingue "bloqueia" de "quebrado": um `gitea-up.sh` que aborta por
//   qualquer outro motivo também nunca sobe o runner — e passaria.
//
//   Então esta prova EXECUTA o caminho real, com um registry de verdade em
//   127.0.0.1 (node:http falando OCI v2 de mentira, mas HTTP de verdade), o
//   `deploy/gitea-up.sh` real e um `docker` dublê que REGISTRA cada chamada.
//   O que se afirma é sobre o REGISTRO das chamadas: nenhum `compose up`
//   aconteceu.
//
// A CONTRA-PROVA (por que são TRÊS casos e não um):
//   "não subiu" sozinho é evidência fraca — um script quebrado também não sobe
//   nada. O terceiro caso é o CONTROLE: com a tag PRESENTE o runner sobe. É ele
//   que transforma "não subiu" em "não subiu PORQUE a tag faltava".
//
//   Os três:
//     A. --check-only + tag ausente        → exit 4, ZERO chamadas ao docker
//     B. subida normal + tag ausente        → exit 5, o publisher "publica"
//        (build+push ok) e a RELEITURA desmente; ZERO `compose up` — ou seja,
//        nem um publisher que mente consegue subir o runner.
//     C. CONTROLE: tag presente             → exit 0 e `up -d runner` observado
//
//   No caso B a asserção inclui o `build`/`push` no log: sem isso, "exit 5" não
//   distinguiria "bloqueou na releitura" de "não havia caminho de publicação" —
//   dois mundos com o mesmo código de saída e significados opostos.
//
// O registry de teste é LOCAL e ESMERALDA: nenhuma rede externa, nenhum docker.
// Roda em ~1s (o healthcheck do Gitea é desligado com HEALTH_TIMEOUT=1).
//
// Usage:
//   node scripts/prove-runner-image-gate.mjs          # prova; exit 0 = segura
//   node scripts/prove-runner-image-gate.mjs --json   # mesma informação em JSON
//   node scripts/prove-runner-image-gate.mjs --cwd <raiz>   # repo mutado (teste)
//
// Exit codes:
//   0 — a prova SE SUSTENTA nos três casos
//   1 — a prova FALHOU (o bloqueio não existe, ou a contra-prova não sobe)
//   2 — não consegui rodar a prova (sem bash, sem o script do bring-up)
// =============================================================================

import { spawn as nodeSpawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { delimiter, dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"

import { EXIT } from "./ensure-runner-image.mjs"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

/** O bring-up real — a única peça que a prova executa. */
export const BRING_UP = "deploy/gitea-up.sh"

/**
 * Versão de TESTE — sintética de propósito. Montada por código para NENHUMA
 * linha do fonte parecer um `BUN_VERSION=<x.y.z>` que o guard estático pudesse
 * confundir com um default literal (mesma preocupação do check-bun-mirror, que
 * monta a tag por `String.fromCharCode`).
 */
export const PROOF_VERSION = ["9", "9", "9"].join(".")

/** Nome da variável montado por código, pelo mesmo motivo acima. */
const VERSION_KEY = ["BUN", "VERSION"].join("_")

const C = {
  green: "\u001b[0;32m",
  red: "\u001b[0;31m",
  yellow: "\u001b[1;33m",
  cyan: "\u001b[0;36m",
  nc: "\u001b[0m",
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Registry de TESTE (OCI v2 mínimo, HTTP de verdade em 127.0.0.1)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sobe um registry OCI mínimo numa porta aleatória de 127.0.0.1.
 *
 * `exists` → 200 no manifesto (a tag é puxável); `missing` → 404. Só isso: a
 * pergunta da prova é binária, e um registry mais rico (Bearer, blobs)
 * esconderia a resposta atrás de fidelidade que não está em julgamento.
 *
 * @param {"exists"|"missing"} mode
 * @returns {Promise<{url: string, port: number, hits: string[], close: () => Promise<void>}>}
 */
export function startTestRegistry(mode) {
  const hits = []
  const server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`)
    const status = mode === "exists" ? 200 : 404
    res.writeHead(status, { "content-type": "application/json" })
    res.end(mode === "exists" ? '{"schemaVersion":2}' : "{}")
  })
  return new Promise((resolve, reject) => {
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        hits,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. `docker` e `gh` dublês — o REGISTRO das chamadas é a evidência
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Instala `docker` e `gh` FALSOS num diretório próprio (preposto ao PATH).
 *
 * POR QUE FALSOS: o alvo da prova é a DECISÃO do gitea-up.sh, não o docker.
 * Com o docker real, `compose up -d runner` levaria minutos, exigiria registry
 * autenticado e mudaria o estado da máquina — e a prova deixaria de ser
 * esmeralda. O dublê registra `$*` de cada chamada num log; é ESSE log que se
 * lê depois ("houve `up -d runner`?").
 *
 * Semântica do dublê, deliberada:
 *   - `--version` sai 0 (as pré-condições do gitea-up.sh, que exigem docker);
 *   - `build`/`push` saem 0 — no caso B é ESSENCIAL: um publisher que "dá
 *     certo" e mesmo assim não derruba o bloqueio;
 *   - `manifest` sai 1 (o docker não conhece a tag);
 *   - `commit`/`compose`/qualquer outra coisa sai 0.
 *
 * O `gh` sempre falha: sem `gh` autenticado o ensure não pode escolher o
 * workflow de publicação, e nenhum workflow de verdade é disparado.
 *
 * @param {string} parentDir
 * @returns {{binDir: string, dockerCalls: () => string[]}}
 */
export function makeFakeBin(parentDir) {
  const binDir = join(parentDir, "fake-bin")
  mkdirSync(binDir, { recursive: true })
  const dockerLog = join(binDir, "docker.log")
  writeFileSync(dockerLog, "")

  writeFileSync(
    join(binDir, "docker"),
    [
      "#!/usr/bin/env bash",
      `echo "$*" >> "${dockerLog}"`,
      'case "$1" in',
      '  --version) echo "Docker version 27.0.0, build fake"; exit 0 ;;',
      "  manifest) exit 1 ;;",
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
    dockerCalls: () =>
      readFileSync(dockerLog, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
  }
}

/** Escreve o env do compose apontando para o registry de teste. */
function writeProofEnv(dir, registryUrl) {
  const path = join(dir, "gitea.env")
  writeFileSync(
    path,
    [
      `IMAGE_REGISTRY=${registryUrl}`,
      "IMAGE_NAMESPACE=severinno",
      `${VERSION_KEY}=${PROOF_VERSION}`,
      "RUNNER_TOKEN=prova",
      "",
    ].join("\n"),
  )
  return path
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Os três casos
// ═══════════════════════════════════════════════════════════════════════════

/**
 * O resultado de UM caso — a mesma forma nos três, para o relatório e o JSON
 * serem lidos do mesmo jeito (e para o teste do doctor poder dublar o fato).
 *
 * @typedef {object} ProofCaseResult
 * @property {string} id
 * @property {string} title
 * @property {string} why
 * @property {boolean} ok
 * @property {string[]} failures
 * @property {number|null} exit
 * @property {number} expectedExit
 * @property {boolean} runnerUp
 * @property {number} composeCalls
 * @property {boolean} published
 * @property {number} registryHits
 * @property {string} tail
 */

/**
 * @typedef {object} ProofCase
 * @property {string} id
 * @property {string} title
 * @property {"exists"|"missing"} registry
 * @property {string[]} args        argumentos extras do gitea-up.sh
 * @property {number} expectExit
 * @property {boolean} expectRunnerUp
 * @property {number|null} expectCompose  nº exato de chamadas 'compose' (null = não checa)
 * @property {boolean} expectPublish      o log deve conter build E push?
 * @property {boolean} expectBlockMsg     a saída deve conter 'NADA foi subido'?
 * @property {string} why                 o que este caso prova
 */

/** @type {ProofCase[]} */
export const PROOF_CASES = [
  {
    id: "check-only",
    title: "tag AUSENTE + --check-only",
    registry: "missing",
    args: ["--check-only"],
    expectExit: EXIT.MISSING,
    expectRunnerUp: false,
    expectCompose: 0,
    expectPublish: false,
    expectBlockMsg: false,
    why: "a ausência CONFIRMADA pelo registry nem chega a tocar no docker (exit 4)",
  },
  {
    id: "ausente",
    title: "tag AUSENTE + subida normal (publisher que 'mente' e releitura que desmente)",
    registry: "missing",
    args: ["--source", "local"],
    expectExit: EXIT.PUBLISH_FAILED,
    expectRunnerUp: false,
    expectCompose: 0,
    expectPublish: true,
    expectBlockMsg: true,
    why: "nem um build+push que 'dá certo' sobe o runner: a RELEITURA é a garantia (exit 5)",
  },
  {
    id: "presente",
    title: "CONTROLE — tag PRESENTE",
    registry: "exists",
    args: [],
    expectExit: EXIT.OK,
    expectRunnerUp: true,
    expectCompose: null,
    expectPublish: false,
    expectBlockMsg: false,
    why: "com a tag presente a stack SOBE o runner — é isto que faz do 'não subiu' uma prova, e não um script quebrado",
  },
]

/**
 * Executa um processo e espera o fim, juntando stdout+stderr.
 *
 * ASSÍNCRONO DE PROPÓSITO — e este é o detalhe que faz a prova funcionar: o
 * `gitea-up.sh` chama o ensure num processo FILHO que precisa falar com o
 * registry de teste, que roda NESTE processo (mesmo event loop). Com
 * `spawnSync` o event loop do pai ficaria bloqueado esperando o filho — que
 * espera o registry responder; o registry não responde porque o pai está
 * bloqueado, e o ensure fica 'unreachable' por timeout. Medido: os três casos
 * saíam exit 3 (indeterminado) em vez de 4/5/0. `spawn` + await mantém o loop
 * vivo e o registry atende de verdade.
 *
 * @returns {Promise<{status: number|null, out: string}>}
 */
function runProcess(spawn, cmd, args, opts, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout?.on("data", (c) => (out += c))
    child.stderr?.on("data", (c) => (out += c))
    // Rede de segurança: sem isso um bring-up que travasse penduraria o doctor.
    const killer = setTimeout(() => child.kill("SIGKILL"), timeoutMs)
    child.on("error", (err) => {
      clearTimeout(killer)
      resolve({ status: null, out: `${out}\n${err.message}` })
    })
    child.on("close", (code) => {
      clearTimeout(killer)
      resolve({ status: code, out })
    })
  })
}

/**
 * Roda um caso: registry de teste + env + `gitea-up.sh` real com PATH preparado.
 *
 * @returns {Promise<ProofCaseResult>} o resultado do caso, pronto para o relatório
 */
async function runCase(testCase, { cwd, bash, spawn }) {
  const tmp = mkdtempSync(join(tmpdir(), `prove-gate-${testCase.id}-`))
  const registry = await startTestRegistry(testCase.registry)
  try {
    const { binDir, dockerCalls } = makeFakeBin(tmp)
    const envFile = writeProofEnv(tmp, registry.url)

    const res = await runProcess(
      spawn,
      bash,
      [join(cwd, BRING_UP), "--env-file", envFile, ...testCase.args],
      {
        cwd,
        env: {
          ...process.env,
          PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
          // O healthcheck do Gitea esperaria até 180s por um Gitea que não existe:
          // 1s (que vira ZERO iterações) tira a espera sem tirar o caminho.
          HEALTH_TIMEOUT: "1",
        },
      },
    )

    const calls = dockerCalls()
    const out = res.out
    const composeCalls = calls.filter((c) => c.includes("compose"))
    const runnerUp = calls.some((c) => c.includes("up -d runner"))
    const published =
      calls.some((c) => c.startsWith("build")) && calls.some((c) => c.startsWith("push"))

    const failures = []
    if (res.status !== testCase.expectExit) {
      failures.push(`exit ${res.status} — esperado ${testCase.expectExit}`)
    }
    if (runnerUp !== testCase.expectRunnerUp) {
      failures.push(
        runnerUp
          ? "o runner SUBIU (havia 'up -d runner' no log do docker)"
          : "o runner NÃO subiu (faltou 'up -d runner'), mas o controle exige que subisse",
      )
    }
    if (testCase.expectCompose !== null && composeCalls.length !== testCase.expectCompose) {
      failures.push(
        `${composeCalls.length} chamada(s) 'compose' — esperado ${testCase.expectCompose} (nada da stack deveria subir)`,
      )
    }
    if (testCase.expectPublish && !published) {
      failures.push(
        "não houve build+push: o bloqueio pode ter vindo da falta de publisher, não da releitura",
      )
    }
    if (testCase.expectBlockMsg && !out.includes("NADA foi subido")) {
      failures.push("a saída não traz a mensagem de bloqueio ('NADA foi subido')")
    }

    return {
      id: testCase.id,
      title: testCase.title,
      why: testCase.why,
      ok: failures.length === 0,
      failures,
      exit: res.status,
      expectedExit: testCase.expectExit,
      runnerUp,
      composeCalls: composeCalls.length,
      published,
      registryHits: registry.hits.length,
      // Um resumo curto e legível do que o docker viu — é o que se cita no relatório.
      tail: failures.length === 0 ? "" : out.trim().split("\n").slice(-6).join("\n"),
    }
  } finally {
    await registry.close()
    rmSync(tmp, { recursive: true, force: true })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. A prova
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Roda os três casos contra o registry de teste.
 *
 * @param {object} [options]
 * @param {string} [options.cwd]    raiz do repositório (default: esta)
 * @param {string} [options.bash]   binário do bash (default: resolveBash)
 * @param {Function} [options.spawn] `child_process.spawn` real ou dublê de teste
 * @returns {Promise<{ok: boolean, status: "holds"|"violated"|"unavailable", detail: string, cases: ProofCaseResult[]}>}
 */
export async function proveRunnerImageGate({
  cwd = REPO_ROOT,
  bash = resolveBash(),
  spawn = nodeSpawn,
} = {}) {
  if (!existsSync(join(cwd, BRING_UP))) {
    return {
      ok: false,
      status: "unavailable",
      detail: `${BRING_UP} não encontrado em ${cwd} — sem o bring-up real não há o que provar`,
      cases: [],
    }
  }
  if (!bash) {
    return {
      ok: false,
      status: "unavailable",
      detail:
        "bash não encontrado — a prova executa o deploy/gitea-up.sh real e precisa dele (no Windows: Git Bash)",
      cases: [],
    }
  }

  const cases = []
  for (const testCase of PROOF_CASES) {
    cases.push(await runCase(testCase, { cwd, bash, spawn }))
  }
  const broken = cases.filter((c) => !c.ok)
  return {
    ok: broken.length === 0,
    status: broken.length === 0 ? "holds" : "violated",
    detail:
      broken.length === 0
        ? "com a tag ausente o runner NÃO sobe (2 casos) e, com a tag presente, sobe (controle)"
        : `${broken.length} caso(s) da prova falharam: ${broken.map((c) => c.id).join(", ")}`,
    cases,
  }
}

/**
 * Resolve o bash. No Windows o `bash` do PATH pode ser o do WSL (saída UTF-16,
 * exit 1 sempre) — prefere o Git for Windows quando presente, como já faz o
 * helper dos testes.
 *
 * @returns {string}
 */
export function resolveBash() {
  if (process.platform === "win32") {
    for (const candidate of [
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    ]) {
      if (existsSync(candidate)) return candidate
    }
  }
  return "bash"
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Relatório + CLI
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {object} result  retorno de proveRunnerImageGate
 * @param {{emit?: Function}} [deps]
 */
export function renderProof(result, { emit = console.log } = {}) {
  const line = (s = "") => emit(s)
  for (const c of result.cases) {
    const mark = c.ok ? `${C.green}✅${C.nc}` : `${C.red}❌${C.nc}`
    const runner = c.runnerUp ? "runner SUBIU" : "runner não subiu"
    line(`  ${mark} ${c.title}`)
    line(
      `       exit ${c.exit} (esperado ${c.expectedExit}) · ${runner} · ${c.composeCalls} 'compose'`,
    )
    line(`       ${C.cyan}▸${C.nc} ${c.why}`)
    for (const f of c.failures) line(`       ${C.red}✗${C.nc} ${f}`)
    if (c.tail) for (const l of c.tail.split("\n")) line(`         ${l}`)
  }
  if (result.status === "unavailable") {
    line(`  ${C.yellow}⚠️${C.nc} prova indisponível: ${result.detail}`)
    return
  }
  line()
  line(
    result.ok
      ? `  ${C.green}✅ prova do bloqueio: ${result.detail}${C.nc}`
      : `  ${C.red}❌ prova do bloqueio FALHOU: ${result.detail}${C.nc}`,
  )
}

export const USAGE = `prove-runner-image-gate — prova, contra um registry de teste, que o runner não sobe com a tag ausente

Usage:
  node scripts/prove-runner-image-gate.mjs [opções]

Opções:
  --cwd <raiz>   raiz do repositório a usar (default: esta) — serve para testar
                 uma cópia MUTADA do gitea-up.sh
  --json         saída JSON (para guard/automação)
  -h, --help     esta ajuda

Exit codes: 0 prova segura · 1 prova falhou · 2 não consegui rodar a prova`

export function parseArgs(argv) {
  const opts = { cwd: REPO_ROOT, json: false, help: false, error: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") opts.json = true
    else if (arg === "-h" || arg === "--help") opts.help = true
    else if (arg === "--cwd") opts.cwd = argv[++i] ?? ""
    else opts.error = `argumento desconhecido: ${arg}`
  }
  if (!opts.error && !opts.cwd) opts.error = "--cwd exige um caminho"
  if (!opts.error && opts.cwd && !isAbsolute(opts.cwd)) opts.cwd = join(process.cwd(), opts.cwd)
  return opts
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(USAGE)
    return 0
  }
  if (opts.error) {
    console.error(`prove-runner-image-gate: ${opts.error}`)
    console.error(USAGE)
    return 2
  }
  const result = await proveRunnerImageGate({ cwd: opts.cwd })
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log("")
    console.log("  ═════════════════════════════════════════════════════════════════")
    console.log("   🔒 PROVA — o runner não sobe sem a imagem (registry de teste)")
    console.log("  ═════════════════════════════════════════════════════════════════")
    console.log("")
    renderProof(result)
    console.log("")
  }
  if (result.status === "unavailable") return 2
  return result.ok ? 0 : 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code))
}
