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
 * Scope (gateFiles(), shared with the module):
 *   - scripts/*.sh, scripts/*.mjs, scripts/*.py, scripts/*.ps1
 *   - root *.sh supervisor scripts
 *   - .husky/pre-commit, .husky/pre-push
 *   - .github/workflows/*.yml (run blocks are bash — fragile patterns there
 *     are real gates)
 *
 * Excluded by design: scripts/__tests__/ — that is where the historical bug
 * is documented and where the scanner's immunity is proven with the very
 * patterns this guard hunts.
 */
import { afterEach, describe, it, expect } from "vitest"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import {
  FRAGILE_PATTERNS,
  stripComments,
  gateFiles,
  scanForFragile,
  filesInDir,
  scanDirectory,
} from "../fragile-range-patterns.mjs"
import { cleanupTempDirs, createTempDir } from "./golden-copy-utils"

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
function runCli(args: string[] = []) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

describe("fragile-range guard (class closure for the 2026-08 em-dash bug)", () => {
  it("repo-wide: no fragile character-class range in live gate code", () => {
    const offenders = scanForFragile(ROOT)
    expect(offenders, `fragile range patterns in LIVE gate code:\n${offenders.join("\n")}`).toEqual([])
  })

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

    it("--dir clean target: exit 0 and the verdict counts the target files", () => {
      const dir = createTempDir("frg-cli-clean-")
      writeFile(dir, "e2e/ok.spec.ts", "import { test } from '@playwright/test'\ntest('ok', () => {})\n")
      const r = runCli(["--ci", "--dir", dir])
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
      const r = runCli(["--ci", "--dir", dir])
      expect(r.status).toBe(1)
      expect(r.stderr).toContain("fragile-range:")
      expect(r.stderr).toContain("space-tilde character range")
      expect(r.stderr).toContain(path.join("e2e", "dirty.spec.ts"))
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
      // __tests__ excluded by design (historical-bug docs live there).
      expect(files.some((f) => rel(f).includes("__tests__"))).toBe(false)
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
