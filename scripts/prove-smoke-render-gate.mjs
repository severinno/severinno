#!/usr/bin/env node
// =============================================================================
// prove-smoke-render-gate.mjs
//
// Usage:
//   node scripts/prove-smoke-render-gate.mjs                # controle + mutação (imagem local)
//   node scripts/prove-smoke-render-gate.mjs --json         # mesmo veredito, com o formato plano
//   node scripts/prove-smoke-render-gate.mjs --build        # constrói a imagem se ela não existir
//   node scripts/prove-smoke-render-gate.mjs --gitea-env deploy/.env.gitea
//
// Exit codes:
//   0 — PROVADO: com o plugin o render fecha E, sem o plugin, a Prova 4 fica VERMELHA
//   1 — VIOLADO: o gate não morde (o mutante passa) ou o controle não prova o render
//   2 — INDETERMINADO: sem docker, ou sem a imagem do runner — ausência de prova
//   3 — uso inválido
//
// POR QUE EXISTE
//
// A Prova 4 do smoke (`forge-smoke.yml`) roda
// `bun run check:registry-source --require-compose` — a única etapa que exige o
// render do compose DENTRO do job. A pergunta que ela responde é de runtime, e
// por isso nenhum guard estático a fecha: *o render realmente acontece lá?* Um
// `--require-compose` que não falha quando o render não é provável é um check
// decorativo — e o jeito de saber é INJETAR a falha e ver o vermelho.
//
// Este comando faz isso em duas passadas, no MESMO container e com o MESMO
// comando (extraído do próprio workflow, não copiado):
//
//   1. CONTROLE — a imagem do runner, com o plugin que ela embarca: o render
//      tem de ser PROVADO (é o verde que a forja espera);
//   2. MUTAÇÃO — a mesma imagem, com o plugin REMOVIDO antes do comando: o
//      passo tem de ficar VERMELHO, com a marca de `--require-compose`.
//
// O controle não é cerimônia: sem ele, um vermelho na mutação poderia vir de
// qualquer outra coisa (imagem ausente, docker sem socket, repo ilegível) e a
// prova atribuiria ao plugin um defeito que não é dele. As duas passadas juntas
// são o que separa "o gate morde" de "o ambiente está quebrado".
//
// O que NÃO é o sujeito da prova, e o relatório escreve isso: a linha
// `bun install --frozen-lockfile` do passo (escreveria `node_modules` no
// worktree e não tem como influenciar a existência do plugin) e o restante do
// smoke (Provas 1-3 e 5). O repositório é montado READ-ONLY de propósito: a
// prova não pode alterar o que ela mede.
//
// Onde roda: manual/operador (`bun run smoke-render:prove`), no host que tem a
// imagem do runner — antes de confiar o merge à forja e ao mudar o
// `Dockerfile.ubuntu-bun`. Fora do CI: depende de docker e da imagem.
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { GITEA_COMPOSE } from "./check-bun-mirror.mjs"
import { COMPOSE_RENDER_PROVEN_MARK, REQUIRE_COMPOSE_FAIL_MARK } from "./check-registry-source.mjs"
import { parseEnvFile, resolveImageRef } from "./ensure-runner-image.mjs"
import { buildRunnerImage } from "./prove-forge-runtime.mjs"

/** A raiz do repositório — este script mora em `scripts/`. */
export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** O workflow do smoke: fonte do comando sob prova. */
export const SMOKE_WORKFLOW = ".gitea/workflows/forge-smoke.yml"

/** O env de referência da forja (o mesmo das outras provas da família). */
export const DEFAULT_ENV_FILE = "deploy/env.gitea.example"

/** O marcador do passo cujo contrato está sob prova. */
export const PROVA_STEP_MARKER = "Prova 4"

/** Onde o job monta o checkout. */
export const WORKSPACE = "/workspace"

/**
 * Todos os diretórios em que o CLI procura plugins. A mutação remove o `compose`
 * de TODOS: deixar um para trás faria o "sem o plugin" ser, na verdade, "com o
 * plugin em outro lugar" — e o mutante passaria por um motivo falso.
 */
export const PLUGIN_DIRS = [
  "/usr/libexec/docker/cli-plugins",
  "/usr/local/lib/docker/cli-plugins",
  "/usr/lib/docker/cli-plugins",
  "/root/.docker/cli-plugins",
  "/home/runner/.docker/cli-plugins",
]

/**
 * Os formatos que atravessam as duas passadas. Declarados (em vez de `object`)
 * porque o consumidor TS desta CLI é o TESTE da prova: `object` apagaria o
 * contrato e deixaria o teste acessar campos que não existem sem o tsc reclamar.
 *
 * @typedef {{state: string, detail: string, code?: number|null, output?: string}} RenderRun
 * @typedef {{verdict: string, blockers: string[], detail: string}} ProofVerdict
 * @typedef {{ok: boolean, script: string|null, detail: string}} StepScript
 * @typedef {{json?: boolean, build?: boolean, help?: boolean, envFile?: string, bunVersion?: string|null, timeoutS?: number, error?: string}} ProofOptions
 * @typedef {ProofVerdict & {ref: string|null, version: string|null, envFile: string, command: string|null, step?: string|null, control: RenderRun|null, mutant: RenderRun|null}} ProofResult
 */

/** Exit codes — o contrato da CLI (a mesma escala da família). */
export const EXIT = {
  OK: 0,
  FAILED: 1,
  UNAVAILABLE: 2,
  USAGE: 3,
}

/**
 * Extrai o bloco `run: |` do passo do smoke identificado por um marcador.
 *
 * O comando sob prova vem do WORKFLOW, não de uma cópia aqui: uma prova que
 * roda uma segunda versão do comando mede a segunda versão. A extração é
 * fail-closed — passo ausente, sem `run:` ou com bloco vazio viram `ok: false`
 * (e o chamador trata como uso inválido, nunca como "provado").
 *
 * A âncora é a linha `- name:`, não a primeira ocorrência do marcador: o
 * cabeçalho do workflow CITA "Prova 4" ao explicar por que a flag existe, e
 * ancorar na prosa faria a extração medir o comentário (defeito real da
 * primeira versão — pego pelo próprio fail-closed).
 *
 * @param {string} yaml conteúdo de SMOKE_WORKFLOW
 * @param {string} [marker]
 * @returns {StepScript}
 */
export function extractStepScript(yaml, marker = PROVA_STEP_MARKER) {
  const lines = String(yaml ?? "").split(/\r?\n/)
  const at = lines.findIndex((l) => /^\s*-\s+name:/.test(l) && l.includes(marker))
  if (at === -1) {
    return { ok: false, script: null, detail: `passo '${marker}' nao existe em ${SMOKE_WORKFLOW}` }
  }
  const stepIndent = lines[at].match(/^\s*/)[0].length

  let runAt = -1
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === "") continue
    if (line.match(/^\s*/)[0].length <= stepIndent) break // acabou o passo
    if (/^\s*run:\s*\|/.test(line)) {
      runAt = i
      break
    }
  }
  if (runAt === -1) {
    return { ok: false, script: null, detail: `o passo '${marker}' nao tem bloco 'run: |'` }
  }

  const runIndent = lines[runAt].match(/^\s*/)[0].length
  const body = []
  for (let i = runAt + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === "") {
      body.push("")
      continue
    }
    if (line.match(/^\s*/)[0].length <= runIndent) break
    body.push(line)
  }
  // Desindenta como o bloco escalar do YAML entrega ao shell: sem isso o
  // script carrega os espaços do arquivo (inofensivos no `bash -c`, mas o
  // texto deixa de ser o mesmo que a forja executa — e a prova compara texto).
  const nonBlank = body.filter((l) => l.trim() !== "")
  const common =
    nonBlank.length > 0 ? Math.min(...nonBlank.map((l) => l.match(/^\s*/)[0].length)) : 0
  const script = body
    .map((l) => l.slice(Math.min(common, l.match(/^\s*/)[0].length)))
    .join("\n")
    .replace(/\s+$/, "")
  if (script.trim() === "") {
    return { ok: false, script: null, detail: `o 'run:' do passo '${marker}' esta vazio` }
  }
  return { ok: true, script, detail: `passo '${marker}' extraido de ${SMOKE_WORKFLOW}` }
}

/**
 * A LINHA do passo que carrega a exigência do render — a que decide o status da
 * etapa (o shell do job é `bash -e`, então é o último comando que responde por
 * ela). Devolve `null` se o passo deixar de exigir o render: nesse caso a prova
 * não tem sujeito, e dizer "provado" seria pior que não rodar.
 *
 * @param {string} script
 * @returns {string|null}
 */
export function renderCommand(script) {
  const line = String(script ?? "")
    .split(/\r?\n/)
    .find((l) => l.includes("--require-compose"))
  return line ? line.trim() : null
}

/**
 * O script do MUTANTE: remove o plugin e roda o comando do passo. Uma linha só
 * porque é o que o `bash -c` do container executa.
 *
 * @param {string} command
 * @param {string[]} [dirs]
 * @returns {string}
 */
export function mutantScript(command, dirs = PLUGIN_DIRS) {
  return `rm -f ${dirs.map((d) => `${d}/docker-compose`).join(" ")}; ${command}`
}

/**
 * Os argumentos do container. O mount é READ-ONLY: a prova mede o repositório,
 * não o altera (e `bun install` do passo não entra — ver o cabeçalho).
 *
 * @param {{ref: string, script: string, cwd: string, version?: string|null, registry?: string|null, namespace?: string|null}} args
 * @returns {string[]}
 */
export function containerArgs({
  ref,
  script,
  cwd,
  version = null,
  registry = null,
  namespace = null,
}) {
  return [
    "run",
    "--rm",
    "--entrypoint",
    "bash",
    "-v",
    `${cwd}:${WORKSPACE}:ro`,
    "-w",
    WORKSPACE,
    "-e",
    "GIT_CONFIG_COUNT=1",
    "-e",
    "GIT_CONFIG_KEY_0=safe.directory",
    "-e",
    `GIT_CONFIG_VALUE_0=${WORKSPACE}`,
    "-e",
    "CI=true",
    ...(version ? ["-e", `BUN_VERSION=${version}`] : []),
    ...(registry ? ["-e", `IMAGE_REGISTRY=${registry}`] : []),
    ...(namespace ? ["-e", `IMAGE_NAMESPACE=${namespace}`] : []),
    ref,
    "-c",
    script,
  ]
}

/**
 * Lê o desfecho de uma passada pelo TEXTO que o gate imprime — e não pelo exit
 * code sozinho, pelo mesmo motivo do `classifyImageRun`: um passo que deixou de
 * verificar pode sair 0 e ser lido como prova.
 *
 *   - `proven`       — o render passou (marca de sucesso da invariante 7);
 *   - `not-provable` — o render NÃO foi provado (marca de `--require-compose`);
 *   - `other`        — saiu outra coisa (build do passo quebrado, erro de uso);
 *   - `unavailable`  — o docker não rodou o container.
 *
 * @param {{code: number|null, output: string}} run
 * @returns {RenderRun}
 */
export function classifyRenderRun({ code, output }) {
  const text = String(output ?? "")
  if (code === null || code === undefined) {
    return { state: "unavailable", detail: "o docker nao executou o container (docker ausente?)" }
  }
  if (text.includes(COMPOSE_RENDER_PROVEN_MARK)) {
    return { state: "proven", detail: "o render do compose foi PROVADO dentro do container" }
  }
  if (text.includes(REQUIRE_COMPOSE_FAIL_MARK)) {
    return {
      state: "not-provable",
      detail: `o render NAO foi provado (exit ${code}) e o gate acusou, como pedido`,
    }
  }
  return { state: "other", detail: `saida inesperada (exit ${code}): ${lastNonEmpty(text)}` }
}

/** As últimas `limit` linhas não vazias da saída, em uma linha. */
export function lastNonEmpty(output, limit = 4) {
  return String(output ?? "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "")
    .slice(-limit)
    .join(" · ")
}

/**
 * O veredito: o CONTROLE prova o render **E** o MUTANTE fica vermelho.
 *
 * A ordem importa. Sem o controle, um vermelho no mutante não é atribuível ao
 * plugin — seria um ambiente quebrado passando por gate que morde. Sem o
 * mutante vermelho, a exigência do smoke é decorativa: a Prova 4 passaria em
 * qualquer imagem, inclusive numa sem o plugin.
 *
 * @param {{control: RenderRun, mutant: RenderRun}} args
 * @returns {ProofVerdict}
 */
export function summarizeProof({ control, mutant }) {
  const blockers = []
  if (control.state === "unavailable") {
    return {
      verdict: "unavailable",
      blockers: ['sem docker nao ha passada alguma — ausencia de prova, nunca "esta certo"'],
      detail: "o docker nao executou o container do controle",
    }
  }
  if (control.state !== "proven") {
    blockers.push(
      `o CONTROLE nao provou o render (${control.state}): ${control.detail} — o ambiente nao entrega o verde que a forja espera, e um vermelho na mutacao nao seria do plugin`,
    )
  }
  if (mutant.state !== "not-provable") {
    blockers.push(
      `o MUTANTE nao acusou o render nao provado (${mutant.state}): ${mutant.detail} — a Prova 4 passaria numa imagem SEM o plugin ` +
        `(\`--require-compose\` decorativo), e a invariante 7 seguiria NAO verificada dentro de um job verde`,
    )
  }
  if (blockers.length > 0) {
    return {
      verdict: "violated",
      blockers,
      detail: "a prova NAO fecha: o gate nao morde ou o controle nao prova",
    }
  }
  return {
    verdict: "proven",
    blockers: [],
    detail: `com o plugin o ${GITEA_COMPOSE} renderiza; sem ele a Prova 4 fica VERMELHA`,
  }
}

/**
 * O resultado com o MESMO formato em qualquer desfecho (o `--json` não muda de shape).
 *
 * @param {Partial<ProofResult>} [partial]
 * @returns {ProofResult}
 */
export function proofResult(partial = {}) {
  return {
    verdict: "unavailable",
    blockers: [],
    detail: "",
    ref: null,
    version: null,
    envFile: DEFAULT_ENV_FILE,
    command: null,
    control: null,
    mutant: null,
    ...partial,
  }
}

/** O exit code do veredito. */
export function exitCodeFor(verdict) {
  if (verdict === "proven") return EXIT.OK
  if (verdict === "violated") return EXIT.FAILED
  return EXIT.UNAVAILABLE
}

export const USAGE = `prove-smoke-render-gate — prova que a Prova 4 do smoke fica VERMELHA sem o plugin \`compose\`

  node scripts/prove-smoke-render-gate.mjs [opções]

  --json                 imprime o resultado em JSON (mesmo shape em todo desfecho)
  --build                constrói a imagem do runner se ela não existir localmente
  --gitea-env <arquivo>  env de referência (default: ${DEFAULT_ENV_FILE})
  --bun-version <v>      sobrepõe o BUN_VERSION do env (a tag da imagem)
  --timeout <segundos>   timeout de cada passada no container (default: 600)
  -h, --help             esta ajuda

Exit codes: 0 provado · 1 violado · 2 indeterminado · 3 uso inválido`

/**
 * O uso dos argumentos — puro, para o teste poder exercitar o contrato da CLI.
 *
 * @param {string[]} argv
 * @returns {ProofOptions}
 */
export function parseArgs(argv) {
  const opts = {
    json: false,
    build: false,
    help: false,
    envFile: DEFAULT_ENV_FILE,
    bunVersion: null,
    timeoutS: 600,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") opts.json = true
    else if (arg === "--build") opts.build = true
    else if (arg === "-h" || arg === "--help") opts.help = true
    else if (arg === "--gitea-env") opts.envFile = argv[++i] ?? ""
    else if (arg === "--bun-version") opts.bunVersion = argv[++i] ?? ""
    else if (arg === "--timeout") {
      const value = Number(argv[++i])
      if (!Number.isFinite(value) || value <= 0) return { error: `--timeout invalido: ${argv[i]}` }
      opts.timeoutS = value
    } else if (arg.startsWith("-")) return { error: `flag desconhecida: ${arg}` }
    else return { error: `argumento inesperado: ${arg}` }
  }
  if (!opts.envFile) return { error: "--gitea-env exige um caminho" }
  if (opts.bunVersion === "") return { error: "--bun-version exige um valor" }
  return opts
}

/**
 * Roda o container e devolve code+saída (o docker ausente vira `code: null`).
 * O `run` é injetável para o teste exercitar as duas passadas sem docker.
 */
function runContainer({ docker, args, cwd, timeoutMs, run = spawnSync }) {
  const res = run(docker, args, { cwd, encoding: "utf8", timeout: timeoutMs })
  if (res?.error) return { code: null, output: String(res.error.message) }
  const code = res?.status === null || res?.status === undefined ? null : res.status
  return { code, output: `${String(res?.stdout ?? "")}${String(res?.stderr ?? "")}` }
}

/** A imagem existe localmente? */
function imageExists({ docker, ref, cwd, run = spawnSync }) {
  const res = run(docker, ["image", "inspect", ref], { cwd, encoding: "utf8", timeout: 60_000 })
  return !res?.error && res.status === 0
}

/**
 * A prova inteira: resolve a imagem, extrai o comando do workflow e roda as duas
 * passadas. Sempre devolve `proofResult` — nenhum caminho devolve `undefined`.
 *
 * @param {{cwd?: string, envFile?: string, bunVersion?: string|null, build?: boolean, timeoutS?: number, docker?: string, run?: Function, exists?: Function, readFile?: Function}} [options]
 * @returns {Promise<ProofResult>}
 */
export async function proveSmokeRenderGate({
  cwd = REPO_ROOT,
  envFile = DEFAULT_ENV_FILE,
  bunVersion = null,
  build = false,
  timeoutS = 600,
  docker = "docker",
  run = spawnSync,
  exists = existsSync,
  readFile = (p) => readFileSync(p, "utf8"),
} = {}) {
  const workflowPath = join(cwd, SMOKE_WORKFLOW)
  if (!exists(workflowPath)) {
    return proofResult({
      detail: `${SMOKE_WORKFLOW} ausente — sem o workflow nao ha passo sob prova`,
    })
  }
  const step = extractStepScript(readFile(workflowPath), PROVA_STEP_MARKER)
  if (!step.ok) return proofResult({ detail: step.detail })

  const command = renderCommand(step.script)
  if (!command) {
    return proofResult({
      detail: `o passo '${PROVA_STEP_MARKER}' deixou de exigir o render (--require-compose) — sem exigencia nao ha o que provar`,
    })
  }

  const envPath = join(cwd, envFile)
  if (!exists(envPath)) {
    return proofResult({
      detail: `env de referência ausente: ${envFile} (aponte --gitea-env para o env da forja)`,
      command,
    })
  }
  const values = parseEnvFile(readFile(envPath))
  const resolved = resolveImageRef({
    ...values,
    ...(bunVersion ? { BUN_VERSION: bunVersion } : {}),
  })
  if (resolved.error) return proofResult({ detail: resolved.error, command })

  if (!imageExists({ docker, ref: resolved.ref, cwd, run })) {
    if (!build) {
      return proofResult({
        ref: resolved.ref,
        version: resolved.version,
        envFile,
        command,
        detail: `a imagem '${resolved.ref}' NAO existe localmente — construa com --build (ou \`bun run forge-runtime:prove\`)`,
      })
    }
    const built = buildRunnerImage({
      ref: resolved.ref,
      version: resolved.version,
      cwd,
      run,
      build: true,
      docker,
    })
    if (!built.ok) {
      return proofResult({
        ref: resolved.ref,
        version: resolved.version,
        envFile,
        command,
        detail: `o build da imagem FALHOU: ${built.detail}`,
      })
    }
  }

  const common = {
    ref: resolved.ref,
    cwd,
    version: resolved.version,
    registry: values.IMAGE_REGISTRY ?? null,
    namespace: values.IMAGE_NAMESPACE ?? null,
  }
  const timeoutMs = Math.round(timeoutS * 1000)

  const controlRun = runContainer({
    docker,
    args: containerArgs({ ...common, script: command }),
    cwd,
    timeoutMs,
    run,
  })
  const control = {
    ...classifyRenderRun(controlRun),
    code: controlRun.code,
    output: controlRun.output,
  }

  const mutantRun = runContainer({
    docker,
    args: containerArgs({ ...common, script: mutantScript(command) }),
    cwd,
    timeoutMs,
    run,
  })
  const mutant = { ...classifyRenderRun(mutantRun), code: mutantRun.code, output: mutantRun.output }

  const summary = summarizeProof({ control, mutant })
  return proofResult({
    ...summary,
    ref: resolved.ref,
    version: resolved.version,
    envFile,
    command,
    step: step.script,
    control,
    mutant,
  })
}

/** O relatório humano — uma linha por fato, com o que cada passada viu. */
export function renderReport(result, { emit = console.log } = {}) {
  const mark = { proven: "✅", violated: "❌", unavailable: "·" }
  const line = (s = "") => emit(s)
  line()
  line(`prove-smoke-render-gate — Prova 4 do smoke x container sem o plugin \`compose\``)
  line(`  alvo   : ${result.ref ?? "<nao resolvido>"} (BUN_VERSION ${result.version ?? "?"})`)
  line(`  env    : ${result.envFile}`)
  line(`  comando: ${result.command ?? "<nao extraido>"}`)
  line()
  if (result.control) {
    line(
      `  controle : ${mark[result.control.state] ?? "·"} ${result.control.state} — ${result.control.detail}`,
    )
    line(`             ${lastNonEmpty(result.control.output, 3)}`)
  }
  if (result.mutant) {
    line(
      `  mutacao  : ${result.mutant.state === "not-provable" ? "✅" : "❌"} ${result.mutant.state} — ${result.mutant.detail}`,
    )
    line(`             ${lastNonEmpty(result.mutant.output, 3)}`)
  }
  line()
  line(`  ${mark[result.verdict] ?? "·"} ${result.verdict.toUpperCase()}: ${result.detail}`)
  for (const b of result.blockers) line(`     - ${b}`)
  line()
  line(
    `  NAO cobre: a linha \`bun install\` do passo, o resto do smoke (Provas 1-3 e 5) e o socket do job.`,
  )
  line(`  O repositorio e montado READ-ONLY: a prova mede o checkout sem altera-lo.`)
  line()
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.error) {
    console.error(`prove-smoke-render-gate: ${opts.error}`)
    console.error(USAGE)
    process.exit(EXIT.USAGE)
  }
  if (opts.help) {
    console.log(USAGE)
    process.exit(EXIT.OK)
  }

  const result = await proveSmokeRenderGate(opts)
  if (opts.json) {
    console.log(JSON.stringify({ ...result, exitCode: exitCodeFor(result.verdict) }, null, 2))
  } else {
    renderReport(result)
  }
  process.exit(exitCodeFor(result.verdict))
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (IS_DIRECT_RUN) await main()
