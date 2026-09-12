#!/usr/bin/env node

// =============================================================================
// forge-doctor.mjs
//
// Usage:
//   node scripts/forge-doctor.mjs                 # relatório de prontidão da forja
//   node scripts/forge-doctor.mjs --json          # o mesmo, como dados
//   node scripts/forge-doctor.mjs --no-guards     # pula a bateria (só contrato + imagem)
//   node scripts/forge-doctor.mjs --no-proof      # pula a prova do bloqueio (mais rápido)
//   node scripts/forge-doctor.mjs --gitea-env deploy/.env.gitea
//   node scripts/forge-doctor.mjs --timeout 300   # segundos por guard (default 120)
//
// Exit codes:
//   0 — PRONTA: tudo o que dá para provar localmente foi provado, e a imagem do
//       runner existe e é puxável
//   1 — BLOQUEADA: alguma invariante falhou, OU a imagem do runner não está no
//       registry (sem ela NENHUM job inicia) — o merge não pode ser confiado
//   2 — INDETERMINADA: nada falhou, mas algo não pôde ser provado (registry
//       inacessível, pacote privado sem credencial, ferramenta ausente)
//   3 — uso/erro interno (argumento inválido, pipeline ilegível)
//
// POR QUE EXISTE: os guards da forja passavam VERDES e a forja ainda não
// bloqueava o merge. Cada peça tem seu guard, mas ninguém respondia a pergunta
// inteira — e as respostas parciais alinhavam num sentido falso:
//
//   - `check:forge-parity` prova que a pipeline da forja CONTÉM as invariantes
//     do CORE. Ele não prova que elas PASSAM agora, nem que a branch protection
//     as exige, nem que o runner consegue iniciar um job;
//   - `check:required-checks` prova que o manifesto aponta para jobs que
//     EXISTEM. Ele não prova que a forja aplicou aquele manifesto;
//   - `runner-image:ensure` prova a imagem. Ele não sabe nada sobre os guards.
//
// E a garantia da imagem tinha um buraco próprio: `runner-image:check` diz se a
// tag existe AGORA, mas não prova que a subida da stack depende dela. Quem prova
// isso é uma seção a mais — a PROVA DO BLOQUEIO (seção 4): ela executa o
// `deploy/gitea-up.sh` real contra um registry de TESTE em 127.0.0.1, com a tag
// ausente e com a tag presente, e afirma sobre o LOG do docker dublê. Sem ela, o
// relatório afirmaria "a imagem está garantida" sem nunca ter visto o bloqueio
// acontecer.
//
// Com todos eles verdes, um runner sem a imagem publicada, ou um gate quebrado
// no momento do merge, ainda travava o PR — e o diagnóstico chegava pelo
// sintoma mais distante da causa. Este comando junta as peças num veredito, e
// — igual de importante — DIZ O QUE NÃO PROVOU.
//
// DE ONDE VEM A LISTA DE GUARDS (o ponto central do desenho): de LUGAR NENHUM
// escrita à mão. A forja é dona do merge, então quem define "os guards da
// forja" é o próprio job `guards` de `.gitea/workflows/ci.yml`. O doctor fatia
// esse job e executa os gates que estão lá, com a mesma classificação que o
// `check-forge-parity` usa (`discoverGates`). Consequência: um guard novo na
// pipeline entra no doctor SOZINHO, e um guard removido de lá some daqui — não
// existe lista paralela para envelhecer.
//
// O que ele NÃO pode provar daqui, e por isso sai escrito no relatório:
//   - a branch protection REGISTRADA na forja (requer token/API dela);
//   - o smoke (tier-1 em runtime — é um job da própria forja);
//   - o `.env.gitea` do VPS, que não existe neste checkout.
// =============================================================================

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import process from "node:process"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { discoverGates } from "./check-forge-parity.mjs"
import { ensureRunnerImage, DEFAULT_ENV_FILE } from "./ensure-runner-image.mjs"
import { proveRunnerImageGate } from "./prove-runner-image-gate.mjs"
import { checkComposeInterpolation } from "./check-registry-source.mjs"
import { GITEA_COMPOSE } from "./check-bun-mirror.mjs"
import { GITEA_WORKFLOW_DIR } from "./forge-workflows.mjs"
import {
  extractActrcBunVersion,
  extractEnvMirrorBunVersion,
  GITEA_ENV_MIRROR,
} from "./check-actrc-sync.mjs"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

/** O manifesto do contrato de merge (fonte única dos checks obrigatórios). */
export const REQUIRED_CHECKS_MANIFEST = "ci/required-checks.json"

/** A pipeline DONA DO MERGE — de onde a bateria de guards é derivada. */
export const MERGE_OWNER_PIPELINE = `${GITEA_WORKFLOW_DIR}/ci.yml`

/** O job dessa pipeline cujos gates formam a bateria da forja. */
export const FORGE_GUARDS_JOB = "guards"

/** Exit code do `runner-image:check` quando a tag NÃO existe (a única falha da forja). */
const IMAGE_MISSING = 4
/** Exit code do `runner-image:check` quando o env está ausente/inválido. */
const IMAGE_ENV_BAD = 2

const C = {
  reset: "\u001b[0m",
  red: "\u001b[0;31m",
  green: "\u001b[0;32m",
  yellow: "\u001b[1;33m",
  cyan: "\u001b[0;36m",
  gray: "\u001b[0;90m",
}
const color = (c, s) => (process.stdout.isTTY ? `${c}${s}${C.reset}` : s)

/** Marcadores de status do relatório — um só vocabulário para todas as seções. */
// Sem espaço à direita: o template sempre põe um depois do marcador.
const MARK = {
  ok: () => color(C.green, "✅"),
  fail: () => color(C.red, "❌"),
  warn: () => color(C.yellow, "⚠️"),
  info: () => color(C.cyan, "▸"),
  skip: () => color(C.gray, "·"),
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Descoberta (derivada da pipeline, nunca escrita à mão)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fatia UM job da pipeline, pela indentação de 2 espaços sob `jobs:`.
 *
 * POR QUE parser caseiro: o doctor roda com `node` puro, sem node_modules
 * (mesma restrição declarada em check-required-checks.mjs). A fidelidade é
 * garantida pelo teste que compara o resultado com a pipeline REAL.
 *
 * @param {string} content  conteúdo da pipeline
 * @param {string} jobId    id do job (ex.: 'guards')
 * @returns {string|null}   o bloco do job, ou null se ele não existir
 */
export function sliceJob(content, jobId) {
  const lines = content.split(/\r?\n/)
  const start = lines.findIndex((line) => new RegExp(`^  ${jobId}:\\s*$`).test(line))
  if (start === -1) return null

  const body = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    // Próximo job (mesmo nível) ou fim do bloco `jobs:` (coluna 0).
    // Comentário em coluna 0 NÃO encerra: ele pode estar no meio do job, e o
    // descobridor de gates já ignora comentários por conta própria.
    if (/^ {2}\S/.test(line)) break
    if (/^\S/.test(line) && line.trim() !== "" && !line.startsWith("#")) break
    body.push(line)
  }
  return body.join("\n")
}

/**
 * O comando declara MODO DE VERIFICAÇÃO? É a trava que impede o doctor de
 * executar um script na sua modalidade de EFEITO.
 *
 * POR QUE ISSO PRECISA EXISTIR (defeito real, cometido e depois corrigido): o
 * rótulo que o descobridor devolve para uma invocação direta é só o CAMINHO —
 * `bun scripts/rotate-secrets.mjs --check` vira o rótulo
 * `scripts/rotate-secrets.mjs`, com a flag descartada. Executar o rótulo como
 * comando roda o script SEM `--check`: no caso do rotate-secrets isso significa
 * PREPARAR UMA ROTAÇÃO DE SEGREDOS como efeito de rodar um relatório. O
 * comando tem de vir da LINHA da pipeline (que preserva as flags) e ainda
 * passar por esta trava.
 *
 * As marcas são as MESMAS que o check-forge-parity usa para chamar algo de
 * gate (`--check`/`--ci`, entrada `check:`/`validate:`/`test-mutation:`, script
 * com prefixo check-/validate-/audit-/test-mutation-/run-, `tsc`).
 *
 * @param {string} command
 * @returns {boolean}
 */
export function isVerificationCommand(command) {
  return [
    /--(?:check|ci|dry-run)\b/,
    /\b(?:check|validate|test-mutation):[a-z0-9-]+/,
    /(?:^|\/)(?:check|validate|audit|test-mutation|run)-[a-z0-9-]+\.(?:mjs|cjs|js|sh|bash)\b/,
    /(?:^|\s)tsc(?:\s|$)/,
  ].some((re) => re.test(command))
}

/**
 * Converte um COMANDO (a linha `run:` da pipeline, não o rótulo) no processo a
 * executar.
 *
 * Recusa comando com metacaracteres de shell em vez de "executar mesmo assim":
 * o doctor executa por lista de argumentos, não por shell, e adivinhar a
 * intenção seria pior que falhar alto.
 *
 * @param {string} command
 * @returns {{cmd: string, args: string[]}|{error: string}}
 */
export function gateCommand(command) {
  if (/["'`$|&;<>()\\*?]/.test(command)) {
    return {
      error: `comando de gate com caractere de shell não suportado: '${command}' — o doctor executa por lista de argumentos, não por shell`,
    }
  }
  if (!isVerificationCommand(command)) {
    return {
      error: `comando sem modo de verificação ('--check'/'--ci', entrada check:, ou script check-/validate-/audit-/run-): '${command}' — o doctor NÃO executa um gate na modalidade de efeito`,
    }
  }
  const parts = command.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { error: `comando de gate vazio` }

  // Invocação direta de script vem sem interpretador (`scripts/x.mjs`) — o
  // comando da pipeline tem `bun scripts/x.mjs`, mas se a linha não for achada
  // o fallback é o caminho cru. Reconstrói pela EXTENSÃO, que é como as
  // pipelines chamam (bun para .mjs/.js, bash para .sh/.bash).
  if (/\.(mjs|cjs|js)$/.test(parts[0])) return { cmd: "bun", args: parts }
  if (/\.(sh|bash)$/.test(parts[0])) return { cmd: "bash", args: parts }

  return { cmd: parts[0], args: parts.slice(1) }
}

/**
 * A linha `run:` que PRODUZIU o rótulo (preserva flags que o rótulo descarta).
 * Só considera linhas executáveis: comentário que menciona o script não é
 * comando (mesma regra dos outros guards do repo).
 *
 * @param {string[]} lines  linhas do job
 * @param {string} label
 * @returns {string|null}
 */
export function gateRunLine(lines, label) {
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith("#") || !line.includes(label)) continue
    // `- run: <cmd>` ou `run: <cmd>` — pega o que vem depois do marcador.
    const m = line.match(/^(?:-\s*)?run:\s*(.+)$/)
    if (m) return m[1].trim()
  }
  return null
}

/**
 * Os gates da bateria da forja, derivados da pipeline dona do merge.
 *
 * O CONJUNTO vem do descobridor do `check-forge-parity` (mesma classificação,
 * uma fonte só), mas o COMANDO vem da linha `run:` que o gerou — porque o
 * rótulo é uma identidade para classificar, não um comando executável (ele
 * descarta as flags; ver `isVerificationCommand`).
 *
 * @param {string} content  conteúdo de `.gitea/workflows/ci.yml`
 * @returns {{gates: {label: string, command: string|null}[], error?: string}}
 */
export function forgeGates(content) {
  const job = sliceJob(content, FORGE_GUARDS_JOB)
  if (job === null) {
    return {
      gates: [],
      error: `job '${FORGE_GUARDS_JOB}' não encontrado em ${MERGE_OWNER_PIPELINE} — a bateria da forja não tem de onde ser derivada`,
    }
  }
  const labels = discoverGates(job)
  if (labels.length === 0) {
    return {
      gates: [],
      error: `job '${FORGE_GUARDS_JOB}' existe mas não declara nenhum gate — a forja não estaria bloqueando nada`,
    }
  }
  const lines = job.split(/\r?\n/)
  return { gates: labels.map((label) => ({ label, command: gateRunLine(lines, label) })) }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Execução de um gate
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Roda um gate da bateria e devolve o resultado cru. `code === null` significa
 * que o processo não terminou (timeout/sinal) ou não pôde ser executado — que
 * NÃO é "passou".
 *
 * @param {{label: string, command: string|null}} gate
 * @param {{cwd?: string, timeoutS?: number, run?: Function}} [deps]
 * @returns {{gate: string, code: number|null, seconds: number, error?: string, tail?: string}}
 */
export function runGate(gate, { cwd = REPO_ROOT, timeoutS = 120, run = spawnSync } = {}) {
  const label = gate.label
  if (!gate.command) {
    return {
      gate: label,
      code: null,
      seconds: 0,
      error: `não achei a linha 'run:' que executa este gate em ${MERGE_OWNER_PIPELINE} — não executo o rótulo cru (sem as flags ele roda em modo de efeito)`,
    }
  }
  const parsed = gateCommand(gate.command)
  if (parsed.error) return { gate: label, code: null, seconds: 0, error: parsed.error }

  const started = Date.now()
  const res = run(parsed.cmd, parsed.args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutS * 1000,
    env: process.env,
  })
  const seconds = (Date.now() - started) / 1000

  if (res.error) {
    // ENOENT (binário ausente) chega aqui — é "não executado", não "falhou".
    return { gate: label, code: null, seconds, error: res.error.message }
  }
  if (res.signal || res.status === null) {
    return {
      gate: label,
      code: null,
      seconds,
      error: `não terminou em ${timeoutS}s (timeout) — trate como NÃO verificado`,
    }
  }
  const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`.trim()
  return {
    gate: label,
    code: res.status,
    seconds,
    tail: res.status === 0 ? undefined : out.split("\n").slice(-12).join("\n"),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. O veredito
// ═══════════════════════════════════════════════════════════════════════════

export const VERDICT = {
  READY: "pronta",
  BLOCKED: "bloqueada",
  UNKNOWN: "indeterminada",
}

/**
 * Junta os fatos num veredito.
 *
 * A REGRA, e por que ela não é "tudo verde = pronto": a pergunta é se o merge
 * pode ser CONFIADO à forja. Três coisas quebram isso, em ordens diferentes de
 * gravidade:
 *   - uma invariante FALHA     → o gate que existe vai reprovar PRs bons ou
 *                                aprovar PRs ruins: BLOQUEADA; *   - a imagem do runner não   → nenhum job INICIA (não é um gate vermelho, é a
 *     está no registry            fila inteira parada): BLOQUEADA;
 *   - a PROVA do bloqueio é    → a garantia da imagem é DECORATIVA: a subida da
 *     VIOLADA                     stack leva o runner ao ar sem a tag. BLOQUEADA,
 *                                 e mais grave que a imagem ausente — ali o
 *                                 remédio é publicar a imagem, aqui é consertar
 *                                 a própria subida;
 *   - algo não deu para        → não é falha, é ausência de prova. Não pode
 *     determinar                  virar "pronta" (seria a falsa segurança que
 *                                 o check-forge-parity foi escrito para matar)
 *                                 nem "bloqueada" (mentiria para o outro lado)
 *                                 → INDETERMINADA.
 *
 * @param {{contract: object, guards: object, image: object, proof: object, mirrors: object, skippedGuards?: boolean, skippedProof?: boolean}} facts
 * @returns {{verdict: string, blockers: string[], unknowns: string[], unproven: string[]}}
 */
export function summarize(facts) {
  const blockers = []
  const unknowns = []

  for (const f of facts.contract.failures) blockers.push(f)
  if (facts.contract.unknown) unknowns.push(facts.contract.unknown)

  if (facts.skippedGuards) {
    // Pular a bateria NÃO pode dar PRONTA: seria dizer "pode confiar o merge"
    // sem ter olhado um gate sequer. É a falsa segurança que este comando
    // existe para não produzir.
    unknowns.push("os guards da forja foram pulados (--no-guards): o veredito não cobre os gates")
  } else {
    for (const g of facts.guards.results) {
      if (g.code === null) unknowns.push(`gate '${g.gate}' não foi verificado: ${g.error}`)
      else if (g.code !== 0) blockers.push(`gate '${g.gate}' FALHOU (exit ${g.code})`)
    }
    if (facts.guards.error) blockers.push(facts.guards.error)
  }

  if (facts.image.code === IMAGE_MISSING) {
    blockers.push(
      "imagem do runner AUSENTE no registry (exit 4): sem ela NENHUM job inicia — nenhum gate chega a rodar, e o PR não é bloqueado por invariante nenhuma",
    )
  } else if (facts.image.code === IMAGE_ENV_BAD) {
    // Ausência do env NÃO é evidência sobre a forja: o arquivo é gitignored e
    // mora no host de deploy. Falta de prova, não prova de falha.
    unknowns.push(
      `imagem do runner não checada: o env não existe neste checkout (exit ${facts.image.code}) — aponte --gitea-env para o env da forja para que o veredito cubra a imagem`,
    )
  } else if (facts.image.code !== 0) {
    unknowns.push(`imagem do runner não confirmada (exit ${facts.image.code})`)
  }
  // A prova do bloqueio: só a VIOLAÇÃO é defeito (a garantia existe no texto e
  // não no comportamento). Não conseguir rodá-la é ausência de prova — nunca
  // "pronta", pelo mesmo motivo de sempre.
  if (facts.skippedProof) {
    unknowns.push(
      "a prova do bloqueio foi pulada (--no-proof): o veredito não cobre se a subida da stack realmente exige a imagem",
    )
  } else if (facts.proof.status === "violated") {
    blockers.push(
      `a PROVA do bloqueio da imagem FALHOU (${facts.proof.detail}): com a tag ausente o runner SOBE — o pré-requisito da imagem é decorativo`,
    )
  } else if (facts.proof.status === "unavailable") {
    unknowns.push(`prova do bloqueio não executada: ${facts.proof.detail}`)
  }

  // A interpolação do compose: variável vazia / valor literal BLOQUEIA (o
  // runner roda uma imagem que não é a declarada). Não conseguir renderizar é
  // ausência de prova — nunca "pronta".
  const compose = facts.compose
  if (compose?.state === "violated") {
    for (const v of compose.violations) blockers.push(v)
  } else if (compose && compose.state !== "proven" && compose.state !== "absent") {
    unknowns.push(`a interpolacao do compose da forja nao foi provada: ${compose.detail}`)
  }

  for (const m of facts.mirrors.blockers) blockers.push(m)
  for (const m of facts.mirrors.unknowns) unknowns.push(m)

  const verdict =
    blockers.length > 0 ? VERDICT.BLOCKED : unknowns.length > 0 ? VERDICT.UNKNOWN : VERDICT.READY

  const unproven = [
    `a branch protection REGISTRADA na forja (o manifesto ${REQUIRED_CHECKS_MANIFEST} é aplicado por scripts/apply-required-checks.mjs — o doctor lê o manifesto, não a forja)`,
    "o smoke da forja: que o runner usa a imagem com o Bun da variable (tier-1 em runtime) — é um job da própria forja",
    "o deploy/.env.gitea do VPS (não existe neste checkout; o doctor usa o que --gitea-env apontar)",
    `o render do compose com o DOCKER DO RUNNER da forja: aqui o render é feito com ESTE docker (${GITEA_COMPOSE}). A imagem do job da forja EMBARCA o plugin \`compose\` — medido: a base catthehacker/ubuntu:act-latest entrega /usr/libexec/docker/cli-plugins/docker-compose, e o build do Dockerfile.ubuntu-bun FALHA se isso mudar — e o smoke exige o render (--require-compose). O que segue fora do alcance daqui é o socket do job: é a Prova 4 do smoke que o exercita, no host.`,
  ]
  if (facts.skippedGuards) unproven.unshift("os guards da forja (pulados por --no-guards)")
  if (facts.skippedProof) unproven.unshift("a prova do bloqueio da imagem (pulada por --no-proof)")

  return { verdict, blockers, unknowns, unproven }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Coleta dos fatos
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lê o contrato de merge: cada forja do manifesto, com workflow existente e a
 * contagem de jobs obrigatórios.
 */
export function readContract(cwd = REPO_ROOT) {
  const path = join(cwd, REQUIRED_CHECKS_MANIFEST)
  if (!existsSync(path)) {
    return { forges: [], failures: [`${REQUIRED_CHECKS_MANIFEST}: ausente`], unknown: null }
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"))
  } catch (err) {
    return {
      forges: [],
      failures: [`${REQUIRED_CHECKS_MANIFEST}: JSON inválido (${err.message})`],
      unknown: null,
    }
  }

  const failures = []
  const forges = []
  for (const [forge, cfg] of Object.entries(manifest.forges ?? {})) {
    const jobs = cfg.jobs ?? []
    const exists = existsSync(join(cwd, cfg.workflow))
    if (!exists) failures.push(`${forge}: workflow obrigatório ausente (${cfg.workflow})`)
    if (jobs.length === 0) failures.push(`${forge}: nenhum job obrigatório no manifesto`)
    forges.push({ forge, workflow: cfg.workflow, jobs: jobs.length, exists })
  }
  if (forges.length === 0) failures.push(`${REQUIRED_CHECKS_MANIFEST}: nenhuma forja declarada`)
  return { forges, failures, unknown: null }
} /**
 * Os espelhos LOCAIS da versão concordam entre si? (sem rede)
 *
 * A GRAVIDADE É DIFERENTE PARA CADA UM, e misturar os dois seria mentir:
 *   - `deploy/env.gitea.example` alimenta a label do runner. Sem ele a forja não
 *     sabe QUAL imagem rodar → BLOQUEIA (é config da forja);
 *   - `.actrc` é o espelho do act LOCAL. Divergir dele não impede a forja de
 *     bloquear merge nenhum — incomoda quem roda act na máquina → NÃO PROVADO.
 *     (O job semanal `actrc-sync` existe justamente porque este valor só é
 *     comparável com a variável remota, que aqui não existe.)
 */
export function readMirrors(cwd = REPO_ROOT) {
  const blockers = []
  const unknowns = []

  const envPath = join(cwd, GITEA_ENV_MIRROR)
  const env = existsSync(envPath) ? extractEnvMirrorBunVersion(readFileSync(envPath, "utf8")) : null
  if (env === null) {
    blockers.push(
      `${GITEA_ENV_MIRROR} ausente ou sem BUN_VERSION — é ele que alimenta a label do runner: sem ele a forja não sabe qual imagem rodar`,
    )
  }

  const actrcPath = join(cwd, ".actrc")
  const actrc = existsSync(actrcPath)
    ? extractActrcBunVersion(readFileSync(actrcPath, "utf8"))
    : null
  if (actrc === null) {
    unknowns.push(".actrc ausente ou sem BUN_VERSION — o act local rodaria sem versão")
  } else if (env !== null && actrc !== env) {
    unknowns.push(
      `os espelhos locais divergem: .actrc='${actrc}' vs ${GITEA_ENV_MIRROR}='${env}' — um dos dois está velho; qual é o certo só a repository variable diz (job semanal actrc-sync)`,
    )
  }

  return { actrc, env, blockers, unknowns }
}

/** Roda o check da imagem (NUNCA publica) e guarda as linhas que ele emitiu. */
export async function readImage({ envFile = DEFAULT_ENV_FILE, cwd = REPO_ROOT, deps = {} } = {}) {
  const lines = []
  const emit = {
    pass: (m) => lines.push(`✅ ${m}`),
    fail: (m) => lines.push(`❌ ${m}`),
    warn: (m) => lines.push(`⚠️  ${m}`),
    info: (m) => lines.push(`▸  ${m}`),
    plain: (m = "") => lines.push(m),
  }
  // `emit` por ÚLTIMO: as dependências injetadas são para o fetch/exec, nunca
  // para trocar o coletor de linhas (senão a saída do check sumiria do relatório).
  const res = await ensureRunnerImage({ check: true, envFile, cwd, ...deps, emit })
  return { code: res.code, ref: res.ref, state: res.state, detail: res.detail, lines }
}

/**
 * A prova do bloqueio: EXECUTA o `deploy/gitea-up.sh` real contra um registry de
 * TESTE (127.0.0.1) e afirma sobre o log do docker dublê — com a tag ausente o
 * runner não sobe, com a tag presente sobe.
 *
 * POR QUE ISTO É UM FATO DO VEREDITO e não uma nota de rodapé: o doctor podia
 * dizer "imagem garantida" com base apenas na EXISTÊNCIA da tag agora. Isso
 * responde "dá para puxar?", não "a subida depende disso?". A prova responde a
 * segunda — e se ela falhar, o remédio não é publicar imagem nenhuma: é
 * consertar a subida.
 *
 * Nunca lança: `unavailable` (sem bash, sem o bring-up) é um estado próprio,
 * distinto de falha, porque ausência de prova não é prova de falha.
 */
export async function readProof({ cwd = REPO_ROOT, deps = {} } = {}) {
  // `prove` é o ponto de injeção: o teste do doctor precisa dos TRÊS estados
  // (segura/violada/indisponível) sem montar um registry e um docker dublê
  // dentro do teste do AGREGADOR — a prova em si tem o próprio arquivo de teste.
  const { prove = proveRunnerImageGate, ...rest } = deps
  try {
    const res = await prove({ cwd, ...rest })
    return { status: res.status, ok: res.ok, detail: res.detail, cases: res.cases }
  } catch (err) {
    return {
      status: "unavailable",
      ok: false,
      detail: `a prova não pôde rodar: ${err?.message ?? String(err)}`,
      cases: [],
    }
  }
}

/**
 * A INTERPOLAÇÃO do compose da forja: o que o `docker compose config` resolve
 * para o label do runner (invariante 7 do `check:registry-source`).
 *
 * POR QUE É UM FATO DO VEREDITO: a seção 3 mostra que a tag existe no registry,
 * e a seção 4 que a subida depende dela. Nenhuma das duas lê o que o compose
 * REALMENTE pede — um `${BUN_VERSIO}` (typo) resolve para string vazia e um
 * `${BUN_VERSION:-1.4.0}` resolve para um literal: nos dois casos a tag do
 * registry pode até existir, e o runner registra/puxa OUTRA imagem.
 *
 * `state: 'unavailable'` (sem docker/compose, sem env) NÃO falha aqui — vira
 * "não provado", a mesma regra do resto do doctor.
 */
export async function readComposeInterpolation({ cwd = REPO_ROOT, deps = {} } = {}) {
  const { check = checkComposeInterpolation } = deps
  try {
    const res = check({ cwd })
    return { state: res.state, violations: res.violations ?? [], detail: res.detail }
  } catch (err) {
    return {
      state: "unavailable",
      violations: [],
      detail: `a interpolacao do compose nao pode ser avaliada: ${err?.message ?? String(err)}`,
    }
  }
}

/** Executa a bateria de gates da forja. */
export function runGuards(gates, { cwd = REPO_ROOT, timeoutS = 120, run } = {}) {
  return gates.map((gate) => runGate(gate, { cwd, timeoutS, run: run ?? spawnSync }))
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Relatório
// ═══════════════════════════════════════════════════════════════════════════

const VERDICT_LINE = {
  [VERDICT.READY]: () => `${MARK.ok()} PRONTA PARA BLOQUEAR O MERGE`,
  [VERDICT.BLOCKED]: () => `${MARK.fail()} NÃO ESTÁ PRONTA — o merge NÃO pode ser confiado à forja`,
  [VERDICT.UNKNOWN]: () => `${MARK.warn()} INDETERMINADA — nada falhou, mas há coisa não provada`,
}

/**
 * @param {object} report  { facts, verdict }
 * @param {{emit: Function}} deps
 */
export function renderReport(report, { emit = console.log } = {}) {
  const { facts, verdict } = report
  const line = (s = "") => emit(s)

  line()
  line("  ═════════════════════════════════════════════════════════════════")
  line("   🩺 DOCTOR DA FORJA — prontidão para bloquear o merge")
  line("  ═════════════════════════════════════════════════════════════════")
  line()
  line(`  ${MARK.info()} dona do merge : ${MERGE_OWNER_PIPELINE} (job '${FORGE_GUARDS_JOB}')`)
  line(`  ${MARK.info()} manifesto     : ${REQUIRED_CHECKS_MANIFEST}`)

  // ── 1. Contrato de merge ────────────────────────────────────────────────
  line()
  line("  1/5  Contrato de merge")
  for (const f of facts.contract.forges) {
    const mark = f.exists && f.jobs > 0 ? MARK.ok() : MARK.fail()
    line(
      `       ${mark} ${f.forge.padEnd(7)} ${f.workflow.padEnd(32)} ${f.jobs} job(s) obrigatório(s)`,
    )
  }
  for (const failure of facts.contract.failures) line(`       ${MARK.fail()} ${failure}`)

  // ── 2. Guards da forja ──────────────────────────────────────────────────
  line()
  line(`  2/5  Guards da forja (derivados de ${MERGE_OWNER_PIPELINE})`)
  if (facts.skippedGuards) {
    line(`       ${MARK.skip()} pulados por --no-guards (o veredito NÃO cobre os gates)`)
  } else if (facts.guards.error) {
    line(`       ${MARK.fail()} ${facts.guards.error}`)
  } else {
    const failed = facts.guards.results.filter((r) => r.code !== 0)
    const mark = failed.length === 0 ? MARK.ok() : MARK.fail()
    line(
      `       ${mark} ${facts.guards.results.length} gate(s) executado(s) — ${failed.length} com problema`,
    )
    for (const r of facts.guards.results) {
      const status = r.code === 0 ? MARK.ok() : r.code === null ? MARK.warn() : MARK.fail()
      const time = `${r.seconds.toFixed(1)}s`.padStart(6)
      const note = r.code === null ? `  ${r.error}` : r.code === 0 ? "" : `  exit ${r.code}`
      line(`       ${status} ${r.gate.padEnd(40)}${time}${note}`)
      if (r.tail) for (const l of r.tail.split("\n")) line(`           ${color(C.gray, l)}`)
    }
  }

  // ── 3. Imagem do runner ─────────────────────────────────────────────────
  line()
  line("  3/5  Imagem do runner (o que os jobs puxam para INICIAR)") // Só a AUSÊNCIA confirmada (exit 4) é falha da forja; o resto é falta de
  // prova (env ausente no checkout, registry inacessível, pacote privado).
  const imageMark =
    facts.image.code === 0
      ? MARK.ok()
      : facts.image.code === IMAGE_MISSING
        ? MARK.fail()
        : MARK.warn()
  line(`       ${imageMark} exit ${facts.image.code} · estado '${facts.image.state}'`)
  if (facts.image.ref) line(`           ${facts.image.ref}`)
  for (const l of facts.image.lines) line(`           ${color(C.gray, l)}`)

  // A tag existir no registry não prova que o compose PEDE a tag certa: aqui o
  // `docker compose config` resolve o label do runner de verdade (invariante 7).
  const ci = facts.compose
  if (ci) {
    const ciMark =
      ci.state === "proven"
        ? MARK.ok()
        : ci.state === "violated"
          ? MARK.fail()
          : ci.state === "absent"
            ? MARK.info()
            : MARK.warn()
    line(`       ${ciMark} interpolacao do compose: ${ci.detail}`)
    for (const v of ci.violations) line(`           ${color(C.gray, v)}`)
  }

  // ── 4. Prova do bloqueio ────────────────────────────────────────────────
  // A tag existir AGORA não prova que a subida depende dela. Esta seção executa
  // o caminho real contra um registry de teste e mostra o que o docker viu.
  line()
  line("  4/5  Prova do bloqueio (registry de TESTE — o runner não sobe sem a imagem)")
  if (facts.skippedProof) {
    line(`       ${MARK.skip()} pulada por --no-proof (o veredito NÃO cobre o bloqueio)`)
  } else {
    const proofMark =
      facts.proof.status === "holds"
        ? MARK.ok()
        : facts.proof.status === "violated"
          ? MARK.fail()
          : MARK.warn()
    const cases = facts.proof.cases ?? []
    const summary =
      facts.proof.status === "holds"
        ? `${cases.length} caso(s): ${cases.map((c) => `${c.id}=exit ${c.exit}`).join(" · ")}`
        : facts.proof.detail
    line(`       ${proofMark} ${summary}`)
    if (facts.proof.status === "holds") {
      line(
        `           ${color(C.gray, "tag ausente ⇒ NENHUM 'compose up'; tag presente ⇒ 'up -d runner' (controle)")}`,
      )
    }
    for (const c of cases.filter((c) => !c.ok)) {
      line(`           ${MARK.fail()} ${c.title}`)
      for (const f of c.failures ?? []) line(`               ${color(C.gray, f)}`)
    }
  }

  // ── 5. Espelhos locais ─────────────────────────────────────────────────
  line()
  line("  5/5  Espelhos locais da versão (sem rede)")
  if (facts.mirrors.blockers.length === 0 && facts.mirrors.unknowns.length === 0) {
    line(`       ${MARK.ok()} .actrc e ${GITEA_ENV_MIRROR} concordam (${facts.mirrors.actrc})`)
  }
  for (const p of facts.mirrors.blockers) line(`       ${MARK.fail()} ${p}`)
  for (const p of facts.mirrors.unknowns) line(`       ${MARK.warn()} ${p}`)

  // ── Veredito ────────────────────────────────────────────────────────────
  line()
  line("  ─────────────────────────────────────────────────────────────────")
  line(`  VEREDITO: ${VERDICT_LINE[verdict.verdict]()}`)
  line("  ─────────────────────────────────────────────────────────────────")

  if (verdict.blockers.length > 0) {
    line()
    line(`  ${color(C.red, "Bloqueios")} (corrigir antes de confiar o merge à forja):`)
    for (const b of verdict.blockers) line(`    ${MARK.fail()} ${b}`)
  }
  if (verdict.unknowns.length > 0) {
    line()
    line(`  ${color(C.yellow, "Não provado")}:`)
    for (const u of verdict.unknowns) line(`    ${MARK.warn()} ${u}`)
  }

  line()
  line(`  ${color(C.gray, "O veredito NÃO cobre:")}`)
  for (const u of verdict.unproven) line(`    ${color(C.gray, `· ${u}`)}`)
  line()
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. CLI
// ═══════════════════════════════════════════════════════════════════════════

export const USAGE = `forge-doctor — relatório de prontidão da forja para bloquear o merge

Usage:
  node scripts/forge-doctor.mjs [opções]

Opções:
  --no-guards            pula a bateria de guards (mais rápido; o veredito fica parcial)
  --no-proof             pula a prova do bloqueio da imagem (mais rápido; o veredito fica parcial)
  --no-compose-render    pula a interpolação do compose (docker compose config)
  --gitea-env <path>     env do runner a checar (default: deploy/.env.gitea)
  --timeout <segundos>   limite por gate (default: 120)
  --json                 sai como JSON (mesma informação do relatório)
  -h, --help             esta ajuda

Exit codes (o veredito é o exit code — dá para usar em pipeline):
  0 — pronta   1 — bloqueada   2 — indeterminada   3 — uso/erro interno
`

export function parseArgs(argv) {
  const opts = {
    guards: true,
    proof: true,
    composeRender: true,
    envFile: DEFAULT_ENV_FILE,
    timeoutS: 120,
    json: false,
    help: false,
    error: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--no-guards") opts.guards = false
    else if (arg === "--no-proof") opts.proof = false
    else if (arg === "--no-compose-render") opts.composeRender = false
    else if (arg === "--json") opts.json = true
    else if (arg === "-h" || arg === "--help") opts.help = true
    else if (arg === "--gitea-env") opts.envFile = argv[++i] ?? ""
    else if (arg === "--timeout") opts.timeoutS = Number(argv[++i])
    else opts.error = `argumento desconhecido: ${arg}`
  }
  if (!opts.envFile) opts.error = "--gitea-env exige um caminho"
  if (!Number.isFinite(opts.timeoutS) || opts.timeoutS < 1) {
    opts.error = "--timeout exige um número de segundos >= 1"
  }
  return opts
}

/**
 * Coleta os fatos e monta o veredito. Exportado para o teste exercitar o fluxo
 * inteiro com dependências dubladas (sem registry, sem rodar gate de verdade).
 *
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {string} [options.envFile]   env do runner (o mesmo do compose)
 * @param {boolean} [options.guards]   executar a bateria da forja (default: true)
 * @param {boolean} [options.proof]    executar a prova do bloqueio (default: true)
 * @param {boolean} [options.composeRender] interpolar o compose da forja (default: true)
 * @param {number} [options.timeoutS]  limite por gate
 * @param {Function} [options.run]     `spawnSync` real ou dublê de teste
 * @param {object} [options.imageDeps] dependências repassadas ao check da imagem
 * @param {object} [options.proofDeps] dependências repassadas à prova do bloqueio
 * @param {object} [options.composeDeps] dependências repassadas à interpolação do compose
 * (`{prove}` substitui a prova inteira — é o ponto de injeção do teste)
 * (sem `@returns` declarado de propósito: o formato dos fatos é o que o
 * `summarize` consome, e descrevê-lo aqui de novo só criaria duas verdades)
 */
export async function diagnose({
  cwd = REPO_ROOT,
  envFile = DEFAULT_ENV_FILE,
  guards = true,
  proof = true,
  composeRender = true,
  timeoutS = 120,
  run,
  imageDeps = {},
  proofDeps = {},
  composeDeps = {},
} = {}) {
  const contractRun = runGate(
    { label: "check:required-checks", command: "bun run check:required-checks" },
    { cwd, timeoutS, run },
  )
  const contract = readContract(cwd)
  if (contractRun.code !== 0) {
    contract.failures.push(
      contractRun.code === null
        ? `check:required-checks não foi verificado: ${contractRun.error}`
        : `check:required-checks FALHOU (exit ${contractRun.code}) — o manifesto aponta para jobs que não existem, ou um obrigatório virou condicional`,
    )
  }

  const pipelinePath = join(cwd, MERGE_OWNER_PIPELINE)
  let gatesResult = { gates: [], error: null }
  if (existsSync(pipelinePath)) {
    gatesResult = forgeGates(readFileSync(pipelinePath, "utf8"))
  } else {
    gatesResult = { gates: [], error: `${MERGE_OWNER_PIPELINE}: ausente` }
  }

  const results = guards ? runGuards(gatesResult.gates, { cwd, timeoutS, run }) : []

  return {
    facts: {
      contract,
      guards: { results, error: gatesResult.error ?? null, gates: gatesResult.gates },
      image: await readImage({ envFile, cwd, deps: imageDeps }),
      proof: proof
        ? await readProof({ cwd, deps: proofDeps })
        : { status: "skipped", ok: false, detail: "pulada por --no-proof", cases: [] },
      compose: composeRender
        ? await readComposeInterpolation({ cwd, deps: composeDeps })
        : { state: "skipped", violations: [], detail: "pulada por --no-compose-render" },
      mirrors: readMirrors(cwd),
      skippedGuards: !guards,
      skippedProof: !proof,
    },
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.error) {
    console.error(`forge-doctor: ${opts.error}`)
    console.error(USAGE)
    process.exit(3)
  }
  if (opts.help) {
    console.log(USAGE)
    process.exit(0)
  }

  const { facts } = await diagnose(opts)
  const verdict = summarize(facts)
  const report = { facts, verdict }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    renderReport(report)
  }

  process.exit(verdict.verdict === VERDICT.READY ? 0 : verdict.verdict === VERDICT.BLOCKED ? 1 : 2)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (IS_DIRECT_RUN) await main()
