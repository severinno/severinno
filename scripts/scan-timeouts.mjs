#!/usr/bin/env node
/**
 * scan-timeouts.mjs — the versioned guard for the explicit-timeout contract
 * on subprocess-heavy vitest tests.
 *
 * WHY THIS EXISTS (read before you skip it):
 *   In 2026-08 the CI was flaking because subprocess-heavy tests ran on
 *   vitest's IMPLICIT default timeout (5000ms): a test that shells out
 *   (spawnSync / runSubprocess / execSync ...) to node, bash or a script
 *   on a SLOW runner can exceed 5s even when it is deterministic — the
 *   flake class. The fix was a one-off sweep that standardized an EXPLICIT
 *   timeout (60000) on 137 subprocess-heavy tests across the scripts/
 *   suites. A sweep is a point-in-time action: nothing stops a NEW
 *   subprocess-heavy `it()` from landing without a timeout and quietly
 *   reintroducing the class (and src/ tests are just as capable of it as
 *   scripts/). THIS module is the sweep made permanent: it fails on any
 *   it()/test() that is subprocess-heavy AND lacks an explicit timeout, so
 *   the class cannot come back.
 *
 *   NOTE ON THE GLOBAL TIMEOUT (2026-08, layered with this guard):
 *   vitest.config.unit.ts sets testTimeout: 30000 — a SAFETY NET for tests
 *   this guard does NOT flag (pure tests, and subprocess tests that slip
 *   past the three detection layers). The per-test explicit timeout remains
 *   the REQUIRED contract for subprocess-heavy tests: it is their own
 *   documented ceiling, independent of config drift, and it is what makes
 *   the 60000 sweep standard enforceable. The guard does not key on the
 *   global value; the global only widens the backstop.
 *
 * WHAT "subprocess-heavy" MEANS — three detection layers, so a test that
 * shells out through a LOCAL HELPER is caught, not just direct calls:
 *   1. DIRECT token in the test body: spawnSync( execSync( execFileSync(
 *      spawn( fork( runSubprocess( process.execPath child_process.
 *      Strings, comments and REGEX LITERALS are code-masked before the
 *      scan, so prose quoting these tokens (or a toMatch(/...\(/) regex)
 *      cannot false-positive.
 *   2. LOCAL HELPER call: the test body calls a top-level function /
 *      const-arrow defined in the SAME file whose own body (transitively)
 *      contains a subprocess token. The repo's suites shell out mostly
 *      through per-suite wrappers (runGate, runReport, runBudget, runCli,
 *      run, ...) that encapsulate runSubprocess/spawnSync — a token scan
 *      of test bodies alone would miss them (measured: ~15 vs ~159). The
 *      helper analysis closes that gap.
 *   3. IMPORTED helper call: the test body calls a helper imported from a
 *      local module (e.g. golden-copy-utils) that is itself subprocess-
 *      heavy (runSubprocess, expectLayer3FailsThroughWrapper). The
 *      imported module is analyzed with the same helper logic.
 *   Over-flagging is safe-side: a test that merely calls a heavy helper
 *   gets flagged and only costs an explicit timeout.
 *
 * WHAT "explicit timeout" MEANS (both vitest forms are accepted):
 *   it(name, fn, 60000)                  — positional 3rd arg, numeric
 *   it(name, { timeout: 60000 }, fn)     — jest-style options object
 *   (60_000 underscore literals count too.)
 *
 * API (importable — entry-point guarded, same pattern as
 * fragile-range-patterns.mjs / scan-non-ascii.mjs):
 *   import { codeMask, findTestCalls, scanTestFile, scanSurface,
 *            scanFiles } from "./scan-timeouts.mjs"
 *
 *   codeMask(source)      -> string   (code-masked: strings/comments/regex
 *                                     literals are spaces, newlines kept)
 *   findTestCalls(source, heavyCallables?) -> Array<{ name, line,
 *                                     subprocessHeavy, hasTimeout }>
 *   scanTestFile(file)    -> { path, tests, subprocessHeavy, violations }
 *   scanSurface(root?)    -> { files, tests, subprocessHeavy, violations }
 *   scanFiles(paths)      -> same shape, over an explicit file list
 *
 * CLI (what CI calls):
 *   node scripts/scan-timeouts.mjs [--ci] [file...]
 *     With no files: scans the whole vitest surface (scripts/ + src/
 *     recursive *.test.{ts,tsx} — the same trees vitest.config.unit.ts
 *     includes, so a test the CI can run is a test this gate can scan).
 *     With files: scans exactly those (targeted CI / mutation proofs).
 *     --ci only documents intent (this gate is ALWAYS strict: exit 1 on
 *     any violation). exit 2 on usage error (unknown flag). The scan root
 *     is resolved from this module's own location (cwd-independent, same
 *     convention as the shell siblings' SCRIPT_DIR); TIMEOUT_SCAN_ROOT
 *     env override scans a synthetic tree for fixture-driven tests /
 *     CI proofs without touching the real repo.
 *
 * Exit codes: 0 = clean · 1 = at least one subprocess-heavy test without
 * an explicit timeout · 2 = usage error.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/**
 * Tokens that make code subprocess-heavy. Tested on the CODE-MASKED body
 * (strings/comments/regex literals stripped), so quoting one of these in
 * a docblock, an assertion string or a toMatch() regex cannot flag a test.
 * `spawn(` is included: a test calling a local helper named spawn is
 * unlikely, and over-flagging only costs an explicit timeout (safe-side).
 */
const SUBPROCESS_RE =
  /(?:spawnSync|execSync|execFileSync|spawn|fork|runSubprocess)\s*\(|process\.execPath|child_process/

/**
 * Characters after which a `/` begins a regex literal rather than a
 * division. The standard tokenizer heuristic: the previous significant
 * code char is an operator, an opening bracket, a comma, or the start of
 * the file. `return /re/` is a known blind spot (previous char is a
 * letter) — rare in this repo's test bodies; the cost of a miss is a
 * mis-parsed test, caught by the BASELINE count companion, not a silent
 * security hole.
 */
const REGEX_START_CHARS = new Set("([{,=:;!&|?+-*%~<>")

/**
 * Return a code-masked copy of a test file's source: every character that
 * is part of a string literal, template literal, comment, or REGEX LITERAL
 * becomes a space; newlines are preserved so line numbers stay aligned.
 * The masked string is what the call-finder and the subprocess-token scan
 * run over — there is no way for a pattern inside prose (or a regex with
 * escaped parens like toMatch(/numEnv\(/)) to be mistaken for code.
 * Template-literal `${...}` interpolations are masked whole (a subprocess
 * token inside one would not be seen; no test in this repo does that).
 * @param {string} source
 * @returns {string}
 */
export function codeMask(source) {
  const out = source.split("")
  const n = source.length
  let i = 0
  let prevSig = "" // last significant (non-space) CODE char, for regex detection
  while (i < n) {
    const c = source[i]
    const c1 = source[i + 1]
    if (c === "/" && c1 === "/") {
      // Line comment: mask to end of line (newline kept).
      while (i < n && source[i] !== "\n") {
        out[i] = " "
        i++
      }
      continue
    }
    if (c === "/" && c1 === "*") {
      out[i] = " "
      out[i + 1] = " "
      i += 2
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        out[i] = source[i] === "\n" ? "\n" : " "
        i++
      }
      if (i < n) {
        out[i] = " "
        out[i + 1] = " "
        i += 2
      }
      continue
    }
    if (c === '"' || c === "'") {
      const q = c
      out[i] = " "
      i++
      while (i < n) {
        if (source[i] === "\\") {
          out[i] = " "
          i++
          if (i < n) {
            out[i] = " "
            i++
          }
          continue
        }
        if (source[i] === q) {
          out[i] = " "
          i++
          break
        }
        out[i] = " "
        i++
      }
      prevSig = q
      continue
    }
    if (c === "`") {
      out[i] = " "
      i++
      while (i < n) {
        if (source[i] === "\\") {
          out[i] = " "
          i++
          if (i < n) {
            out[i] = " "
            i++
          }
          continue
        }
        if (source[i] === "`") {
          out[i] = " "
          i++
          break
        }
        out[i] = " "
        i++
      }
      prevSig = "`"
      continue
    }
    if (c === "/" && (prevSig === "" || REGEX_START_CHARS.has(prevSig))) {
      // Regex literal: mask to the closing unescaped `/` (char classes
      // may contain `/` and must not end the literal early).
      out[i] = " "
      i++
      let inClass = false
      while (i < n) {
        const rc = source[i]
        if (rc === "\\") {
          out[i] = " "
          i++
          if (i < n) {
            out[i] = " "
            i++
          }
          continue
        }
        if (rc === "[") inClass = true
        else if (rc === "]") inClass = false
        else if (rc === "/" && !inClass) {
          out[i] = " "
          i++
          break
        }
        out[i] = " "
        i++
      }
      prevSig = "/" // a regex literal behaves like a value
      continue
    }
    if (!/\s/.test(c)) prevSig = c
    i++
  }
  return out.join("")
}

/** Index of the paren matching the one at openIdx, or -1 (never balances). */
function matchParen(masked, openIdx) {
  let depth = 0
  for (let i = openIdx; i < masked.length; i++) {
    if (masked[i] === "(") depth++
    else if (masked[i] === ")") {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Index of the BRACE matching the one at openIdx (openIdx must be `{`), or
 * -1. Distinct from matchParen on purpose: a helper body must be bounded by
 * brace depth, NOT paren depth. Using matchParen on a `{` made a paren-less
 * body (e.g. a pure helper returning a template literal) LEAK forward into
 * the next function and capture its runSubprocess(...) - flagging pure
 * helpers heavy (and, the other direction, truncating at the first balanced
 * `)` so a subprocess call after an earlier paren was never seen).
 */
function matchBrace(masked, openIdx) {
  let depth = 0
  for (let i = openIdx; i < masked.length; i++) {
    if (masked[i] === "{") depth++
    else if (masked[i] === "}") {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Split a call's argument span at top-level commas (depth 0 over
 * parens/brackets/braces). Operates on the masked string so commas inside
 * strings do not split; returns raw slices for reporting.
 * @param {string} masked
 * @param {string} raw
 * @returns {string[]}
 */
function splitTopLevelArgs(masked, raw) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i]
    if (ch === "(" || ch === "[" || ch === "{") depth++
    else if (ch === ")" || ch === "]" || ch === "}") depth--
    else if (ch === "," && depth === 0) {
      parts.push(raw.slice(start, i))
      start = i + 1
    }
  }
  parts.push(raw.slice(start))
  return parts
}

/** True when an explicit timeout is present in either vitest form. */
function hasExplicitTimeout(args) {
  // Form 1: it(name, fn, 60000) — positional numeric 3rd arg (underscores ok).
  if (args.length >= 3 && /^\d[\d_]*$/.test(args[2].trim())) return true
  // Form 2: it(name, { timeout: 60000 }, fn) — jest-style options object.
  if (args.length >= 2 && args[1].trim().startsWith("{") && /timeout\s*:/.test(args[1])) {
    return true
  }
  return false
}

/**
 * Find every it()/test() registration in a test file's source. Handles the
 * plain form, the .each table form (it.each([...])("name", fn[, timeout])),
 * the .each template-literal form (it.each`a,b`("name", fn[, timeout])),
 * and the .skip/.fails/.concurrent variants (a skipped subprocess-heavy
 * test still demands a timeout — if the skip is lifted later, the flake
 * class returns). Parsing runs over the CODE-MASKED source, so a paren or
 * comma inside a string / comment / regex literal cannot unbalance it.
 * @param {string} source
 * @param {Set<string>} [heavyCallables]  names of subprocess-heavy helpers
 *   (local + imported) — a body calling one is subprocess-heavy
 * @returns {Array<{ name: string, line: number, subprocessHeavy: boolean, hasTimeout: boolean }>}
 */
export function findTestCalls(source, heavyCallables = new Set()) {
  const masked = codeMask(source)
  const calls = []
  const re = /\b(it|test)(?:\.(\w+))*/g
  let m
  while ((m = re.exec(masked)) !== null) {
    const identStart = m.index
    const identEnd = m.index + m[0].length
    const mods = [...m[0].matchAll(/\.(\w+)/g)].map((x) => x[1])
    const isEach = mods.includes("each")
    const isTodo = mods.includes("todo")
    if (isTodo) continue // it.todo("name") has no callback — nothing to time.

    // Find the ARGS open paren. Plain form: the first `(` after the
    // identifier. .each PARENTHESIZED form (it.each([...])): the first `(`
    // is the TABLE — balance it, then the args paren follows. .each
    // TEMPLATE form (it.each`a,b`): the template content is masked to
    // spaces, so the first `(` after the identifier IS the args paren.
    let openIdx = masked.indexOf("(", identEnd)
    if (openIdx < 0) continue
    if (isEach) {
      const rawTail = source.slice(identEnd).replace(/^\s+/, "")
      if (!rawTail.startsWith("`")) {
        const tableEnd = matchParen(masked, openIdx)
        if (tableEnd < 0) continue
        openIdx = masked.indexOf("(", tableEnd)
        if (openIdx < 0) continue
      }
    }
    const closeIdx = matchParen(masked, openIdx)
    if (closeIdx < 0) continue

    const argMasked = masked.slice(openIdx + 1, closeIdx)
    const argRaw = source.slice(openIdx + 1, closeIdx)
    const args = splitTopLevelArgs(argMasked, argRaw)

    const bodyMasked = masked.slice(openIdx, closeIdx + 1)
    const direct = SUBPROCESS_RE.test(bodyMasked)
    const viaHelper = [...heavyCallables].some((h) => new RegExp(`\\b${h}\\b\\s*\\(`).test(bodyMasked))
    const line = source.slice(0, identStart).split("\n").length
    calls.push({
      name: (args[0] ?? "").trim(),
      line,
      subprocessHeavy: direct || viaHelper,
      hasTimeout: hasExplicitTimeout(args),
    })
  }
  return calls
}

/**
 * Top-level helper definitions in a source file (function declarations and
 * const-arrow functions with brace bodies) — the per-suite wrappers that
 * encapsulate subprocess calls (runGate, runReport, runBudget, ...).
 * @param {string} source
 * @returns {Array<{ name: string, start: number, end: number }>}
 */
function localDefs(source) {
  const masked = codeMask(source)
  const defs = []
  const addArrow = (name, openIdx) => {
    const paramsClose = matchParen(masked, openIdx)
    if (paramsClose < 0) return
    const arrow = masked.indexOf("=>", paramsClose)
    if (arrow < 0) return
    const brace = masked.indexOf("{", arrow)
    if (brace < 0) return
    const end = matchBrace(masked, brace)
    if (end < 0) return
    defs.push({ name, start: brace, end })
  }
  const addFn = (name, openIdx) => {
    const paramsClose = matchParen(masked, openIdx)
    if (paramsClose < 0) return
    const brace = masked.indexOf("{", paramsClose)
    if (brace < 0) return
    // Brace-bounded, not paren-bounded - a paren-less body (template-literal
    // return) must not leak into the next function's span (2026-08, the
    // dispatchWarning class: a pure helper was flagged heavy because its
    // span swallowed the NEXT helper's runSubprocess).
    const end = matchBrace(masked, brace)
    if (end < 0) return
    defs.push({ name, start: brace, end })
  }
  // function NAME(params) { ... } at line start (incl. export / async -
  // the shared runner golden-copy-utils exports its helpers as `export
  // function runSubprocess(...)`, so the imported-helper path depends on
  // localDefs seeing the prefix; `export async function` would silently
  // miss otherwise - the same under-flag class, closed here).
  const fnRe =
    /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g
  let m
  // Run on the MASKED source (like every other parse in this module): a
  // line-start comment like `// function fake(` cannot create a spurious
  // def whose body-span lookup would land on a later real paren. The 1:1
  // masking keeps m.index valid for the masked body-span math below.
  while ((m = fnRe.exec(masked)) !== null) {
    addFn(m[1], masked.indexOf("(", m.index + m[0].length - 1))
  }
  // const NAME = (params) => { ... } / const NAME = async (params) => { ... }
  // (incl. export const - same exported-helper rationale as above).
  const arRe =
    /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g
  while ((m = arRe.exec(masked)) !== null) {
    addArrow(m[1], masked.indexOf("(", m.index + m[0].length - 1))
  }
  return defs
}

/**
 * Names of the top-level helpers in a source file that are subprocess-heavy
 * (their own body, transitively, contains a subprocess token or calls
 * another heavy helper). Fixpoint iteration so a helper that calls a heavy
 * helper is caught (e.g. a wrapper over a wrapper).
 * @param {string} source
 * @returns {Set<string>}
 */
function heavyHelperNames(source) {
  const masked = codeMask(source)
  const defs = localDefs(source)
  const heavy = new Set()
  let changed = true
  while (changed) {
    changed = false
    for (const d of defs) {
      if (heavy.has(d.name)) continue
      const body = masked.slice(d.start, d.end + 1)
      if (SUBPROCESS_RE.test(body)) {
        heavy.add(d.name)
        changed = true
        continue
      }
      for (const h of heavy) {
        if (new RegExp(`\\b${h}\\b\\s*\\(`).test(body)) {
          heavy.add(d.name)
          changed = true
          break
        }
      }
    }
  }
  return heavy
}

/**
 * Names imported by a test file from LOCAL modules that are themselves
 * subprocess-heavy helpers (analyzed with the same helper logic). Covers
 * the repo's shared runner (golden-copy-utils: runSubprocess,
 * expectLayer3FailsThroughWrapper) without hardcoding a module name.
 * @param {string} source
 * @param {string} filePath
 * @returns {Set<string>}
 */
function importedHeavyCallables(source, filePath) {
  const names = new Set()
  const re = /import\s*\{([^}]+)\}\s*from\s*["'](\.[^"']+)["']/g
  let m
  while ((m = re.exec(source)) !== null) {
    const mod = m[2]
    let modSrc = null
    const base = path.resolve(path.dirname(filePath), mod)
    for (const ext of [".ts", ".mjs", ".tsx"]) {
      try {
        modSrc = readFileSync(base + ext, "utf8")
        break
      } catch {
        /* try next extension */
      }
    }
    if (modSrc == null) continue
    const heavy = heavyHelperNames(modSrc)
    if (heavy.size === 0) continue
    for (const item of m[1].split(",")) {
      const bare = item.trim().split(/\s+as\s+/).pop().trim()
      if (bare && heavy.has(bare)) names.add(bare)
    }
  }
  return names
}

/**
 * Scan ONE test file: find its it()/test() registrations and its
 * violations (subprocess-heavy calls without an explicit timeout). Local
 * and imported heavy helpers are resolved per file.
 * @param {string} filePath
 * @returns {{ path: string, tests: Array, subprocessHeavy: number, violations: Array<{ line: number, name: string }> }}
 */
export function scanTestFile(filePath) {
  const source = readFileSync(filePath, "utf8")
  const heavy = new Set([...heavyHelperNames(source), ...importedHeavyCallables(source, filePath)])
  const tests = findTestCalls(source, heavy)
  return {
    path: filePath,
    tests,
    subprocessHeavy: tests.filter((t) => t.subprocessHeavy).length,
    violations: tests
      .filter((t) => t.subprocessHeavy && !t.hasTimeout)
      .map((t) => ({ line: t.line, name: t.name })),
  }
}

/**
 * Recursively enumerate every vitest test file under scripts/ and src/
 * (the same trees vitest.config.unit.ts includes — *.test.{ts,tsx}).
 * @param {string} root
 * @returns {string[]}
 */
export function testFiles(root) {
  const files = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      return // missing tree (e.g. a minimal synthetic root) = empty
    }
    for (const f of entries) {
      const full = path.join(dir, f)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (f === "node_modules" || f === ".next" || f.startsWith(".")) continue
        walk(full)
      } else if (/\.test\.(ts|tsx)$/.test(f)) {
        files.push(full)
      }
    }
  }
  for (const tree of ["scripts", "src"]) walk(path.join(root, tree))
  return files.sort()
}

/**
 * Scan the whole vitest surface (or a synthetic root via TIMEOUT_SCAN_ROOT
 * in the CLI). Aggregates per-file results.
 * @param {string} [root]
 * @returns {{ files: number, tests: number, subprocessHeavy: number, violations: Array }}
 */
export function scanSurface(root = REPO_ROOT) {
  return scanFiles(testFiles(root))
}

/**
 * Scan an explicit list of test files (CLI file args / mutation proofs).
 * @param {string[]} paths
 * @returns {{ files: number, tests: number, subprocessHeavy: number, violations: Array<{ file: string, line: number, name: string }> }}
 */
export function scanFiles(paths) {
  const violations = []
  let tests = 0
  let subprocessHeavy = 0
  for (const p of paths) {
    const r = scanTestFile(p)
    tests += r.tests.length
    subprocessHeavy += r.subprocessHeavy
    for (const v of r.violations) violations.push({ file: p, ...v })
  }
  return { files: paths.length, tests, subprocessHeavy, violations }
}

const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_MAIN) {
  const args = process.argv.slice(2)
  const unknown = args.filter((a) => a.startsWith("--") && a !== "--ci")
  if (unknown.length > 0) {
    process.stderr.write("scan-timeouts: usage: node scripts/scan-timeouts.mjs [--ci] [file...]\n")
    process.exit(2)
  }
  const fileArgs = args.filter((a) => !a.startsWith("--"))
  const root = process.env.TIMEOUT_SCAN_ROOT
    ? path.resolve(process.env.TIMEOUT_SCAN_ROOT)
    : REPO_ROOT
  const r = fileArgs.length > 0 ? scanFiles(fileArgs) : scanSurface(root)
  if (r.violations.length === 0) {
    const noun = r.files === 1 ? "test file" : "test files"
    process.stdout.write(
      `scan-timeouts: clean (${r.files} ${noun}, ${r.tests} tests, ${r.subprocessHeavy} subprocess-heavy - all with explicit timeouts)\n`,
    )
    process.exit(0)
  }
  process.stderr.write(
    `scan-timeouts: ${r.violations.length} subprocess-heavy test(s) WITHOUT an explicit timeout (the global testTimeout: 30000 is only a safety net - a subprocess-heavy test needs its own explicit ceiling; add a numeric 3rd arg or a { timeout } option):\n`,
  )
  for (const v of r.violations) {
    process.stderr.write(`  ${v.file}:${v.line} :: ${v.name || "(unnamed)"}\n`)
  }
  process.exit(1)
}
