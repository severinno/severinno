#!/usr/bin/env node

// =============================================================================
// blob-crlf-scope-issue.mjs
//
// Transforma o ALCANCE do CRLF no histórico (o que o job semanal
// `blob-crlf-all-text-alert` do `benchmark-weekly.yml` mapeia com
// `audit-blob-crlf-history.sh --all-text`) em uma ISSUE ACIONÁVEL.
//
// POR QUE ISSO PRECISA EXISTIR (o defeito real): aquele job FALHAVA com
// `::error::Alcance do CRLF cresceu — revise all-text-report.txt` — e um cron
// vermelho é alerta MUDO (ninguém abre o log de um run que já falhou). O
// repositório já trata isso como defeito em cinco publicadores
// (`actrc-sync-issue`, `readme-reverse-issue`, `required-checks-drift-issue`,
// `forge-doctor-issue`, `mutation-trend-issue`); aqui a dívida é a MESMA classe
// e ganha o MESMO canal: a issue é o alerta, o vermelho passa a ser a lembrança.
//
// POR QUE O DRIFT É INVISÍVEL SEM ESTE SCRIPT: o gate de CI é `.sh`/`.bash`
// (`check-blob-crlf`/`blob-crlf-history-audit`) — CRLF quebra bash em containers
// Linux. Em QUALQUER OUTRO tipo (`text eol=lf` do `.gitattributes`: `.md`,
// `.ts`, `.yml`, `Makefile`, ...) CRLF não quebra toolchain nenhuma: prettier e
// lint-staged normalizam os commits NOVOS, então o working tree fica limpo e
// nenhum gate vermelho. O que resta são os BLOBS HISTÓRICOS — commitados antes
// do `.gitattributes` — que reproduzem CRLF em TODO checkout daquele commit,
// para sempre. O `--all-text` é quem os mapeia; sem um ticket, o mapa fica só
// no log de um job que ninguém lê.
//
// FONTE ÚNICA DAS REGRAS: o diagnóstico NÃO é reimplementado aqui — o script
// roda o MESMO audit (`audit-blob-crlf-history.sh --all-text`) que o job roda.
// Só os achados (`<hash>  <path>`) e o resumo do produtor são lidos, com o
// MESMO sentinel documentado no `check-sentinel-producer`. Assim a issue não
// pode discordar do relatório do job.
//
// E O OUTRO LADO DA DÍVIDA: publicar sem FECHAR deixa a issue ABERTA depois de
// resolvida — uma dívida que mente no board (o próximo incidente é investigado
// duas vezes). Quando o audit volta a reportar 0 CRLF no escopo `--all-text`,
// este script RECONCILIA: comenta a prova (o estado limpo medido agora) e fecha
// as issues que ELE abriu. Só o que é NOSSO (marcador, nunca só o label). Se o
// alcance voltar a crescer, a mesma regra abre uma issue nova (o dedup é entre
// as ABERTAS).
//
// O QUE "ALCANCE CRESCEU" SIGNIFICA AQUI: qualquer blob histórico com CRLF em
// qualquer tipo `text eol=lf` do `.gitattributes` (a lista é DERIVADA do
// arquivo pelo audit, não hardcoded). A assinatura da dívida é o conjunto
// ORDENADO dos paths ofensores: duas runs com os mesmos achados produzem a
// MESMA assinatura (o cron não vira ruído); um achado NOVO muda a assinatura e
// COMENTA na issue aberta (a dívida mudou).
//
// NÃO MEDIDO ≠ RESOLVIDO: se o audit sai != 0 (ex.: stream do `cat-file`
// truncado), o script NÃO publica e NÃO fecha nada — uma medição quebrada não é
// evidência de "limpo". O job já falha nesse caso pelo step de alerta; aqui a
// guarda é para o fechamento automático não mentir.
//
// Usage:
//   node scripts/blob-crlf-scope-issue.mjs                    # roda o audit + cicla
//   node scripts/blob-crlf-scope-issue.mjs --dry-run          # só imprime (sem gh)
//   node scripts/blob-crlf-scope-issue.mjs --report all-text-report.txt --audit-exit 0
//   node scripts/blob-crlf-scope-issue.mjs --backend gitea
//
// Exit codes:
//   0 — sem achados (e a dívida aberta foi fechada), ou issue criada/comentada,
//       ou já reportada (ou dry-run), ou medição ausente (não medido ≠ resolvido:
//       o job de alerta é quem fica vermelho)
//   1 — erro real (audit ausente, backend/gh indisponível, issue não criada, ou
//       uma dívida resolvida que não pôde ser fechada — continua mentindo)
//
// Dependências: `bash` + git (o audit) e `gh` (ou a API do Gitea) com token de
// escrita em issues. Requer o histórico COMPLETO (fetch-depth: 0).
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

import {
  bodyHasMarker,
  defineDebtPublisher,
  makeGithubBackend,
  publisherBody,
  publisherHasSignature,
  publisherMarker,
  publisherMarkerPrefix,
  publisherOwns,
  reconcilePublisherDebt,
  runDebtPublisher,
  selectIssueBackend,
} from "./issue-publish.mjs"

/** O produtor do relatório (o MESMO que o job roda). Caminho relativo à raiz. */
export const AUDIT_SCRIPT = "scripts/audit-blob-crlf-history.sh"

/** O sentinel do produtor no caminho de ACHADOS (fonte única com o job/guard). */
export const FOUND_SENTINEL = "com CRLF"

/** O sentinel do produtor no caminho LIMPO. */
export const CLEAN_SENTINEL = "sem CRLF"

/** Label de triagem (dedup + filtro no board). */
export const ISSUE_LABEL = "crlf-scope-drift"
export const ISSUE_LABEL_COLOR = "D93F0B"
export const ISSUE_LABEL_DESCRIPTION =
  "Alcance do CRLF no histórico cresceu (blobs em tipos text eol=lf além do gate .sh/.bash)"

/** O identificador do marcador (dedup POR publicador). */
export const SCOPE_MARKER_ID = "blob-crlf-scope-drift"

/**
 * Roda o audit `--all-text` e devolve `{ status, stdout, stderr }`.
 *
 * `bash` é o MESMO interpretador que o workflow usa (`bash scripts/...`), e o
 * wrapper resolve o produtor real (python3 → python → node). O env é herdado —
 * é assim que o `CHECK_CRLF_ROOT` dos testes/fixtures chega ao audit.
 *
 * @param {{cwd?: string, env?: Record<string, string|undefined>}} [args]
 * @returns {{status: number, stdout: string, stderr: string}}
 */
export function spawnAudit({ cwd = process.cwd(), env = process.env } = {}) {
  const script = join(cwd, AUDIT_SCRIPT)
  if (!existsSync(script)) {
    return { status: 2, stdout: "", stderr: `audit ausente: ${AUDIT_SCRIPT}` }
  }
  const res = spawnSync("bash", [script, "--all-text"], {
    cwd,
    encoding: "utf8",
    env,
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    // `status` nulo (sinal/ENOENT) NÃO é 0 — fail-closed: medição ausente nunca
    // pode se passar por limpa.
    status: typeof res.status === "number" ? res.status : 2,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  }
}

/**
 * Parseia o stdout do audit. As linhas de achado são `<hash12>  <path>` (dois
 * espaços: o separador do produtor); o resto é resumo/prosa.
 *
 * NÃO confia no sentinel para decidir "tem achado": conta as LINHAS de achado.
 * O sentinel é do produtor (o job o usa), e derivar o achado daqui é o que
 * permite publicar o CONJUNTO exato de paths em vez de um booleano.
 *
 * @param {string} text
 * @returns {{findings: {blob: string, path: string}[], scanned: number|null, foundCount: number|null}}
 */
export function parseAuditOutput(text) {
  const findings = []
  let scanned = null
  let foundCount = null
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    if (raw.trim() === "") continue
    const offender = raw.match(/^([0-9a-f]{7,40})\s{2}(.+)$/)
    if (offender) {
      findings.push({ blob: offender[1], path: offender[2].trim() })
      continue
    }
    const found = raw.match(/^(\d+)\s+bloco\(s\)\s+com CRLF/)
    if (found) {
      foundCount = Number(found[1])
      continue
    }
    const clean = raw.match(/^OK\s+—\s+(\d+)\s+blobs/)
    if (clean) scanned = Number(clean[1])
  }
  return { findings, scanned, foundCount }
}

/**
 * O TIPO de um caminho — a extensão (`.md`, `.ts`) ou o basename quando não há
 * extensão (`Makefile`, `.husky/*`). É a unidade do "alcance": o mapa do job
 * fala em TIPOS do `.gitattributes`.
 *
 * @param {string} path
 * @returns {string}
 */
export function typeOf(path) {
  const base = String(path).split("/").pop() ?? String(path)
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(dot) : base
}

/**
 * O ALCANCE derivado dos achados: paths únicos, tipos afetados e o total de
 * blobs ofensores. Os três são ordenados — a assinatura (abaixo) depende disso
 * para ser estável entre runs.
 *
 * @param {{blob?: string, path: string}[]} findings
 * @returns {{paths: string[], types: string[], count: number}}
 */
export function scopeOf(findings) {
  const list = Array.isArray(findings) ? findings : []
  const paths = [...new Set(list.map((f) => f.path))].sort()
  const types = [...new Set(paths.map(typeOf))].sort()
  return { paths, types, count: list.length }
}

/**
 * O diagnóstico inteiro num objeto.
 *
 * `measured` é a guarda do fechamento: só um audit que terminou (exit 0) é
 * evidência de estado. `measuredExit` guarda o código cru para o relatório.
 *
 * @typedef {object} CrlfScopeReport
 * @property {boolean} measured          o audit terminou (exit 0)?
 * @property {number} measuredExit       o código de saída do audit
 * @property {{blob: string, path: string}[]} findings
 * @property {{paths: string[], types: string[], count: number}} scope
 * @property {number|null} scanned        blobs varridos (só no caminho limpo)
 * @property {string} stderr
 */

/**
 * Monta o diagnóstico rodando o audit (ou lendo um relatório salvo).
 *
 * `runAudit` é injetável para os testes exercitarem cada desfecho (limpo/achado/
 * quebrado) sem tocar o histórico do repo. `reportText` (opcional) evita o
 * spawn: é o stdout CRU do audit já teed pelo job/um teste.
 *
 * @param {{cwd?: string, env?: Record<string, string|undefined>, runAudit?: Function, reportText?: string|null, reportExit?: number}} [args]
 * @returns {CrlfScopeReport}
 */
export function collectReport({
  cwd = process.cwd(),
  env = process.env,
  runAudit = spawnAudit,
  reportText = null,
  reportExit = 0,
} = {}) {
  const res =
    reportText === null
      ? runAudit({ cwd, env })
      : { status: reportExit, stdout: reportText, stderr: "" }
  // `status` nulo (sinal/ENOENT) NÃO é 0 — fail-closed em QUALQUER `runAudit`
  // injetado, e não só no `spawnAudit` (a guarda não pode depender do caminho).
  const status = typeof res.status === "number" ? res.status : 2
  const parsed = parseAuditOutput(res.stdout)
  return {
    measured: status === 0,
    measuredExit: status,
    findings: parsed.findings,
    scope: scopeOf(parsed.findings),
    scanned: parsed.scanned,
    stderr: res.stderr ?? "",
  }
}

/**
 * Assinatura ESTÁVEL do alcance: os paths ofensores, ordenados e únicos. Duas
 * runs com os MESMOS achados → mesma assinatura (dedup); um achado novo → outra
 * (a dívida mudou, comentar é o correto).
 *
 * @param {CrlfScopeReport} report
 * @returns {string}
 */
export function signatureOf(report) {
  return (report?.scope?.paths ?? []).join("\n")
}

/** Título ESTÁVEL entre runs — não inclui os paths nem a contagem (vão no corpo). */
export function driftTitle() {
  return (
    "Alcance do CRLF no histórico cresceu (blobs em tipos `text eol=lf`" +
    " além do gate `.sh`/`.bash`)"
  )
}

/**
 * A PROSA do corpo da issue — sem o marcador (quem o compõe é o contrato).
 *
 * @param {CrlfScopeReport} report
 * @returns {string}
 */
export function scopeProse(report) {
  const scope = report?.scope ?? scopeOf([])
  const lines = []
  lines.push(
    `O audit \`--all-text\` encontrou **${scope.count} blob(s) histórico(s) com CRLF**` +
      ` em **${scope.types.length} tipo(s)** fora do gate \`.sh\`/\`.bash\`` +
      (report?.scanned !== null && report?.scanned !== undefined
        ? ` (${report.scanned} blobs varridos)`
        : "") +
      ".",
  )
  lines.push("")
  lines.push(
    "O gate de CI cobre só `.sh`/`.bash` (CRLF quebra bash em containers Linux)." +
      " Nos demais tipos do `.gitattributes` (`text eol=lf`) CRLF **não quebra" +
      " toolchain nenhuma** — prettier e lint-staged normalizam os commits NOVOS," +
      " então o working tree fica limpo e nenhum gate acende. O que resta são os" +
      " **blobs históricos** deste relatório: eles reproduzem CRLF em TODO checkout" +
      " daquele commit, para sempre. O sintoma aparece longe da causa.",
  )
  lines.push("")
  lines.push("### O que aparece no histórico")
  lines.push("")
  for (const finding of report?.findings ?? []) {
    lines.push(`- \`${finding.path}\` (\`${finding.blob}\`)`)
  }
  lines.push("")
  lines.push("### Tipos afetados (o alcance)")
  lines.push("")
  for (const type of scope.types) lines.push(`- \`${type}\``)
  lines.push("")
  lines.push("### O que fazer")
  lines.push("")
  lines.push(
    "A correção retroativa é **reescrita de história** com `git filter-repo`" +
      " (deliberada e irreversível — reescreve hashes, exige force-push e" +
      " coordenação de clones). O procedimento está em" +
      " **README → Auditoria histórica de blobs CRLF**; use o `--blob-callback`" +
      " cobrindo os tipos deste relatório (o gate `.sh`/`.bash` já garante o" +
      " subconjunto dele).",
  )
  lines.push("")
  lines.push(
    "> Antes de reescrever, confirme que o achado é real e não deliberado:" +
      " rode `bun run audit:blob-crlf-history:all-text` e inspecione os blobs" +
      " listados. Se a decisão for **não** corrigir, registre o motivo na issue" +
      " e feche-a manualmente (o fechamento automático só acontece quando o" +
      " audit volta a reportar 0 CRLF no escopo `--all-text`).",
  )
  lines.push("")
  return lines.join("\n")
}

/**
 * O comentário de RESOLUÇÃO — a PROVA de que o alcance voltou ao limpo, com o
 * comando que reproduz o estado. Entra numa issue ainda aberta (antes do
 * fechamento), para o pior caso ser dívida aberta COM a prova anexada.
 *
 * @param {CrlfScopeReport} report
 * @returns {string}
 */
export function resolutionComment(report) {
  const lines = []
  lines.push(
    "✅ **Resolvido** — o audit `--all-text` voltou a reportar **0 blob(s) com" +
      " CRLF** no histórico em todos os tipos `text eol=lf` do `.gitattributes`.",
  )
  lines.push("")
  lines.push("### A prova")
  lines.push("")
  lines.push("```")
  lines.push(
    `OK — ${report?.scanned ?? "N"} blobs únicos sem CRLF no histórico (rev-list --all; escopo: ...).`,
  )
  lines.push("```")
  lines.push("")
  lines.push("```bash")
  lines.push("bun run audit:blob-crlf-history:all-text   # exit 0 = alcance limpo")
  lines.push("```")
  lines.push("")
  lines.push(
    "> Fechada automaticamente: se um blob CRLF voltar a entrar no histórico" +
      " (ex.: antes de um tipo novo ser declarado no `.gitattributes`), a mesma" +
      " regra abre uma issue nova com a assinatura do momento (o dedup é entre" +
      " as ABERTAS).",
  )
  return lines.join("\n")
}

/**
 * O CONTRATO deste publicador (`issue-publish.mjs`).
 *
 * O CICLO (label idempotente, dedup por assinatura no corpo E nos comentários,
 * comentar no título já aberto, criar, e RECONCILIAR quando o alcance voltou ao
 * limpo — comentando a prova e fechando só o que é NOSSO) mora no contrato, um
 * só para todos os publicadores. O que fica DECLARADO aqui: a etiqueta, o
 * FORMATO do marcador (`b64`: a assinatura são paths, com quebra de linha), o
 * título estável, a assinatura (o conjunto de paths), a prosa, quando há dívida,
 * o ESCOPO (uma issue para o alcance — é UM estado do histórico, não um item por
 * blob) e o FECHAMENTO (a prova + o motivo).
 *
 * `resolution.when` é a guarda `não medido ≠ resolvido`: sem um audit que
 * terminou (exit 0), NADA é fechado — uma medição quebrada não prova limpeza.
 */
export const CRLF_SCOPE_PUBLISHER = defineDebtPublisher({
  name: SCOPE_MARKER_ID,
  label: ISSUE_LABEL,
  labelColor: ISSUE_LABEL_COLOR,
  labelDescription: ISSUE_LABEL_DESCRIPTION,
  marker: { id: SCOPE_MARKER_ID, format: "b64" },
  title: () => driftTitle(),
  signature: (report) => signatureOf(report),
  body: (report) => scopeProse(report),
  actionable: (report) => report?.measured === true && (report?.scope?.paths ?? []).length > 0,
  scope: { kind: "single" },
  resolution: {
    when: (report) => report?.measured === true,
    comment: (report) => resolutionComment(report),
    reason: "o audit --all-text voltou a reportar 0 CRLF no histórico (alcance limpo)",
  },
  prose: {
    actionable: (report) =>
      `⚠️  Alcance do CRLF cresceu (${report?.scope?.count ?? 0} blob(s) em ` +
      `${report?.scope?.types?.length ?? 0} tipo(s)) — publicando issue acionável.`,
    inSync: (report) =>
      report?.measured === true
        ? "✅ Sem achados: nenhum blob histórico com CRLF nos tipos `text eol=lf` do `.gitattributes`."
        : "· Alcance do CRLF: a medição não terminou (ver abaixo) — sem veredito.",
    alreadyReported: (issue) =>
      `ℹ️  Alcance idêntico já reportado na issue #${issue.number} — sem ruído.`,
    commented: (issue) => `✅ Comentário adicionado à issue #${issue.number} (alcance novo).`,
    reconciled: (count) =>
      `🔒 Reconciliado: ${count} issue(s) de alcance fechada(s) — a dívida não fica aberta depois de resolvida.`,
    unmeasured: (report) =>
      `⚠️  Medição ausente/incompleta (audit exit ${report?.measuredExit ?? "?"}) — NÃO reconciliando` +
      " (não medido ≠ resolvido); o job de alerta é quem fica vermelho.",
  },
})

/** O backend do GitHub com a etiqueta DESTE publicador (uma fonte: o contrato). */
function githubBackendFor(ghFn) {
  return makeGithubBackend({
    gh: ghFn,
    label: CRLF_SCOPE_PUBLISHER.label,
    color: CRLF_SCOPE_PUBLISHER.labelColor,
    description: CRLF_SCOPE_PUBLISHER.labelDescription,
  })
}

/** O marcador da assinatura (a regra de formato é do contrato). */
export function markerOf(signature) {
  return publisherMarker(CRLF_SCOPE_PUBLISHER, signature)
}

/** O prefixo de QUALQUER marcador nosso (a assinatura vem depois dos `:`). */
export const MARKER_PREFIX = publisherMarkerPrefix(CRLF_SCOPE_PUBLISHER)

/** `true` se `body` (um corpo de texto) carrega um marcador nosso. */
export function hasAnyMarker(body) {
  return bodyHasMarker(CRLF_SCOPE_PUBLISHER, body)
}

/** `true` se `body` carrega ESTA assinatura. */
export function hasSignature(body, signature) {
  return publisherHasSignature({ body, comments: [] }, CRLF_SCOPE_PUBLISHER, signature)
}

/** `true` se a issue já carrega ESTA assinatura (no corpo ou num comentário). */
export function issueHasSignature(issue, signature) {
  return publisherHasSignature(issue, CRLF_SCOPE_PUBLISHER, signature)
}

/** `true` se a issue foi escrita por ESTE script (marcador em qualquer corpo). */
export function issueHasAnyMarker(issue) {
  return publisherOwns(issue, CRLF_SCOPE_PUBLISHER)
}

/** O corpo COMPLETO da issue: a prosa + o marcador, como o contrato os compõe. */
export function scopeBody(report) {
  return publisherBody(CRLF_SCOPE_PUBLISHER, report)
}

/**
 * A RECONCILIAÇÃO: o alcance voltou ao limpo → comenta a prova e fecha o que é
 * nosso. O ciclo é do contrato; aqui fica o backend (injetável para os testes).
 *
 * @param {{report: object, backend?: object, gh?: Function, log?: Function}} args
 */
export function reconcileDebt({ report, backend, gh: ghFn, log = console.log } = {}) {
  return reconcilePublisherDebt({
    publisher: CRLF_SCOPE_PUBLISHER,
    input: report,
    backend: backend ?? githubBackendFor(ghFn),
    log,
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    report: null,
    auditExit: 0,
    dryRun: false,
    backend: "github",
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--report") options.report = argv[++i] ?? null
    else if (arg === "--audit-exit") {
      const value = Number(argv[++i] ?? "0")
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`--audit-exit exige um inteiro >= 0 (recebi '${argv[i]}')`)
      }
      options.auditExit = value
    } else if (arg === "--backend") {
      const value = argv[++i] ?? ""
      if (!["github", "gitea"].includes(value)) {
        throw new Error(`--backend deve ser github|gitea (recebi '${value}')`)
      }
      options.backend = value
    } else if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--help" || arg === "-h") options.help = true
    else throw new Error(`Argumento desconhecido: ${arg}`)
  }
  return options
}

/**
 * O relatório de um arquivo salvo (o stdout CRU do audit, ex.:
 * `all-text-report.txt`). `--audit-exit` declara o código do audit que gerou o
 * arquivo: um relatório de um audit QUEBRADO (exit != 0) tem de permanecer
 * "não medido" — do contrário o fechamento automático mentiria sobre a dívida.
 *
 * @param {string} reportPath
 * @param {number} auditExit
 * @returns {CrlfScopeReport}
 */
export function reportFromFile(reportPath, auditExit = 0) {
  if (!existsSync(reportPath)) {
    throw new Error(`--report aponta para um arquivo inexistente: ${reportPath}`)
  }
  return collectReport({ reportText: readFileSync(reportPath, "utf8"), reportExit: auditExit })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(
      "Uso: node scripts/blob-crlf-scope-issue.mjs [--report <arquivo>] [--audit-exit N]\n" +
        "       [--backend github|gitea] [--dry-run]\n" +
        "  Com achados: publica/comenta a issue acionável do alcance do CRLF.\n" +
        "  Sem achados: FECHA as issues que este script abriu (alcance limpo), com a prova no comentário.\n\n" +
        "  --report: lê o stdout CRU do audit (ex.: all-text-report.txt) em vez de rodar o audit.\n" +
        "  --audit-exit: o código do audit que gerou o --report (default 0 = medido).",
    )
    return 0
  }

  const report =
    options.report !== null ? reportFromFile(options.report, options.auditExit) : collectReport({})

  // `--dry-run` NÃO constrói um backend real (nenhuma chamada de rede) — o
  // contrato dele é não ter efeito nenhum.
  const backend = options.dryRun
    ? { name: options.backend }
    : selectIssueBackend(options, process.env, {
        label: ISSUE_LABEL,
        color: ISSUE_LABEL_COLOR,
        description: ISSUE_LABEL_DESCRIPTION,
      })

  await runDebtPublisher({
    publisher: CRLF_SCOPE_PUBLISHER,
    input: report,
    backend,
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
