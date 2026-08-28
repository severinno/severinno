#!/usr/bin/env node

// =============================================================================
// check-e2e-counts.mjs
//
// CI guard (fast gate, <2s) que valida que os counts de checks DOCUMENTADOS
// nos comentários dos workflows e no script de validação local batem com a
// FONTE DA VERDADE: a DERIVAÇÃO scripts/seed-e2e-count.ts (que calcula o
// total de checks de cada E2E a partir do CÓDIGO — sites de asserção +
// loops dirigidos por dados + helpers compartilhados).
//
//   scripts/seed-e2e-count.ts  →  {"prod": 128, "dev": 162}  (bun --json)
//
// Por que derivação em vez de literal: antes o guard lia `EXPECTED_TOTAL =
// 115` via regex no source do E2E. Agora os E2Es calculam o próprio total
// com deriveExpectedChecks(...) — NENHUM literal existe no código. Se uma
// asserção for adicionada/removida, o count ajusta sozinho em todos os
// lugares (E2E, guard, workflows) sem edição manual.
//
// Cadeia de validação (2 elos):
//   1. Comentários dos workflows → derivação (bun --json)
//      ESTE GUARD compara estaticamente (falha o PR no início)
//   2. Derivação → Resultados REAL impresso pelo E2E
//      O runtime drift check no final de cada E2E valida (exit 1 se divergir)
//      e o .sh (test-seed-{prod,dev}-e2e.sh) compara o count real impresso
//      contra a MESMA derivação (bun scripts/seed-e2e-count.ts prod|dev).
//
// Escopo (arquivos que DOCUMENTAM counts):
//   - .github/workflows/pr-check.yml            (comentários + summary)
//   - .github/workflows/seed-guards.yml         (comentários + echos da matrix)
//   - scripts/validate-seed-guards-matrix-local.sh
//
// PISO de sites por alvo (MIN_DOCUMENTED_SITES, prod ≥ 8 / dev ≥ 6): além
// de validar cada count ENCONTRADO, o guard falha se sites documentados
// SOMEM da extração (ex.: reformatar o ternary, generalizar "127 checks" →
// "N checks") — mesma proteção do piso do seed-e2e-count.test.ts, fechando
// a brecha onde uma doc esvaziada passaria sem violações.
//
// Usage:
//   node scripts/check-e2e-counts.mjs
//
// Exit codes:
//   0 — todos os counts documentados batem com a derivação (pass)
//   1 — alguma divergência ou a derivação falhou (fail-closed)
// =============================================================================

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

// ---------------------------------------------------------------------------
// Config — derivação e padrões de extração
// ---------------------------------------------------------------------------

/** Arquivos que DOCUMENTAM counts nos comentários/echos — todos escaneados.
 *  Se um workflow NOVO começar a documentar counts, ADICIONE-O aqui (a lista
 *  explícita evita falsos positivos de prosa "N checks" em workflows não
 *  relacionados; o check-workflow-refs.mjs escaneia tudo porque lá o padrão
 *  de invocação é inequívoco, aqui é heurístico por contexto). */
export const SCAN_FILES = [
  ".github/workflows/pr-check.yml",
  ".github/workflows/seed-guards.yml",
  "scripts/validate-seed-guards-matrix-local.sh",
]

/**
 * Piso de sites documentados por alvo (prod ≥ 8, dev ≥ 6 — MESMO valor do
 * teste "piso de sites documentados por alvo" do seed-e2e-count.test.ts).
 *
 * Por quê: checkCounts só valida counts que a extração ENCONTRA. Se um site
 * for silenciosamente PERDIDO (ex.: reformatar o ternary da matrix, ou — o
 * cenário do mutation test — generalizar "127 checks" → "N checks"), a
 * extração encolhe, zero violações são encontradas e o guard passaria com a
 * doc esvaziada. Este piso falha o guard quando um alvo fica com menos sites
 * do que o mínimo — fechando a mesma brecha que o piso do teste de
 * integração cobre do lado do vitest (os 2 elos da cadeia agora concordam).
 */
export const MIN_DOCUMENTED_SITES = { prod: 8, dev: 6 }

/**
 * Padrões que ligam um count documentado ao SEU alvo (prod|dev). A dedupe
 * remove sobreposições (ex.: uma linha com "prod E2E (test-seed-prod-e2e.ts *   — 127 checks)" casa 2×, mas com o MESMO count → vira 1 registro).
 */
const TARGET_PATTERNS = [
  // Filename explícito do source
  { target: "prod", re: /test-seed-prod-e2e\.ts[^\n]*?(\d+)\s+checks?/g },
  { target: "dev", re: /test-seed-dev-e2e\.ts[^\n]*?(\d+)\s+checks?/g },
  // "prod E2E ... (N checks)" / "dev E2E ... (N checks)"
  { target: "prod", re: /\bprod\s+E2E\b[^\n]*?(\d+)\s+checks?/gi },
  { target: "dev", re: /\bdev\s+E2E\b[^\n]*?(\d+)\s+checks?/gi },
  // "prod: N checks" / "dev: N checks" (seed-guards.yml — linha do validator)
  { target: "prod", re: /\bprod:\s*(\d+)\s+checks?/g },
  { target: "dev", re: /\bdev:\s*(\d+)\s+checks?/g },
  // Ternary da matrix (seed-guards.yml L205): seed == 'prod' && '127' || '161'
  // ATENÇÃO: o padrão dev depende da formatação exata `'162' }} checks` — se
  // o echo for reformatado, o count dev deixa de ser validado (site perdido,
  // não violação). Mantenha o formato quando editar a linha do summary.
  { target: "prod", re: /'prod'\s*&&\s*'(\d+)'/g },
  { target: "dev", re: /\|\|\s*'(\d+)'\s*\}\}\s+checks?/g },
]

// ---------------------------------------------------------------------------
// Funções puras (exportadas para teste unitário)
// ---------------------------------------------------------------------------

/**
 * Extrai os counts documentados de um conteúdo de workflow/script.
 *
 * @param {string} content  conteúdo do arquivo
 * @returns {{ target: "prod"|"dev", line: number, count: number, text: string }[]}
 */
export function extractDocumentedCounts(content) {
  const found = []
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // matchAll clona a regex /g — lastIndex do módulo nunca avança (seguro).
    for (const { target, re } of TARGET_PATTERNS) {
      for (const m of line.matchAll(re)) {
        found.push({
          target,
          line: i + 1,
          count: Number(m[1]),
          text: line.trim().slice(0, 80),
        })
      }
    }
  }
  // Dedupe (linha, alvo, count) — sobreposições de padrões não geram duplicatas
  const seen = new Set()
  return found.filter((f) => {
    const key = `${f.line}:${f.target}:${f.count}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Roda a derivação de counts via `bun scripts/seed-e2e-count.ts --json` e
 * retorna { prod, dev }. Falha-closed: se o bun não estiver disponível ou o
 * script falhar, lança com a mensagem do stderr — o guard deve FALHAR quando
 * não conseguir obter a fonte da verdade (nunca validar contra nada).
 *
 * @param {string} cwd  diretório do repo (onde rodar o bun)
 * @returns {{ prod: number, dev: number }}
 */
export function runDerivation(cwd) {
  // Windows: `bun` costuma ser um shim npm (bun.cmd) — node não executa
  // shims .cmd sem shell:true (spawn direto → ENOENT). Linux/macOS (CI com
  // oven-sh/setup-bun@v2) tem o binário real — spawn direto é suficiente.
  let res = spawnSync("bun", ["scripts/seed-e2e-count.ts", "--json"], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    ...(process.platform === "win32" ? { shell: true } : {}),
  })
  // Fallback: if bun is not installed, try `npx tsx` (TypeScript runner)
  if (res.error && res.status === null) {
    res = spawnSync("npx", ["tsx", "scripts/seed-e2e-count.ts", "--json"], {
      cwd,
      encoding: "utf8",
      timeout: 30_000,
    })
  }
  if (res.status !== 0) {
    const err = (res.stderr ?? res.stdout ?? "").trim() || `exit ${res.status}`
    throw new Error(`derivação de counts falhou (bun scripts/seed-e2e-count.ts --json): ${err}`)
  }
  return parseDerivedJson(res.stdout)
}

/**
 * Parseia a saída JSON da derivação ({ prod, dev }) — funções puras testáveis.
 *
 * @param {string} stdout  saída do `bun scripts/seed-e2e-count.ts --json`
 * @returns {{ prod: number, dev: number }}
 */
export function parseDerivedJson(stdout) {
  let parsed
  try {
    parsed = JSON.parse(stdout.trim())
  } catch {
    throw new Error(`saída da derivação não é JSON válido: ${stdout.slice(0, 80)}`)
  }
  if (typeof parsed.prod !== "number" || typeof parsed.dev !== "number") {
    throw new Error(`saída da derivação sem prod/dev numéricos: ${stdout.slice(0, 80)}`)
  }
  return { prod: parsed.prod, dev: parsed.dev }
}

/**
 * Compara os counts documentados com o esperado por alvo.
 *
 * @param {{ target: string, line: number, count: number, text: string }[]} documented
 * @param {{ prod: number, dev: number }} expected
 * @returns {{ target: string, line: number, count: number, expected: number, text: string }[]}
 */
export function checkCounts(documented, expected) {
  const violations = []
  for (const d of documented) {
    if (d.count !== expected[d.target]) {
      violations.push({ ...d, expected: expected[d.target] })
    }
  }
  return violations
}

/**
 * Verifica o PISO de sites documentados por alvo — a proteção contra PERDA
 * de extração (site some silenciosamente → a contagem de sites encolhe).
 *
 * @param {{ target: string, line: number, count: number, text: string }[]} documented
 * @param {Record<string, number>} minimums  piso por alvo (default MIN_DOCUMENTED_SITES)
 * @returns {{ target: string, found: number, minimum: number }[]}
 */
export function checkSitePisos(documented, minimums = MIN_DOCUMENTED_SITES) {
  const foundByTarget = {}
  for (const d of documented) {
    foundByTarget[d.target] = (foundByTarget[d.target] ?? 0) + 1
  }
  const violations = []
  for (const [target, minimum] of Object.entries(minimums)) {
    const found = foundByTarget[target] ?? 0
    if (found < minimum) {
      violations.push({ target, found, minimum })
    }
  }
  return violations
}

// ---------------------------------------------------------------------------
// Main — roda a derivação + escaneia workflows/script local
// ---------------------------------------------------------------------------

/** Lê um arquivo relativo ao cwd (exit 1 com mensagem se ilegível). */
function readText(rel) {
  try {
    return readFileSync(join(process.cwd(), rel), "utf8")
  } catch (e) {
    console.error(`❌ Não foi possível ler ${rel}: ${e.message}`)
    process.exit(1)
  }
}

function main() {
  // ── Fonte da verdade: derivação (bun scripts/seed-e2e-count.ts --json) ──
  let expected
  try {
    expected = runDerivation(process.cwd())
  } catch (e) {
    console.error(`❌ ${e.message}`)
    console.error(
      `   A derivação (scripts/seed-e2e-count.ts) é a fonte da verdade dos counts de checks.`,
    )
    process.exit(1)
  }

  // ── Escaneia os arquivos que documentam counts ────────────────────────
  const violations = []
  const allDocumented = []
  for (const rel of SCAN_FILES) {
    const documented = extractDocumentedCounts(readText(rel))
    allDocumented.push(...documented)
    for (const v of checkCounts(documented, expected)) {
      violations.push({ file: rel, ...v })
    }
  }

  // Piso de sites por alvo: pega a PERDA de extração que o checkCounts não vê
  // (sites que SOMEM da doc — não divergem — como o cenário do mutation test
  // "doc 128→N"). Mesmo piso do seed-e2e-count.test.ts (prod ≥ 8, dev ≥ 6).
  const pisoViolations = checkSitePisos(allDocumented)

  if (pisoViolations.length > 0) {
    console.error(
      `❌ Site(s) documentado(s) de checks SUMIRAM da extração (piso por alvo violado):\n`,
    )
    for (const v of pisoViolations) {
      console.error(
        `   - alvo=${v.target}: encontrados ${v.found} sites documentados, mínimo ${v.minimum}`,
      )
    }
    console.error(
      `\n   Ação: um site documentado foi removido ou reformatado nos SCAN_FILES` +
        `\n   (ex.: o ternary da matrix, um comentário "N checks", um echo).` +
        `\n   Restaure o site (ou ajuste o piso em MIN_DOCUMENTED_SITES se a doc` +
        `\n   foi LEGITIMAMENTE simplificada — deliberado e documentado).`,
    )
    process.exit(1)
  }

  if (violations.length > 0) {
    console.error(
      `❌ Count(s) de checks divergente(s) entre workflows e derivação (scripts/seed-e2e-count.ts):\n`,
    )
    for (const v of violations) {
      console.error(
        `   - ${v.file}:${v.line}  [${v.target}] documentado=${v.count} → esperado=${v.expected}`,
      )
      console.error(`     → ${v.text}`)
    }
    console.error(
      `\n   Ação: atualize o comentário/echo do workflow para bater com a derivação` +
        `\n   (ou corrija a derivação em scripts/seed-e2e-count.ts se a asserção foi` +
        `\n   adicionada/removida no E2E — ela ajusta o count sozinha).` +
        `\n   O runtime drift check do E2E também falha se o total REAL (📊 Resultados) divergir.`,
    )
    process.exit(1)
  }

  console.log(`✅ Counts de checks sincronizados (prod=${expected.prod}, dev=${expected.dev}).`)
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
