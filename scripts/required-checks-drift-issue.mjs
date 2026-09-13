#!/usr/bin/env node

// =============================================================================
// required-checks-drift-issue.mjs
//
// Transforma o drift do branch protection (detectado por
// `apply-required-checks.mjs --check`) em uma ISSUE ACIONÁVEL. O precedente
// deste repo (readme-reverse-issue.mjs) vale aqui pelo mesmo motivo: "o job
// semanal falhou" é um alerta MUDO — ninguém abre o log de um cron vermelho.
//
// POR QUE DRIFT IMPORTA: os gates existem como jobs, mas quem BLOQUEIA o merge
// é o branch protection, que é estado da forja e não aparece em review. Se
// alguém renomear o `name:` de um job (o contexto de status muda junto), o
// check exigido passa a ser um que NUNCA roda — e o PR trava esperando para
// sempre, com diagnóstico opaco. O `--check` detecta isso; esta issue diz o que
// fazer.
//
// DOIS BACKENDS, UMA REGRA: a forja self-hosted (Gitea) é a DONA DO MERGE, e
// ela não tem `gh`. Por muito tempo o cron dela terminava o run com o diff no
// log e mais nada — o mesmo alerta mudo de antes, do lado que decide o merge.
// Aqui a publicação é plugável: `--backend github` (CLI `gh`) ou `--backend
// gitea` (API de issues do Gitea). O que decide o que é drift, o TEXTO e a
// ASSINATURA de dedup é o MESMO código nos dois — só muda quem cria o ticket.
//
// E O OUTRO LADO DA DÍVIDA: publicar sem FECHAR deixa a issue ABERTA depois de
// resolvida — uma dívida que mente. Um alerta que o procedimento documentado não
// limpa acaba ignorado, e o próximo rename é investigado duas vezes. Então,
// quando o diagnóstico não tem drift nenhum, este script RECONCILIA: comenta o
// que foi comparado (a prova) e fecha as issues que ELE abriu. Só o que é NOSSO
// (marcador, nunca só o label). Se o drift voltar, a mesma regra abre uma issue
// nova com a assinatura do momento (o dedup é entre as ABERTAS).
//
// Fluxo:
//   1. lê um relatório de drift — de arquivo (--report) ou gerando agora
//      (spawna `apply-required-checks.mjs --check --json`);
//   2. sem drift → RECONCILIA (fecha as dívidas abertas por este publicador) e
//      sai 0;
//   3. calcula uma ASSINATURA estável do drift (por forja+branch+itens) e
//      deduplica: se uma issue aberta com o label já carrega esse marcador,
//      não comenta de novo (cron semanal não deve virar ruído);
//   4. caso contrário, cria a issue (ou comenta numa aberta) com a tabela do
//      drift e o comando de correção.
//
// Usage:
//   node scripts/required-checks-drift-issue.mjs --report /tmp/drift.json
//   node scripts/required-checks-drift-issue.mjs --forge github
//   node scripts/required-checks-drift-issue.mjs --backend gitea --repo org/repo
//   node scripts/required-checks-drift-issue.mjs --report /tmp/drift.json --dry-run
//
// Credenciais (nunca do arquivo — só do ambiente):
//   github: GH_TOKEN | GITHUB_TOKEN  (CLI `gh`)
//   gitea:  GITEA_TOKEN + GITEA_URL  (obrigatórios)
//           repo: --repo owner/name | GITEA_REPOSITORY
//           O token precisa de ESCRITA em issues além de ler o branch
//           protection — sem isso o drift volta a ser alerta mudo.
//
// Exit codes:
//   0 — sem drift (e a dívida aberta foi fechada), ou issue criada/comentada,
//       ou já reportada (ou dry-run)
//   1 — erro real: relatório ausente/inválido, credencial ausente, falha do
//       backend (`gh`/API) ou o próprio `--check` falhou por infra (token sem
//       permissão) — um drift que não pode ser medido é tão grave quanto o
//       drift, e uma dívida resolvida que não pôde ser fechada continua
//       mentindo no board
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  decidePublication,
  hasMarker,
  issueHasAnyMarker,
  markerOf as markerOfId,
  reconcileDebt,
  selectIssueBackend,
} from "./issue-publish.mjs"

// Reexportado porque é a mecânica de publicação que os TESTES deste publicador
// exercitam (config da API do Gitea) — a implementação mora em issue-publish.mjs.
export { giteaIssueConfig } from "./issue-publish.mjs"

/** Label de triagem das issues de drift (dedup + filtro no board). */
export const ISSUE_LABEL = "required-checks-drift"

/** Cor do label (hex sem `#`, o formato da CLI do `gh`). */
export const ISSUE_LABEL_COLOR = "BFD4F2"

/** Descrição do label (aparece no board e explica a dívida). */
export const ISSUE_LABEL_DESCRIPTION = "Branch protection divergente de ci/required-checks.json"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const APPLIER_PATH = resolve(REPO_ROOT, "scripts", "apply-required-checks.mjs")

// ---------------------------------------------------------------------------
// Funções puras (exportadas para teste unitário — sem rede, sem gh)
// ---------------------------------------------------------------------------

/** Título ESTÁVEL entre runs — não inclui branch nem itens (isso vai no corpo). */
export function driftTitle() {
  return "Required checks drift: branch protection ≠ ci/required-checks.json"
}

/**
 * Assinatura estável do drift: só o que importa (forja, branch, itens faltando
 * e sobrando), ordenado. Sem timestamp e sem a ordem de retorno da API — duas
 * runs com o MESMO drift precisam produzir a MESMA assinatura, senão o dedup
 * não funciona e a issue vira ruído semanal.
 */
export function signatureOf(report) {
  const parts = []
  for (const forge of Object.keys(report?.forges ?? {}).sort()) {
    for (const branch of report.forges[forge]?.branches ?? []) {
      if (branch.inSync) continue
      const missing = [...(branch.missing ?? [])].sort().join(" | ")
      const extra = [...(branch.extra ?? [])].sort().join(" | ")
      // `enable_status_check=false` (só o Gitea reporta) é um drift INVISÍVEL
      // em listas de contexto: nada falta e nada sobra, e o merge passa com o
      // gate vermelho. Sem o token na assinatura, esse estado não se distingue
      // de "contextos em sincronia" no dedup. Só conta com proteção EXISTENTE:
      // branch sem proteção nenhuma já difere pelos contextos que faltam.
      const silent =
        branch.configured === true && branch.enforceStatusChecks === false ? ":!enforce=false" : ""
      parts.push(`${forge}:${branch.branch}:-[${missing}]:+[${extra}]${silent}`)
    }
  }
  for (const error of report?.errors ?? []) parts.push(`error:${error.forge}:${error.message}`)
  return parts.join("\n")
}

/**
 * O identificador do marcador na issue (o dedup é POR publicador: um drift de
 * required checks nunca pode ser confundido com o veredito do doctor).
 */
export const DRIFT_MARKER_ID = "required-checks-drift"

/**
 * Marcador HTML invisível que carrega a assinatura dentro do corpo da issue.
 *
 * A REGRA (formato do marcador + decisão de dedup) é a de `issue-publish.mjs`:
 * aqui fica só o id deste publicador, para a mecânica não ter duas cópias.
 */
export function markerOf(signature) {
  return markerOfId(DRIFT_MARKER_ID, signature)
}

/** `true` se `body` já carrega o marcador desta assinatura. */
export function hasSignature(body, signature) {
  return hasMarker(body, DRIFT_MARKER_ID, signature)
}

/**
 * Corpo da issue em markdown: o que divergiu, por forja/branch, e o comando
 * que resolve. Sem isso a issue só diz "tem drift" e transfere o trabalho de
 * investigação para quem lê.
 */
export function driftBody(report) {
  const lines = []
  lines.push("O branch protection não corresponde a `ci/required-checks.json`.")
  lines.push("")
  lines.push(
    "Os gates rodam como jobs, mas quem **bloqueia o merge** é a lista de required" +
      " status checks — estado da forja, fora do review. Um contexto renomeado (o" +
      " `name:` de um job muda o contexto) ou removido deixa o PR esperando para" +
      " sempre por um check que nunca vai rodar.",
  )
  lines.push("")

  for (const [forge, data] of Object.entries(report?.forges ?? {})) {
    lines.push(`### ${forge} — \`${data.workflow ?? "-"}\``)
    lines.push("")
    for (const branch of data.branches ?? []) {
      if (branch.inSync) {
        lines.push(`- \`${branch.branch}\`: em sincronia`)
        continue
      }
      lines.push(`- \`${branch.branch}\`${branch.configured ? "" : " (sem proteção configurada)"}:`)
      if (branch.configured === true && branch.enforceStatusChecks === false) {
        lines.push(
          "  - ⚠️ `enable_status_check` DESLIGADO: os contextos estão registrados e" +
            " **NÃO bloqueiam** — o merge passa com o gate vermelho",
        )
      }
      for (const item of branch.missing ?? []) lines.push(`  - ➕ falta exigir: \`${item}\``)
      for (const item of branch.extra ?? []) lines.push(`  - ➖ exige a mais: \`${item}\``)
    }
    lines.push("")
  }

  if ((report?.errors ?? []).length > 0) {
    lines.push("### Erros de verificação")
    lines.push("")
    for (const error of report.errors) lines.push(`- \`${error.forge}\`: ${error.message}`)
    lines.push("")
    lines.push(
      "> Um drift que **não pôde ser medido** é tão grave quanto o drift: a" +
        " proteção pode estar furada e ninguém sabe. Corrija o token antes de" +
        " fechar esta issue.",
    )
    lines.push("")
  }

  lines.push("### Corrigir")
  lines.push("")
  lines.push("```bash")
  lines.push("bun run check:required-checks        # o manifesto ainda aponta para jobs reais?")
  lines.push("bun run ci:required-checks -- --check   # reexibe este drift")
  lines.push("bun run ci:required-checks -- --apply   # aplica o manifesto na forja")
  lines.push("```")
  lines.push("")
  lines.push(
    "Se a causa foi um **rename de job**, prefira atualizar o manifesto/workflow a" +
      " aplicar: exigir um contexto que não existe é pior que não exigir nada.",
  )
  lines.push("")
  lines.push(markerOf(signatureOf(report)))
  return lines.join("\n")
}

/**
 * O comentário de RESOLUÇÃO — o que a issue passa a contar quando é fechada.
 *
 * Tem de carregar a PROVA (o estado comparado agora), não só "resolvido": quem
 * chegar depois lê o desfecho sem reconstruir o estado do mundo na data do
 * fechamento. E diz o ESCOPO do fechamento (o que este script NÃO olha), porque
 * um "resolvido" sem escopo mente por omissão.
 *
 * @param {object} report  relatório do `apply-required-checks --check --json`
 * @returns {string}
 */
export function driftResolutionComment(report) {
  const lines = []
  lines.push(
    "✅ **Resolvido** — o branch protection voltou a corresponder a `ci/required-checks.json`.",
  )
  lines.push("")
  lines.push("### O que foi comparado agora (a prova)")
  lines.push("")
  const forges = Object.entries(report?.forges ?? {})
  for (const [forge, data] of forges) {
    lines.push(`- **${forge}** (\`${data.workflow ?? "-"}\`)`)
    for (const branch of data.branches ?? []) {
      lines.push(
        branch.inSync
          ? `  - \`${branch.branch}\`: em sincronia (exige exatamente os checks do manifesto)`
          : `  - \`${branch.branch}\`: ainda diverge`,
      )
    }
  }
  if (forges.length === 0) {
    lines.push("- nenhuma forja foi comparada neste relatório")
  }
  lines.push("")
  lines.push("```bash")
  lines.push("bun run ci:required-checks -- --check   # exit 0 = em sincronia")
  lines.push("```")
  lines.push("")
  lines.push(
    "> Fechada automaticamente: se o drift voltar, a mesma regra abre uma issue nova" +
      " com a assinatura do momento (o dedup é entre as ABERTAS).",
  )
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Publicação (agnóstica de backend — o ciclo é o mesmo nas duas forjas)
// ---------------------------------------------------------------------------

/**
 * Publica o drift no backend dado, com dedup por assinatura.
 *
 * @param {object} params
 * @param {object} params.report           relatório do `apply-required-checks --check --json`
 * @param {object} params.backend          backend de `issue-publish.mjs`
 *                                         (GitHub via `gh` ou API do Gitea) — em
 *                                         dry-run basta `{ name }`, que nada é tocado
 * @param {boolean} [params.dryRun]        imprime o corpo e NÃO toca o backend
 * @param {(msg: string) => void} [params.log]
 * @returns {Promise<{status: string, number?: number, ref?: string}>}
 */
export async function publishDriftIssue({ report, backend, dryRun = false, log = console.log }) {
  const signature = signatureOf(report)
  if (signature === "") {
    log("✅ Sem drift: o branch protection corresponde ao manifesto.")
    // O outro lado da dívida: sem drift, o que este publicador abriu já não
    // existe. `--dry-run` continua sem tocar no backend (o contrato do modo é
    // não ter efeito nenhum) — ele DIZ o que faria.
    if (dryRun) {
      log(
        `   (dry-run: nenhuma chamada ao backend '${backend.name}' — a reconciliação fecharia as issues abertas por este publicador, com a prova no comentário)`,
      )
      return { status: "in-sync" }
    }
    const { closed } = await reconcileDebt({
      backend,
      // Só o que é NOSSO: uma issue que ganhou o label por engano não pode ser
      // fechada por automatismo.
      isOurs: (issue) => issueHasAnyMarker(issue, DRIFT_MARKER_ID),
      resolutionBody: driftResolutionComment(report),
      reason: "o branch protection voltou a corresponder ao manifesto",
      log,
    })
    if (closed.length > 0) {
      log(
        `🔒 Reconciliado: ${closed.length} issue(s) de drift fechada(s) — a dívida não fica aberta depois de resolvida.`,
      )
    }
    return { status: "in-sync", closed }
  }

  log("⚠️  Drift detectado — publicando issue acionável.")
  if (dryRun) {
    log(driftBody(report))
    log(`\n(dry-run: nenhuma chamada ao backend '${backend.name}')`)
    return { status: "dry-run" }
  }

  await backend.ensureLabel()

  const title = driftTitle()
  const body = driftBody(report)
  const decision = decidePublication({
    existing: await backend.openIssues(),
    title,
    signature,
    markerId: DRIFT_MARKER_ID,
  })

  if (decision.action === "already-reported") {
    log(`ℹ️  Drift idêntico já reportado na issue #${decision.issue.number} — sem ruído.`)
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    report: null,
    forge: "all",
    backend: "github",
    repo: null,
    dryRun: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--report") options.report = argv[++i]
    else if (arg === "--forge") options.forge = argv[++i]
    else if (arg === "--backend") options.backend = argv[++i]
    else if (arg === "--repo") options.repo = argv[++i]
    else if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--help" || arg === "-h") options.help = true
    else throw new Error(`Argumento desconhecido: ${arg}`)
  }
  if (!["github", "gitea"].includes(options.backend)) {
    throw new Error(`--backend deve ser github|gitea (recebido: ${options.backend})`)
  }
  return options
}

function loadReport(options) {
  if (options.report) {
    if (!existsSync(options.report))
      throw new Error(`--report: arquivo não existe: ${options.report}`)
    return JSON.parse(readFileSync(options.report, "utf8"))
  }

  const res = spawnSync(
    process.execPath,
    [APPLIER_PATH, "--check", "--json", "--forge", options.forge],
    { encoding: "utf8", env: process.env },
  )
  // Exit 1 é ESPERADO quando há drift — o JSON vem no stdout de qualquer forma.
  const stdout = (res.stdout ?? "").trim()
  if (!stdout) {
    throw new Error(
      `\`apply-required-checks.mjs --check --json\` não produziu relatório` +
        ` (exit ${res.status}): ${(res.stderr ?? "").slice(0, 400)}`,
    )
  }
  return JSON.parse(stdout)
}

/**
 * Backend do DRIFT selecionado pelo `--backend`.
 *
 * A seleção e os dois backends são de `issue-publish.mjs` (mecânica
 * compartilhada entre os publicadores); aqui só entra o que é DESTE publicador:
 * o label, a cor e a descrição da issue de drift.
 *
 * @param {{backend: string, repo?: string|null}} options
 * @param {Record<string, string|undefined>} env
 */
export function backendFor(options, env = process.env) {
  return selectIssueBackend(options, env, {
    label: ISSUE_LABEL,
    color: ISSUE_LABEL_COLOR,
    description: ISSUE_LABEL_DESCRIPTION,
  })
}

const USAGE =
  "Uso: node scripts/required-checks-drift-issue.mjs [--report FILE] " +
  "[--forge all|github|gitea] [--backend github|gitea] [--repo owner/name] [--dry-run]"

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  const report = loadReport(options)
  // Em dry-run nenhum backend é tocado: a seleção vira só um rótulo, para o
  // corpo poder ser conferido localmente SEM credencial nenhuma (exigir o token
  // para não escrever inverteria o propósito do dry-run).
  await publishDriftIssue({
    report,
    backend: options.dryRun ? { name: options.backend } : backendFor(options),
    dryRun: options.dryRun,
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
