/**
 * fragile-range-guard.test.ts — closes the CLASS of the 2026-08 em-dash bug.
 *
 * History: an em-dash slipped into scripts/health-check.sh because the
 * encoding gate used `grep -n '[^ -~]'` — a locale-dependent
 * character-class RANGE that fails SILENTLY (no hits, non-zero confidence).
 * The fix was scripts/scan-non-ascii.mjs: raw BYTE iteration, no pattern to
 * break, immune to LC_ALL and to range-quoting quirks.
 *
 * But fixing ONE instance is not enough: the fragile-range CLASS can
 * reintroduce itself through any future gate (a new .sh checker, an inline
 * grep in a workflow run block, a sed/perl one-liner). This suite guards
 * the class: it scans every gate-relevant file in the repo and FAILS if a
 * fragile character-class range pattern appears in LIVE code. Comments are
 * stripped first, so the historical documentation (and the immunity tests in
 * scan-non-ascii.test.ts) stays exempt — the guard hunts runtime code, not
 * prose.
 *
 * The patterns live in scripts/fragile-range-patterns.mjs (importable, with
 * a --ci CLI). This suite imports them — it is NOT a second copy. The SAME
 * module is wired into the encoding gate itself (verify-encoding.sh layer 3)
 * so the class is blocked even when the gate runs without vitest.
 *
 * Scope (scanExecutableCode(), shared with the module — the FULL executable
 * code surface, not just encoding gates):
 *   - gate files: scripts/*.sh, scripts/*.mjs, scripts/*.ts, scripts/*.py,
 *     scripts/*.ps1, root *.sh, .husky hooks, .github/workflows/*.yml,
 *     and composite actions under .github/actions (action.yml - executable
 *     run blocks, same class as workflows)
 *   - scripts/__tests__ NON-TEST helpers (e.g. golden-copy-utils.ts — a
 *     subprocess runner): executable code in the gate class, so it is
 *     scanned too.
 *   - TARGET_DIRS: e2e/ (playwright specs + helpers), src/ (app code, unit
 *     tests, test helpers), mini-services/ (deployed backend service code)
 *     and .zscripts/ (operational dev/build/start shell scripts) — a
 *     fragile range used for byte detection in any of them is the SAME bug
 *     class as the 2026-08 em-dash, so it must be blocked there too.
 *
 * Excluded by design: the .test.* SPECS in the __tests__ trees (scripts
 * and under src) — that is where the historical bug is documented and
 * where the scanner's immunity is proven with the very patterns this guard
 * hunts (their string-literal fixtures would trip the scan on themselves),
 * plus the fixtures/ tree (test data, not executable gates). (Note: the
 * glob is written without a literal star-slash so this docblock stays a
 * comment.)
 *
 * NOT scanned (decision record: fragile-range-patterns.mjs — the DECISION
 * RECORD block just below TARGET_EXTS is CANONICAL; the rationale lives
 * there, not duplicated here). Exclusions: the docs/ TREE and the
 * .md/.css/.html EXTENSIONS. docs/ is deliberately NOT a TARGET_DIR and
 * .md is NOT a TARGET_EXTS entry; if a future change adds either, the
 * contract tests below fail and force an explicit rethink.
 *
 * REAL-REPO CLEAN CONTRACT (the REAL-SURFACE tests' baseline): the tests
 * that DO scan real surface - the repo-wide scan, the BASELINE test below
 * (explicit count === 0), the REAL-REPO CONTRACT --dir MULTI-ARG test
 * (pins +476 target files) and the plain clean-verdict CLI runs
 * (runCli(["--ci"]) / runCli([])) - assume the REAL repo has ZERO fragile
 * ranges TODAY (scanExecutableCode(ROOT) has no offenders). This is a
 * DELIBERATE contract, not an accident: a synthetic proof is only
 * meaningful when the real surface cannot be the failure source, so a
 * fragile range landing in real scanned code (src/, e2e/, a gate file) is
 * SUPPOSED to break THOSE tests loudly - that is the live-regression
 * signal, owned by the BASELINE test below (which pins the count at 0).
 * The fix is never to weaken a pin: write byte-safe code with
 * scripts/scan-non-ascii.mjs (raw byte iteration, no pattern to break),
 * or move a legitimate pattern-carrying fixture into an EXCLUDED zone
 * (fixtures/, __tests__, a .test.* spec) - never into scanned live code.
 * The SYNTHETIC count-pin tests are hermetic by construction: the CLI
 * --dir dirty/clean pair AND the FRAGILE_SCAN_ROOT dirty gate-file test
 * set FRAGILE_SCAN_ROOT (synthetic root) so they scan ZERO real surface
 * (a real-repo regression can never flip their pin or masquerade as
 * their proof), and the wrapper mutation tests set BOTH layer-3
 * overrides (FRAGILE_SCAN_ROOT + FRAGILE_SCAN_DIRS) the same way.
 */
import { afterEach, describe, it, expect } from "vitest"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import {
  FRAGILE_PATTERNS,
  EXCLUDED_TREES,
  stripComments,
  gateFiles,
  scanForFragile,
  filesInDir,
  scanDirectory,
  TARGET_DIRS,
  scanExecutableCode,
} from "../fragile-range-patterns.mjs"
import {
  cleanupTempDirs,
  createTempDir,
  expectSoleFailureCount,
  patchModuleCopy,
  runReverseMutation,
  runSubprocess,
} from "./golden-copy-utils"

const ROOT = process.cwd()
const SCRIPT = path.resolve(ROOT, "scripts", "fragile-range-patterns.mjs")

function writeFile(dir: string, rel: string, content: string): string {
  const p = path.join(dir, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
  return p
}

afterEach(() => {
  cleanupTempDirs()
})

/** Run the module's CLI; returns status + stdout + stderr. */
function runCli(args: string[] = [], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, ...env },
  })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

// REVERSE-MUTATION harness (patchModuleCopy / runReverseMutation) lives in
// golden-copy-utils.ts - shared with the WRAPPER-level reverse mutation in
// verify-encoding.test.ts (which uses patchModuleFile + FRAGILE_MODULE).
// Both write a temp COPY of the real module with the scan-scope contracts
// LIFTED (docs/ injected into TARGET_DIRS, optionally .md appended to
// TARGET_EXTS) and re-execute the REAL code with the lifted constants - an
// export-level vi.mock could never change the binding scanExecutableCode
// reads. The patch anchors are asserted so a module drift FAILS LOUDLY.

describe("fragile-range guard (class closure for the 2026-08 em-dash bug)", () => {
  it("repo-wide: no fragile character-class range in live executable code (gate files + e2e/ + src/)", () => {
    const offenders = scanExecutableCode(ROOT)
    expect(offenders, `fragile range patterns in LIVE executable code:\n${offenders.join("\n")}`).toEqual([])
  }, 60000)

  it("BASELINE: the real repo has ZERO fragile ranges - the explicit count the REAL-SURFACE tests depend on", () => {
    // The REAL-SURFACE tests - repo-wide scan, REAL-REPO CONTRACT --dir
    // MULTI-ARG, and the plain clean-verdict CLI runs - rely on the REAL
    // repo being clean: a synthetic proof is only meaningful when the real
    // surface cannot be the failure source. (The count-pin dirty tests are
    // HERMETIC by construction via FRAGILE_SCAN_ROOT - they do NOT depend
    // on this baseline.) THIS test pins the baseline explicitly as a
    // COUNT (=== 0) - if a fragile range lands in real scanned code (even
    // "legitimately", e.g. a fixture quoting the historical pattern
    // OUTSIDE an excluded zone), it fails with the offender list and the
    // pin flips loudly, forcing a conscious decision instead of a
    // confusing 1->2 flip in some unrelated dirty test. Same root as the
    // repo-wide test above, stated as the contract the real-surface tests
    // depend on (see the REAL-REPO CLEAN CONTRACT paragraph in the suite
    // docblock).
    const offenders = scanExecutableCode(ROOT)
    expect(offenders, `real-repo baseline broken - fragile ranges in scanned live code:\n${offenders.join("\n")}`).toHaveLength(0)
  }, 60000)

  it("mutation: a [^ -~] range injected into live .sh code trips the guard", () => {
    const live = stripComments('#!/bin/bash\nif grep -q "[^ -~]" file; then exit 1; fi\n', "sh")
    expect(FRAGILE_PATTERNS.some(({ re }) => re.test(live))).toBe(true)
  })

  it("mutation: the same pattern inside a comment does NOT trip the guard", () => {
    const live = stripComments("# [^ -~] historical bug doc\necho ok\n", "sh")
    expect(FRAGILE_PATTERNS.some(({ re }) => re.test(live))).toBe(false)
  })

  it("mutation: a hex-escape range [\\x80-\\xFF] in live mjs code trips the guard", () => {
    const live = stripComments("const re = /[\\x80-\\xFF]/;\n", "mjs")
    expect(FRAGILE_PATTERNS.some(({ re }) => re.test(live))).toBe(true)
  })

  it("mutation: a POSIX [:print:] class in a workflow run block trips the guard", () => {
    const live = stripComments("      - name: Gate\n        run: |\n          grep -E '[^[:print:]]' file\n", "yml")
    expect(FRAGILE_PATTERNS.some(({ re }) => re.test(live))).toBe(true)
  })

  it("mutation: legit PCRE extraction (grep -oP '\\d+') does NOT trip the guard", () => {
    // fail2ban/security-headers use -oP for port/IP parsing — not a fragile
    // byte-range, so the guard must let it through (no character range).
    const live = stripComments("local maxretry=$(grep -oP '\\d+' file || echo 0)\n", "sh")
    expect(FRAGILE_PATTERNS.some(({ re }) => re.test(live))).toBe(false)
  })

  it("mutation: PCRE combined flag WITH a range (grep -qP '[^ -~]') trips the guard", () => {
    const live = stripComments('grep -qP "[^ -~]" file && echo bad\n', "sh")
    expect(FRAGILE_PATTERNS.some(({ re }) => re.test(live))).toBe(true)
  })

  it("mutation: PCRE brace-hex range ([\\x{80}-\\x{FF}]) trips ONLY via the grep -P pattern", () => {
    // PCRE brace-hex `\x{80}` is the ONE form pattern 2 (\xNN, exactly 2
    // hex digits) cannot catch — so this fixture isolates pattern 4's
    // unique contribution: no pattern 1/2/3 match, only grep -P + range.
    const live = stripComments("grep -P '[\\x{80}-\\x{FF}]' file\n", "sh")
    const matches = FRAGILE_PATTERNS.filter(({ re }) => re.test(live)).map(({ label }) => label)
    expect(matches).toEqual(["grep -P / rg -P with character-class range"])
  })

  it("mutation: a fragile range inside a Python docstring does NOT trip the guard", () => {
    // Python docstrings are comments — the historical-bug mention in
    // check_utf8.py's module docstring must stay exempt (same rule as /* */
    // in scan-non-ascii.mjs).
    const live = stripComments(
      '"""\ncheck_utf8.py - the `[^ -~]` grep failed silently in 2026-08.\n"""\nprint(1)\n',
      "py",
    )
    expect(FRAGILE_PATTERNS.some(({ re }) => re.test(live))).toBe(false)
  })

  it("mutation: a fragile range in LIVE Python code (outside a docstring) trips the guard", () => {
    const live = stripComments('"""module docstring"""\npattern = re.compile("[^ -~]")\n', "py")
    expect(FRAGILE_PATTERNS.some(({ re }) => re.test(live))).toBe(true)
  })

  describe("CLI (the encoding-gate wiring: same patterns, no vitest needed)", () => {
    it("--print-target-dirs: prints TARGET_DIRS space-joined (the wrapper's derivation source)", () => {
      // verify-encoding.sh layer 3 derives its default --dir targets from
      // this output - the module is the single source of truth, so the
      // wrapper never hardcodes a second "e2e/ src/" list. Pinning the
      // exact output to the exported array closes the drift the manual
      // sync used to allow.
      const r = runCli(["--print-target-dirs"])
      expect(r.status).toBe(0)
      expect(r.stdout.trim()).toBe(TARGET_DIRS.join(" "))
    })

    it("--print-target-dirs combined with other flags: exit 2 (standalone query only)", () => {
      // The query is a pure derivation source - combining it with scan
      // flags would silently drop the query intent, so it is a usage
      // error (the same no-silent-ignore posture the wrapper keeps for
      // --sync).
      const r = runCli(["--ci", "--print-target-dirs"])
      expect(r.status).toBe(2)
      expect(r.stderr).toContain("usage:")
    })

    it("exit 0 with a clean verdict on the real repo", () => {
      const r = runCli(["--ci"])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("fragile-range: clean")
    }, 60000)

    it("usage error (exit 2) when given an unexpected positional arg", () => {
      const r = runCli(["file.sh"])
      expect(r.status).toBe(2)
      expect(r.stderr).toContain("usage:")
    })

    it("exit 0 without --ci too (verdict identical; --ci only documents intent)", () => {
      const r = runCli([])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("fragile-range: clean")
    }, 60000)

    it("REAL-REPO CONTRACT: --dir MULTI-ARG (all TARGET_DIRS trees) exits 0 and pins the target-file count", () => {
      // Runs the FULL user-facing form against the REAL repo - not a
      // synthetic tempdir - so the verdict locks in the actual executable
      // surface the encoding gate audits (verify-encoding.sh layer 3 derives
      // its --dir targets from TARGET_DIRS, exactly this set). The dir list
      // is DERIVED from the imported TARGET_DIRS export (spread after the
      // --dir flag) - never a literal second "e2e/ src/" list in the test
      // that could silently omit a new tree if TARGET_DIRS grows (the same
      // single-source-of-truth contract the wrapper keeps). The count is a
      // CONTRACT: if a new code file lands in any TARGET_DIR tree, this
      // assertion fails and forces an explicit decision (same frozen-surface
      // posture as the ascii-safe baseline and the FRAGILE_SCAN_ROOT
      // count-pin).
      const r = runCli(["--ci", "--dir", ...TARGET_DIRS])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("fragile-range: clean")
      // Verdict shape: "clean (109 gate files + 476 target files, ...)".
      expect(r.stdout).toContain("+ 476 target files")
    }, 60000)

    it("--dir clean target: exit 0 and the verdict counts the target files", () => {
      const dir = createTempDir("frg-cli-clean-")
      writeFile(dir, "e2e/ok.spec.ts", "import { test } from '@playwright/test'\ntest('ok', () => {})\n")
      // HERMETIC like its dirty sibling: FRAGILE_SCAN_ROOT redirects the
      // gate-file scan to the synthetic root, so the clean verdict is
      // unconditional (not contingent on the real repo staying clean) and
      // the "+ 1 target file" count is the only surface asserted.
      const r = runCli(["--ci", "--dir", dir], { FRAGILE_SCAN_ROOT: dir })
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("fragile-range: clean")
      expect(r.stdout).toContain("+ 1 target file")
    }, 60000)

    it("--dir dirty target: exit 1 with the offender path + label on stderr", () => {
      const dir = createTempDir("frg-cli-dirty-")
      writeFile(
        dir,
        "e2e/dirty.spec.ts",
        "import { test } from '@playwright/test'\ntest('x', () => { console.log(/[^ -~]/) })\n",
      )
      // HERMETIC by construction (same posture as the wrapper mutation
      // tests): FRAGILE_SCAN_ROOT redirects the gate-file scan to the
      // synthetic root (0 gate files there), so the ONLY failure source is
      // the synthetic dirty spec - the count-pin is unconditional and a
      // real-repo regression can never flip it or masquerade as this
      // proof. Live gate-regression coverage belongs to the repo-wide /
      // BASELINE / REAL-REPO CONTRACT / plain clean-verdict CLI tests.
      const r = runCli(["--ci", "--dir", dir], { FRAGILE_SCAN_ROOT: dir })
      expect(r.status).toBe(1)
      expect(r.stderr).toContain("fragile-range:")
      expect(r.stderr).toContain("space-tilde character range")
      expect(r.stderr).toContain(path.join("e2e", "dirty.spec.ts"))
      expectSoleFailureCount(r.stderr, 1)
    })

    it("--dir missing target: exit 2 (no silent ignore of a mistyped path)", () => {
      const missing = path.join(createTempDir("frg-cli-missing-"), "nope")
      const r = runCli(["--ci", "--dir", missing])
      expect(r.status).toBe(2)
      expect(r.stderr).toContain("--dir target not found")
    })

    it("--dir pointing at a FILE: exit 2, not an ENOTDIR stack trace", () => {
      const dir = createTempDir("frg-cli-file-")
      const file = writeFile(dir, "plain.ts", "export const x = 1\n")
      const r = runCli(["--ci", "--dir", file])
      expect(r.status).toBe(2)
      expect(r.stderr).toContain("not a directory")
      expect(r.stderr).not.toContain("ENOTDIR")
    })

    it("--dir without a path argument: exit 2 usage error", () => {
      const r = runCli(["--dir"])
      expect(r.status).toBe(2)
      expect(r.stderr).toContain("--dir requires at least one path")
    })

    it("--dir MULTI-ARG form (--dir a b): both targets scanned, one dirty trips exit 1", () => {
      // The user-facing example "--dir e2e/ src/" is one flag with several
      // paths - every non-flag token after --dir is a target dir.
      const cleanDir = createTempDir("frg-cli-clean-")
      writeFile(cleanDir, "ok.ts", "export const ok = 1\n")
      const dirtyDir = createTempDir("frg-cli-dirty-")
      writeFile(dirtyDir, "bad.ts", "const re = /[^ -~]/\n")
      const r = runCli(["--ci", "--dir", cleanDir, dirtyDir])
      expect(r.status).toBe(1)
      expect(r.stderr).toContain("space-tilde character range")
      expect(r.stderr).toContain(path.join("bad.ts"))
    })
  })

  describe("CLI (FRAGILE_SCAN_ROOT env override: synthetic root, no wrapper)", () => {
    it("dirty gate file in the synthetic root: exit 1 with the offender path + label on stderr", () => {
      // FRAGILE_SCAN_ROOT redirects the module's repo scan (gateFiles +
      // scanForFragile) to a synthetic tree - the same override
      // verify-encoding.sh passes through to layer 3. This test is
      // self-proving: the REAL repo is clean today, so a status-1 verdict
      // can only come from the synthetic gate file, never from the real
      // one.
      const dir = createTempDir("frg-cli-root-dirty-")
      writeFile(
        dir,
        "scripts/foo.sh",
        "#!/usr/bin/env bash\nif grep -n '[^ -~]' file; then exit 1; fi\n",
      )
      const r = runCli(["--ci"], { FRAGILE_SCAN_ROOT: dir })
      expect(r.status).toBe(1)
      expect(r.stderr).toContain("fragile-range:")
      expect(r.stderr).toContain("space-tilde character range")
      // Offender path is relative to the synthetic root (platform
      // separator - compare with path.join).
      expect(r.stderr).toContain(path.join("scripts", "foo.sh"))
      // Count pinned to 1 (mirrors the clean test's "(1 gate files" pin):
      // HERMETIC by construction - FRAGILE_SCAN_ROOT redirects the scan to
      // the synthetic root (the real repo is never scanned), so the ONLY
      // failure source is the synthetic gate file and a real-repo
      // regression CANNOT affect (or masquerade as) this proof.
      expectSoleFailureCount(r.stderr, 1)
    })

    it("clean synthetic root: exit 0 with the clean verdict (override points at a clean tree)", () => {
      const dir = createTempDir("frg-cli-root-clean-")
      writeFile(dir, "scripts/ok.sh", "#!/usr/bin/env bash\necho ok\n")
      const r = runCli(["--ci"], { FRAGILE_SCAN_ROOT: dir })
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("fragile-range: clean")
      // The override must REPLACE the real repo scan, not add to it - the
      // verdict counts ONLY the synthetic tree's 1 gate file (the real repo
      // has ~106, so this proves the redirect happened).
      expect(r.stdout).toContain("(1 gate files")
      expect(r.stdout).not.toContain("fragile character-class range(s)")
    })
  })

  describe("target scanning (--dir: e2e/ and src/ files, not just gate files)", () => {
    it("filesInDir() walks a tree recursively and skips vendored/hidden/__test dirs", () => {
      const dir = createTempDir("frg-filesindir-")
      const app = writeFile(dir, "src/app/page.tsx", "export default function Page() { return null }\n")
      writeFile(dir, "e2e/home.spec.ts", "import { test } from '@playwright/test'\n")
      writeFile(dir, "node_modules/pkg/index.ts", "export const x = 1\n")
      writeFile(dir, "src/__tests__/x.test.ts", "it('x', () => {})\n")
      writeFile(dir, ".next/server/app/page.js", "exports.page = 1\n")
      const files = filesInDir(dir)
      const rel = (f: string) => path.relative(dir, f).split(path.sep).join("/")
      expect(files.map(rel).sort()).toEqual(["e2e/home.spec.ts", "src/app/page.tsx"])
      expect(files).toContain(app)
    })

    it("scanDirectory() finds a fragile range in a nested app file, path relative to the target dir", () => {
      const dir = createTempDir("frg-scandir-")
      writeFile(dir, "src/ok.ts", "export const ok = 1\n")
      expect(scanDirectory(dir)).toEqual([])
      writeFile(dir, "src/bad.tsx", "const re = /[^ -~]/\n")
      const offs = scanDirectory(dir)
      expect(offs.length).toBe(1)
      expect(offs[0]).toContain("space-tilde character range")
      // path.relative -> platform separator; compare with path.join.
      expect(offs[0]).toContain(path.join("src", "bad.tsx"))
    })

    it("stripComments handles app extensions (js/jsx/tsx): comments do not trip, live code does", () => {
      const commented = stripComments("// [^ -~] doc\nconst re = /x/\n", "tsx")
      expect(FRAGILE_PATTERNS.some(({ re }) => re.test(commented))).toBe(false)
      const live = stripComments("const re = /[^ -~]/\n", "jsx")
      expect(FRAGILE_PATTERNS.some(({ re }) => re.test(live))).toBe(true)
    })

    it("EXCLUSION CONTRACT: a space-tilde range in a .md/.css/.html file does NOT trip (prose/content, not gates)", () => {
      // Contract pinned (decision + WHY: canonical record in
      // fragile-range-patterns.mjs, the DECISION RECORD block just below
      // TARGET_EXTS): if a future change extends TARGET_EXTS to
      // .md/.css/.html, this test fails and forces an explicit rethink.
      // (A scanned .md quoting the historical pattern would false-positive
      // the repo's own docs - the rationale lives in the canonical block.)
      const dir = createTempDir("frg-ext-exclusion-")
      writeFile(dir, "docs/dirty.md", "the historical bug used `grep -n '[^ -~]'`\n")
      writeFile(dir, "src/styles.css", "/* [^ -~] comment */\nbody { color: red }\n")
      writeFile(dir, "public/index.html", "<!-- [^ -~] -->\n<p>hi</p>\n")
      // filesInDir must not even enumerate these extensions.
      expect(filesInDir(dir)).toEqual([])
      expect(scanDirectory(dir)).toEqual([])
    })

    it("EXCLUSION CONTRACT (docs/ TREE): a .md with [^ -~] under docs/ does NOT trip the full repo scan", () => {
      // The extension-level exclusion above (.md not in TARGET_EXTS) already
      // keeps docs/ out of filesInDir — but it does not pin the docs/ TREE
      // itself. This closes the tree-level case the extension exclusion
      // leaves open: docs/ is NOT a TARGET_DIR, so the FULL repo-wide scan
      // (scanExecutableCode — what the CI actually runs) never enters the
      // tree, even if a future change extended TARGET_EXTS to .md. The
      // synthetic repo mirrors the real TARGET_DIRS (e2e/ + src/ clean)
      // PLUS a docs/ tree carrying the historical bug quote — the verdict
      // must stay clean, proving docs/ is excluded at the TREE level, not
      // just by extension. When the repo gains more docs, this contract
      // stays green BY DESIGN — a doc can never become a silent gap.
      const dir = createTempDir("frg-ext-docs-tree-")
      fs.mkdirSync(path.join(dir, "scripts"), { recursive: true })
      fs.mkdirSync(path.join(dir, "e2e"), { recursive: true })
      fs.mkdirSync(path.join(dir, "src"), { recursive: true })
      fs.mkdirSync(path.join(dir, "docs"), { recursive: true })
      writeFile(dir, "scripts/ok.sh", "#!/usr/bin/env bash\necho ok\n")
      writeFile(dir, "e2e/ok.spec.ts", "import { test } from '@playwright/test'\ntest('ok', () => {})\n")
      writeFile(dir, "src/ok.ts", "export const ok = 1\n")
      writeFile(dir, "docs/dirty.md", "the historical bug used `grep -n '[^ -~]'`\n")
      // Sole-failure-source proof: the fixture is GENUINELY dirty (the
      // space-tilde pattern would match if scanned) - so the clean verdict
      // below is attributable to the docs/ exclusion, not to an inert
      // fixture. If the exclusion ever silently breaks, this test fails
      // with the real reason.
      expect(FRAGILE_PATTERNS.some(({ re }) => re.test("the historical bug used `grep -n '[^ -~]'`"))).toBe(true)
      // Contract: docs/ must never enter TARGET_DIRS (if it does, a doc
      // quoting the historical pattern would trip the repo-wide scan).
      expect(TARGET_DIRS).not.toContain("docs")
      expect(scanExecutableCode(dir)).toEqual([])
    })

    it("EXCLUSION CONTRACT (parametrized over EXCLUDED_TREES): every explicitly-excluded root tree stays out of the scan", () => {
      // One parametrized contract for EVERY tree-level exclusion decision
      // (the machine list in fragile-range-patterns.mjs, the WHY in its
      // DECISION RECORD block): (a) TARGET_DIRS must never contain the
      // tree, and (b) a synthetic root with a dirty TARGET_EXTS file INSIDE
      // that tree must NOT trip the full repo scan - the tree is excluded
      // at the TREE level, not by extension. If a future change adds any of
      // these trees to TARGET_DIRS, this fails and forces an explicit
      // rethink (same posture as the docs/ tree contract above).
      // Sole-failure-source proof: the dirty fixture genuinely matches a
      // fragile pattern, so a clean verdict is attributable to the tree
      // exclusion, not to an inert fixture.
      const dirty = "const re = /[^ -~]/\n"
      expect(FRAGILE_PATTERNS.some(({ re }) => re.test(dirty))).toBe(true)
      for (const tree of EXCLUDED_TREES) {
        expect(TARGET_DIRS, `${tree} must never be a TARGET_DIR`).not.toContain(tree)
        const dir = createTempDir("frg-excl-tree-")
        fs.mkdirSync(path.join(dir, "scripts"), { recursive: true })
        fs.mkdirSync(path.join(dir, "e2e"), { recursive: true })
        fs.mkdirSync(path.join(dir, "src"), { recursive: true })
        writeFile(dir, "scripts/ok.sh", "#!/usr/bin/env bash\necho ok\n")
        writeFile(dir, "e2e/ok.spec.ts", "import { test } from '@playwright/test'\ntest('ok', () => {})\n")
        writeFile(dir, "src/ok.ts", "export const ok = 1\n")
        writeFile(dir, `${tree}/dirty.ts`, dirty)
        expect(scanExecutableCode(dir), `${tree} leaked into the repo-wide scan`).toEqual([])
      }
    })
  })

  describe("REVERSE MUTATION (the exclusions are contracts, not luck: lifting TARGET_DIRS/TARGET_EXTS makes the scan trip)", () => {
    it("TARGET_DIRS += docs (temp module copy) makes scanExecutableCode trip on a dirty .ts inside docs/", () => {
      // The mirror of the EXCLUSION CONTRACT tests: they prove docs/ stays
      // clean because TARGET_DIRS never contains it - but a synthetic proof
      // is only meaningful if the CONTRACT is what does the work, not the
      // fixture being inert. This mutation LIFTS the contract on a temp
      // COPY of the real module (source-patched, re-executed as a real node
      // process - scanExecutableCode closes over the module-scope
      // TARGET_DIRS, so an export-level vi.mock could never lift it) and
      // proves the SAME dirty .ts the EXCLUSION CONTRACT test keeps out
      // trips the moment docs/ becomes a target. Sole-failure-source: the
      // synthetic root's gate files + e2e/ + src/ are clean; the ONLY
      // offender is docs/dirty.ts.
      const dir = createTempDir("frg-rev-tree-")
      fs.mkdirSync(path.join(dir, "scripts"), { recursive: true })
      fs.mkdirSync(path.join(dir, "e2e"), { recursive: true })
      fs.mkdirSync(path.join(dir, "src"), { recursive: true })
      fs.mkdirSync(path.join(dir, "docs"), { recursive: true })
      writeFile(dir, "scripts/ok.sh", "#!/usr/bin/env bash\necho ok\n")
      writeFile(dir, "e2e/ok.spec.ts", "import { test } from '@playwright/test'\ntest('ok', () => {})\n")
      writeFile(dir, "src/ok.ts", "export const ok = 1\n")
      writeFile(dir, "docs/dirty.ts", "const re = /[^ -~]/\n")
      // Control: the REAL module keeps docs/ out (the contract the
      // parametrized EXCLUSION CONTRACT test pins).
      expect(scanExecutableCode(dir)).toEqual([])
      // Mutation: docs/ injected into TARGET_DIRS -> the scan trips.
      const runner = patchModuleCopy({ targetDirs: [...TARGET_DIRS, "docs"] })
      const r = runReverseMutation(runner, dir)
      expect(r.status).toBe(1)
      const offs: string[] = JSON.parse(r.stdout)
      expect(offs).toHaveLength(1)
      expect(offs[0]).toContain("space-tilde character range")
      expect(offs[0]).toContain(path.join("docs", "dirty.ts"))
    })

    it(".md inside docs/ trips only when BOTH contracts are lifted (TARGET_DIRS AND TARGET_EXTS) - the .md exclusion is two-layered", () => {
      // The user-facing premise "inject docs/ into TARGET_DIRS and the .md
      // trips" is only half the story: a .md is kept out by TWO contracts -
      // the TREE (docs/ not in TARGET_DIRS) AND the EXTENSION (.md not in
      // TARGET_EXTS; filesInDir never even enumerates it). Evidence-first
      // verification: lifting ONLY the tree does NOT trip a .md (the
      // extension filter still blocks it), and lifting ONLY the extension
      // does NOT trip either (docs/ is still not a target) - only lifting
      // BOTH makes scanExecutableCode trip on the .md. This pins the
      // two-layered nature of the exclusion the DECISION RECORD documents.
      const dir = createTempDir("frg-rev-md-")
      fs.mkdirSync(path.join(dir, "scripts"), { recursive: true })
      fs.mkdirSync(path.join(dir, "e2e"), { recursive: true })
      fs.mkdirSync(path.join(dir, "src"), { recursive: true })
      fs.mkdirSync(path.join(dir, "docs"), { recursive: true })
      writeFile(dir, "scripts/ok.sh", "#!/usr/bin/env bash\necho ok\n")
      writeFile(dir, "e2e/ok.spec.ts", "import { test } from '@playwright/test'\ntest('ok', () => {})\n")
      writeFile(dir, "src/ok.ts", "export const ok = 1\n")
      writeFile(dir, "docs/dirty.md", "the historical bug used `grep -n '[^ -~]'`\n")
      // Sole-failure-source: the fixture is genuinely dirty (matches a
      // fragile pattern) - a clean verdict can only come from the contract.
      expect(FRAGILE_PATTERNS.some(({ re }) => re.test("the historical bug used `grep -n '[^ -~]'`"))).toBe(true)
      // Control: the REAL module keeps docs/ out.
      expect(scanExecutableCode(dir)).toEqual([])
      // (a) tree-only lift: STILL clean - the extension filter blocks .md.
      const rTree = runReverseMutation(patchModuleCopy({ targetDirs: [...TARGET_DIRS, "docs"] }), dir)
      expect(rTree.status).toBe(0)
      const offsTree: string[] = JSON.parse(rTree.stdout)
      expect(offsTree).toEqual([])
      // (b) extension-only lift: STILL clean - docs/ is not a target.
      const rExt = runReverseMutation(patchModuleCopy({ extsAddMd: true }), dir)
      expect(rExt.status).toBe(0)
      const offsExt: string[] = JSON.parse(rExt.stdout)
      expect(offsExt).toEqual([])
      // (c) both lifted: trips on the .md - the two contracts are
      // complementary, exactly as the DECISION RECORD documents.
      const rBoth = runReverseMutation(patchModuleCopy({ targetDirs: [...TARGET_DIRS, "docs"], extsAddMd: true }), dir)
      expect(rBoth.status).toBe(1)
      const offs: string[] = JSON.parse(rBoth.stdout)
      expect(offs).toHaveLength(1)
      expect(offs[0]).toContain("space-tilde character range")
      expect(offs[0]).toContain(path.join("docs", "dirty.md"))
    })
  })

  describe("full executable-code scope (scanExecutableCode: gate files + TARGET_DIRS)", () => {
    it("TARGET_DIRS covers e2e specs, src/ app code, mini-services and .zscripts", () => {
      expect(TARGET_DIRS).toEqual(["e2e", "src", "mini-services", ".zscripts"])
    })

    it("EXCLUDED_TREES is the frozen list of tree-level exclusions (absolute pin - removal breaks this)", () => {
      // Absolute pin mirroring the TARGET_DIRS toEqual above: the
      // parametrized EXCLUSION CONTRACT test covers the BEHAVIOR of each
      // entry, but silently removing one would just shrink its loop with no
      // test failing. This pins that the 14-tree list stays intact - the
      // WHY for each tree lives in the module's DECISION RECORD.
      expect(EXCLUDED_TREES).toEqual([
        "docs",
        "public",
        "examples",
        "config",
        "prisma",
        "db",
        "download",
        "upload",
        "osrm-data",
        "agent-ctx",
        ".opencode",
        "tool-results",
        "secrets",
        ".agents",
      ])
    })

    it("mutation: a fragile range in a synthetic e2e spec trips scanExecutableCode", () => {
      // Synthetic repo root with the TARGET_DIRS skeleton: gate files clean,
      // but an e2e/ spec carries the space-tilde range in LIVE code - the
      // repo-wide scan (gate files + targets) must surface it with a path
      // relative to the root.
      const dir = createTempDir("frg-exec-")
      fs.mkdirSync(path.join(dir, "scripts"), { recursive: true })
      fs.mkdirSync(path.join(dir, "e2e"), { recursive: true })
      fs.mkdirSync(path.join(dir, "src"), { recursive: true })
      writeFile(dir, "scripts/ok.sh", "#!/usr/bin/env bash\necho ok\n")
      writeFile(
        dir,
        "e2e/headers.spec.ts",
        "import { test } from '@playwright/test'\ntest('h', () => { console.log(/[^ -~]/) })\n",
      )
      const offs = scanExecutableCode(dir)
      expect(offs.length).toBe(1)
      expect(offs[0]).toContain("space-tilde character range")
      expect(offs[0]).toContain(path.join("e2e", "headers.spec.ts"))
    })

    it("mutation: a fragile range in a synthetic src/ helper trips scanExecutableCode", () => {
      const dir = createTempDir("frg-exec-src-")
      fs.mkdirSync(path.join(dir, "scripts"), { recursive: true })
      fs.mkdirSync(path.join(dir, "e2e"), { recursive: true })
      fs.mkdirSync(path.join(dir, "src", "lib"), { recursive: true })
      writeFile(dir, "scripts/ok.sh", "#!/usr/bin/env bash\necho ok\n")
      writeFile(dir, "src/lib/sanitize.ts", "const re = /[\\x80-\\xFF]/\n")
      const offs = scanExecutableCode(dir)
      expect(offs.length).toBe(1)
      expect(offs[0]).toContain("hex-escape byte range")
      expect(offs[0]).toContain(path.join("src", "lib", "sanitize.ts"))
    })

    it("scanExecutableCode on a clean synthetic root: no offenders (target dirs present, clean)", () => {
      const dir = createTempDir("frg-exec-clean-")
      fs.mkdirSync(path.join(dir, "scripts"), { recursive: true })
      fs.mkdirSync(path.join(dir, "e2e"), { recursive: true })
      fs.mkdirSync(path.join(dir, "src"), { recursive: true })
      writeFile(dir, "scripts/ok.sh", "#!/usr/bin/env bash\necho ok\n")
      writeFile(dir, "e2e/ok.spec.ts", "import { test } from '@playwright/test'\ntest('ok', () => {})\n")
      writeFile(dir, "src/ok.ts", "export const ok = 1\n")
      expect(scanExecutableCode(dir)).toEqual([])
    })
  })

  describe("scripts/__tests__ non-test helpers (gate class: scanned like gates)", () => {
    it("mutation: a fragile range in a synthetic __tests__ HELPER trips the scan", () => {
      // golden-copy-utils.ts (subprocess runner) is the live example of a
      // non-test helper that is executable code in the gate class - a
      // fragile range there must be caught even though it lives under
      // __tests__. gateFiles() includes such helpers; only .test.* specs
      // and the fixtures/ tree are exempt.
      const dir = createTempDir("frg-tests-helper-")
      fs.mkdirSync(path.join(dir, "scripts", "__tests__"), { recursive: true })
      writeFile(dir, "scripts/__tests__/helper.ts", "export const re = /[^ -~]/\n")
      const offs = scanForFragile(dir)
      expect(offs.length).toBe(1)
      expect(offs[0]).toContain("space-tilde character range")
      expect(offs[0]).toContain(path.join("scripts", "__tests__", "helper.ts"))
    })

    it("mutation: the same pattern in a synthetic .test.* SPEC does NOT trip (fixture exemption)", () => {
      // The exemption that keeps the suite green: .test.* specs carry the
      // patterns as string-literal fixtures, so scanning them would trip on
      // the tests themselves. The spec must NOT be a gate file.
      const dir = createTempDir("frg-tests-spec-")
      fs.mkdirSync(path.join(dir, "scripts", "__tests__"), { recursive: true })
      writeFile(dir, "scripts/__tests__/x.test.ts", "it('x', () => { const re = /[^ -~]/ })\n")
      expect(scanForFragile(dir)).toEqual([])
    })

    it("mutation: a fragile range in the synthetic fixtures/ tree does NOT trip (test data)", () => {
      const dir = createTempDir("frg-tests-fixtures-")
      fs.mkdirSync(path.join(dir, "scripts", "__tests__", "fixtures"), { recursive: true })
      writeFile(dir, "scripts/__tests__/fixtures/golden.awk", "if (x ~ /[^ -~]/) { print }\n")
      expect(scanForFragile(dir)).toEqual([])
    })
  })

  describe("composite actions (.github/actions - gate files like workflows)", () => {
    it("mutation: a fragile range in a synthetic composite action's run block trips the scan", () => {
      // Composite actions are executable gate logic (the same class as
      // workflows): a fragile range in an action.yml run block must be
      // caught. The real actions (severinno-ssh/-scp) are uses-only wiring
      // with 0 run: blocks today - this pins the CLASS, not their content.
      const dir = createTempDir("frg-actions-")
      writeFile(
        dir,
        ".github/actions/x/action.yml",
        "name: x\nruns:\n  using: composite\n  steps:\n    - run: grep -n '[^ -~]' file\n",
      )
      const offs = scanForFragile(dir)
      expect(offs.length).toBe(1)
      expect(offs[0]).toContain("space-tilde character range")
      expect(offs[0]).toContain(path.join(".github", "actions", "x", "action.yml"))
    })

    it("CONTRACT: .github/ is not a TARGET_DIR tree - its executable YAML is scanned as gate files", () => {
      expect(TARGET_DIRS).not.toContain(".github")
    })
  })

  describe("module shape (single source of truth for the gate wiring)", () => {
    it("gateFiles() enumerates the real gate surface (scripts, root .sh, hooks, workflows)", () => {
      const files = gateFiles(ROOT)
      // Platform-independent check: normalize to forward slashes so the
      // assertion holds on Windows (path.sep = \\ ) and on POSIX alike.
      const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/")
      expect(files.length).toBeGreaterThan(10)
      expect(files.some((f) => rel(f) === "scripts/check-utf8.sh")).toBe(true)
      expect(files.some((f) => rel(f) === ".husky/pre-commit")).toBe(true)
      expect(files.some((f) => rel(f) === ".github/workflows/ci.yml")).toBe(true)
      expect(files.some((f) => rel(f) === ".github/actions/severinno-ssh/action.yml")).toBe(true)
      expect(files.some((f) => rel(f) === ".github/actions/severinno-scp/action.yml")).toBe(true)
      // Non-test helpers in scripts/__tests__ ARE scanned (executable
      // subprocess runners like golden-copy-utils.ts), but .test.* specs
      // and the fixtures/ tree are excluded by design.
      expect(files.some((f) => rel(f) === "scripts/__tests__/golden-copy-utils.ts")).toBe(true)
      expect(files.some((f) => rel(f).includes("__tests__") && rel(f).includes(".test."))).toBe(false)
      expect(files.some((f) => rel(f).includes("__tests__") && rel(f).includes("fixtures"))).toBe(false)
    })

    it("FRAGILE_PATTERNS is a non-empty array of { label, re } entries", () => {
      expect(FRAGILE_PATTERNS.length).toBeGreaterThanOrEqual(4)
      for (const p of FRAGILE_PATTERNS) {
        expect(typeof p.label).toBe("string")
        expect(p.re).toBeInstanceOf(RegExp)
      }
    })
  })
})
