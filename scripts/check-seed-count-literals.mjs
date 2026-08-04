#!/usr/bin/env node

// =============================================================================
// check-seed-count-literals.mjs
//
// Guard (padrão check-e2e-counts) que varre TODO o repo — scripts/, docs/,
// .github/ — por literais de counts de seed que NÃO batam com a derivação
// real (bun scripts/seed-e2e-count.ts --json → {prod, dev}).
//
// Por que existe: o incidente do "count drifted" (doc dizia 128, âncora de
// teste esperava 123) mostrou que um literal órfão pode sobreviver a um bump
// do seed sem ninguém perceber — o check-e2e-counts cobre os workflows e o
// script local, mas NÃO varre docs/ nem todos os scripts/. Este guard fecha o
// buraco: QUALQUER literal "N checks" fora do conjunto válido {prod, dev}
// (ex.: um literal 123 órfão numa doc após a derivação passar para 128)
// falha o PR na hora.
//
// Contexto (evita falso positivo): só literais em CONTEXTO de count são
// extraídos — número adjacente à palavra "checks" (precedido por espaço/
// pontuação, NUNCA por hífen, para não casar "UTF-8 check") ou no ternary
// ESPECÍFICO da matrix do seed-guards.yml ('prod' && '<N>' || '<N>' }} checks
// — ternaries genéricos tipo && '1' do SKIP_PRISMA_GENERATE não casam).
// Mock data (CVC "123", "Rua das Flores, 123", rgba(249,115,22), senhas
// "minha-senha-123") NÃO casa e NÃO é flag. Prosa histórica (GUARDS.md "doc
// dizia 128, âncora de teste esperava 123") também não casa — falta a
// palavra "checks" adjacente ao número.
//
// Nota (self-scan): este guard varre scripts/ e, portanto, o PRÓPRIO arquivo.
// O header NÃO usa literais reais de count com "checks" adjacente de
// propósito — ex.: "N checks" em vez de "128 checks" — para que um bump
// futuro da derivação não transforme a documentação do guard num tripwire.
//
// Fonte da verdade: REUSA runDerivation/parseDerivedJson do
// check-e2e-counts.mjs (bun scripts/seed-e2e-count.ts --json) — um único
// ponto de derivação, nunca literal hardcoded.
//
// Usage:
//   node scripts/check-seed-count-literals.mjs
//
// Exit codes:
//   0 — todos os literais de count em contexto batem com a derivação
//   1 — literal fora do conjunto válido OU derivação falhou (fail-closed)
// =============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { runDerivation } from "./check-e2e-counts.mjs"

// ---------------------------------------------------------------------------
// Config — escopo e padrões de extração
// ---------------------------------------------------------------------------

/** Raízes varridas recursivamente (TODO o repo de interesse). */
export const SCAN_ROOTS = ["scripts", "docs", ".github"]

/** Extensões de arquivos de texto consideradas (mock/binary são pulados). */
const TEXT_EXTS = new Set([
  ".md",
  ".yml",
  ".yaml",
  ".sh",
  ".mjs",
  ".js",
  ".ts",
  ".tsx",
  ".json",
  ".txt",
])

/** Diretórios sempre pulados na varredura. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "tool-results", "coverage"])

/**
 * Padrões que extraem um literal de count em CONTEXTO. Cada padrão captura o
 * número no grupo 1. O contexto é o que separa um count de seed de mock data:
 *   - "128 checks" / "162 checks" (adjacência à palavra checks)
 *   - ternary da matrix do seed-guards.yml: 'prod' && '128' || '162' }} checks
 * Prosa sem a palavra "checks" perto do número não casa (GUARDS.md histórica).
 */
const COUNT_CONTEXT_PATTERNS = [
  // "N checks" — forma dominante em comentários, echos e docs. O prefixo
  // [^\w-] impede casar "UTF-8 check" (hífen antes do número) e números
  // colados em palavras ("a128 checks" não casa em 128). \d{2,}: counts de
  // seed nunca são single-digit (128/162) — prosa como "run 3 checks" e o
  // flag '1' (SKIP_PRISMA_GENERATE) não casam; e o teto fica aberto (4+
  // dígitos num bump futuro ainda são detectados, não viram ref órfão).
  { re: /(?:^|[^\w-])(\d{2,})\s+checks?\b/gi },
  // ternary ESPECÍFICO da matrix: ${{ matrix.seed == 'prod' && '128' || '162' }} checks
  // — ancorado em 'prod' E em 2+ dígitos: ternaries && '1' (SKIP_PRISMA_
  // GENERATE) são single-digit e NÃO casam.
  { re: /'prod'\s*&&\s*'(\d{2,})'/g },
  // o ramo dev do MESMO ternary, ancorado no fechamento "}} checks" e em
  // 2+ dígitos (mesma razão do ramo prod).
  { re: /\|\|\s*'(\d{2,})'\s*\}\}\s*checks?/g },
]

// ---------------------------------------------------------------------------
// Funções puras (exportadas para teste unitário)
// ---------------------------------------------------------------------------

/**
 * Coleta os arquivos de texto sob as raízes de SCAN_ROOTS (recursivo).
 *
 * @param {string} cwd  diretório do repo
 * @returns {string[]}  paths relativos (ex.: "docs/API.md")
 */
export function collectTextFiles(cwd) {
  const out = []
  const walk = (dir, prefix) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full, rel)
      } else if (e.isFile() && TEXT_EXTS.has(e.name.slice(e.name.lastIndexOf(".")))) {
        out.push(rel)
      }
    }
  }
  for (const root of SCAN_ROOTS) {
    walk(join(cwd, root), root)
  }
  return out
}

/**
 * Extrai os literais de count em contexto de um conteúdo.
 *
 * @param {string} content  conteúdo do arquivo
 * @returns {{ line: number, count: number, text: string }[]}
 */
export function extractCountLiterals(content) {
  const found = []
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const { re } of COUNT_CONTEXT_PATTERNS) {
      // matchAll clona a regex /g — lastIndex do módulo nunca avança (seguro)
      for (const m of line.matchAll(re)) {
        found.push({ line: i + 1, count: Number(m[1]), text: line.trim().slice(0, 80) })
      }
    }
  }
  // Dedupe (linha, count) — sobreposições de padrões não geram duplicatas
  const seen = new Set()
  return found.filter((f) => {
    const key = `${f.line}:${f.count}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Valida os literais extraídos contra o conjunto válido {prod, dev}.
 *
 * @param {{ line: number, count: number, text: string }[]} literals
 * @param {{ prod: number, dev: number }} expected
 * @returns {{ line: number, count: number, expected: number[], text: string }[]}
 */
export function checkLiterals(literals, expected) {
  const valid = [expected.prod, expected.dev]
  return literals.filter((l) => !valid.includes(l.count)).map((l) => ({ ...l, expected: valid }))
}

// ---------------------------------------------------------------------------
// Main — derivação + varredura das raízes
// ---------------------------------------------------------------------------

function main() {
  // ── Fonte da verdade: derivação (reusa check-e2e-counts.mjs) ────────────
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

  // ── Varre scripts/, docs/, .github/ por literais em contexto ─────────────
  const violations = []
  for (const rel of collectTextFiles(process.cwd())) {
    let content
    try {
      content = readFileSync(join(process.cwd(), rel), "utf8")
    } catch {
      continue
    }
    for (const v of checkLiterals(extractCountLiterals(content), expected)) {
      violations.push({ file: rel, ...v })
    }
  }

  if (violations.length > 0) {
    console.error(
      `❌ Literal(is) de count de seed fora da derivação (scripts/seed-e2e-count.ts → {prod: ${expected.prod}, dev: ${expected.dev}}):\n`,
    )
    for (const v of violations) {
      console.error(
        `   - ${v.file}:${v.line}  literal=${v.count} → esperado ∈ {${v.expected.join(", ")}}`,
      )
      console.error(`     → ${v.text}`)
    }
    console.error(
      `\n   Ação: atualize o literal para bater com a derivação (ou corrija a` +
        `\n   derivação em scripts/seed-e2e-count.ts se a asserção foi` +
        `\n   adicionada/removida no E2E — ela ajusta o count sozinha).` +
        `\n   Provável causa: bump do seed que deixou um ref órfão (como a âncora 123).`,
    )
    process.exit(1)
  }

  console.log(
    `✅ Counts de seed sincronizados em ${SCAN_ROOTS.join(", ")} (prod=${expected.prod}, dev=${expected.dev}).`,
  )
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
