#!/usr/bin/env node
// =============================================================================
// check-readme-reverse-baseline.mjs — Guard semanal: drift semântico de links
// =============================================================================
//
// Roda o check-readme-anchors.mjs --reverse --json (o guard de âncoras do
// README — UMA fonte de verdade para o que é link quebrado vs link
// semanticamente errado, sem duplicar regras) e compara os achados REVERSE
// com um BASELINE commitado (docs/security/readme-reverse-baseline.json).
// Falha (exit 1) SOMENTE se achados NOVOS aparecerem.
//
// Por que --reverse e não o forward: o forward (link quebrado) já é gate no
// CI (utf8-check/pr-check) e nos hooks. O --reverse pega o DRIFT SEMÂNTICO —
// um link que RESOLVE mas aponta para o heading errado (ex.: `[CRLF
// Guard](#normalizador)` com um heading 'Normalizador' existente: o forward
// passa, o reverse acusa). O pr-check NÃO roda --reverse (0 falsos positivos
// é exigência de PR); este job semanal é a rede de segurança periódica que
// alerta sobre drift semântico SEM bloquear PRs.
//
// FAIL-CLOSED no FORWARD: apesar de o forward ser gate de PR, um link
// QUEBRADO no working tree do audit NÃO é ignorado silenciosamente — um
// README com link morto é INPUT INVÁLIDO para a comparação de drift
// semântico. O guard falha com EXIT 2 (infra) e mensagem clara listando os
// links quebrados, DISTINTO do exit 1 (achados novos de drift, que criam
// issues). O job semanal distingue: exit 1 = dívida de drift → issue; exit 2
// = README quebrado → corrigir o link primeiro (nada de issue para link
// morto — o forward não é drift semântico). Vale para TODOS os modos:
//   - check e --update: ambos falham-closed (não se regenera baseline de um
//     README com link morto — a checagem roda ANTES do branch de update);
//   - --json: exit 2 SEM JSON no stdout (o runBaselineReport do
//     readme-reverse-issue.mjs lança com o stderr — se imprimíssemos um
//     report com newFindings: [] o step de issue daria falso verde).
//
// Comparação por ASSINATURA (file+slug+label), não por count: o label e o
// slug do link são a identidade estável do achado (a LINHA não participa —
// diferente do secret-leaks, onde commit+line são imutáveis na história; o
// README cresce e as linhas migram a cada edição). Findings REMOVIDOS (link
// corrigido) NÃO falham — só os novos. Fail-closed: baseline ausente sem
// --update = exit 2 com instrução clara.
//
// Usage:
//   node scripts/check-readme-reverse-baseline.mjs                # check
//   node scripts/check-readme-reverse-baseline.mjs --update       # regenera baseline
//   node scripts/check-readme-reverse-baseline.mjs --baseline X   # path custom
//   node scripts/check-readme-reverse-baseline.mjs --json         # output JSON
//
// Exit codes:
//   0 — nenhum achado NOVO (ou --update aplicado)
//   1 — achados NOVOS detectados (fail-closed)
//   2 — infra: guard de âncoras falhou / baseline ausente (sem --update) /
//       flag inválida / link QUEBRADO no README (forward — input inválido)
// =============================================================================

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/** Path do baseline default (commitado — a fonte da verdade dos achados conhecidos). */
const DEFAULT_BASELINE = "docs/security/readme-reverse-baseline.json"

/**
 * Caminho ABSOLUTO do check-readme-anchors.mjs — resolvido a partir do
 * próprio módulo (não do cwd!): o guard roda com cwd = repo em CI, mas os
 * testes CLI rodam num temp dir SEM scripts/ — resolver pelo cwd quebraria
 * lá (Cannot find module). O guard de âncoras recebe o cwd via spawnSync
 * abaixo e lê o README.md do caller.
 */
const ANCHORS_PATH = join(dirname(fileURLToPath(import.meta.url)), "check-readme-anchors.mjs")

/**
 * Assinatura estável de um achado reverse — identifica o link semanticamente
 * errado. file+slug+label é determinístico entre runs: o slug é o alvo do
 * link e o label é o texto ancorado — ambos estáveis no working tree. A
 * LINHA NÃO participa: o README cresce e as linhas migram a cada edição, e
 * um achado na linha 10 hoje estará na linha 40 amanhã SEM mudar de
 * natureza (mesmo link errado). Comparar por linha geraria falso "achado
 * novo" a cada edição do doc.
 *
 * @param {{file: string, slug: string, label: string}} f
 * @returns {string}
 */
export function signatureOf(f) {
  return `${f.file}:${f.slug}:${f.label}`
}

/**
 * Constrói o baseline a partir dos achados atuais (formato do arquivo).
 *
 * @param {Array<{file: string, line: number, slug: string, label: string, heading: string, suggestion?: string}>} findings
 * @returns {{count: number, updatedAt: string, findings: object[]}}
 */
export function buildBaseline(findings) {
  return {
    count: findings.length,
    updatedAt: new Date().toISOString().slice(0, 10),
    findings: findings.map((f) => ({
      file: f.file,
      line: f.line,
      slug: f.slug,
      label: f.label,
      heading: f.heading,
      suggestion: f.suggestion ?? null,
    })),
  }
}

/**
 * Lê e valida o conteúdo do arquivo de baseline.
 *
 * @param {string} content
 * @returns {{count: number, updatedAt: string, findings: object[]}}
 */
export function parseBaseline(content) {
  const j = JSON.parse(content)
  if (!Array.isArray(j.findings)) {
    throw new Error("baseline sem campo 'findings'")
  }
  return j
}

/**
 * Achados cuja assinatura NÃO existe no baseline — os NOVOS (a regra do guard).
 *
 * @param {Array<object>} current       achados do audit atual
 * @param {Array<object>} baselineFindings  achados do baseline
 * @returns {Array<object>} achados novos (ordenados como no audit)
 */
export function findNewFindings(current, baselineFindings) {
  const known = new Set(baselineFindings.map(signatureOf))
  return current.filter((f) => !known.has(signatureOf(f)))
}

function main() {
  const args = process.argv.slice(2)
  const update = args.includes("--update")
  const json = args.includes("--json")

  const baselineIdx = args.indexOf("--baseline")
  if (baselineIdx !== -1 && args[baselineIdx + 1] === undefined) {
    console.error("check-readme-reverse-baseline: --baseline requer um path")
    process.exit(2)
  }
  const baselinePath = baselineIdx !== -1 ? args[baselineIdx + 1] : DEFAULT_BASELINE

  const cwd = process.cwd()
  const baselineFile = join(cwd, baselinePath)

  // ── Roda o guard de âncoras real (--reverse --json, exit 0 sempre) ───
  // Reutiliza as regras do check-readme-anchors.mjs — UMA fonte de verdade
  // para o que é link quebrado vs semanticamente errado (sem duplicar regex
  // nem o algoritmo de slugger). O cwd é passado para o child (o guard lê
  // README.md do caller); o PATH é absoluto (ANCHORS_PATH), nunca relativo.
  const audit = spawnSync(process.execPath, [ANCHORS_PATH, "--reverse", "--json"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })

  if (audit.status !== 0 || !audit.stdout) {
    console.error(
      `❌ check-readme-reverse-baseline: check-readme-anchors falhou (exit ${audit.status ?? "?"}) — README.md ausente no cwd?`,
    )
    console.error(audit.stderr ? audit.stderr.slice(0, 800) : "")
    process.exit(2)
  }

  let current
  try {
    current = JSON.parse(audit.stdout)
  } catch {
    console.error("❌ check-readme-reverse-baseline: guard retornou JSON inválido")
    process.exit(2)
  }

  // ── FAIL-CLOSED no FORWARD: link QUEBRADO invalida o audit ───────────
  // Um README com link quebrado (forward: o slug não resolve) NÃO pode ser
  // auditado para drift semântico — o input está inválido. Falha com EXIT 2
  // (infra), DISTINTO do exit 1 (achados novos de drift): o job semanal cria
  // issues só no exit 1; no exit 2 o README precisa ser corrigido primeiro.
  // O forward já é gate de PR (utf8-check/hooks); chegar aqui significa que
  // o working tree/PR mergeado quebrou um link — alerta de infra, não
  // silêncio (antes este caso saía com '0 achado(s) reverse' — falso verde).
  const forwardFindings = (current.findings ?? []).filter((f) => f.type === "forward")
  if (forwardFindings.length > 0) {
    console.error(
      `❌ check-readme-reverse-baseline: ${forwardFindings.length} link(s) QUEBRADO(s) no README (forward) — o audit de drift semântico NÃO roda com link quebrado:`,
    )
    for (const f of forwardFindings) {
      console.error(`   • ${f.file}:${f.line}  [${f.label}](#${f.slug})`)
    }
    console.error(
      `\n   O forward (link quebrado) é gate de PR — corrija o link ANTES do audit.` +
        `\n   Exit 2 = INFRA (input inválido), DISTINTO do exit 1 (achados novos de drift).`,
    )
    process.exit(2)
  }

  // ── Filtra só os achados REVERSE — o foco do job semanal ─────────────
  // O forward (link quebrado) já é gate no CI/hooks; o baseline protege o
  // drift SEMÂNTICO que o forward não vê. Um forward quebrado no working
  // tree é bug do PR, não achado semanal — e o check-readme-anchors --json
  // inclui os dois tipos (type: 'forward' | 'reverse'), então filtramos.
  const reverseFindings = (current.findings ?? []).filter((f) => f.type === "reverse")

  // ── --update: regenera o baseline a partir do guard real ─────────────
  if (update) {
    mkdirSync(dirname(baselineFile), { recursive: true })
    const baseline = buildBaseline(reverseFindings)
    writeFileSync(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`, "utf8")
    console.log(`✅ Baseline atualizado: ${baseline.count} achado(s) → ${baselinePath}`)
    process.exit(0)
  }

  // ── Fail-closed: baseline ausente sem --update ────────────────────────
  if (!existsSync(baselineFile)) {
    console.error(`❌ Baseline ausente: ${baselinePath}`)
    console.error(`   Rode primeiro: node scripts/check-readme-reverse-baseline.mjs --update`)
    process.exit(2)
  }

  let baseline
  try {
    baseline = parseBaseline(readFileSync(baselineFile, "utf8"))
  } catch (e) {
    console.error(`❌ Baseline inválido (${baselinePath}): ${e.message}`)
    process.exit(2)
  }

  // ── Comparação por assinatura — só achados NOVOS falham ──────────────
  const newFindings = findNewFindings(reverseFindings, baseline.findings)

  if (json) {
    console.log(
      JSON.stringify(
        {
          count: reverseFindings.length,
          baselineCount: baseline.count,
          newCount: newFindings.length,
          newFindings,
        },
        null,
        2,
      ),
    )
    process.exit(newFindings.length > 0 ? 1 : 0)
  }

  if (newFindings.length === 0) {
    console.log(
      `🔗 check-readme-reverse-baseline: ${reverseFindings.length} achado(s) reverse — ` +
        `nenhum NOVO além do baseline (${baseline.count}, ${baseline.updatedAt}).`,
    )
    process.exit(0)
  }

  console.error(
    `🔗 check-readme-reverse-baseline: ${newFindings.length} achado(s) NOVO(s) de drift ` +
      `semântico no README (baseline ${baseline.count} → atual ${reverseFindings.length}):\n`,
  )
  for (const f of newFindings) {
    console.error(
      `   • ${f.file}:${f.line}  [${f.label}](#${f.slug}) → heading '${f.heading}'` +
        (f.suggestion ? ` (sugestão: '#${f.suggestion}')` : ""),
    )
  }
  console.error(
    `\n⚠️  Link aponta para o heading errado mas RESOLVE — o forward não vê isso.` +
      `\n   Corrija o slug/label no mesmo PR. Se o achado for deliberado (prosa),` +
      `\n   atualize o baseline: node scripts/check-readme-reverse-baseline.mjs --update`,
  )
  process.exit(1)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
