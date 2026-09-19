#!/usr/bin/env node

// =============================================================================
// guard-timing-issue.mjs
//
// Transforma a REGRESSÃO DE TEMPO do `bench-guard-timing` (uma forma medida
// acima do limiar vs a baseline) numa ISSUE ACIONÁVEL — e fecha a dívida quando
// o número volta à baseline.
//
// POR QUE ISTO PRECISA EXISTIR (auditoria dos jobs periódicos): o
// `bench-guard-timing` mede wall time dos guards e do doctor e o próprio
// repositório registrava, na doc, que ele **não roda em cron nenhum** — o número
// só existia quando alguém lembrava de rodar à mão, e `--compare` terminava
// VERMELHO num run semanal (o alerta MUDO que o
// `required-checks-drift-issue.mjs`, o `actrc-sync-issue.mjs`, o
// `readme-reverse-issue.mjs`, o `mutation-trend-issue.mjs` e o
// `blob-crlf-scope-issue.mjs` existem para eliminar: ninguém abre o log de um
// cron que passou). A issue é o canal; o run do job continua verde porque tempo
// de execução NÃO é corretude — tratá-lo como gate vermelho apagaria a diferença
// entre "observa a tendência" e "o build quebrou".
//
// A RÉGUA É UMA SÓ: a comparação vem de `compareTimings` (do
// `bench-guard-timing.mjs`), a MESMA que o relatório impresso usa — limiar de
// 20% por forma medida (guards, doctor, lint) e no total. Reimplementar o delta
// aqui criaria uma segunda régua, e a divergência apareceria como "o CI diz
// regressão e a issue está fechada" (ou o inverso) sem nenhum teste vermelho.
//
// ASSINATURA POR FAIXA (não pelo número): o wall time oscila a cada run; uma
// assinatura com o valor exato comentaria TODA semana (o ruído que o dedup
// existe para impedir). A faixa é a dezena do pior percentual ACIMA do limiar —
// ela muda só quando a severidade muda de ordem, e aí comentar é o certo.
//
// "NÃO MEDIDO" NÃO FECHA: baseline ausente, forma sem número ou um comando que
// não terminou (`ok: false` — ele pode ter ficado RÁPIDO por ter morrido antes
// de fazer o trabalho) deixam a comparação `measured: false`. Um medidor
// quebrado não é evidência de que o tempo voltou ao normal, então `resolution.when`
// recusa o fechamento e o run diz que não reconciliou.
//
// Fluxo:
//   1. lê o relatório do run (`--report`, default
//      `docs/benchmarks/guard-timing-latest.json`) e a baseline (`--baseline`,
//      default `docs/benchmarks/guard-timing-baseline.json`);
//   2. alguma forma medida acima do limiar → assinatura estável + dedup contra
//      as issues ABERTAS → cria ou comenta, com o guard e o DELTA no corpo;
//   3. nenhuma acima do limiar E tudo medido → RECONCILIA: comenta a prova e
//      fecha as issues que ESTE publicador abriu;
//   4. `--no-reconcile` publica sem fechar (para quem roda no caminho que não
//      conhece todos os relatórios).
//
// Usage:
//   node scripts/guard-timing-issue.mjs
//   node scripts/guard-timing-issue.mjs --report X.json --baseline Y.json
//   node scripts/guard-timing-issue.mjs --backend gitea --repo org/repo
//   node scripts/guard-timing-issue.mjs --dry-run
//
// Credenciais (nunca do arquivo — só do ambiente):
//   github: GH_TOKEN | GITHUB_TOKEN  (CLI `gh`, com escrita em issues)
//   gitea:  GITEA_TOKEN + GITEA_URL  (+ GITEA_REPOSITORY | --repo)
//
// Exit codes:
//   0 — regressão publicada (issue criada/comentada/já reportada), dentro do
//       limiar (nada a fazer, ou a dívida foi fechada), ou dry-run
//   1 — erro real: relatório/baseline ausente ou inválido, credencial ausente,
//       ou falha do backend — "não medido" não pode parecer verde
// =============================================================================

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

import { REGRESSION_THRESHOLD_PCT, compareTimings } from "./bench-guard-timing.mjs"
import {
  defineDebtPublisher,
  publisherBody,
  runDebtPublisher,
  selectIssueBackend,
} from "./issue-publish.mjs"

/** Label de triagem (dedup + filtro no board). */
export const ISSUE_LABEL = "guard-timing-regression"

/** Cor do label (hex sem `#`, o formato da CLI do `gh`). */
export const ISSUE_LABEL_COLOR = "FBCA04"

/** Descrição do label (aparece no board e explica a dívida). */
export const ISSUE_LABEL_DESCRIPTION =
  "Wall time dos guards/doctor acima do limiar do bench-guard-timing (job semanal)"

/** Id do marcador invisível que carrega a assinatura (o dedup é por publicador). */
export const MARKER_ID = "guard-timing-regression"

/** O relatório do run e a baseline — versionados em `docs/benchmarks/`. */
export const DEFAULT_REPORT = join("docs", "benchmarks", "guard-timing-latest.json")
export const DEFAULT_BASELINE = join("docs", "benchmarks", "guard-timing-baseline.json")

// ---------------------------------------------------------------------------
// Funções puras (exportadas para teste unitário — sem rede, sem gh)
// ---------------------------------------------------------------------------

/**
 * Monta a ENTRADA do publicador: os dois relatórios e a comparação DERIVADA
 * deles pela régua compartilhada.
 *
 * É o único jeito de produzir a entrada: o publicador nunca recebe uma
 * comparação montada à mão, então não existe caminho em que ele julgue por um
 * número que não veio do `compareTimings`.
 *
 * @param {object} current
 * @param {object|null} baseline  `null` é o caso real (baseline ainda não gravada)
 * @param {{thresholdPct?: number}} [options]
 */
export function inputOf(current, baseline, options = {}) {
  return { current, baseline, comparison: compareTimings(current, baseline, options) }
}

/** As formas medidas que passaram do limiar (a dívida de agora). */
export function regressionsOf(input) {
  return input?.comparison?.regressions ?? []
}

/** `true` se ALGUMA forma MEDIDA passou do limiar. */
export function isActionable(input) {
  return regressionsOf(input).length > 0
}

/**
 * A FAIXA do pior percentual acima do limiar (dezena do %). Zero quando não há
 * regressão. É a severidade em ordem de grandeza, não o número do run.
 *
 * @param {object} input
 */
export function bandOf(input) {
  const pior = Math.max(0, ...regressionsOf(input).map((form) => form.pct ?? 0))
  return Math.max(0, Math.floor((pior * 100) / 10))
}

/**
 * Assinatura estável da dívida: a FAIXA do pior percentual acima do limiar.
 *
 * NÃO leva o número exato nem QUAIS formas pioraram: o wall time oscila a cada
 * run, e uma assinatura que carregasse a lista de formas comentaria toda semana
 * (o ruído que o dedup existe para impedir). A faixa muda só quando a severidade
 * muda de ordem — e aí comentar é o certo. O QUE piorou vai no corpo, que é
 * onde quem investiga precisa ler.
 *
 * @param {object} input
 */
export function signatureOf(input) {
  return `guard-timing:band=${bandOf(input)}`
}

/** Título ESTÁVEL entre runs — não leva números nem duração (isso vai no corpo). */
export function timingTitle() {
  return "Tempo dos guards/doctor acima do limiar (bench-guard-timing)"
}

/** `+34%` / `-12%` — o sinal do delta, com o valor absoluto em segundos. */
function deltaLine(form) {
  const sign = (form.deltaMs ?? 0) > 0 ? "+" : ""
  return `${sign}${((form.deltaMs ?? 0) / 1000).toFixed(1)}s (${sign}${((form.pct ?? 0) * 100).toFixed(0)}%)`
}

/** A tabela da medição inteira: baseline, agora e o delta por forma. */
function measurementTable(comparison) {
  const lines = []
  lines.push("| forma | tipo | baseline | agora | delta |")
  lines.push("| :---- | :--- | -------: | ----: | ----: |")
  for (const form of comparison.forms) {
    const baseline = form.baselineMs === null ? "—" : `${(form.baselineMs / 1000).toFixed(1)}s`
    const agora = form.currentMs === null ? "—" : `${(form.currentMs / 1000).toFixed(1)}s`
    const delta = form.unmeasured
      ? "**não medido**"
      : form.isNew
        ? "novo (sem baseline)"
        : deltaLine(form)
    lines.push(`| \`${form.label}\` | ${form.kind} | ${baseline} | ${agora} | ${delta} |`)
  }
  return lines
}

/**
 * Corpo da issue em markdown: o guard, o DELTA e a medição inteira. Sem o delta
 * e sem a baseline a issue só diz "está lento" e transfere a investigação.
 *
 * @param {object} input
 */
function timingProse(input) {
  const { comparison } = input
  const lines = []
  lines.push(
    `O **bench-guard-timing** mediu ${regressionsOf(input).length} forma(s) acima do limiar de ` +
      `**${(comparison.thresholdPct * 100).toFixed(0)}%** (e de pelo menos ` +
      `${comparison.minDeltaMs}ms de piora absoluta) contra a baseline.`,
  )
  lines.push("")
  lines.push("### O que passou do limiar")
  lines.push("")
  for (const form of regressionsOf(input)) {
    lines.push(
      `- **\`${form.label}\`** (${form.kind}) — **${deltaLine(form)}** ` +
        `(baseline ${(form.baselineMs / 1000).toFixed(1)}s → agora ${(form.currentMs / 1000).toFixed(1)}s)`,
    )
  }
  lines.push("")
  if (comparison.reason) {
    lines.push(`> ⚠️  Parte da medição não pôde ser julgada (${comparison.reason}): o fechamento`)
    lines.push("> automático fica suspenso até a medição voltar a ser completa.")
    lines.push("")
  }
  lines.push("### A medição inteira (contexto)")
  lines.push("")
  lines.push(...measurementTable(comparison))
  lines.push("")
  lines.push(
    `> baseline: \`${comparison.baselineCommit ?? "?"}\` · run atual: \`${comparison.currentCommit ?? "?"}\``,
  )
  lines.push("")
  lines.push("### Olhar")
  lines.push("")
  lines.push("```bash")
  lines.push("bun run bench:guard-timing:compare   # mede de novo e compara com a baseline")
  lines.push("bun run bench:guard-timing           # mede e imprime a medição inteira")
  lines.push("```")
  lines.push("")
  lines.push(
    "Causas comuns: um guard novo entrou na bateria (o total sobe sem que nada tenha ficado" +
      " mais lento — confira a linha da forma); o guard ganhou trabalho de verdade (dependência," +
      " arquivo novo para varrer); o runner ficou mais lento (ruído — a baseline é um run, não" +
      " uma mediana).",
  )
  lines.push("")
  lines.push(
    `> O piso de ${comparison.minDeltaMs}ms existe porque a bateria é medida com UMA amostra por` +
      " guard: em comandos de dezenas de ms, 20% é ruído de escalonamento, e um canal que abre" +
      " dívida por ruído deixa de ser lido.",
  )
  lines.push("")
  lines.push(
    "Se a piora for **aceita** (o gate passou a fazer mais), mova a baseline DE PROPÓSITO:" +
      " `bun run bench:guard-timing:baseline`. A baseline é o número que esta issue cobra, e" +
      " movê-la é decisão registrada — não efeito do tempo.",
  )
  lines.push("")
  return lines.join("\n")
}

/** O corpo COMPLETO da issue: a prosa + o marcador, como o contrato os compõe. */
export function timingBody(input) {
  return publisherBody(GUARD_TIMING_PUBLISHER, input)
}

/**
 * O comentário de RESOLUÇÃO — a prova de que o tempo voltou para dentro do
 * limiar. Entra na issue ANTES do fechamento.
 *
 * @param {object} input
 */
export function resolutionComment(input) {
  const { comparison } = input
  const lines = []
  lines.push(
    `✅ **Resolvido** — nenhuma forma medida passou do limiar de ${(comparison.thresholdPct * 100).toFixed(0)}%.`,
  )
  lines.push("")
  lines.push("### A prova (medição de agora, contra a MESMA baseline)")
  lines.push("")
  lines.push(...measurementTable(comparison))
  lines.push("")
  lines.push(
    `> baseline: \`${comparison.baselineCommit ?? "?"}\` · run atual: \`${comparison.currentCommit ?? "?"}\``,
  )
  lines.push("")
  lines.push(
    "> Fechada automaticamente: se o tempo voltar a passar do limiar, a mesma regra abre uma" +
      " issue nova com a assinatura do momento (o dedup é entre as ABERTAS).",
  )
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Publicação
// ---------------------------------------------------------------------------

/**
 * O CONTRATO deste publicador (`issue-publish.mjs`): o ciclo (publicar,
 * deduplicar por assinatura, comentar no título já aberto, criar, COMENTAR a
 * prova antes de fechar) mora no contrato, um só para todos os publicadores.
 *
 * O QUE FICA DECLARADO AQUI: a etiqueta, o formato do marcador (`b64`), o título
 * estável, a assinatura por FAIXA, a prosa, quando há dívida (`isActionable`), o
 * ESCOPO (uma issue — a regressão de tempo é UM estado do bench, não um item por
 * guard) e o FECHAMENTO (a prova do comentário + o motivo).
 *
 * A GUARDA DO FECHAMENTO é `comparison.measured`: um medidor quebrado não é
 * evidência de que o tempo voltou ao normal.
 */
export const GUARD_TIMING_PUBLISHER = defineDebtPublisher({
  name: MARKER_ID,
  label: ISSUE_LABEL,
  labelColor: ISSUE_LABEL_COLOR,
  labelDescription: ISSUE_LABEL_DESCRIPTION,
  marker: { id: MARKER_ID, format: "b64" },
  title: () => timingTitle(),
  signature: (input) => signatureOf(input),
  body: (input) => timingProse(input),
  actionable: (input) => isActionable(input),
  scope: { kind: "single" },
  resolution: {
    when: (input) => input?.comparison?.measured === true,
    comment: (input) => resolutionComment(input),
    reason: "o tempo voltou para dentro do limiar do bench-guard-timing",
  },
  prose: {
    actionable: (input) =>
      `⚠️  Regressão de tempo em ${regressionsOf(input).length} forma(s) (limiar ${(
        (input?.comparison?.thresholdPct ?? REGRESSION_THRESHOLD_PCT) * 100
      ).toFixed(0)}%) — publicando issue acionável.`,
    // O MOTIVO nomeia a família que faltou: "medição incompleta" sozinho deixa
    // quem lê o log sem saber o que refazer (`--merge`? `--no-lint`? um guard que
    // morreu?). O fechamento é recusado nos dois casos; o que muda é o diagnóstico.
    inSync: (input) =>
      input?.comparison?.measured
        ? "✅ Nenhuma forma medida acima do limiar de tempo."
        : `ℹ️  Comparação de tempo sem medição completa neste run (${input?.comparison?.reason ?? "motivo não declarado"}).`,
    alreadyReported: (issue) =>
      `ℹ️  Regressão idêntica já reportada na issue #${issue.number} — sem ruído.`,
    commented: (issue) => `✅ Comentário adicionado à issue #${issue.number} (regressão nova).`,
    created: (ref) => `✅ Issue criada: ${ref}`,
    reconciled: (count) =>
      `🔒 Reconciliado: ${count} issue(s) de regressão de tempo fechada(s) — a dívida não fica aberta depois de resolvida.`,
    dryRunTail: (backendName) => `\n(dry-run: nenhuma chamada ao backend '${backendName}')`,
    dryRunReconcile: (backendName) =>
      `   (dry-run: nenhuma chamada ao backend '${backendName}' — a reconciliação fecharia as issues abertas por este publicador)`,
  },
})

/**
 * Publica a regressão de tempo (ou reconcilia quando tudo voltou ao limiar).
 *
 * A ORDEM é a do contrato (`runDebtPublisher`): ação quando há dívida;
 * reconciliação quando não há E a medição permite provar que voltou.
 *
 * @param {object} params
 * @param {object} params.input      `inputOf(current, baseline)`
 * @param {object} params.backend    backend de `issue-publish.mjs`
 * @param {boolean} [params.dryRun]
 * @param {boolean} [params.reconcile]
 * @param {(msg: string) => void} [params.log]
 */
export async function publishTimingIssue({
  input,
  backend,
  dryRun = false,
  reconcile = true,
  log = console.log,
}) {
  return runDebtPublisher({
    publisher: GUARD_TIMING_PUBLISHER,
    input,
    backend,
    dryRun,
    reconcile,
    log,
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const USAGE =
  "Uso: node scripts/guard-timing-issue.mjs [--report FILE] [--baseline FILE] " +
  "[--backend github|gitea] [--repo owner/name] [--no-reconcile] [--dry-run]"

export function parseArgs(argv) {
  const options = {
    report: DEFAULT_REPORT,
    baseline: DEFAULT_BASELINE,
    backend: "github",
    repo: null,
    reconcile: true,
    dryRun: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--report") {
      const value = argv[++i]
      if (value === undefined) throw new Error("--report exige um caminho")
      options.report = value
    } else if (arg === "--baseline") {
      const value = argv[++i]
      if (value === undefined) throw new Error("--baseline exige um caminho")
      options.baseline = value
    } else if (arg === "--backend") {
      const value = argv[++i]
      if (value === undefined) throw new Error("--backend exige um valor")
      options.backend = value
    } else if (arg === "--repo") {
      const value = argv[++i]
      if (value === undefined) throw new Error("--repo exige um valor")
      options.repo = value
    } else if (arg === "--no-reconcile") options.reconcile = false
    else if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--help" || arg === "-h") options.help = true
    else throw new Error(`Argumento desconhecido: ${arg}`)
  }
  if (!["github", "gitea"].includes(options.backend)) {
    throw new Error(`--backend deve ser github|gitea (recebido: ${options.backend})`)
  }
  return options
}

/**
 * Carrega um relatório JSON de medição. Arquivo AUSENTE ou inválido é ERRO: o
 * job que passou o caminho esperava medição ali — publicar (ou fechar) a partir
 * de nada é a forma mais barata do alerta mudo que este publicador elimina.
 */
export function loadReport(path, { exists = existsSync, read = readFileSync } = {}) {
  if (!exists(path)) throw new Error(`relatório de medição não existe: ${path}`)
  const parsed = JSON.parse(read(path, "utf8"))
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`relatório de medição inválido (não é objeto): ${path}`)
  }
  return parsed
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  const input = inputOf(loadReport(options.report), loadReport(options.baseline))
  await publishTimingIssue({
    input,
    backend: options.dryRun
      ? { name: options.backend }
      : selectIssueBackend(options, process.env, {
          label: ISSUE_LABEL,
          color: ISSUE_LABEL_COLOR,
          description: ISSUE_LABEL_DESCRIPTION,
        }),
    dryRun: options.dryRun,
    reconcile: options.reconcile,
  })
  return 0
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) {
  let code = 1
  try {
    code = await main()
  } catch (error) {
    console.error(`❌ ${error.message}`)
    code = 1
  }
  process.exit(code)
}
