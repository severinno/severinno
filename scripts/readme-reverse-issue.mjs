#!/usr/bin/env node

// =============================================================================
// readme-reverse-issue.mjs
//
// Publica os achados NOVOS de drift semântico do README (o que o job semanal
// readme-reverse-audit detecta via check-readme-reverse-baseline.mjs) como
// GitHub ISSUES ACIONÁVEIS via `gh issue create` (GITHUB_TOKEN do runner) —
// transformando o "job falhou" (alerta mudo) em ticket com o link quebrado
// semanticamente + a sugestão do heading correto.
//
// UM ACHADO, UMA ISSUE: diferente dos demais publicadores (que têm UM título
// estável e comentam nas mudanças), aqui a dívida é POR LINKS — a mesma revisão
// de README costuma gerar vários achados independentes, e cada um tem o seu
// remédio. O dedup é por ASSINATURA (file+slug+label) presente no corpo.
//
// E O OUTRO LADO DA DÍVIDA (defeito corrigido): publicar sem FECHAR deixava a
// issue ABERTA depois de o link ser corrigido — uma dívida que mente no board e
// é reinvestigada. Por isso, a cada run, este script RECONCILIA: um achado que
// **deixou de ser reportado** (o link foi corrigido OU foi registrado no baseline
// como deliberado) já não é dívida, e a issue que o representa é FECHADA com a
// prova no comentário. Só o que é NOSSO (marcador, nunca só o label). Se o link
// voltar a divergir, a mesma regra abre uma issue nova (o dedup é entre as
// ABERTAS).
//
// POR QUE O MARCADOR AQUI NÃO É BASE64 (como nos outros publicadores): o
// formato `<!-- readme-drift:file:slug:label -->` (texto simples) já está no
// corpo de issues ABERTAS. Migrar para o formato codificado de
// `issue-publish.mjs` tornaria essas issues invisíveis para o dedup (abrindo
// duplicatas) e para o fechamento automático (que é o oposto do objetivo). O
// que é COMPARTILHADO aqui é o CICLO (listar, separar o que é nosso, comentar a
// prova, fechar) — o selo de cada publicador é dele.
//
// Fluxo:
//   1. spawna check-readme-reverse-baseline.mjs --json (REPORT mode: JSON no
//      stdout SEMPRE, exit 1 quando há achados novos) e parseia o report;
//   2. RECONCILIA: fecha as issues cujo achado não é mais reportado (com a
//      prova no comentário);
//   3. lista as issues abertas com o label `readme-drift` e deduplica por
//      ASSINATURA file+slug+label — a MESMA signatureOf que o baseline guard
//      usa (importada, sem drift): um achado que JÁ tem issue aberta não cria
//      duplicata a cada run semanal;
//   4. cria UMA issue por achado novo (gh issue create --label readme-drift)
//      com o link markdown, o heading atual, a sugestão e a assinatura como
//      marcador HTML (<!-- readme-drift:... -->) para o dedup de próximas runs.
//
// Usage:
//   node scripts/readme-reverse-issue.mjs             # roda baseline + cria
//   node scripts/readme-reverse-issue.mjs --dry-run   # só imprime (sem gh)
//   node scripts/readme-reverse-issue.mjs --report /tmp/report.json  # usa um
//                      report PRÉ-GERADO (teste unitário/CLI sem rede)
//
// Exit codes:
//   0 — sem achados novos OU issues criadas/puladas/reconciliadas (dry-run ok)
//   1 — erro real (baseline falhou, gh indisponível/falhou, issue não criada, e
//       uma dívida resolvida que não pôde ser fechada continua mentindo)
//
// Dependências: gh CLI (pré-instalado nos runners ubuntu) + GITHUB_TOKEN no
// env (GH_TOKEN) — o job declara permissions: issues: write.
// =============================================================================

import { spawnSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { signatureOf } from "./check-readme-reverse-baseline.mjs"
import { issueBodies, makeGithubBackend, reconcileDebt } from "./issue-publish.mjs"

/** Label usado nas issues de drift semântico (dedup + triagem no board). */
export const ISSUE_LABEL = "readme-drift"

/** Cor e descrição do label (formato da CLI do `gh`). */
export const ISSUE_LABEL_COLOR = "f9d0c4"
export const ISSUE_LABEL_DESCRIPTION =
  "Drift semântico de link no README (guard semanal readme-reverse-audit)"

/** Prefixo de QUALQUER marcador nosso (a assinatura vem depois dos `:`). */
export const MARKER_PREFIX = "<!-- readme-drift:"

/** Caminho ABSOLUTO do baseline guard — spawnado com cwd = caller. */
const BASELINE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "check-readme-reverse-baseline.mjs",
)

/**
 * Marcador HTML invisível que carrega a assinatura do achado.
 *
 * É TEXTO SIMPLES (não base64) de propósito: o formato já vive no corpo de
 * issues abertas, e trocá-lo faria o dedup abrir duplicatas das dívidas que já
 * existem. O contrato de FORMATO deste publicador é este.
 *
 * @param {string} signature  `file:slug:label`
 */
export function markerOf(signature) {
  return `${MARKER_PREFIX}${signature} -->`
}

/** `true` se `body` foi escrito por ESTE publicador (qualquer assinatura). */
export function hasAnyMarker(body) {
  return typeof body === "string" && body.includes(MARKER_PREFIX)
}

/**
 * As assinaturas que uma issue carrega (corpo + comentários).
 *
 * A extração é por análise do marcador — a assinatura é o que vem entre o
 * prefixo e o `-->`, e ela própria contém `:` (file:slug:label), então não dá
 * para cortar por `:`.
 *
 * @param {{body?: string, comments?: {body?: string}[]}|undefined} issue
 * @returns {string[]}
 */
export function signaturesOf(issue) {
  const found = []
  for (const body of issueBodies(issue)) {
    if (typeof body !== "string") continue
    const pattern = /<!-- readme-drift:(.*?) -->/g
    for (const match of body.matchAll(pattern)) found.push(match[1])
  }
  return found
}

/**
 * `true` se a dívida desta issue CADUCOU: ela é nossa (tem ≥1 assinatura) e
 * NENHUMA das assinaturas dela ainda está entre os achados reportados.
 *
 * Uma assinatura some do report quando o link é corrigido (o achado deixa de
 * existir) ou quando ele é registrado no baseline como deliberado — nos dois
 * casos a issue já não representa dívida nenhuma.
 *
 * @param {object} issue
 * @param {Set<string>} live  assinaturas dos achados reportados agora
 */
export function isExpired(issue, live) {
  const signatures = signaturesOf(issue)
  return signatures.length > 0 && signatures.every((s) => !live.has(s))
}

/**
 * O comentário de RESOLUÇÃO — a prova de que a dívida caducou, com o caminho
 * para reconferir. Entra na issue ANTES do fechamento.
 *
 * @param {string[]} signatures  as assinaturas que a issue carregava
 * @returns {string}
 */
export function resolutionComment(signatures) {
  const lines = []
  lines.push(
    "✅ **Resolvido** — este achado deixou de ser reportado pelo guard semântico do README.",
  )
  lines.push("")
  lines.push(
    "Ou o link foi **corrigido** (o achado sumiu do audit) ou foi **registrado no" +
      " baseline** como deliberado (`docs/security/readme-reverse-baseline.json`)." +
      " Nos dois casos não há mais dívida para esta issue.",
  )
  lines.push("")
  if (signatures.length > 0) {
    lines.push("### Assinatura(s) que esta issue representava")
    lines.push("")
    for (const signature of signatures) lines.push(`- \`${signature}\``)
    lines.push("")
  }
  lines.push("```bash")
  lines.push("node scripts/check-readme-reverse-baseline.mjs --json   # o achado ainda aparece?")
  lines.push("```")
  lines.push("")
  lines.push(
    "> Fechada automaticamente: se o link voltar a divergir, a mesma regra abre uma" +
      " issue nova com a assinatura do momento (o dedup é entre as ABERTAS).",
  )
  return lines.join("\n")
}

/**
 * Título da issue — estável entre runs (NÃO leva a linha: o README cresce e
 * as linhas migram; o título identifica o link errado por file+slug+label).
 * O `line` é ACEITO no param (os findings do report carregam a linha) mas
 * IGNORADO no título — o contrato "estável entre runs" é exatamente não
 * depender dela (travado em teste).
 *
 * @param {{file: string, slug: string, label: string, line?: number}} f
 * @returns {string}
 */
export function buildIssueTitle(f) {
  return `README drift semântico: [${f.label}](#${f.slug}) → heading errado (${f.file})`
}

/**
 * Body markdown da issue — link, heading atual, sugestão do heading correto
 * (quando houver) e o marcador de assinatura para o dedup de próximas runs
 * (<!-- readme-drift:file:slug:label -->) — invisível no render, greppável
 * via gh issue list --json body.
 *
 * @param {{file: string, line: number, slug: string, label: string, heading: string, suggestion?: string | null}} f
 * @returns {string}
 */
export function buildIssueBody(f) {
  const suggestion =
    f.suggestion !== null && f.suggestion !== undefined
      ? `- **Sugestão (heading mais provável):** [\`#${f.suggestion}\`](#${f.suggestion})\n`
      : ""
  return [
    `Detectado pelo guard semanal \`readme-reverse-audit\` (baseline \`docs/security/readme-reverse-baseline.json\`).`,
    "",
    `O link **[${f.label}](#${f.slug})** (\`${f.file}:${f.line}\`) RESOLVE, mas aponta para o heading semanticamente errado:`,
    "",
    `- **Heading atual:** \`${f.heading}\``,
    suggestion,
    "O forward (link quebrado) não vê isso — o link resolve mas está no lugar errado.",
    "",
    "**Correção:** atualize o slug/label do link no mesmo PR. Se o achado for deliberado (prosa),",
    "registre-o no baseline: `node scripts/check-readme-reverse-baseline.mjs --update`.",
    "",
    markerOf(signatureOf(f)),
    "",
  ]
    .filter(Boolean)
    .join("\n")
}

/**
 * Dedup por assinatura: filtra os achados novos que NÃO têm issue aberta
 * (marcador <!-- readme-drift:signature --> presente em algum corpo de issue
 * com o label). Um achado com issue aberta NÃO cria duplicata a cada run
 * semanal — a issue vira o estado da dívida até ser fechada.
 *
 * @param {Array<object>} newFindings  achados do report (com file/slug/label)
 * @param {string[]} openIssueBodies   bodies das issues abertas com o label
 * @returns {Array<object>} achados sem issue aberta (ordenados como no report)
 */
export function filterNewToCreate(newFindings, openIssueBodies) {
  return newFindings.filter((f) => {
    const marker = markerOf(signatureOf(f))
    return !openIssueBodies.some((b) => typeof b === "string" && b.includes(marker))
  })
}

/**
 * Roda o baseline guard em REPORT mode (--json) e retorna o report parseado.
 * O baseline falha (exit 1) QUANDO há achados novos — por isso o spawn é
 * SEMPRE verificado contra o JSON no stdout, não contra o exit code.
 *
 * @param {string} cwd
 * @returns {{count: number, baselineCount: number, newCount: number, newFindings: object[]}}
 */
export function runBaselineReport(cwd) {
  const res = spawnSync(process.execPath, [BASELINE_PATH, "--json"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
  if (!res.stdout) {
    throw new Error(
      `check-readme-reverse-baseline falhou sem stdout (exit ${res.status ?? "?"}): ` +
        (res.stderr ? res.stderr.slice(0, 500) : "sem stderr"),
    )
  }
  return JSON.parse(res.stdout)
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const reportIdx = args.indexOf("--report")
  const reportPath =
    reportIdx !== -1 && args[reportIdx + 1] !== undefined ? args[reportIdx + 1] : null

  // ── 1. Report: --report pré-gerado (teste) OU spawna o baseline real ──
  let report
  if (reportPath) {
    if (!existsSync(reportPath)) {
      console.error(`❌ --report ausente: ${reportPath}`)
      process.exit(1)
    }
    report = JSON.parse(readFileSync(reportPath, "utf8"))
  } else {
    try {
      report = runBaselineReport(process.cwd())
    } catch (e) {
      console.error(`❌ ${e.message}`)
      process.exit(1)
    }
  }
  const newFindings = report.newFindings ?? []
  const live = new Set(newFindings.map(signatureOf))

  // ── 2. `--dry-run`: NENHUMA chamada ao gh — só DIZ o que faria ────────
  if (dryRun) {
    if (newFindings.length === 0) {
      console.log(
        `✅ readme-reverse-issue: nenhum achado NOVO de drift semântico ` +
          `(baseline ${report.baselineCount ?? "?"} → atual ${report.count ?? "?"}) — nenhuma issue.`,
      )
    } else {
      console.log(
        `🔗 readme-reverse-issue: ${newFindings.length} achado(s) novo(s) — ${newFindings.length} para criar.`,
      )
      for (const f of newFindings) {
        console.log(`  [dry-run] criaria issue: ${buildIssueTitle(f)}`)
        console.log(
          `            body: ${f.file}:${f.line} [${f.label}](#${f.slug}) → '${f.heading}'${f.suggestion ? ` (sugestão '#${f.suggestion}')` : ""}`,
        )
      }
    }
    console.log(
      "  (dry-run — nenhuma chamada gh feita; a reconciliação fecharia as issues cujo achado não é mais reportado)",
    )
    process.exit(0)
  }

  const backend = makeGithubBackend({
    label: ISSUE_LABEL,
    color: ISSUE_LABEL_COLOR,
    description: ISSUE_LABEL_DESCRIPTION,
  })

  // ── 3. Reconciliação: o achado que sumiu do report não é mais dívida ──
  let closed = []
  try {
    await backend.ensureLabel()
    const existing = await backend.openIssues()
    const reconciled = await reconcileDebt({
      backend,
      existing,
      isOurs: (issue) => issueBodies(issue).some(hasAnyMarker),
      isExpired: (issue) => isExpired(issue, live),
      resolutionBody: (issue) => resolutionComment(signaturesOf(issue)),
      reason: "o achado não é mais reportado (corrigido ou registrado no baseline)",
    })
    closed = reconciled.closed

    // ── 4. Dedup por assinatura contra as issues abertas + criação ──────
    const openBodies = existing.flatMap(issueBodies).filter((b) => typeof b === "string")
    const toCreate = filterNewToCreate(newFindings, openBodies)
    if (closed.length > 0) {
      console.log(
        `🔒 Reconciliado: ${closed.length} issue(s) fechada(s) — a dívida não fica aberta depois de resolvida.`,
      )
    }

    if (newFindings.length === 0) {
      console.log(
        `✅ readme-reverse-issue: nenhum achado NOVO de drift semântico ` +
          `(baseline ${report.baselineCount ?? "?"} → atual ${report.count ?? "?"}) — nenhuma issue.`,
      )
      process.exit(0)
    }

    const skipped = newFindings.length - toCreate.length
    console.log(
      `🔗 readme-reverse-issue: ${newFindings.length} achado(s) novo(s) — ${toCreate.length} para criar${skipped > 0 ? `, ${skipped} já com issue aberta` : ""}.`,
    )

    for (const f of toCreate) {
      const title = buildIssueTitle(f)
      const body = buildIssueBody(f)
      const ref = await backend.create(title, body)
      console.log(`  ✅ issue criada: ${title} → ${ref}`)
    }
    console.log(`✅ ${toCreate.length} issue(s) criada(s) com o label ${ISSUE_LABEL}.`)
  } catch (e) {
    console.error(`❌ ${e.message}`)
    process.exit(1)
  }
  process.exit(0)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) {
  // `main` decide o exit code (process.exit nos caminhos), então aqui só resta
  // o erro que escapou do try interno.
  try {
    await main()
  } catch (error) {
    console.error(`❌ ${error.message}`)
    process.exit(1)
  }
}
