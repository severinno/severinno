#!/usr/bin/env node
/**
 * scan-lint-staged-loader.mjs - guard do veredito RECUSADO da 11.7 (2026-08):
 * o lint-staged nao pode voltar a rodar o eslint por um loader bun.
 *
 * WHY: a 11.7 do gates-proofs.md mediu o loader do bun no boot do eslint
 * (bun ~8% mais rapido) e RECUSOU como lever - o hook lint-staged roda o
 * shim eslintd (11.6) com o loader do node. O veredito pode regredir
 * silenciosamente: alguem troca o comando do lint-staged no package.json
 * para `bunx eslint`, `bun eslint`, `bun run lint` etc. sem re-medir.
 *
 * CONTRATO BIDIRECIONAL (mesmo padrao do scan-push-full-suite):
 * - NEGATIVO: um loader bun (bun/bunx) antes do eslint/eslint_d em QUALQUER
 *   comando do lint-staged - a menos que o gates-proofs.md tenha uma secao
 *   numerada 11.x declarando o loader ADOTADO (a re-mediacao datada que
 *   reverteria o veredito - o padrao de reversao das outras secoes).
 * - POSITIVO: o lint-staged precisa ter UM comando de eslint (o shim
 *   eslintd-shim.sh da 11.6 ou `eslint` puro, o baseline node da 11.7) -
 *   deletar o gate eslint do lint-staged = commit sem lint = falha
 *   'LINT-STAGED ESLINT MISSING'.
 *
 * Env override LINT_LOADER_SCAN_ROOT (repo sintetico p/ o vitest - espelha
 * o PUSH_SUITE_SCAN_ROOT do scan-push-full-suite). Saida ASCII pura (gate
 * file). Puro node, sem deps, <10ms.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(process.env.LINT_LOADER_SCAN_ROOT || process.cwd())
const DOC = path.join("docs", "gates-proofs.md")

/**
 * Bun-loader invocations of eslint in lint-staged commands (the 11.7
 * regression class). The eslint token is followed by whitespace/end/.js so
 * `eslint-config`-style package names never false-positive.
 */
const BUN_LOADER_RES = [
  /\bbunx?\s+(?:--bun\s+)?eslint(?:\s|$|\.js\b)/,
  /\bbunx?\s+(?:--bun\s+)?eslint_d\b/,
  /\bbun\s+run\s+lint(?:$|\s)/,
  /\bbun\s+run\s+\S*eslint\S*/,
  /\bbun\s+(?:node_modules\/)?(?:\.bin\/)?eslint(?:\/|\s|$|\.js\b)/,
]

/** The eslint gate must exist in lint-staged (shim 11.6 or node eslint, incl. the bin path form `eslint.js` from the 11.7 baseline). */
const ESLINT_GATE_RE = /eslintd-shim\.sh|\beslint(?:\.js)?(?:\s|$)/

/**
 * The 11.x reversal note: a dated SECTION HEADER declaring the bun loader
 * ADOTADO (e.g. "## 11.11 bun loader no lint-staged - ADOTADO (medicao ...)").
 * Anchored on a header line: prose in the doc explaining the rule does NOT
 * satisfy the contract (a re-mediation must exist as a dated section).
 */
const REVERSAL_RE = /^##\s+11\.\d+.*\bbun\b.*\b(?:ADOTADO|ALLOWED)\b/im

/** Flatten lint-staged values (string or array of strings) into commands. */
function commandsOf(lintStaged) {
  const out = []
  if (!lintStaged || typeof lintStaged !== "object") return out
  for (const [key, value] of Object.entries(lintStaged)) {
    for (const cmd of Array.isArray(value) ? value : [value]) {
      if (typeof cmd === "string") out.push({ key, command: cmd })
    }
  }
  return out
}

/** Line of the first occurrence of a distinctive command fragment (0 = n/a). */
function lineOf(raw, fragment) {
  const lines = raw.split(/\r?\n/)
  const frag = fragment.slice(0, 24)
  const idx = lines.findIndex((l) => l.includes(frag))
  return idx === -1 ? 0 : idx + 1
}

/**
 * Scan the lint-staged config. Returns { bunLoader, missingGate } where
 * bunLoader is [{ key, line, text }] of bun-loader eslint commands (without
 * the reversal note) and missingGate is [{ text }] when no eslint command
 * exists. All empty = clean. Exported for unit tests.
 */
export function scanLintStagedLoader(root = ROOT) {
  const pkgPath = path.join(root, "package.json")
  if (!fs.existsSync(pkgPath)) return { bunLoader: [], missingGate: [] }
  let pkg
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
  } catch {
    return { bunLoader: [], missingGate: [] } // broken package.json: not scannable
  }
  const raw = fs.readFileSync(pkgPath, "utf8")
  const commands = commandsOf(pkg["lint-staged"])

  const reversalNote = (() => {
    const doc = path.join(root, DOC)
    if (!fs.existsSync(doc)) return false
    return REVERSAL_RE.test(fs.readFileSync(doc, "utf8"))
  })()

  const bunLoader = []
  for (const { key, command } of commands) {
    if (!reversalNote && BUN_LOADER_RES.some((re) => re.test(command))) {
      bunLoader.push({ key, line: lineOf(raw, command), text: command.trim() })
    }
  }

  const missingGate = commands.some((c) => ESLINT_GATE_RE.test(c.command))
    ? []
    : [{ text: "lint-staged" }]

  return { bunLoader, missingGate }
}

export function main() {
  const { bunLoader, missingGate } = scanLintStagedLoader()
  if (bunLoader.length === 0 && missingGate.length === 0) {
    console.log(
      "lint-staged-loader: clean (eslint gate via shim/plain eslint, no bun loader - sec 11.7 RECUSADO locked)",
    )
    return 0
  }
  for (const o of bunLoader) {
    console.log(
      `lint-staged-loader: BUN LOADER for eslint in lint-staged ("${o.key}") at package.json:${o.line}: ${o.text}`,
    )
  }
  for (const m of missingGate) {
    console.log(
      "lint-staged-loader: LINT-STAGED ESLINT MISSING - no eslint/eslintd-shim command in lint-staged config (sec 11.7)",
    )
  }
  console.log(
    "lint-staged-loader: sec 11.7 RECUSADO o loader bun no boot do eslint (~8%, nao vale); para re-adotar, adicione uma secao numerada 11.x com o loader ADOTADO e a re-mediacao datada no gates-proofs.md",
  )
  return 1
}

// Entry-point guard: only run the CLI when executed directly (vitest imports
// the file for unit tests of scanLintStagedLoader without side effects).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
