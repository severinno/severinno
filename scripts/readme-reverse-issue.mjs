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
// Fluxo:
//   1. spawna check-readme-reverse-baseline.mjs --json (REPORT mode: JSON no
//      stdout SEMPRE, exit 1 quando há achados novos) e parseia o report;
//   2. lista issues abertas com o label `readme-drift` (gh issue list) e
//      deduplica por ASSINATURA file+slug+label — a MESMA signatureOf que o
//      baseline guard usa (importada, sem drift): um achado que JÁ tem issue
//      aberta não cria duplicata a cada run semanal;
//   3. cria UMA issue por achado novo (gh issue create --label readme-drift)
//      com o link markdown, o heading atual, a sugestão e a assinatura como
//      marcador HTML (<!-- readme-drift:... -->) para o dedup de próximas
//      runs.
//
// Usage:
//   node scripts/readme-reverse-issue.mjs             # roda baseline + cria
//   node scripts/readme-reverse-issue.mjs --dry-run   # só imprime (sem gh)
//   node scripts/readme-reverse-issue.mjs --report /tmp/report.json  # usa um
//                      report PRÉ-GERADO (teste unitário/CLI sem rede)
//
// Exit codes:
//   0 — sem achados novos OU issues criadas/puladas (dry-run ok)
//   1 — erro real (baseline falhou, gh indisponível/falhou, issue não criada)
//
// Dependências: gh CLI (pré-instalado nos runners ubuntu) + GITHUB_TOKEN no
// env (GH_TOKEN) — o job declara permissions: issues: write.
// =============================================================================

import { spawnSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { signatureOf } from "./check-readme-reverse-baseline.mjs"

/** Label usado nas issues de drift semântico (dedup + triagem no board). */
export const ISSUE_LABEL = "readme-drift"

/** Caminho ABSOLUTO do baseline guard — spawnado com cwd = caller. */
const BASELINE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "check-readme-reverse-baseline.mjs",
)

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
    `<!-- readme-drift:${signatureOf(f)} -->`,
    "",
  ]
    .filter(Boolean)
    .join("\n")
}

/**
 * Dedup por assinatura: filtra os achados novos que NÃO têm issue aberta
 * (marcador <!-- readme-drift:signature --> presente no body de alguma issue
 * com o label). Um achado com issue aberta NÃO cria duplicata a cada run
 * semanal — a issue vira o estado da dívida até ser fechada.
 *
 * @param {Array<object>} newFindings  achados do report (com file/slug/label)
 * @param {string[]} openIssueBodies   bodies das issues abertas com o label
 * @returns {Array<object>} achados sem issue aberta (ordenados como no report)
 */
export function filterNewToCreate(newFindings, openIssueBodies) {
  return newFindings.filter((f) => {
    const marker = `readme-drift:${signatureOf(f)}`
    return !openIssueBodies.some((b) => b.includes(marker))
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

/**
 * Lista os bodies das issues abertas com o label de drift (gh issue list).
 * Falha-closed: gh indisponível/falha → throw (o CI não pode criar issues
 * duplicadas às cegas — melhor falhar e o GATE do job já sinalizou).
 *
 * @returns {string[]}
 */
export function listOpenDriftIssueBodies() {
  const res = spawnSync(
    "gh",
    [
      "issue",
      "list",
      "--state",
      "open",
      "--label",
      ISSUE_LABEL,
      "--json",
      "body",
      "--jq",
      ".[].body",
    ],
    {
      encoding: "utf8",
    },
  )
  if (res.error) {
    throw new Error(`gh indisponível: ${res.error.message} (GITHUB_TOKEN no env?)`)
  }
  if (res.status !== 0) {
    throw new Error(
      `gh issue list falhou (exit ${res.status}): ${(res.stderr ?? "").slice(0, 500)}`,
    )
  }
  return (res.stdout ?? "").split("\n").filter((l) => l.length > 0)
}

/**
 * Garante que o label readme-drift existe (gh label create --force — idempotente:
 * atualiza se já existir, não falha se existir). Ignora erro de "já existe"
 * via --force; outros erros de rede/perm falham-closed.
 */
export function ensureDriftLabel() {
  const res = spawnSync(
    "gh",
    [
      "label",
      "create",
      ISSUE_LABEL,
      "--color",
      "f9d0c4",
      "--description",
      "Drift semântico de link no README (guard semanal readme-reverse-audit)",
      "--force",
    ],
    { encoding: "utf8" },
  )
  if (res.status !== 0 && !res.error) {
    // --force já cobre 'já existe'; qualquer outro status é real (sem rede/
    // sem permissão de issues) — falha-closed para o criador da issue ver.
    throw new Error(
      `gh label create falhou (exit ${res.status}): ${(res.stderr ?? "").slice(0, 500)}`,
    )
  }
}

/**
 * Cria a issue via gh issue create (args array — sem shell, sem risco de
 * quoting no título/body).
 *
 * @param {{file: string, slug: string, label: string}} f  usado no título
 * @param {string} body
 */
export function createIssue(title, body) {
  const res = spawnSync(
    "gh",
    ["issue", "create", "--title", title, "--body", body, "--label", ISSUE_LABEL],
    { encoding: "utf8" },
  )
  if (res.error || res.status !== 0) {
    throw new Error(
      `gh issue create falhou (exit ${res.status ?? "?"}): ` +
        (res.error ? res.error.message : (res.stderr ?? "").slice(0, 500)),
    )
  }
  return (res.stdout ?? "").trim()
}

function main() {
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

  if (newFindings.length === 0) {
    console.log(
      `✅ readme-reverse-issue: nenhum achado NOVO de drift semântico ` +
        `(baseline ${report.baselineCount ?? "?"} → atual ${report.count ?? "?"}) — nenhuma issue.`,
    )
    process.exit(0)
  }

  // ── 2. Dedup por assinatura contra issues abertas (só quando vai criar) ──
  let toCreate
  if (dryRun) {
    toCreate = newFindings
  } else {
    try {
      ensureDriftLabel()
      toCreate = filterNewToCreate(newFindings, listOpenDriftIssueBodies())
    } catch (e) {
      console.error(`❌ ${e.message}`)
      process.exit(1)
    }
  }
  const skipped = newFindings.length - toCreate.length

  console.log(
    `🔗 readme-reverse-issue: ${newFindings.length} achado(s) novo(s) — ${toCreate.length} para criar${skipped > 0 ? `, ${skipped} já com issue aberta` : ""}.`,
  )

  // ── 3. Cria as issues ────────────────────────────────────────────────
  for (const f of toCreate) {
    const title = buildIssueTitle(f)
    const body = buildIssueBody(f)
    if (dryRun) {
      console.log(`  [dry-run] criaria issue: ${title}`)
      console.log(
        `            body: ${f.file}:${f.line} [${f.label}](#${f.slug}) → '${f.heading}'${f.suggestion ? ` (sugestão '#${f.suggestion}')` : ""}`,
      )
      continue
    }
    try {
      const url = createIssue(title, body)
      console.log(`  ✅ issue criada: ${title} → ${url}`)
    } catch (e) {
      console.error(`  ❌ ${e.message}`)
      process.exit(1)
    }
  }
  console.log(
    dryRun
      ? "  (dry-run — nenhuma chamada gh feita)"
      : `✅ ${toCreate.length} issue(s) criada(s) com o label ${ISSUE_LABEL}.`,
  )
  process.exit(0)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
