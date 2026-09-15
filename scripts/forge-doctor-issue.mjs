#!/usr/bin/env node

// =============================================================================
// forge-doctor-issue.mjs
//
// Transforma o VEREDITO do `forge-doctor.mjs` em uma ISSUE ACIONÁVEL quando ele
// não é PRONTA.
//
// POR QUE: o doctor responde a pergunta inteira ("esta forja pode bloquear o
// merge?") e diz o que NÃO provou — mas só o lê quem se lembrou de rodá-lo. O
// bring-up da stack já o tornou pré-requisito da SUBIDA (recusa BLOQUEADA); este
// é o mesmo cuidado para o que muda SOZINHO depois que a forja está no ar: a
// branch protection registrada, o registro GRAVADO do runner, a tag que o
// registry serve hoje, os espelhos do BUN_VERSION. Nada disso aparece em review,
// e nenhum deles fica vermelho em PR.
//
// POR QUE ISSUE (e não só um cron vermelho): o precedente deste repo
// (`required-checks-drift-issue.mjs`, `actrc-sync-issue.mjs`,
// `readme-reverse-issue.mjs`) vale inteiro aqui — ninguém abre o log de um cron
// que ficou vermelho. A issue carrega o veredito, os bloqueadores com o remédio
// e o que ficou SEM PROVA.
//
// FONTE ÚNICA: aqui não há diagnóstico nenhum reimplementado. O corpo sai do
// MESMO relatório que o doctor produz (`--json`), e a mecânica de issue
// (marcador, decisão de dedup, backends do GitHub e do Gitea) é a de
// `issue-publish.mjs`. O que é deste publicador: o label, o título, a prosa.
//
// O QUE CONTA COMO ACIONÁVEL: veredito ≠ PRONTA. Isso inclui INDETERMINADA, que
// NÃO é violação — mas é dívida de PROVA, e é exatamente onde um drift se
// esconde (um fato que ninguém mediu não pode estar certo nem errado). O corpo
// diz qual dos dois casos é, para o leitor não tratar "não provado" como
// "quebrado": INDETERMINADA pede a credencial/acesso que falta, não o conserto
// de uma peça.
//
// Fluxo:
//   1. lê o relatório (--report FILE) ou roda o doctor agora (`--json`, com as
//      flags do doctor repassadas: `--expected`, `--gitea-env`, `--no-*`);
//   2. veredito PRONTA → sai 0 sem tocar a forja;
//   3. ASSINATURA estável (veredito + bloqueadores + não-provados, ordenados) e
//      dedup contra as issues ABERTAS com o label: o MESMO veredito não repete
//      (cron semanal não vira ruído) e um veredito DIFERENTE comenta na aberta;
//   4. cria a issue (ou comenta) — sempre ANTES de o job falhar, porque um step
//      que falha primeiro mata o step que publica.
//
// Usage:
//   node scripts/forge-doctor-issue.mjs --report /tmp/doctor.json
//   node scripts/forge-doctor-issue.mjs --backend gitea --expected 1.3.14
//   node scripts/forge-doctor-issue.mjs --report /tmp/doctor.json --dry-run
//
// Credenciais (nunca do arquivo — só do ambiente):
//   github: GH_TOKEN | GITHUB_TOKEN            (CLI `gh`)
//   gitea:  GITEA_TOKEN + GITEA_URL            (+ GITEA_REPOSITORY | --repo)
//
// Exit codes:
//   0 — veredito PRONTA, ou issue criada/comentada, ou já reportada (ou dry-run)
//   1 — erro real: relatório ausente/inválido, credencial ausente, backend fora,
//       ou o doctor NÃO produziu relatório (exit 3 = uso/erro interno) —
//       fail-closed: um alerta que não pode ser publicado é o mesmo silêncio de
//       antes, só que parecendo verde
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { VERDICT } from "./forge-doctor.mjs"
import {
  defineDebtPublisher,
  publisherBody,
  runDebtPublisher,
  selectIssueBackend,
} from "./issue-publish.mjs"

/** Label de triagem das issues de veredito (dedup + filtro no board). */
export const ISSUE_LABEL = "forge-doctor-verdict"

/** Cor do label (hex sem `#`, o formato da CLI do `gh`). */
export const ISSUE_LABEL_COLOR = "FBCA04"

/** Descrição do label (aparece no board e explica a dívida). */
export const ISSUE_LABEL_DESCRIPTION =
  "Veredito do forge doctor que não é PRONTA (a forja pode não segurar o merge)"

/** Id do marcador invisível que carrega a assinatura (dedup por publicador). */
export const VERDICT_MARKER_ID = "forge-doctor-verdict"

/**
 * O comentário de RESOLUÇÃO — a PROVA de que o veredito voltou a PRONTA.
 *
 * Era a metade que faltava deste publicador: ele abria a issue e nunca a
 * fechava, então a dívida do veredito ficava no board depois de resolvida (a
 * mesma "dívida que mente" que o resto do repositório já corrigia). Agora o
 * fechamento vem do CONTRATO — e a prova diz o que foi medido agora, para quem
 * chegar depois não ter de reconstruir o estado da forja na data do fechamento.
 *
 * @param {{facts?: object, verdict?: object}} report
 * @returns {string}
 */
export function verdictResolutionComment(report) {
  const lines = []
  lines.push("✅ **Resolvido** — o veredito do doctor voltou a **PRONTA**.")
  lines.push("")
  lines.push("### O que foi medido agora (a prova)")
  lines.push("")
  lines.push("- veredito: `pronta` (nenhum bloqueador, nada que o doctor não tenha provado)")
  const facts = report?.facts ?? {}
  // Só os fatos que o relatório de fato trouxe: a prova não inventa medição que
  // não aconteceu (um fato ausente num relatório antigo não vira "provado").
  const saida = [
    ["branch protection REGISTRADA", facts.protection?.state],
    ["interpolação do compose", facts.compose?.state],
    ["registro do act_runner", facts.runnerLabels?.state],
    ["registro do runner do GitHub", facts.githubRunnerLabels?.state],
    ["dívida aberta no board", facts.openDebt?.state],
  ].filter(([, state]) => state !== undefined)
  for (const [label, state] of saida) lines.push(`- ${label}: \`${state}\``)
  if (facts.mirrors?.expected !== undefined) {
    lines.push(`- espelhos do BUN_VERSION: comparados com \`${facts.mirrors.expected}\``)
  }
  if (report?.verdict?.unproven?.length) {
    lines.push(
      `- o veredito NÃO cobre ${report.verdict.unproven.length} coisa(s) por desenho (ver o relatório)`,
    )
  }
  lines.push("")
  lines.push("```bash")
  lines.push("bun run doctor   # exit 0 = PRONTA (o mesmo comando do cron)")
  lines.push("```")
  lines.push("")
  lines.push(
    "> Fechada automaticamente: se o veredito voltar a não ser PRONTA, a mesma" +
      " regra abre uma issue nova com a assinatura do momento (o dedup é entre as" +
      " ABERTAS).",
  )
  return lines.join("\n")
}

/**
 * O CONTRATO deste publicador (`issue-publish.mjs`).
 *
 * ESCOPO `single`: o veredito é UM estado da forja (bloqueadores + não-provados
 * ordenados), não um item por achado. FECHAMENTO: o veredito voltou a PRONTA —
 * aí a issue deste publicador já não representa dívida nenhuma, e o contrato
 * comenta a prova e fecha.
 */
export const VERDICT_PUBLISHER = defineDebtPublisher({
  name: VERDICT_MARKER_ID,
  label: ISSUE_LABEL,
  labelColor: ISSUE_LABEL_COLOR,
  labelDescription: ISSUE_LABEL_DESCRIPTION,
  marker: { id: VERDICT_MARKER_ID, format: "b64" },
  title: () => doctorIssueTitle(),
  signature: (report) => verdictSignatureOf(report),
  body: (report) => doctorIssueProse(report),
  actionable: (report) => isActionable(report),
  scope: { kind: "single" },
  resolution: {
    comment: (report) => verdictResolutionComment(report),
    reason: "o veredito do doctor voltou a PRONTA",
  },
  prose: {
    inSync: () => "✅ Veredito PRONTA — nada a reportar.",
    actionable: (report) =>
      `⚠️  Veredito ${verdictOf(report).toUpperCase()} — publicando issue acionável.`,
    alreadyReported: (issue) =>
      `ℹ️  Veredito idêntico já reportado na issue #${issue.number} — sem ruído.`,
    commented: (issue) => `✅ Comentário adicionado à issue #${issue.number} (veredito novo).`,
    reconciled: (count) =>
      `🔒 Reconciliado: ${count} issue(s) de veredito fechada(s) — a dívida não fica aberta depois de resolvida.`,
  },
})

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DOCTOR_PATH = resolve(REPO_ROOT, "scripts", "forge-doctor.mjs")

// ---------------------------------------------------------------------------
// Funções puras (exportadas para teste unitário — sem rede, sem docker)
// ---------------------------------------------------------------------------

/** O veredito em si ("pronta" | "bloqueada" | "indeterminada"), ou "?" se ausente. */
export function verdictOf(report) {
  return report?.verdict?.verdict ?? "?"
}

/**
 * Título ESTÁVEL entre runs — de propósito NÃO inclui o veredito nem os fatos
 * (isso vai no corpo): um título que muda a cada veredito abriria uma issue nova
 * por run em vez de comentar na dívida já aberta.
 */
export function doctorIssueTitle() {
  return "Forge doctor: prontidão da forja ≠ PRONTA"
}

/**
 * `true` quando há o que reportar: qualquer veredito que não seja PRONTA.
 *
 * INDETERMINADA entra de propósito. Ela não é violação, mas é o estado em que o
 * drift vive invisível (ninguém conseguiu medir); deixá-la fora do alerta faria
 * o cron semanal ficar verde justamente quando a prova está faltando.
 */
export function isActionable(report) {
  return verdictOf(report) !== VERDICT.READY
}

/**
 * Assinatura estável do veredito: só o que importa (o veredito, os bloqueadores
 * e o que ficou sem prova), ordenado. Sem timestamp e sem a ordem de retorno —
 * duas runs com o MESMO veredito precisam produzir a MESMA assinatura, senão o
 * dedup não funciona e a issue vira ruído semanal.
 *
 * A lista `unproven` (o que o veredito NÃO cobre, por desenho) fica FORA: ela é
 * constante entre runs, e assinatura é sobre o que mudou.
 */
export function verdictSignatureOf(report) {
  const verdict = report?.verdict ?? {}
  const parts = [`verdict:${verdict.verdict ?? "?"}`]
  for (const b of [...(verdict.blockers ?? [])].sort()) parts.push(`blocker:${b}`)
  for (const u of [...(verdict.unknowns ?? [])].sort()) parts.push(`unknown:${u}`)
  return parts.join("\n")
}

/**
 * Corpo da issue em markdown: o veredito, os bloqueadores (cada um já carrega o
 * remédio) e o que ficou sem prova. Sem isso a issue só diz "não está pronta" e
 * transfere a investigação para quem lê.
 */
/**
 * A PROSA do corpo da issue — sem o marcador: quem o compõe é o contrato
 * (`publisherBody`), para o marcador ter UMA implementação.
 */
function doctorIssueProse(report) {
  const verdict = report?.verdict ?? {}
  const blockers = verdict.blockers ?? []
  const unknowns = verdict.unknowns ?? []
  const unproven = verdict.unproven ?? []

  const lines = []
  lines.push(
    "O veredito do `bun run doctor` **não é PRONTA**: a forja pode não segurar o" +
      " merge, ou há coisa que ninguém conseguiu provar.",
  )
  lines.push("")
  lines.push(`**VEREDITO: ${String(verdict.verdict ?? "?").toUpperCase()}**`)
  lines.push("")

  if (blockers.length > 0) {
    lines.push("### Bloqueadores — violação PROVADA (corrigir antes de confiar o merge)")
    lines.push("")
    for (const b of blockers) lines.push(`- ${b}`)
    lines.push("")
  }

  if (unknowns.length > 0) {
    lines.push("### Não provado — o veredito NÃO cobre")
    lines.push("")
    for (const u of unknowns) lines.push(`- ${u}`)
    lines.push("")
  }

  if (verdict.verdict === VERDICT.UNKNOWN) {
    lines.push(
      "> **INDETERMINADA não é violação**: nada falhou — algo não pôde ser" +
        " medido AGORA (registry fora, sem token, sem docker, ferramenta ausente)." +
        " O remédio costuma ser dar o acesso que falta a quem roda o doctor, e não" +
        " consertar uma peça quebrada.",
    )
    lines.push("")
  }

  if (unproven.length > 0) {
    lines.push("<details><summary>Fora do alcance deste veredito (por desenho)</summary>")
    lines.push("")
    for (const u of unproven) lines.push(`- ${u}`)
    lines.push("")
    lines.push("</details>")
    lines.push("")
  }

  lines.push("### Reproduzir")
  lines.push("")
  lines.push("```bash")
  lines.push("bun run doctor                              # o relatório completo")
  lines.push(
    [
      'bun run doctor --expected "$(gh variable get BUN_VERSION)" \\',
      '  --expected-var "IMAGE_REGISTRY=$(gh variable get IMAGE_REGISTRY)" \\',
      '  --expected-var "IMAGE_NAMESPACE=$(gh variable get IMAGE_NAMESPACE)"   # + o VALOR das três',
    ].join("\n"),
  )
  lines.push("bun run doctor --gitea-env <o env DESTE host>  # com o env do host da forja")
  lines.push("```")
  lines.push("")
  lines.push(
    "Um drift de branch protection tem o seu próprio alerta" +
      " (`required-checks-drift`); esta issue é o veredito INTEIRO, incluindo o que" +
      " os alertas por assunto não olham.",
  )
  lines.push("")
  return lines.join("\n")
}

/** O corpo COMPLETO da issue: a prosa + o marcador, como o contrato os compõe. */
export function doctorIssueBody(report) {
  return publisherBody(VERDICT_PUBLISHER, report)
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const OWN_VALUE_FLAGS = new Set(["--report", "--backend", "--repo"])
const DOCTOR_VALUE_FLAGS = new Set(["--expected", "--expected-var", "--gitea-env", "--timeout"])

/**
 * Argumentos: os DESTE publicador são poucos e explícitos; qualquer outra flag
 * `--x` é do DOCTOR e vai repassada como está (com o valor, quando ela tem um).
 * Assim uma flag nova do doctor não exige mexer aqui — e uma flag desconhecida
 * não é engolida em silêncio.
 */
export function parseArgs(argv) {
  const options = {
    report: null,
    backend: "github",
    repo: null,
    dryRun: false,
    help: false,
    doctorArgs: [],
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--help" || arg === "-h") options.help = true
    else if (OWN_VALUE_FLAGS.has(arg)) {
      const value = argv[++i]
      if (value === undefined) throw new Error(`${arg} exige um valor`)
      if (arg === "--report") options.report = value
      else if (arg === "--backend") options.backend = value
      else options.repo = value
    } else if (arg.startsWith("--")) {
      options.doctorArgs.push(arg)
      if (DOCTOR_VALUE_FLAGS.has(arg)) {
        const value = argv[++i]
        if (value === undefined) throw new Error(`${arg} exige um valor`)
        options.doctorArgs.push(value)
      }
    } else {
      throw new Error(`Argumento desconhecido: ${arg}`)
    }
  }
  if (!["github", "gitea"].includes(options.backend)) {
    throw new Error(`--backend deve ser github|gitea (recebido: ${options.backend})`)
  }
  return options
}

/**
 * O relatório do doctor: de arquivo (`--report`) ou rodando o doctor agora.
 *
 * Exit 1/2 do doctor são ESPERADOS (o veredito é o exit code) — o JSON vem no
 * stdout de qualquer forma. Já sem stdout não há veredito: erro, não "verde".
 */
export function loadDoctorReport(options, { run = spawnSync, execPath = process.execPath } = {}) {
  if (options.report) {
    if (!existsSync(options.report))
      throw new Error(`--report: arquivo não existe: ${options.report}`)
    return JSON.parse(readFileSync(options.report, "utf8"))
  }
  const res = run(execPath, [DOCTOR_PATH, "--json", ...(options.doctorArgs ?? [])], {
    encoding: "utf8",
    env: process.env,
    // O JSON carrega o `facts` inteiro (inclui a saída dos gates): dezenas de MB
    // é o teto folgado de um relatório, e o default de 1 MB cortaria no meio.
    maxBuffer: 64 * 1024 * 1024,
  })
  const stdout = (res.stdout ?? "").trim()
  if (!stdout) {
    throw new Error(
      `\`forge-doctor.mjs --json\` não produziu relatório (exit ${res.status}): ` +
        `${(res.stderr ?? "").slice(0, 400)}`,
    )
  }
  return JSON.parse(stdout)
}

/**
 * Publica o veredito, com dedup por assinatura.
 *
 * @param {object} params
 * @param {object} params.report    o JSON do doctor (`{facts, verdict}`)
 * @param {object} params.backend   backend de `issue-publish.mjs`
 * @param {boolean} [params.dryRun] imprime o corpo e NÃO toca o backend
 * @param {(msg: string) => void} [params.log]
 * @returns {Promise<{status: string, number?: number, ref?: string}>}
 */
export async function publishDoctorVerdict({ report, backend, dryRun = false, log = console.log }) {
  // O ciclo inteiro é do contrato — inclusive o FECHAMENTO, que era a metade
  // deste publicador que faltava: com o veredito de volta em PRONTA, a issue
  // é fechada com a prova no comentário em vez de ficar mentindo no board.
  return runDebtPublisher({
    publisher: VERDICT_PUBLISHER,
    input: report,
    backend,
    dryRun,
    log,
  })
}

const USAGE =
  "Uso: node scripts/forge-doctor-issue.mjs [--report FILE] [--backend github|gitea] " +
  "[--repo owner/name] [--dry-run] [flags do doctor: --expected, --gitea-env, --no-*…]"

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  const report = loadDoctorReport(options)
  const backend = options.dryRun
    ? { name: options.backend }
    : selectIssueBackend(options, process.env, {
        label: ISSUE_LABEL,
        color: ISSUE_LABEL_COLOR,
        description: ISSUE_LABEL_DESCRIPTION,
      })
  await publishDoctorVerdict({ report, backend, dryRun: options.dryRun })
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
