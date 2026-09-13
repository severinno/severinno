#!/usr/bin/env node
// =============================================================================
// prove-forge-runtime.mjs
//
// Usage:
//   node scripts/prove-forge-runtime.mjs                  # build + asserções + o job guards
//   node scripts/prove-forge-runtime.mjs --no-build        # reusa a imagem local (não constrói)
//   node scripts/prove-forge-runtime.mjs --install         # roda `bun install --frozen-lockfile` antes
//   node scripts/prove-forge-runtime.mjs --only check:registry-source
//   node scripts/prove-forge-runtime.mjs --gitea-env deploy/.env.gitea
//   node scripts/prove-forge-runtime.mjs --bun-version 1.3.14 --timeout 300
//   node scripts/prove-forge-runtime.mjs --json
//
// Exit codes:
//   0 — a imagem constrói, as asserções do contrato passam DENTRO dela e TODOS os
//       gates do job `guards` saem 0 no container
//   1 — o contrato falhou dentro da imagem, ou um gate do job `guards` FALHOU lá
//   2 — não deu para ensaiar (sem docker, build falhou, imagem ausente com
//       --no-build, pipeline ilegível) — ausência de prova, nunca "está pronto"
//   3 — uso inválido
//
// POR QUE EXISTE (o buraco entre "os guards passam aqui" e "os guards passam LÁ")
//
// O `doctor` responde "a forja pode bloquear o merge?" com fatos sobre o
// repositório, o registry e o host — mas todos medidos NESTA máquina. O job
// `guards` roda em outro lugar: dentro da imagem do runner, sem node_modules
// garantido, com o `docker` do RUNNER, com o workspace montado em outro caminho
// e como OUTRO usuário. Cinco diferenças de runtime que nenhum guard estático
// enxerga, e cada uma já quebrou pipeline de verdade em algum projeto:
//
//   - o plugin `compose` que a invariante 7 usa existe na imagem? (sem ele, o
//     render fica INDETERMINADO dentro de um job verde);
//   - o `node`/`bun` que rodam os scripts são os que a imagem embarca?
//   - os guards acham o repositório quando o cwd não é o do host?
//   - o `git` aceita o workspace montado (dubious ownership)?
//   - algum guard precisa de algo que só existe na máquina de quem desenvolve
//     (node_modules, `.env` local, ferramenta instalada à mão)?
//
// Este comando fecha isso em UM passo, com a imagem e a bateria vindas de FONTE
// ÚNICA — nada aqui é uma segunda lista:
//
//   1. CONSTRÓI a imagem do Dockerfile real (`Dockerfile.ubuntu-bun`, com o
//      BUN_VERSION declarado) e a marca com a referência que o compose declara;
//   2. roda as ASSERÇÕES do contrato DENTRO do artefato (o mesmo bloco `RUN` do
//      Dockerfile, via `runContractInImage` — o guard da base é quem fala);
//   3. roda o job `guards` INTEIRO dentro da imagem: os comandos saem de
//      `forgeGates` (a MESMA derivação do `doctor` e do `check-forge-parity`, do
//      job `guards` da pipeline dona do merge), com as mesmas variáveis que o
//      step exporta (`IMAGE_REGISTRY`, `IMAGE_NAMESPACE`, `BUN_VERSION`);
//   4. mede e mostra o AMBIENTE do job (usuário, cwd, node, bun, docker, plugin
//      `compose`, git) — porque é aí que a diferença entre as máquinas aparece.
//
// O que ele NÃO prova (dito no relatório): o **runner** em si (registro,
// labels, agendamento, socket) — isso é o job `guards` de verdade e o smoke; o
// `vars.*` da forja (aqui vem do arquivo local / `--bun-version`); e um gate que
// use `node_modules` da máquina quando `--install` não é passado (o relatório
// diz se o `node_modules` estava lá).
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  CONTRACT_OK_MARK,
  DOCKERFILE,
  classifyImageRun,
  contractBlock,
  runContractInImage,
} from "./check-runner-base.mjs"
import { MERGE_OWNER_PIPELINE, forgeGates } from "./forge-doctor.mjs"
import { parseEnvFile, resolveImageRef } from "./ensure-runner-image.mjs"

/** A raiz do repositório — o script mora em `scripts/`, e é dela que tudo sai. */
export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * O env local do ensaio: o TEMPLATE comitado, não o `deploy/.env.gitea`.
 *
 * Por que o template: este é um comando de CHECKOUT (o `doctor` roda no host e
 * aceita o env do host por `--gitea-env`). O template é o único env que existe em
 * qualquer clone, tem a versão declarada e é o mesmo arquivo que o invariante 7b
 * usa como referência — apontar `--gitea-env` troca a origem, como no doctor.
 */
export const DEFAULT_ENV_FILE = "deploy/env.gitea.example"

/** O caminho do workspace DENTRO do container (o job roda com o repo montado). */
export const WORKSPACE = "/workspace"

/**
 * O socket do docker do HOST.
 *
 * POR QUE ELE PRECISA ENTRAR: o runner da forja monta
 * `/var/run/docker.sock:/var/run/docker.sock` (docker-compose.gitea.yml) — é
 * assim que ele sobe a imagem do job. Sem o socket no ensaio, um gate que use o
 * docker falharia AQUI por um motivo que não existe LÁ, e o ensaio diria "o
 * runtime quebra" sobre uma limitação dele mesmo. Alarme falso é o que ensina a
 * ignorar o gate.
 */
export const DEFAULT_DOCKER_SOCK = "/var/run/docker.sock"

/**
 * Decide se o ensaio pode (e deve) montar o socket do docker.
 *
 * `requested: false` é o desligamento explícito (`--no-docker-sock`); um
 * caminho inexistente também desliga — mas DIZENDO isso, porque "o ensaio não
 * tinha socket" muda a leitura de um vermelho.
 *
 * @param {{requested?: string|false|null, exists?: (p: string) => boolean}} [args]
 * @returns {{sock: string|null, detail: string}}
 */
export function resolveDockerSock({ requested = DEFAULT_DOCKER_SOCK, exists = existsSync } = {}) {
  if (requested === false || requested === null) {
    return { sock: null, detail: "desligado por --no-docker-sock" }
  }
  if (!exists(requested)) return { sock: null, detail: `${requested} nao existe neste host` }
  return { sock: requested, detail: `${requested} montado (o job da forja tem o socket)` }
}

/**
 * A pipeline dona do merge — a MESMA constante do `doctor` e do
 * `check-forge-parity` (se a forja dona do merge mudar, o ensaio segue a
 * mudança sem uma segunda declaração para envelhecer).
 */
export const MERGE_OWNER_FILE = MERGE_OWNER_PIPELINE

/** Exit codes — o contrato da CLI. */
export const EXIT = {
  OK: 0,
  FAILED: 1,
  UNAVAILABLE: 2,
  USAGE: 3,
}

// Os formatos que atravessam as etapas. Declarados (em vez de `object`) porque o
// consumidor TS desta CLI é o teste do ensaio: `object` apagaria o contrato e
// deixaria o teste acessar campos que não existem sem o tsc reclamar.
/**
 * @typedef {{label: string, code: number|null, seconds: number|null, output: string}} GateResult
 * @typedef {{env: Record<string, string>, gates: GateResult[], install: {code: number|null, output: string}|null}} ContainerReport
 * @typedef {{ok: boolean, code?: number|null, detail: string, output?: string, skipped?: boolean}} StageResult
 * @typedef {{ok: boolean, state: string, detail: string, findings?: object|null}} ContractResult
 * @typedef {{code: number|null, output: string, parsed: ContainerReport, target: string}} JobResult
 * @typedef {{verdict: string, blockers: string[], detail: string}} Verdict
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. A bateria e o script que roda DENTRO do container
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Os gates do job `guards` — pela derivação do `doctor` (fonte única).
 *
 * @param {string} [cwd]
 * @returns {{ok: boolean, gates: {label: string, command: string}[], detail: string}}
 */
export function forgeGatesForRuntime(cwd = REPO_ROOT) {
  const path = join(cwd, MERGE_OWNER_FILE)
  if (!existsSync(path)) {
    return { ok: false, gates: [], detail: `${MERGE_OWNER_FILE} ausente em ${cwd}` }
  }
  const content = readFileSync(path, "utf8")
  const found = forgeGates(content)
  if (found.error) return { ok: false, gates: [], detail: found.error }
  const incomplete = found.gates.filter((g) => !g.command)
  if (incomplete.length > 0) {
    return {
      ok: false,
      gates: [],
      detail:
        `gate(s) sem linha executável: ${incomplete.map((g) => g.label).join(", ")} — ` +
        "o `run:` foi reescrito e o ensaio rodaria outra coisa",
    }
  }
  return {
    ok: true,
    gates: found.gates,
    detail: `${found.gates.length} gate(s) derivados de ${MERGE_OWNER_FILE} (job 'guards')`,
  }
}

/** Os fatos de ambiente que o relatório mede DENTRO do job. */
export const ENV_PROBE = [
  'printf "user=%s\\n" "$(id -un 2>/dev/null || echo AUSENTE)"',
  'printf "cwd=%s\\n" "$PWD"',
  'printf "shell=%s\\n" "$(command -v bash 2>/dev/null || echo AUSENTE)"',
  'printf "node=%s\\n" "$(node --version 2>/dev/null || echo AUSENTE)"',
  'printf "bun=%s\\n" "$(bun --version 2>/dev/null || echo AUSENTE)"',
  'printf "bun-path=%s\\n" "$(command -v bun 2>/dev/null || echo AUSENTE)"',
  'printf "docker=%s\\n" "$(command -v docker 2>/dev/null || echo AUSENTE)"',
  'printf "compose=%s\\n" "$(docker compose version 2>/dev/null || echo AUSENTE)"',
  'printf "git=%s\\n" "$(git --version 2>/dev/null || echo AUSENTE)"',
  'printf "node_modules=%s\\n" "$(if [ -d node_modules ]; then echo presente; else echo AUSENTE; fi)"',
  // O SOCKET é a diferença que mais engana: sem ele um gate que use o docker
  // FALHA aqui por um motivo que não existe na forja — e o ensaio diria "o
  // runtime quebra" sobre uma limitação dele mesmo.
  'printf "docker-sock=%s\\n" "$(if [ -S /var/run/docker.sock ]; then echo montado; else echo AUSENTE; fi)"',
].join("\n")

/**
 * O script bash que roda dentro do container: o ambiente, o `install` opcional
 * e CADA gate com o seu código de saída e a sua saída delimitada.
 *
 * O formato é `::gate <label> start` / `<saída>` / `::gate <label> code=<n>
 * secs=<n>` — delimitado de propósito: o host precisa da SAÍDA do gate que
 * falhou, e pescar isso de um log concatenado é como o diagnóstico se perde.
 *
 * `timeout` por gate: um gate que pendura não pode pendurar o ensaio inteiro (o
 * `timeout` do docker é do processo TODO, não de cada etapa).
 *
 * O `install` é decidido por variável (`SKIP_INSTALL`) e não pelo texto do
 * script: o MESMO script roda nos dois modos, e o que ele executou fica no log.
 *
 * @param {{gates: {label: string, command: string}[], timeoutS: number}} args
 * @returns {string}
 */
export function containerScript({ gates, timeoutS }) {
  const lines = [
    "set -uo pipefail",
    ENV_PROBE,
    "",
    'if [ "${SKIP_INSTALL:-1}" != "1" ]; then',
    '  printf "::install start\\n"',
    `  timeout ${Math.max(timeoutS * 10, 900)} bun install --frozen-lockfile 2>&1 | tail -n 20`,
    '  printf "::install code=%s\\n" "${PIPESTATUS[0]}"',
    "fi",
    "",
  ]
  for (const gate of gates) {
    lines.push(`printf "::gate ${gate.label} start\\n"`)
    lines.push("gate_start=$(date +%s)")
    lines.push(`timeout ${timeoutS} ${gate.command} 2>&1`)
    lines.push("gate_code=$?")
    lines.push("gate_end=$(date +%s)")
    lines.push(
      `printf "::gate ${gate.label} code=%s secs=%s\\n" "$gate_code" "$((gate_end - gate_start))"`,
    )
    lines.push("")
  }
  return lines.join("\n")
}

/**
 * Lê a saída do container: o ambiente e um resultado por gate (com a saída dele).
 *
 * @param {string} output
 * @param {string[]} labels
 * @returns {ContainerReport}
 */
export function parseContainerOutput(output, labels) {
  const env = {}
  const gates = []
  let install = null
  const lines = String(output ?? "").split("\n")
  let current = null
  let inInstall = false
  const envKeys = [
    "user",
    "cwd",
    "shell",
    "node",
    "bun",
    "bun-path",
    "docker",
    "compose",
    "git",
    "node_modules",
    "docker-sock",
  ]

  for (const line of lines) {
    const start = /^::gate (.+) start$/.exec(line)
    if (start) {
      current = { label: start[1], code: null, seconds: null, output: "" }
      continue
    }
    const done = /^::gate (.+) code=(\d+) secs=(\d+)$/.exec(line)
    if (done) {
      if (current && current.label === done[1]) {
        current.code = Number(done[2])
        current.seconds = Number(done[3])
        gates.push(current)
      } else {
        gates.push({
          label: done[1],
          code: Number(done[2]),
          seconds: Number(done[3]),
          output: "",
        })
      }
      current = null
      continue
    }
    if (line === "::install start") {
      inInstall = true
      install = { code: null, output: "" }
      continue
    }
    const installDone = /^::install code=(\d+)$/.exec(line)
    if (installDone) {
      inInstall = false
      if (install) install.code = Number(installDone[1])
      continue
    }
    if (current) {
      current.output += `${line}\n`
      continue
    }
    if (inInstall && install) {
      install.output += `${line}\n`
      continue
    }
    const kv = /^([a-z_-]+)=(.*)$/.exec(line)
    if (kv && envKeys.includes(kv[1])) env[kv[1]] = kv[2]
  }

  // Um gate que não emitiu o `code=` não apareceu: o ensaio o reporta como
  // NÃO EXECUTADO (o pior desfecho seria contá-lo como verde).
  for (const label of labels) {
    if (!gates.some((g) => g.label === label)) {
      gates.push({ label, code: null, seconds: null, output: "" })
    }
  }
  return { env, gates, install }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. As três etapas (build, asserções, o job)
// ═══════════════════════════════════════════════════════════════════════════

/** O `run` real, tipado frouxo para o dublê do teste caber (mesmo padrão do guard). */
const defaultRun = /** @type {Function} */ (spawnSync)

/**
 * Constrói a imagem do Dockerfile real, marcada como a referência DECLARADA.
 *
 * Marcar com a referência declarada (`<registry>/<ns>/ubuntu-bun:<versão>`) é o
 * ponto: o ensaio passa a rodar exatamente a imagem que o compose pede — e o
 * `--no-build` reusa essa mesma tag, o que é dito no relatório (uma tag local
 * pode estar velha; `--no-build` é conveniência, não prova).
 *
 * @param {{ref: string, version: string, cwd?: string, run?: Function, timeoutMs?: number, build?: boolean, docker?: string}} args
 * @returns {{ok: boolean, code: number|null, detail: string, output: string, skipped?: boolean}}
 */
export function buildRunnerImage({
  ref,
  version,
  cwd = REPO_ROOT,
  run = defaultRun,
  timeoutMs = 900000,
  build = true,
  docker = "docker",
} = {}) {
  if (!build) {
    const res = run(docker, ["image", "inspect", ref], { cwd, encoding: "utf8", timeout: 60000 })
    if (res?.status === 0) {
      return {
        ok: true,
        code: 0,
        skipped: true,
        detail: "imagem local reusada (--no-build)",
        output: "",
      }
    }
    return {
      ok: false,
      code: res?.status ?? null,
      detail: `--no-build pedido, mas '${ref}' NÃO existe localmente — construa uma vez sem a flag`,
      output: `${String(res?.stderr ?? "")}`.trim(),
    }
  }
  const res = run(
    docker,
    ["build", "--build-arg", `BUN_VERSION=${version}`, "-f", DOCKERFILE, "-t", ref, "."],
    { cwd, encoding: "utf8", timeout: timeoutMs },
  )
  const code = res?.status === null || res?.status === undefined ? 125 : res.status
  const output = `${String(res?.stdout ?? "")}${String(res?.stderr ?? "")}`.trim()
  if (code !== 0) {
    return {
      ok: false,
      code,
      detail: `o build da imagem FALHOU (exit ${code}) — sem artefato não há ensaio`,
      output,
    }
  }
  return { ok: true, code, detail: `imagem construída e marcada como ${ref}`, output }
}

/**
 * As ASSERÇÕES do contrato dentro do artefato — o mesmo bloco do Dockerfile, o
 * mesmo veredito do guard (`classifyImageRun`).
 *
 * @param {{ref: string, version: string, cwd?: string, run?: Function, timeoutMs?: number, docker?: string, text?: string}} args
 * @returns {Promise<ContractResult>}
 */
export async function assertContractInImage({
  ref,
  version,
  cwd = REPO_ROOT,
  run = defaultRun,
  timeoutMs = 180000,
  docker = "docker",
  text = null,
} = {}) {
  const source = text ?? readFileSync(join(cwd, DOCKERFILE), "utf8")
  const block = contractBlock(source)
  if (!block.ok) return { ok: false, state: "unavailable", detail: block.detail, findings: null }
  const res = runContractInImage({
    target: ref,
    block: block.block,
    expectedVersion: version,
    run,
    docker,
    timeoutMs,
    cwd,
  })
  const state = classifyImageRun(res)
  return {
    ok: state === "proven",
    state,
    findings: null,
    detail:
      state === "proven"
        ? `o contrato passou DENTRO da imagem (${CONTRACT_OK_MARK})`
        : state === "violated"
          ? `a imagem NAO cumpre o contrato do Dockerfile: ${lastNonEmpty(res.output) || `exit ${res.code}`}`
          : `o docker nao rodou as assercoes (exit ${res.code}): ${lastNonEmpty(res.output) || "sem saida"}`,
  }
}

/**
 * Roda o job `guards` INTEIRO dentro da imagem, com o repo montado.
 *
 * O `--rm` e o mount são o ENSAIO do job: o workspace no mesmo lugar para todo
 * gate, o usuário da imagem (não o do host) e as variáveis que o step exporta.
 * `safe.directory` entra de propósito: o workspace montado pertence a OUTRO uid,
 * e o git recusa o repositório por "dubious ownership" — um gate que usa o git
 * falharia por um motivo que não existe na forja (onde o checkout é do runner).
 *
 * @param {{ref: string, gates: {label: string, command: string}[], version: string, registry?: string|null, namespace?: string|null, cwd?: string, run?: Function, timeoutMs?: number, install?: boolean, timeoutS?: number, docker?: string, dockerSock?: string|null}} args
 * @returns {JobResult}
 */
export function runGuardsInImage({
  ref,
  gates,
  version,
  registry = null,
  namespace = null,
  cwd = REPO_ROOT,
  run = defaultRun,
  timeoutMs = 3600000,
  install = false,
  timeoutS = 300,
  docker = "docker",
  dockerSock = null,
} = {}) {
  const script = containerScript({ gates, timeoutS })
  const args = [
    "run",
    "--rm",
    // O shell é explícito: a imagem herda o ENTRYPOINT da base, e passar `-c`
    // sem dizer QUEM executa é o tipo de suposição que só falha lá.
    "--entrypoint",
    "bash",
    "-v",
    `${cwd}:${WORKSPACE}`,
    // O socket, como na forja: sem ele um gate que usa o docker falharia por
    // uma limitação do ensaio, não do runtime.
    ...(dockerSock ? ["-v", `${dockerSock}:${DEFAULT_DOCKER_SOCK}`] : []),
    "-w",
    WORKSPACE,
    "-e",
    `BUN_VERSION=${version}`,
    "-e",
    "CI=true",
    ...(registry ? ["-e", `IMAGE_REGISTRY=${registry}`] : []),
    ...(namespace ? ["-e", `IMAGE_NAMESPACE=${namespace}`] : []),
    "-e",
    `SKIP_INSTALL=${install ? "0" : "1"}`,
    "-e",
    "GIT_CONFIG_COUNT=1",
    "-e",
    "GIT_CONFIG_KEY_0=safe.directory",
    "-e",
    `GIT_CONFIG_VALUE_0=${WORKSPACE}`,
    ref,
    "-c",
    script,
  ]
  const res = run(docker, args, { cwd, encoding: "utf8", timeout: timeoutMs })
  const code = res?.status === null || res?.status === undefined ? 125 : res.status
  const output = `${String(res?.stdout ?? "")}${String(res?.stderr ?? "")}`
  return {
    code,
    output,
    parsed: parseContainerOutput(
      output,
      gates.map((g) => g.label),
    ),
    target: ref,
  }
}

/** As últimas `limit` linhas não vazias de uma saída, como texto de uma linha. */
export function lastNonEmpty(output, limit = 6) {
  return tailLines(output, limit).join(" · ")
}

/** As últimas `limit` linhas não vazias de uma saída, como lista. */
function tailLines(output, limit) {
  return String(output ?? "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "")
    .slice(-limit)
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. A decisão
// ═══════════════════════════════════════════════════════════════════════════

/**
 * O veredito do ensaio. Três estados, e o do meio é o que evita a mentira:
 *
 *   - `proven`     — a imagem constrói, o contrato passa dentro dela e TODOS os
 *                    gates do job saem 0 no container;
 *   - `failed`     — o contrato ou um gate FALHOU lá (a forja quebraria no
 *                    runtime, e o ensaio mostra QUAL);
 *   - `unavailable`— não deu para ensaiar (sem docker, build falhou, imagem
 *                    ausente): ausência de prova, nunca "está pronto".
 *
 * @param {{build: StageResult, contract: ContractResult, job: JobResult|null, gates: {label: string}[], install: boolean}} result
 * @returns {Verdict}
 */
export function summarizeRehearsal({ build, contract, job, gates, install = false }) {
  if (!build.ok) return { verdict: "unavailable", blockers: [], detail: build.detail }
  if (!contract.ok) {
    return {
      verdict: contract.state === "violated" ? "failed" : "unavailable",
      blockers: contract.state === "violated" ? [contract.detail] : [],
      detail: contract.detail,
    }
  }
  const failed = (job?.parsed?.gates ?? []).filter((g) => g.code !== 0)
  if (failed.length > 0) {
    return {
      verdict: "failed",
      blockers: failed.map(
        (g) =>
          `gate '${g.label}' ${g.code === null ? "NAO EXECUTOU no container (o job pararia sem diagnostico)" : `FALHOU dentro da imagem (exit ${g.code})`}`,
      ),
      detail: `${failed.length} de ${gates.length} gate(s) nao passaram DENTRO da imagem`,
    }
  }
  if (job === null) {
    return {
      verdict: "unavailable",
      blockers: [],
      detail:
        "os gates nao foram executados no container (docker indisponivel ou imagem nao rodou)",
    }
  }
  const installNote = install
    ? ""
    : " (sem --install: o node_modules do host e o que o container viu)"
  return {
    verdict: "proven",
    blockers: [],
    detail: `${gates.length} gate(s) do job 'guards' sairam 0 DENTRO da imagem${installNote}`,
  }
}

export const MARK = {
  ok: () => "✅",
  fail: () => "❌",
  warn: () => "⚠️",
  skip: () => "·",
  info: () => "▸",
}

/**
 * O relatório — o mesmo texto na CLI e no log de quem ensaia.
 *
 * @param {object} result
 * @param {{emit?: (s?: string) => void}} [opts]
 */
export function renderReport(result, { emit = console.log } = {}) {
  const line = (s = "") => emit(s)
  line()
  line("  ═════════════════════════════════════════════════════════════════")
  line("   🎬 ENSAIO DA FORJA NO RUNTIME — a imagem do runner, antes de publicá-la")
  line("  ═════════════════════════════════════════════════════════════════")
  line()
  line(`  ${MARK.info()} imagem    : ${result.ref}`)
  line(`  ${MARK.info()} versão    : ${result.version}`)
  line(
    `  ${MARK.info()} bateria   : ${result.gates.length} gate(s) de ${result.pipeline} (job 'guards')`,
  )
  line(`  ${result.dockerSock ? MARK.info() : MARK.warn()} socket    : ${result.sockDetail || "?"}`)
  line()
  line("  1/3  BUILD")
  line(
    `       ${result.build.ok ? MARK.ok() : MARK.fail()} ${result.build.detail}${result.build.skipped ? ` ${MARK.skip()}` : ""}`,
  )
  if (!result.build.ok && result.build.output) {
    for (const l of tailLines(result.build.output, 8)) line(`           ${l}`)
  }

  line()
  line("  2/3  ASSERÇÕES DO CONTRATO DENTRO DA IMAGEM")
  line(
    `       ${result.contract.ok ? MARK.ok() : result.contract.state === "violated" ? MARK.fail() : MARK.warn()} ${result.contract.detail}`,
  )

  line()
  line("  3/3  O JOB 'guards' INTEIRO DENTRO DA IMAGEM")
  const env = result.job?.parsed?.env ?? {}
  if (Object.keys(env).length > 0) {
    line(
      `       ${MARK.info()} ambiente: user=${env.user ?? "?"} cwd=${env.cwd ?? "?"} node=${env.node ?? "?"} bun=${env.bun ?? "?"} (${env["bun-path"] ?? "?"})`,
    )
    line(
      `       ${MARK.info()}         : docker=${env.docker ?? "?"} compose=${env.compose ?? "?"} socket=${env["docker-sock"] ?? "?"} git=${env.git ?? "?"} node_modules=${env.node_modules ?? "?"}`,
    )
  }
  const install = result.job?.parsed?.install
  if (install) {
    line(
      `       ${install.code === 0 ? MARK.ok() : MARK.fail()} bun install --frozen-lockfile (exit ${install.code ?? "?"})`,
    )
  }
  for (const gate of result.job?.parsed?.gates ?? []) {
    const mark = gate.code === 0 ? MARK.ok() : gate.code === null ? MARK.warn() : MARK.fail()
    const secs = gate.seconds === null ? "" : `${gate.seconds}s`.padStart(6)
    line(
      `       ${mark} ${gate.label.padEnd(44)}${secs}${gate.code === 0 ? "" : `  exit ${gate.code ?? "?"}`}`,
    )
    if (gate.code !== 0) {
      for (const l of tailLines(gate.output, 6)) line(`           ${l}`)
    }
  }

  line()
  line("  ─────────────────────────────────────────────────────────────────")
  const verdictLine =
    result.verdict === "proven"
      ? `  ${MARK.ok()} RUNTIME PROVADO: ${result.detail}`
      : result.verdict === "failed"
        ? `  ${MARK.fail()} O RUNTIME QUEBRA: ${result.detail}`
        : `  ${MARK.warn()} ENSAIO INDETERMINADO: ${result.detail}`
  line(verdictLine)
  for (const b of result.blockers) line(`    ${MARK.fail()} ${b}`)
  line()
  line("  O QUE O ENSAIO NÃO COBRE")
  line("    · o RUNNER (registro, labels, agendamento): o job de verdade e o smoke")
  line("    · o valor real de vars.BUN_VERSION: aqui vem do env local / --bun-version")
  if (!result.install) {
    line(
      "    · o node_modules da forja: o container viu o do host (use --install para o ensaio fiel)",
    )
  }
  if (!result.dockerSock) {
    line("    · o docker DENTRO do job: sem o socket, um gate que o use falha aqui por uma")
    line("      limitação do ensaio, não do runtime (use --docker-sock <caminho>)")
  }
  line()
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. CLI
// ═══════════════════════════════════════════════════════════════════════════

export const USAGE = `prove-forge-runtime — ensaia a forja no runtime ANTES de publicar a imagem

Usage:
  node scripts/prove-forge-runtime.mjs [opções]

Opções:
  --no-build           reusa a imagem local (não constrói; uma tag local pode estar velha)
  --install            roda \`bun install --frozen-lockfile\` dentro do container antes dos gates
                       (é o ensaio fiel do job: o node_modules passa a ser o da imagem. ATENCAO:
                       ele é escrito no workspace MONTADO pelo usuário do container (root),
                       então use-o num clone de ensaio, não no checkout de trabalho)
  --only <trecho>      roda só os gates cujo rótulo contém o trecho (depuração)
  --gitea-env <path>   env de onde saem registry/namespace/BUN_VERSION
                       (default: ${DEFAULT_ENV_FILE})
  --bun-version <v>    sobrescreve a versão declarada no env (o que \`vars.BUN_VERSION\` daria)
  --timeout <s>        limite por GATE dentro do container (default: 300)
  --docker <bin>       binário do docker (default: docker)
  --docker-sock <path> socket do docker a montar no container (default: ${DEFAULT_DOCKER_SOCK})
                       — é o que o runner da forja tem; sem ele um gate que use o docker
                       falha aqui por uma limitação do ENSAIO
  --no-docker-sock     não monta socket nenhum (o relatório declara o que isso desliga)
  --json               saída estruturada
  -h, --help           esta ajuda

O que ele faz, em ordem:
  1. CONSTRÓI a imagem do ${DOCKERFILE} (com o BUN_VERSION declarado) e a marca
     com a referência que o compose declara;
  2. roda as ASSERÇÕES do contrato DENTRO da imagem (o bloco \`RUN\` do Dockerfile);
  3. roda o job 'guards' INTEIRO dentro da imagem, com o repo montado em ${WORKSPACE},
     medindo o AMBIENTE do job (usuário, cwd, node, bun, docker, plugin compose, git).

A bateria NÃO é uma lista aqui: sai do job 'guards' da pipeline dona do merge
(\`forgeGates\`, a mesma derivação do \`doctor\`).

Exit codes:
  0 — o runtime está provado (contrato + todos os gates dentro da imagem)
  1 — o contrato ou um gate FALHOU dentro da imagem
  2 — não deu para ensaiar (sem docker, build falhou, imagem ausente)
  3 — uso inválido`

/**
 * @param {string[]} argv
 * @returns {{build: boolean, install: boolean, only: string|null, envFile: string, bunVersion: string|null, timeoutS: number, docker: string, dockerSock: string|false, json: boolean, help: boolean, error?: string}}
 */
export function parseArgs(argv) {
  const opts = {
    build: true,
    install: false,
    only: null,
    envFile: DEFAULT_ENV_FILE,
    bunVersion: null,
    timeoutS: 300,
    docker: "docker",
    dockerSock: /** @type {string|false} */ (DEFAULT_DOCKER_SOCK),
    json: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--no-build") opts.build = false
    else if (arg === "--install") opts.install = true
    else if (arg === "--no-docker-sock") opts.dockerSock = false
    else if (arg === "--json") opts.json = true
    else if (arg === "-h" || arg === "--help") opts.help = true
    else if (arg === "--docker-sock") {
      const next = argv[++i]
      if (next === undefined || next.startsWith("--"))
        return { ...opts, error: "--docker-sock exige um caminho" }
      opts.dockerSock = next
    } else if (arg === "--only") {
      const next = argv[++i]
      if (next === undefined || next.startsWith("--"))
        return { ...opts, error: "--only exige um trecho" }
      opts.only = next
    } else if (arg === "--gitea-env") {
      const next = argv[++i]
      if (next === undefined || next.startsWith("--"))
        return { ...opts, error: "--gitea-env exige um caminho" }
      opts.envFile = next
    } else if (arg === "--bun-version") {
      const next = argv[++i]
      if (next === undefined || next.startsWith("--"))
        return { ...opts, error: "--bun-version exige uma versão" }
      opts.bunVersion = next
    } else if (arg === "--docker") {
      const next = argv[++i]
      if (next === undefined || next.startsWith("--"))
        return { ...opts, error: "--docker exige um binário" }
      opts.docker = next
    } else if (arg === "--timeout") {
      const next = Number(argv[++i])
      if (!Number.isFinite(next) || next <= 0)
        return { ...opts, error: "--timeout exige segundos (>0)" }
      opts.timeoutS = next
    } else if (arg.startsWith("-")) return { ...opts, error: `argumento desconhecido: ${arg}` }
  }
  return opts
}

/** O exit code de um resultado — o contrato da CLI. */
export function exitCodeFor(verdict) {
  if (verdict === "proven") return EXIT.OK
  if (verdict === "failed") return EXIT.FAILED
  return EXIT.UNAVAILABLE
}

/**
 * O esqueleto de um resultado do ensaio.
 *
 * TODOS os campos existem em TODOS os desfechos — inclusive nos que desistem
 * cedo. Um retorno parcial obrigaria quem consome (a CLI, o `--json` e o teste)
 * a adivinhar quais campos vieram, e o `--json` de um ensaio indeterminado seria
 * um objeto de formato DIFERENTE do de um ensaio provado.
 *
 * @param {Partial<{verdict: string, detail: string, blockers: string[], ref: string|null, version: string|null, pipeline: string, gates: {label: string, command: string}[], build: StageResult|null, contract: ContractResult|null, job: JobResult|null, install: boolean, dockerSock: string|null, sockDetail: string}>} [partial]
 * @returns {{verdict: string, detail: string, blockers: string[], ref: string|null, version: string|null, pipeline: string, gates: {label: string, command: string}[], build: StageResult|null, contract: ContractResult|null, job: JobResult|null, install: boolean, dockerSock: string|null, sockDetail: string}}
 */
export function rehearsalResult(partial = {}) {
  return {
    verdict: "unavailable",
    detail: "",
    blockers: [],
    ref: null,
    version: null,
    pipeline: MERGE_OWNER_FILE,
    gates: [],
    build: null,
    contract: null,
    job: null,
    install: false,
    dockerSock: null,
    sockDetail: "",
    ...partial,
  }
}

/**
 * A orquestração: as três etapas, com as dependências injetáveis (o ensaio de
 * verdade roda docker; o teste dubla o `run`).
 *
 * @param {{cwd?: string, envFile?: string, bunVersion?: string|null, build?: boolean, install?: boolean, only?: string|null, timeoutS?: number, docker?: string, run?: Function, gates?: {label: string, command: string}[]|null, dockerSock?: string|false|null, exists?: (p: string) => boolean}} [options]
 * @returns {Promise<ReturnType<typeof rehearsalResult>>}
 */
export async function rehearse({
  cwd = REPO_ROOT,
  envFile = DEFAULT_ENV_FILE,
  bunVersion = null,
  build = true,
  install = false,
  only = null,
  timeoutS = 300,
  docker = "docker",
  run = defaultRun,
  gates = null,
  dockerSock = DEFAULT_DOCKER_SOCK,
  exists = existsSync,
} = {}) {
  const path = join(cwd, envFile)
  if (!existsSync(path)) {
    return rehearsalResult({
      detail: `env de referência ausente: ${envFile} (aponte --gitea-env para o env da forja)`,
    })
  }
  const values = parseEnvFile(readFileSync(path, "utf8"))
  const resolved = resolveImageRef({
    ...values,
    ...(bunVersion ? { BUN_VERSION: bunVersion } : {}),
  })
  if (resolved.error) return rehearsalResult({ detail: resolved.error })

  const derived = gates ? { ok: true, gates, detail: "" } : forgeGatesForRuntime(cwd)
  if (!derived.ok) return rehearsalResult({ detail: derived.detail })
  const selected = only ? derived.gates.filter((g) => g.label.includes(only)) : derived.gates
  if (selected.length === 0) {
    return rehearsalResult({ detail: `nenhum gate casa com --only ${only}` })
  }

  const sock = resolveDockerSock({ requested: dockerSock, exists })

  const built = buildRunnerImage({
    ref: resolved.ref,
    version: resolved.version,
    cwd,
    run,
    build,
    docker,
  })

  let contract = { ok: false, state: "unavailable", detail: "o build falhou: nada a ensaiar" }
  let job = null
  if (built.ok) {
    contract = await assertContractInImage({
      ref: resolved.ref,
      version: resolved.version,
      cwd,
      run,
      docker,
    })
  }
  if (built.ok && contract.ok) {
    job = runGuardsInImage({
      ref: resolved.ref,
      gates: selected,
      version: resolved.version,
      registry: values.IMAGE_REGISTRY ?? null,
      namespace: values.IMAGE_NAMESPACE ?? null,
      cwd,
      run,
      install,
      timeoutS,
      docker,
      dockerSock: sock.sock,
    })
  }

  const summary = summarizeRehearsal({ build: built, contract, job, gates: selected, install })
  return rehearsalResult({
    verdict: summary.verdict,
    detail: summary.detail,
    blockers: summary.blockers,
    ref: resolved.ref,
    version: resolved.version,
    gates: selected,
    build: built,
    contract,
    job,
    install,
    dockerSock: sock.sock,
    sockDetail: sock.detail,
  })
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.error) {
    console.error(`prove-forge-runtime: ${opts.error}`)
    console.error(USAGE)
    process.exit(EXIT.USAGE)
  }
  if (opts.help) {
    console.log(USAGE)
    process.exit(EXIT.OK)
  }
  if (!existsSync(join(REPO_ROOT, DOCKERFILE))) {
    console.error(`prove-forge-runtime: ${DOCKERFILE} ausente em ${REPO_ROOT}`)
    process.exit(EXIT.UNAVAILABLE)
  }
  const result = await rehearse(opts)
  if (opts.json)
    console.log(JSON.stringify({ ...result, exitCode: exitCodeFor(result.verdict) }, null, 2))
  else renderReport(result)
  process.exit(exitCodeFor(result.verdict))
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (IS_DIRECT_RUN) await main()
