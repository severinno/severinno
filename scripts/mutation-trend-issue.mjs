#!/usr/bin/env node

// =============================================================================
// mutation-trend-issue.mjs
//
// Transforma o DRIFT DE OVERHEAD do mutation-coord (o `::warning::` dos jobs
// semanais `mutation-coord-timing` e `mutation-coord-trend`) em uma ISSUE
// ACIONÁVEL — e fecha a dívida quando o overhead volta à faixa.
//
// POR QUE ISSO PRECISA EXISTIR (defeito real, audiado): os dois jobs do
// `benchmark-weekly.yml` terminavam VERDES por desenho. O `measure-mutation-trend`
// emite `::warning::` e sai 0 quando o drift relativo passa do limiar; o
// `measure-mutation-timing` faz o mesmo na faixa SOFT (entre a mediana + margem
// e o teto duro). Um `::warning::` dentro de um run VERDE não é lido por
// ninguém — é o alerta MUDO que o `required-checks-drift-issue.mjs`,
// `actrc-sync-issue.mjs`, `readme-reverse-issue.mjs` e `forge-doctor-issue.mjs`
// existem para eliminar. A issue é o canal; o run continua verde (o alerta de
// tendência é deliberadamente não-bloqueante: overhead subindo NÃO quebra
// corretude, e transformar o soft no duro apagaria a distinção entre "observa
// o drift" e "estourou o budget").
//
// POR QUE UM PUBLICADOR SÓ, ALIMENTADO PELOS DOIS RELATÓRIOS: os dois jobs medem
// o MESMO step com a MESMA mediana, mas com limiares diferentes (margem relativa
// vs drift % configurado por var). Se cada job publicasse/reconciliasse por si,
// o mais frouxo fecharia a dívida que o mais estrito acabou de abrir. Aqui os
// relatórios entram JUNTOS (um job que espera os dois e roda o publicador), então
//   - `warned` = QUALQUER relatório fora da faixa;
//   - reconciliar exige TODOS medidos e NENHUM fora da faixa.
// "Não consegui medir" (`found: false`) NUNCA reconcilia: um mecanismo de
// medição quebrado não é evidência de que o overhead voltou ao normal.
//
// FONTE ÚNICA: nenhum diagnóstico é reimplementado — os relatórios são os dos
// medidores (`measure-mutation-timing.mjs` / `measure-mutation-trend.mjs`), e a
// mecânica de issue (marcador, dedup, backends do `gh` e da API do Gitea,
// fechamento) é a de `issue-publish.mjs`. O que é DESTE publicador: o label,
// o título, a assinatura e a prosa.
//
// ASSINATURA POR FAIXA (não por número): a duração varia a cada run; uma
// assinatura com o valor exato comentaria TODA semana (o ruído que o dedup
// existe para impedir). A faixa (`floor(drift%/10)`) muda só quando a
// severidade muda de ordem — e aí comentar é o comportamento certo.
//
// Fluxo:
//   1. lê os relatórios (`--report FILE`, repetível) — o job de alerta passa os
//      dois, extraídos dos artifacts dos jobs de medição;
//   2. algum relatório fora da faixa → assinatura estável + dedup contra as
//      issues ABERTAS → cria ou comenta;
//   3. todos medidos E dentro da faixa → RECONCILIA: comenta a prova e fecha as
//      issues que ESTE publicador abriu;
//   4. `--no-reconcile` publica sem fechar (para quem roda no caminho que não
//      conhece todos os relatórios).
//
// Usage:
//   node scripts/mutation-trend-issue.mjs --report /tmp/mutation-trend.json
//   node scripts/mutation-trend-issue.mjs --report a.json --report b.json
//   node scripts/mutation-trend-issue.mjs --report a.json --backend gitea --repo org/repo
//   node scripts/mutation-trend-issue.mjs --report a.json --dry-run
//
// Credenciais (nunca do arquivo — só do ambiente):
//   github: GH_TOKEN | GITHUB_TOKEN  (CLI `gh`, com escrita em issues)
//   gitea:  GITEA_TOKEN + GITEA_URL  (+ GITEA_REPOSITORY | --repo)
//
// Exit codes:
//   0 — fora da faixa (issue criada/comentada/já reportada), dentro da faixa
//       (nada a fazer, ou a dívida foi fechada), ou dry-run
//   1 — erro real: nenhum relatório, relatório ausente/inválido, credencial
//       ausente, ou falha do backend — "não medido" não pode parecer verde
// =============================================================================

import { existsSync, readFileSync } from "node:fs"
import process from "node:process"
import { pathToFileURL } from "node:url"

import {
  decidePublication,
  issueHasAnyMarker,
  markerOf,
  reconcileDebt,
  selectIssueBackend,
} from "./issue-publish.mjs"

/** Label de triagem (dedup + filtro no board). */
export const ISSUE_LABEL = "mutation-trend-drift"

/** Cor do label (hex sem `#`, o formato da CLI do `gh`). */
export const ISSUE_LABEL_COLOR = "FBCA04"

/** Descrição do label (aparece no board e explica a dívida). */
export const ISSUE_LABEL_DESCRIPTION =
  "Overhead do mutation-coord acima do limiar de tendência (jobs semanais)"

/** Id do marcador invisível que carrega a assinatura (o dedup é por publicador). */
export const MARKER_ID = "mutation-trend-drift"

// ---------------------------------------------------------------------------
// Funções puras (exportadas para teste unitário — sem rede, sem gh)
// ---------------------------------------------------------------------------

/**
 * `true` se o relatório TEM medição: o trend embrulha o run atual em `current`,
 * o timing expõe `found` no topo. `found: false` é infra (o medidor falhou).
 *
 * @param {object} report
 */
export function measured(report) {
  return report?.found === true || report?.current?.found === true
}

/**
 * A faixa do relatório: `ok` | `warn` | `fail` | `unmeasured`.
 *
 * `fail` (teto duro estourado) também é acionável: o run fica vermelho pelo
 * gate, mas um cron vermelho é alerta mudo — a issue é o canal.
 *
 * @param {object} report
 * @returns {"ok"|"warn"|"fail"|"unmeasured"}
 */
export function zoneOf(report) {
  if (!measured(report)) return "unmeasured"
  if (report.zone === "fail") return "fail"
  if (report.warned === true || report.zone === "warn") return "warn"
  return "ok"
}

/** Duração medida do step, ou `null` quando não houve medição. */
export function durationOf(report) {
  return report?.current?.durationSecs ?? report?.durationSecs ?? null
}

/** Mediana usada como baseline, ou `null`. */
export function medianOf(report) {
  return typeof report?.medianSecs === "number" ? report.medianSecs : null
}

/** Drift relativo %, quando o relatório traz um número. */
export function driftPctOf(report) {
  return typeof report?.driftPct === "number" && Number.isFinite(report.driftPct)
    ? report.driftPct
    : null
}

/**
 * A FAIXA do drift (dezena). A assinatura usa a faixa, não o número: a duração
 * oscila a cada run, e uma assinatura com o valor exato comentaria toda semana.
 */
export function bandOf(report) {
  const pct = driftPctOf(report)
  if (pct === null) return 0
  return Math.max(0, Math.floor(pct / 10))
}

/** `true` se ALGUM relatório saiu da faixa. */
export function isActionable(reports) {
  return reports.some((report) => {
    const zone = zoneOf(report)
    return zone === "warn" || zone === "fail"
  })
}

/** `true` se TODOS os relatórios têm medição (sem isso não se reconcilia). */
export function allMeasured(reports) {
  return reports.length > 0 && reports.every(measured)
}

/**
 * Assinatura estável da dívida: a pior faixa + a maior dezena de drift. Duas
 * runs com o MESMO grau de problema produzem a MESMA assinatura (dedup); uma
 * piora de ordem muda a dezena e comenta na issue aberta (a dívida mudou).
 *
 * @param {object[]} reports
 */
export function signatureOf(reports) {
  const worst = reports.some((report) => zoneOf(report) === "fail") ? "fail" : "warn"
  const band = Math.max(0, ...reports.map(bandOf))
  return `mutation-overhead:zone=${worst}:band=${band}`
}

/** Título ESTÁVEL entre runs — não leva números nem duração (isso vai no corpo). */
export function trendTitle() {
  return "Overhead do mutation-coord subindo (tendência acima do limiar)"
}

/** Uma linha por relatório: o medidor, o step, a duração, a mediana e a faixa. */
function reportLines(reports) {
  const lines = []
  for (const report of reports) {
    const zone = zoneOf(report)
    const kind = report.stepName ? `\`${report.stepName}\`` : "step do mutation-coord"
    const duration = durationOf(report)
    const median = medianOf(report)
    const drift = driftPctOf(report)
    const parts = []
    parts.push(`- **${kind}** — faixa \`${zone}\``)
    parts.push(`  - duração: ${duration === null ? "desconhecida" : `**${duration}s**`}`)
    if (median !== null) parts.push(`  - mediana dos runs anteriores: ${median}s`)
    if (drift !== null) parts.push(`  - drift relativo: ${drift.toFixed(1)}%`)
    if (report.maxDriftPct !== undefined)
      parts.push(`  - limiar de tendência: ${report.maxDriftPct}%`)
    if (report.budgetSecs !== undefined) parts.push(`  - teto duro: ${report.budgetSecs}s`)
    if (report.warnSecs !== undefined && report.warnSecs !== null)
      parts.push(`  - faixa soft: ${report.warnSecs}s`)
    if (zone === "unmeasured" && report.error) parts.push(`  - medição falhou: ${report.error}`)
    lines.push(parts.join("\n"))
  }
  return lines
}

/**
 * Corpo da issue em markdown: o que mediu, com que números, por que importa e o
 * que olhar. Sem isso a issue só diz "está lento" e transfere a investigação.
 *
 * @param {object[]} reports
 */
export function trendBody(reports) {
  const lines = []
  lines.push("O overhead do **mutation-coord** passou do limiar de tendência nos jobs semanais.")
  lines.push("")
  lines.push(
    "O step do contrato coordenado ficou mais lento que a mediana dos runs" +
      " anteriores. Isso **não quebra corretude** — é o gate DURO (`--max`) que" +
      " falha o run quando o budget estoura. Esta issue existe para o drift LENTO" +
      " (40s → 55s → 75s) ser visto ANTES de cruzar o teto, em vez de aparecer" +
      " meses depois como um `timed out`.",
  )
  lines.push("")
  lines.push("### O que foi medido")
  lines.push("")
  for (const line of reportLines(reports)) lines.push(line)
  lines.push("")
  lines.push("### Olhar")
  lines.push("")
  lines.push("```bash")
  lines.push("bun run mutation:timing-contract        # o que o step cobre")
  lines.push("bun run mutation:check                  # a suíte de mutação inteira")
  lines.push("```")
  lines.push("")
  lines.push(
    "Causas comuns: o contrato coordenado ganhou um cenário por release; o runner" +
      " ficou mais lento (ruído — confira a mediana vinda de vários runs, não um" +
      " run isolado); dependência nova encareceu o `bun install` do job.",
  )
  lines.push("")
  lines.push(markerOf(MARKER_ID, signatureOf(reports)))
  return lines.join("\n")
}

/**
 * O comentário de RESOLUÇÃO — a prova de que o overhead voltou à faixa. Entra na
 * issue ANTES do fechamento.
 *
 * @param {object[]} reports
 */
export function resolutionComment(reports) {
  const lines = []
  lines.push("✅ **Resolvido** — o overhead voltou para dentro do limiar de tendência.")
  lines.push("")
  lines.push("### O que foi medido agora (a prova)")
  lines.push("")
  for (const line of reportLines(reports)) lines.push(line)
  lines.push("")
  lines.push(
    "> Fechada automaticamente: se o overhead voltar a subir, a mesma regra abre" +
      " uma issue nova com a assinatura do momento (o dedup é entre as ABERTAS).",
  )
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Publicação
// ---------------------------------------------------------------------------

/**
 * Publica o drift de overhead (ou reconcilia quando dentro da faixa).
 *
 * @param {object} params
 * @param {object[]} params.reports            relatórios dos medidores (1+)
 * @param {object} params.backend              backend de `issue-publish.mjs`
 * @param {boolean} [params.dryRun]            imprime e NÃO toca o backend
 * @param {boolean} [params.reconcile]         `false` publica sem fechar
 * @param {(msg: string) => void} [params.log]
 */
export async function publishTrendIssue({
  reports,
  backend,
  dryRun = false,
  reconcile = true,
  log = console.log,
}) {
  if (isActionable(reports)) {
    log("⚠️  Overhead acima do limiar — publicando issue acionável.")
    if (dryRun) {
      log(trendBody(reports))
      log(`\n(dry-run: nenhuma chamada ao backend '${backend.name}')`)
      return { status: "dry-run" }
    }
    await backend.ensureLabel()
    const title = trendTitle()
    const body = trendBody(reports)
    const decision = decidePublication({
      existing: await backend.openIssues(),
      title,
      signature: signatureOf(reports),
      markerId: MARKER_ID,
    })
    if (decision.action === "already-reported") {
      log(
        `ℹ️  Drift de overhead idêntico já reportado na issue #${decision.issue.number} — sem ruído.`,
      )
      return { status: "already-reported", number: decision.issue.number }
    }
    if (decision.action === "comment") {
      await backend.comment(decision.issue.number, body)
      log(`✅ Comentário adicionado à issue #${decision.issue.number} (drift novo).`)
      return { status: "commented", number: decision.issue.number }
    }
    const ref = await backend.create(title, body)
    log(`✅ Issue criada: ${ref}`)
    return { status: "created", ref }
  }

  if (!allMeasured(reports)) {
    // "Não medido" NÃO é "resolvido": reconciliar aqui fecharia a dívida por um
    // mecanismo de medição quebrado. O run já ficou vermelho pelo medidor.
    log("⚠️  Medição ausente/incompleta — NÃO reconciliando (não medido ≠ resolvido).")
    return { status: "unmeasured" }
  }

  log("✅ Overhead dentro do limiar de tendência.")
  if (dryRun) {
    log(
      `   (dry-run: nenhuma chamada ao backend '${backend.name}' — a reconciliação fecharia as issues abertas por este publicador)`,
    )
    return { status: "in-threshold" }
  }
  if (!reconcile) {
    log("   (--no-reconcile: o fechamento é do job que conhece TODOS os relatórios)")
    return { status: "in-threshold" }
  }
  const { closed } = await reconcileDebt({
    backend,
    // Só o que é NOSSO: uma issue que ganhou o label por engano não pode ser
    // fechada por automatismo.
    isOurs: (issue) => issueHasAnyMarker(issue, MARKER_ID),
    resolutionBody: resolutionComment(reports),
    reason: "o overhead voltou para dentro do limiar de tendência",
    log,
  })
  if (closed.length > 0) {
    log(
      `🔒 Reconciliado: ${closed.length} issue(s) fechada(s) — a dívida não fica aberta depois de resolvida.`,
    )
  }
  return { status: "in-threshold", closed }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const USAGE =
  "Uso: node scripts/mutation-trend-issue.mjs --report FILE [--report FILE…] " +
  "[--backend github|gitea] [--repo owner/name] [--no-reconcile] [--dry-run]"

export function parseArgs(argv) {
  const options = {
    reports: [],
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
      options.reports.push(value)
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
 * Carrega os relatórios. Um arquivo AUSENTE é erro: o job que passou o caminho
 * esperava medição ali — seguir sem ela publicaria (ou fecharia) a partir de
 * nada, que é a forma mais barata do alerta mudo.
 */
export function loadReports(paths, { exists = existsSync, read = readFileSync } = {}) {
  if (paths.length === 0) throw new Error("nenhum --report: sem medição não há alerta")
  return paths.map((path) => {
    if (!exists(path)) throw new Error(`--report: arquivo não existe: ${path}`)
    const parsed = JSON.parse(read(path, "utf8"))
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`--report: JSON inválido (não é objeto de relatório): ${path}`)
    }
    return parsed
  })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  const reports = loadReports(options.reports)
  await publishTrendIssue({
    reports,
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
