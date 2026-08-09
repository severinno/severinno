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
 *     filesInDir, scanDirectory, TARGET_DIRS, scanExecutableCode,
 *   } from "./fragile-range-patterns.mjs"
 *
 *   FRAGILE_PATTERNS : Array<{ label: string, re: RegExp }>
 *   stripComments(content, ext) -> string   (comments stripped, live code only)
 *   gateFiles(root?)         -> string[]    (sorted gate-relevant file paths)
 *   scanForFragile(root?)    -> string[]    (offender lines, human-readable)
 *   filesInDir(dir)          -> string[]    (recursive code files, sorted)
 *   scanDirectory(dir)       -> string[]    (offender lines for a dir tree)
 *   TARGET_DIRS              -> string[]    (code trees scanned in addition to
 *                                            gate files: e2e/ specs + src/ app)
 *   scanExecutableCode(root?) -> string[]   (gate files + TARGET_DIRS offenders,
 *                                            paths relative to root - the full
 *                                            repo-wide scan the vitest guard pins)
 *
 * CLI (what gates call):
 *   node scripts/fragile-range-patterns.mjs --print-target-dirs
 *     prints TARGET_DIRS.join(" ") (the default --dir targets - the
 *     TARGET_DIRS trees today) and exits 0 - verify-encoding.sh layer 3
 *     AND a standalone
 *     check-utf8.sh BOTH derive their default --dir args from this output,
 *     so the module is the single source of truth and no shell wrapper
 *     holds a second "e2e/ src/" list that could drift. Standalone only:
 *     combining it with scan flags is a usage error (exit 2), same
 *     no-silent-ignore posture the wrapper keeps for --sync.
 *   node scripts/fragile-range-patterns.mjs [--ci] [--dir <dir> ...]
 *     scans every gate file in the repo (gateFiles()) PLUS, for each --dir,
 *     every code file under that directory tree (filesInDir: recursive,
 *     skipping node_modules/.next/git/hidden dirs - the TARGET_DIRS trees
 *     (e2e/, src/, mini-services/, .zscripts/) were previously invisible
 *     to this guard). A fragile range
 *     in a playwright spec or an app file is now caught, not just in gate
 *     scripts. Prints one line per offender. With --ci, exits 1 if any
 *     offender found, else 0. Without --ci, exits 1 on offenders too
 *     (verdict identical - --ci only documents intent); exit 2 on usage
 *     error (unknown flag, missing --dir path). The repo root is resolved
 *     from this module's own location, so the CLI is cwd-independent (same
 *     convention as the shell siblings' SCRIPT_DIR). --dir paths are
 *     resolved against the caller's cwd, as is standard for a CLI arg.
 *     (verify-encoding.sh layer 3 passes --dir once per TARGET_DIRS tree,
 *     derived via --print-target-dirs, so the encoding gate covers the
 *     SAME executable-code surface as this repo-wide scan.)
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
 * guard: scripts/* (sh|mjs|ts|py|ps1, skipping __tmp_* and other __ junk),
 * root executable tooling (sh + ts/mjs/ps1 configs + Makefile/Dockerfile),
 * .husky hooks, .github/workflows/*.yml, and the composite
 * actions under .github/actions (action.yml / action.yaml - executable
 * run blocks, the same class as workflows). PLUS the NON-TEST
 * helper files under scripts/__tests__/ (e.g. golden-copy-utils.ts): they
 * are executable code that shells out through subprocess, so a fragile
 * character-class range there is the same bug class as in any gate. The
 * .test.* specs stay excluded BY DESIGN - their string-literal fixtures
 * intentionally carry the very patterns this guard hunts (the
 * immunity/mutation proofs would trip on themselves) - as does the
 * fixtures/ tree (test data, not executable gates).
 * @param {string} [root]  repo root (default: resolved from this module)
 * @returns {string[]}
 */
export function gateFiles(root = REPO_ROOT) {
  const files = []

  const scriptsDir = path.join(root, "scripts")
  if (existsSync(scriptsDir)) {
    for (const f of readdirSync(scriptsDir)) {
      if (f.startsWith("__")) continue // __tmp_*, __mocks__, ... (__tests__ handled below)
      // ts included: TS gate scripts (validate-cache-manifest.ts,
      // coverage-gaps.ts, ...) are real gates and must be scanned too.
      if (/\.(sh|mjs|ts|py|ps1)$/.test(f)) files.push(path.join(scriptsDir, f))
    }

    // Non-test helper files under scripts/__tests__: executable code in the
    // gate class (subprocess runners like golden-copy-utils.ts). Specs
    // (*.test.*) and the fixtures/ directory stay excluded by design (their
    // string literals carry the patterns this guard hunts as fixtures).
    // Exact-name match on the fixtures dir (not a prefix): a hypothetical
    // helper like fixtures-config.ts must NOT be over-excluded.
    const testsDir = path.join(scriptsDir, "__tests__")
    if (existsSync(testsDir)) {
      for (const f of readdirSync(testsDir)) {
        if (f === "fixtures") continue
        if (f.includes(".test.")) continue
        if (/\.(sh|mjs|ts|py|ps1)$/.test(f)) files.push(path.join(testsDir, f))
      }
    }
  }

  // Root executable tooling: the shell scripts (keep-alive.sh, ...) AND the
  // executable Node/PowerShell configs + build files that run in CI
  // (next.config.ts, eslint.config.mjs, vitest*.config.ts, dev.ps1,
  // test-prisma7.mjs, Makefile, Dockerfile - the 2026-08 executable-surface
  // audit decision, pinned by scripts/__tests__/executable-surface.test.ts
  // and the gateFiles() enumeration asserts). A fragile character-class
  // range in ANY of them fails silently exactly like the 2026-08 em-dash -
  // same bug class, so the root gate surface is the full executable set,
  // not just *.sh. (Root config DATA - .prettierrc, lighthouserc*.json -
  // is not executable code; not scanned. The extension set mirrors
  // TARGET_EXTS minus .ya?ml - root yml (docker-compose/pnpm) is declared
  // container/package data, OUT BY DESIGN; yml is scanned only under
  // .github/workflows and .github/actions. Makefile/Dockerfile are
  // extension-less build files, matched by name.)
  for (const f of readdirSync(root)) {
    if (
      /\.(sh|mjs|js|cjs|mts|ts|tsx|jsx|py|ps1)$/.test(f) ||
      f === "Makefile" ||
      f === "Dockerfile"
    ) {
      files.push(path.join(root, f))
    }
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

  // Composite actions (.github/actions/<name>/action.yml): executable
  // run-block logic, the SAME bug class as workflows - a fragile range
  // there would fail silently like the 2026-08 em-dash. Scanned as gate
  // files (recursive walk; action.yml / action.yaml only). The current
  // actions (severinno-ssh/-scp) are uses-only wiring with 0 run: blocks,
  // but the CLASS is closed for the day one gains a run block.
  const actionsDir = path.join(root, ".github", "actions")
  if (existsSync(actionsDir)) {
    const walk = (d) => {
      for (const f of readdirSync(d)) {
        const full = path.join(d, f)
        let st
        try {
          st = statSync(full)
        } catch {
          continue // dangling symlink / race - skip
        }
        if (st.isDirectory()) walk(full)
        else if (st.isFile() && /^action\.ya?ml$/.test(f)) files.push(full)
      }
    }
    walk(actionsDir)
  }

  return files.sort()
}

/**
 * Scan ONE file's LIVE code against every fragile pattern. Shared by all
 * three scan entry points (scanForFragile / scanDirectory /
 * scanExecutableCode) so the offender format and the stripComments+pattern
 * pipeline can never drift between them - the same code path the encoding
 * gate's layer 3 runs.
 * @param {string} file        absolute file path
 * @param {string} displayPath path to show in the offender line (root- or
 *                             dir-relative, as each caller contracts)
 * @returns {string[]} offender lines for this file (0..1 per pattern)
 */
function scanFileForFragile(file, displayPath) {
  const ext = path.extname(file).slice(1) || "sh"
  const live = stripComments(readFileSync(file, "utf8"), ext)
  const hits = []
  for (const { label, re } of FRAGILE_PATTERNS) {
    const m = live.match(re)
    if (m) {
      hits.push(`${displayPath} :: ${label} :: ${JSON.stringify(m[0])}`)
    }
  }
  return hits
}

/**
 * Scan every gate file for fragile character-class ranges in LIVE code.
 * @param {string} [root]  repo root (default: resolved from this module)
 * @returns {string[]} offender lines like "rel/path :: label :: match"
 */
export function scanForFragile(root = REPO_ROOT) {
  const offenders = []
  for (const file of gateFiles(root)) {
    offenders.push(...scanFileForFragile(file, path.relative(root, file)))
  }
  return offenders
}

// Code file extensions scanned under a --dir target. Broader than gateFiles
// (which is scripts/* + root .sh + hooks + workflows): a --dir target is an
// arbitrary tree (e2e/, src/) where .ts/.tsx/.js app code carries the same
// fragile-range risk as shell gates - e.g. a playwright spec that shells out
// to `grep -n '[^ -~]'` would pass the old gate-files-only scan unnoticed.
const TARGET_EXTS = /^\.(sh|mjs|js|cjs|mts|ts|tsx|jsx|py|ps1|ya?ml)$/

// ===========================================================================
// DECISION RECORD (CANONICAL) - fragile-range scan scope exclusions.
// Recorded 2026-08. THIS block is the single source of truth for what the
// scan does NOT cover and why. The vitest guard docblock
// (fragile-range-guard.test.ts) and the verify-encoding.sh header POINT
// HERE instead of restating the rationale; the guard test still pins the
// behavior as a contract. Edit the decision in ONE place: here.
//
// NOT scanned BY DESIGN:
//   - extensions: .md, .css, .html (not in TARGET_EXTS above)
//   - trees: the EXCLUDED_TREES array below (docs, public, examples,
//     config, prisma, db, download, upload, osrm-data, agent-ctx,
//     .opencode, tool-results, secrets, .agents) - never TARGET_DIR entries
//
// WHY: the fragile-range class is about EXECUTABLE byte-detection logic - a
// grep pattern in a gate that FAILS SILENTLY. The excluded trees hold
// documentation prose (this repo's own docs legitimately describe the
// 2026-08 bug class, and a scanned .md quoting the space-tilde pattern
// would false-positive the repo's history the moment it grows a new doc),
// static client content (public/), illustrative samples (examples/), infra
// config/seed data (config/, prisma/, db/, osrm-data/), user content
// (download/, upload/), agent/tool prose (agent-ctx/, .opencode/,
// tool-results/), secret templates (secrets/) and the not-yet-existing
// .agents/ (skills are markdown). None of them run as gates on the VPS or
// in CI, so a range there cannot silently fail an encoding check - adding
// them to the scan would only manufacture false positives, which is the
// opposite of this guard's job. INCLUSIONS decided the same way:
// mini-services/ (deployed backend service code) and .zscripts/
// (operational shell scripts) WERE added to TARGET_DIRS - they are
// executable logic that could carry the fragile-range class.
//
// ENFORCED BY: scripts/__tests__/fragile-range-guard.test.ts - extension
// level (filesInDir/scanDirectory never enumerate .md/.css/.html), the
// docs/ tree contract test, and the parametrized EXCLUSION CONTRACT test
// over EXCLUDED_TREES (TARGET_DIRS never contains the tree AND a synthetic
// root with a dirty TARGET_EXTS file inside the tree stays clean). Plus the
// REVERSE MUTATION tests: they lift the contracts on a temp COPY of this
// module (TARGET_DIRS += docs / TARGET_EXTS += .md) and prove
// scanExecutableCode WOULD trip on the very same fixtures - showing the
// exclusions are enforced by these contracts, not by fixture luck. If a
// future change extends TARGET_EXTS or TARGET_DIRS to cover any of these,
// the contract tests fail and force an explicit rethink.
//
// WHO PROTECTS THE DOCS? - no encoding gate audits docs/ or .md/.css/.html
// (by design). The full coverage matrix and the 2026-08 state (73 .md, 69
// with legit accents, 0 invalid UTF-8) live in docs/ascii-safe.md, section
// "Who protects the docs? (encoding audit coverage)" - the canonical
// answer; this block is the fragile-range-specific slice of it.
// ===========================================================================

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
    offenders.push(...scanFileForFragile(file, path.relative(path.resolve(dir), file)))
  }
  return offenders
}

// Code trees scanned IN ADDITION to gate files by the repo-wide scan: the
// e2e/ playwright specs + helpers and the src/ app code (incl. unit tests /
// test helpers), plus mini-services/ (deployed backend service code, e.g.
// realtime/index.ts) and .zscripts/ (operational dev/build/start shell
// scripts). All are executable code like any gate - a fragile range used
// for byte detection in any of them fails silently the same way as the
// 2026-08 em-dash. Trees deliberately NOT scanned are listed in
// EXCLUDED_TREES below (the DECISION RECORD block above is the WHY).
// Single source for importers (the vitest guard via scanExecutableCode)
// AND for the encoding gate's default targets: verify-encoding.sh layer 3
// and a standalone check-utf8.sh BOTH derive their --dir args from this
// array via `--print-target-dirs` (query mode) - no second copy to keep
// in sync.
export const TARGET_DIRS = ["e2e", "src", "mini-services", ".zscripts"]

/**
 * Root trees EXPLICITLY excluded from the repo-wide scan (in addition to
 * the .md/.css/.html extension exclusion in TARGET_EXTS). Machine-parseable
 * enforcement of the tree-level exclusion decisions - the WHY for each tree
 * lives in the DECISION RECORD block above. Consumed by the guard suite's
 * parametrized EXCLUSION CONTRACT test (one iteration per entry): if a
 * future change adds any of these trees to TARGET_DIRS, the contract test
 * fails and forces an explicit rethink (same posture as the docs/
 * exclusion). NOTE: partially-scanned trees are NOT listed - .github/
 * (workflows + composite actions) and .husky/ (hooks) have their
 * executable YAML/shell scanned as GATE files via gateFiles(), not as
 * target trees.
 */
export const EXCLUDED_TREES = [
  "docs", // documentation prose (a scanned doc quoting the historical pattern would false-positive the repo's own history)
  "public", // static client content (sw.js, manifest, assets) - not gates
  "examples", // illustrative sample code - not gates
  "config", // infra config (e.g. pgbouncer entrypoint) - not encoding gates
  "prisma", // schema/seed/migration infra (populate.ts, seed.ts) - not encoding gates
  "db", // sqlite data
  "download", // user content
  "upload", // user content
  "osrm-data", // routing data
  "agent-ctx", // agent prose (md)
  ".opencode", // agent config prose (md)
  "tool-results", // tool output logs (txt)
  "secrets", // env templates (.example)
  ".agents", // does not exist today; skills are markdown - stays out if it appears
]

/**
 * Scan ALL executable code in the repo: the gate files (gateFiles()) plus
 * every tree in TARGET_DIRS (e2e/, src/). This is the full repo-wide scan
 * the vitest guard pins - the fragile-range class is blocked in playwright
 * specs, test helpers and app code too, not just in encoding gates.
 * @param {string} [root]  repo root (default: resolved from this module)
 * @returns {string[]} offender lines, paths relative to root
 */
export function scanExecutableCode(root = REPO_ROOT) {
  const offenders = scanForFragile(root)
  for (const dir of TARGET_DIRS) {
    const abs = path.join(root, dir)
    if (!existsSync(abs) || !statSync(abs).isDirectory()) continue
    for (const file of filesInDir(abs)) {
      offenders.push(...scanFileForFragile(file, path.relative(root, file)))
    }
  }
  return offenders
}

const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_MAIN) {
  // Query mode: print the default target dirs (TARGET_DIRS, space-joined)
  // and exit 0. verify-encoding.sh layer 3 DERIVES its default --dir args
  // from this output - the module is the single source of truth, so the
  // bash wrapper no longer hardcodes an "e2e/ src/" list that could drift
  // (adding a dir to TARGET_DIRS picks it up in every gate automatically).
  // Standalone ONLY: combining it with scan flags would silently drop the
  // query intent, so that combination is a usage error - the same
  // no-silent-ignore posture every gate in this repo keeps.
  if (process.argv.includes("--print-target-dirs")) {
    if (process.argv.length > 3) {
      process.stderr.write(
        "usage: node scripts/fragile-range-patterns.mjs --print-target-dirs (standalone query; not combinable with other flags)\n",
      )
      process.exit(2)
    }
    process.stdout.write(TARGET_DIRS.join(" ") + "\n")
    process.exit(0)
  }
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
