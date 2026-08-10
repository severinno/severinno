#!/usr/bin/env node
/**
 * scan-push-full-suite.mjs - guard do Gate 3 do pre-push (2026-08)
 *
 * WHY: a secao 8.4 do gates-proofs.md decidiu - com medicao (18s vs 178s,
 * ~10x) - que o Gate 3 do pre-push roda os testes das AREAS TOCADAS via
 * pre-commit-tests.mjs --scope push (staged + HEAD + range do push), NAO a
 * suite completa; o CI roda a suite inteira em checkout fresco como rede de
 * seguranca. Este guard trava essa decisao contra regressao futura: falha se
 * scripts/pre-push-gates.sh ou .husky/pre-push voltarem a invocar a suite
 * completa (test:unit, test:run, vitest run sem arquivos mapeados, bun run
 * test em watch) - o custo ~10x por push que a secao 8.4 mediu e recusou.
 *
 * O caminho legitimo (pre-commit-tests.mjs) spawna o vitest com os testes
 * MAPEADOS explicitos - a logica vive no .mjs, nunca nos .sh. Logo: QUALQUER
 * invocacao de vitest/test:unit/test:run/bare-test nos .sh escaneados e
 * regressao por definicao. `test:guard` (o par fixo fragile-range +
 * golden-copy do push net) NAO e a suite completa - fora do escopo deste
 * guard (decisao separada, nao bloqueada aqui).
 *
 * Linhas de comentario (primeiro char nao-branco = '#') sao ignoradas: o
 * header do pre-push-gates.sh menciona "suite completa" em prosa.
 *
 * Env override PUSH_SUITE_SCAN_ROOT (repo sintetico p/ o vitest - espelha o
 * FRAGILE_SCAN_ROOT do fragile-range). Saida ASCII pura (gate file).
 * Puro node, sem deps, <10ms.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(process.env.PUSH_SUITE_SCAN_ROOT || process.cwd())
const FILES = ["scripts/pre-push-gates.sh", ".husky/pre-push"]

/** Full-suite invocation patterns (the section-8.4 regression class). */
const FULL_SUITE_RES = [
  /test:unit\b/,
  /test:run\b/,
  /\bbun\s+run\s+test(?!:guard)\b/,
  /\bvitest\s+run\b/,
  /\bnpx\s+vitest\b/,
  /\bbunx\s+vitest\b/,
]

/** Required Gate-3 marker per guard file (the section-8.4 mapped invocation). */
const REQUIRED_MARKERS = [
  { file: "scripts/pre-push-gates.sh", re: /pre-commit-tests\.mjs\s+--scope\s+push/ },
]

/** True when the line is a full-line comment (first non-space char is #). */
function isComment(line) {
  return /^\s*#/.test(line)
}

/**
 * Scan the guard files. Returns { fullSuite, missingMarker } where fullSuite
 * is [{ file, line, text }] of full-suite invocations and missingMarker is
 * [{ file }] for guard files lacking their required Gate-3 marker. Both empty
 * = clean. Exported for unit tests.
 */
export function scanPushFullSuite(root = ROOT, files = FILES) {
  const fullSuite = []
  for (const rel of files) {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) continue
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/)
    lines.forEach((line, i) => {
      if (isComment(line)) return
      for (const re of FULL_SUITE_RES) {
        if (re.test(line)) {
          fullSuite.push({ file: rel, line: i + 1, text: line.trim() })
          return
        }
      }
    })
  }
  const missingMarker = []
  for (const { file: rel, re } of REQUIRED_MARKERS) {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) continue // synthetic roots may omit the file
    if (!re.test(fs.readFileSync(abs, "utf8"))) missingMarker.push({ file: rel })
  }
  return { fullSuite, missingMarker }
}

function main() {
  const { fullSuite, missingMarker } = scanPushFullSuite()
  if (fullSuite.length === 0 && missingMarker.length === 0) {
    console.log(
      `push-suite: clean (${FILES.length} guard files, mapped Gate 3 present, no full-suite invocations)`,
    )
    return 0
  }
  for (const o of fullSuite) {
    console.log(`push-suite: FULL-SUITE in ${o.file}:${o.line}: ${o.text}`)
  }
  for (const m of missingMarker) {
    console.log(`push-suite: GATE 3 MISSING in ${m.file} (pre-commit-tests.mjs --scope push required, sec 8.4)`)
  }
  console.log(
    "push-suite: Gate 3 must run the MAPPED tests (pre-commit-tests.mjs --scope push), not the full suite (sec 8.4)",
  )
  return 1
}

// Entry-point guard: only run the CLI when executed directly (vitest imports
// the file for unit tests of scanPushFullSuite without side effects).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
