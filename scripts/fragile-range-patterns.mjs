#!/usr/bin/env node
/**
 * fragile-range-patterns.mjs - the fragile character-class RANGE patterns
 * that encoding gates must never use, as an importable module.
 *
 * WHY THIS MODULE EXISTS:
 *   An em-dash slipped into scripts/health-check.sh (2026-08) because the
 *   encoding gate used `grep -n '[^ -~]'` - a locale-dependent character-
 *   class RANGE that fails SILENTLY. The fix was scripts/scan-non-ascii.mjs
 *   (raw byte iteration). But the fragile-range CLASS can reintroduce itself
 *   through any future gate: a new .sh checker, an inline grep in a workflow
 *   run block, a sed/perl one-liner.
 *
 *   The vitest guard (scripts/__tests__/fragile-range-guard.test.ts) hunts
 *   that class across every gate-relevant file - but a developer who runs
 *   ONLY the encoding gates (check-utf8.sh / verify-ascii-proof.sh /
 *   verify-encoding.sh) never executes the vitest suite, so a fragile range
 *   could land in a gate file and pass those three. THIS MODULE closes that
 *   gap: the same patterns are wired into the encoding gate itself as a
 *   layer, so the class is blocked wherever the gate runs, vitest or not.
 *
 * API (importable - entry-point guarded, same pattern as scan-non-ascii.mjs):
 *   import {
 *     FRAGILE_PATTERNS, stripComments, gateFiles, scanForFragile,
 *     filesInDir, scanDirectory,
 *   } from "./fragile-range-patterns.mjs"
 *
 *   FRAGILE_PATTERNS : Array<{ label: string, re: RegExp }>
 *   stripComments(content, ext) -> string   (comments stripped, live code only)
 *   gateFiles(root?)         -> string[]    (sorted gate-relevant file paths)
 *   scanForFragile(root?)    -> string[]    (offender lines, human-readable)
 *   filesInDir(dir)          -> string[]    (recursive code files, sorted)
 *   scanDirectory(dir)       -> string[]    (offender lines for a dir tree)
 *
 * CLI (what gates call):
 *   node scripts/fragile-range-patterns.mjs [--ci] [--dir <dir> ...]
 *     scans every gate file in the repo (gateFiles()) PLUS, for each --dir,
 *     every code file under that directory tree (filesInDir: recursive,
 *     skipping node_modules/.next/git/hidden dirs - the e2e/ specs and src/
 *     app files were previously invisible to this guard). A fragile range
 *     in a playwright spec or an app file is now caught, not just in gate
 *     scripts. Prints one line per offender. With --ci, exits 1 if any
 *     offender found, else 0. Without --ci, exits 1 on offenders too
 *     (verdict identical - --ci only documents intent); exit 2 on usage
 *     error (unknown flag, missing --dir path). The repo root is resolved
 *     from this module's own location, so the CLI is cwd-independent (same
 *     convention as the shell siblings' SCRIPT_DIR). --dir paths are
 *     resolved against the caller's cwd, as is standard for a CLI arg.
 *
 *   Env override: FRAGILE_SCAN_ROOT=<dir> scans a synthetic/alternate repo
 *     root instead of the module-implied root (applies to gateFiles() and
 *     to --dir-less runs). Same fixture-driven pattern as the proof layer's
 *     VPS_SH_FILES/OPS_SH_FILES overrides (the wrapper verify-encoding.sh
 *     passes env through untouched) - lets mutation tests / CI proofs run
 *     layer 3 against a temp tree without touching the real repo. Missing
 *     subdirs (scripts/, .github/workflows/) are treated as empty, so a
 *     minimal synthetic root works.
 *
 * PATTERN CLASSES (each one is the same failure mode as the 2026-08 bug):
 *   - space-tilde range:        [ -~]  /  [^ -~]
 *   - hex-escape byte range:    [\x00-\x7f]  /  [\x80-\xFF]  /  [^\x80-\xff]
 *   - POSIX printable/ascii:    [:print:]  /  [^[:print:]]  /  [:ascii:]
 *   - grep -P / rg -P (PCRE)    hand-rolled PCRE ranges in shell, incl.
 *                               combined flags (grep -qP, rg -rnP) - but
 *                               ONLY when the PCRE pattern carries a
 *                               character-class range `[..-..]`. Legit PCRE
 *                               extraction (grep -oP '\d+', port/IP
 *                               parsing) is allowed: it is not the fragile
 *                               byte-range class.
 *
 * Comment-stripping tradeoffs (same as the vitest guard - documented so
 * "why did the guard trip/skip?" is never a mystery):
 *   - Inline // (mjs/ts) and inline # (sh/py) comments are NOT stripped, so
 *     a fragile pattern in an INLINE comment trips the guard. Safe-side
 *     false positive: it only forces rewording the comment.
 *   - A #-prefixed line INSIDE a heredoc is dropped as a comment even though
 *     heredoc content is live code. Small blind spot - acceptable because
 *     such a gate is not idiomatic.
 *   - Multi-line PCRE (`grep -P \` then the pattern on the next line) slips
 *     past the grep -P pattern (it cannot cross newlines) - inert, because
 *     the fragile RANGE itself on the next line is still caught by the
 *     space-tilde / hex-escape / POSIX patterns.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// Repo root resolved from THIS module's own location - the CLI is
// cwd-independent, same as the shell siblings' SCRIPT_DIR convention (a gate
// must never depend on where the caller happened to run it from).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** The fragile character-class range patterns (the 2026-08 bug class). */
export const FRAGILE_PATTERNS = [
  // Space-tilde: the exact range that failed in 2026-08. `?` = optional ^.
  { label: "space-tilde character range", re: /\[\^? ?-~\]/ },
  // Hex-escape byte ranges, any case: \xNN-\xNN inside brackets.
  { label: "hex-escape byte range", re: /\\x[0-9a-fA-F]{2}\s*-\s*\\x[0-9a-fA-F]{2}/ },
  // POSIX character classes used for printable/ASCII detection.
  { label: "POSIX printable/ascii class", re: /\[:\^?(print|ascii|graph):\]/ },
  // grep -P / rg -P with a character-class range: the PCRE analogue of the
  // fragile range class. `-[^\s]*P` catches combined flags (grep -qP, rg
  // -rnP); the trailing `\[[^\n\]]+-[^\n\]]*\]` requires the pattern to
  // actually carry a `[..-..]` range so legit PCRE extraction like
  // `grep -oP '\d+'` (fail2ban/security-headers port+IP parsing) stays
  // green - that is not the fragile byte-range class this guard hunts.
  { label: "grep -P / rg -P with character-class range", re: /\b(?:grep|rg)\s+-[^\s]*P[^\n]*\[[^\n\]]+-[^\n\]]*\]/ },
]

/**
 * Strip comments from source so only LIVE code is scanned. Same contract as
 * the vitest guard: inline comments are NOT stripped (safe-side), full-line
 * comments are, heredoc content is preserved for sh/ps1/yml.
 * @param {string} content
 * @param {string} ext  file extension without dot ("sh", "mjs", "ts", ...)
 * @returns {string}
 */
export function stripComments(content, ext) {
  if (["mjs", "ts", "tsx", "js", "jsx", "cjs", "mts"].includes(ext)) {
    // JS/TS-family: strip /* */ blocks first, then // line comments. App
    // files (js/jsx/cjs/mts) get the same treatment so a fragile range in
    // a src/ comment does not trip the scan.
    return content
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(/\r?\n/)
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n")
  }
  if (ext === "py") {
    // Python: strip """...""" / '''...''' docstrings (block comments), then
    // # line comments.
    return content
      .replace(/"""[^]*?"""|'''[^]*?'''/g, "")
      .split(/\r?\n/)
      .filter((l) => !/^\s*#/.test(l))
      .join("\n")
  }
  // sh / ps1 / yml: drop full-line # comments. Heredoc content is preserved.
  return content
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n")
}

/**
 * Enumerate every gate-relevant file in the repo. Same scope as the vitest
 * guard: scripts/* (sh|mjs|ts|py|ps1, skipping __*), root *.sh, .husky hooks,
 * .github/workflows/*.yml.
 * @param {string} [root]  repo root (default: resolved from this module)
 * @returns {string[]}
 */
export function gateFiles(root = REPO_ROOT) {
  const files = []

  const scriptsDir = path.join(root, "scripts")
  if (existsSync(scriptsDir)) {
    for (const f of readdirSync(scriptsDir)) {
      if (f.startsWith("__")) continue // __tests__, __tmp_*
      // ts included: TS gate scripts (validate-cache-manifest.ts,
      // coverage-gaps.ts, ...) are real gates and must be scanned too.
      if (/\.(sh|mjs|ts|py|ps1)$/.test(f)) files.push(path.join(scriptsDir, f))
    }
  }

  for (const f of readdirSync(root)) {
    if (f.endsWith(".sh")) files.push(path.join(root, f))
  }

  for (const h of [".husky/pre-commit", ".husky/pre-push"]) {
    if (existsSync(path.join(root, h))) files.push(path.join(root, h))
  }

  const wfDir = path.join(root, ".github", "workflows")
  if (existsSync(wfDir)) {
    for (const f of readdirSync(wfDir)) {
      if (/\.ya?ml$/.test(f)) files.push(path.join(wfDir, f))
    }
  }

  return files.sort()
}

/**
 * Scan every gate file for fragile character-class ranges in LIVE code.
 * @param {string} [root]  repo root (default: resolved from this module)
 * @returns {string[]} offender lines like "rel/path :: label :: match"
 */
export function scanForFragile(root = REPO_ROOT) {
  const offenders = []
  for (const file of gateFiles(root)) {
    const ext = path.extname(file).slice(1) || "sh"
    const live = stripComments(readFileSync(file, "utf8"), ext)
    for (const { label, re } of FRAGILE_PATTERNS) {
      const m = live.match(re)
      if (m) {
        offenders.push(`${path.relative(root, file)} :: ${label} :: ${JSON.stringify(m[0])}`)
      }
    }
  }
  return offenders
}

// Code file extensions scanned under a --dir target. Broader than gateFiles
// (which is scripts/* + root .sh + hooks + workflows): a --dir target is an
// arbitrary tree (e2e/, src/) where .ts/.tsx/.js app code carries the same
// fragile-range risk as shell gates - e.g. a playwright spec that shells out
// to `grep -n '[^ -~]'` would pass the old gate-files-only scan unnoticed.
const TARGET_EXTS = /^\.(sh|mjs|js|cjs|mts|ts|tsx|jsx|py|ps1|ya?ml)$/

// Dirs that must never be scanned under a --dir target: vendored/generated
// trees are either not ours or not hand-written gates. Symmetric with what a
// developer would grep by hand.
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
  "playwright-report",
  "test-results",
  ".turbo",
  ".cache",
  "__tests__",
  "__mocks__",
  "__fixtures__",
])

/**
 * Recursively enumerate every code file under a directory tree (sorted).
 * Skips hidden dirs, node_modules/.next/git artifacts, and __* test-foo
 * dirs - the same "live code only" contract as gateFiles().
 * @param {string} dir  absolute or cwd-relative target dir
 * @returns {string[]}
 */
export function filesInDir(dir) {
  const files = []
  const stack = [path.resolve(dir)]
  while (stack.length > 0) {
    const cur = stack.pop()
    for (const f of readdirSync(cur)) {
      const full = path.join(cur, f)
      let st
      try {
        st = statSync(full)
      } catch {
        continue // dangling symlink / race - skip
      }
      if (st.isDirectory()) {
        if (f.startsWith(".") || SKIP_DIRS.has(f)) continue
        stack.push(full)
      } else if (st.isFile() && TARGET_EXTS.test(path.extname(f))) {
        files.push(full)
      }
    }
  }
  return files.sort()
}

/**
 * Scan every code file under a directory tree for fragile ranges in LIVE
 * code. Offender paths are relative to the given dir (platform separator,
 * as path.relative produces - callers/tests use path.join to compare).
 * @param {string} dir  absolute or cwd-relative target dir
 * @returns {string[]} offender lines, paths RELATIVE TO THE TARGET DIR (e.g.
 *   "foo.spec.ts :: label :: match" when the target dir is e2e/)
 */
export function scanDirectory(dir) {
  const offenders = []
  for (const file of filesInDir(dir)) {
    const ext = path.extname(file).slice(1) || "sh"
    const live = stripComments(readFileSync(file, "utf8"), ext)
    for (const { label, re } of FRAGILE_PATTERNS) {
      const m = live.match(re)
      if (m) {
        offenders.push(`${path.relative(path.resolve(dir), file)} :: ${label} :: ${JSON.stringify(m[0])}`)
      }
    }
  }
  return offenders
}

const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_MAIN) {
  // Flags: --ci (intent only; verdict identical either way - this gate is
  // ALWAYS strict) and --dir <path> (repeatable AND multi-arg: both
  // `--dir e2e/ --dir src/` and `--dir e2e/ src/` work - every non-flag
  // token following --dir is a target dir; additive to the gate-file scan,
  // so the e2e/ and src/ trees get covered too).
  const dirs = []
  const rest = []
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i]
    if (a === "--ci") continue
    if (a === "--dir") {
      // Consume one or more consecutive non-flag tokens as target dirs.
      let n = 0
      while (i + 1 < process.argv.length && !process.argv[i + 1].startsWith("--")) {
        dirs.push(process.argv[i + 1])
        i++
        n++
      }
      if (n === 0) {
        process.stderr.write("fragile-range: --dir requires at least one path argument\n")
        process.exit(2)
      }
      continue
    }
    rest.push(a)
  }
  if (rest.length > 0) {
    process.stderr.write("usage: node scripts/fragile-range-patterns.mjs [--ci] [--dir <dir> ...]\n")
    process.exit(2)
  }
  // FRAGILE_SCAN_ROOT lets fixture-driven tests / CI proofs scan a
  // synthetic root (same env-passthrough pattern as the proof layer's
  // VPS_SH_FILES/OPS_SH_FILES overrides through verify-encoding.sh).
  const root = process.env.FRAGILE_SCAN_ROOT
    ? path.resolve(process.env.FRAGILE_SCAN_ROOT)
    : REPO_ROOT
  const offenders = scanForFragile(root)
  const files = gateFiles(root)
  let extraFiles = 0
  for (const d of dirs) {
    const resolved = path.resolve(d)
    // No silent ignore: a mistyped --dir must fail loudly, like every gate
    // in this repo (a misspelled target would otherwise scan nothing and
    // pass green). A FILE is not a target either - readdirSync on one would
    // throw ENOTDIR as an uncaught stack trace (exit 1), so reject it here
    // with the same clean exit-2 posture as a missing path.
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      process.stderr.write(`fragile-range: --dir target not found or not a directory: ${d}\n`)
      process.exit(2)
    }
    offenders.push(...scanDirectory(d))
    extraFiles += filesInDir(d).length
  }
  if (offenders.length === 0) {
    // process.stdout.write (not console.log): the repo lint allows only
    // console.warn/error, and the verdict line is stdout payload.
    const noun = extraFiles === 1 ? "target file" : "target files"
    const target = dirs.length > 0 ? ` + ${extraFiles} ${noun}` : ""
    process.stdout.write(`fragile-range: clean (${files.length} gate files${target}, no fragile character-class ranges)\n`)
    process.exit(0)
  }
  process.stderr.write(`fragile-range: ${offenders.length} fragile character-class range(s) in LIVE code:\n`)
  for (const o of offenders) {
    process.stderr.write(`  ${o}\n`)
  }
  process.stderr.write("  (use scripts/scan-non-ascii.mjs instead - raw byte iteration, no pattern to break)\n")
  process.exit(1)
}
