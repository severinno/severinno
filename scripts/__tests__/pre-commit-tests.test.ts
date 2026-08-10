/**
 * Unit tests for scripts/pre-commit-tests.mjs — the targeted-tests runner
 * used by the pre-commit hook (--scope cached, git-staged files) and the
 * pre-push Gate 3 (--scope push, staged + HEAD + pushed-commit range).
 *
 * collectTestFiles is exported pure (entry-point guarded), so it is tested
 * directly with a synthetic fixture tree — no git, no vitest subprocess
 * needed for the mapping logic itself.
 *
 * Covered scenarios (cached scope):
 *   1. Staged *.test.{ts,tsx} files are returned as-is
 *   2. Staged source maps to a same-dir <name>.test.ts sibling
 *   3. Staged source maps to a __tests__/<name>.test.ts sibling
 *   4. Staged scripts/*.mjs maps to scripts/__tests__/<name>.test.ts
 *   5. Staged non-source files (yml/md/json) map to nothing
 *   6. Source without any test file maps to nothing
 *   7. Dedup: two sources sharing one test produce one entry
 *   8. Only existing test files are returned (missing candidate skipped)
 *   9. Staged source DELETION (diff-filter D) maps to its still-existing test
 *  10. Staged DELETED test file (not on disk) is skipped — nothing to run
 */
import { describe, it, expect, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  collectTestFiles,
  isTestFile,
  isSourceFile,
  isValidSince,
  mergePushScope,
  parseArgs,
} from "../pre-commit-tests.mjs"

const tempDirs: string[] = []
afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true })
  }
})

function makeFixture(): { dir: string; write(rel: string, content?: string): void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "precommit-fixture-"))
  tempDirs.push(dir)
  return {
    dir,
    write(rel, content = "export const x = 1;") {
      const p = path.join(dir, rel)
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, content)
    },
  }
}

describe("scripts/pre-commit-tests.mjs mapping", () => {
  it("returns a staged *.test.ts file as-is", () => {
    const f = makeFixture()
    f.write("src/lib/foo.test.ts")
    const got = collectTestFiles(["src/lib/foo.test.ts"], f.dir)
    expect(got).toEqual(["src/lib/foo.test.ts"])
  })

  it("maps a staged source to its same-dir <name>.test.ts sibling", () => {
    const f = makeFixture()
    f.write("src/lib/foo.ts")
    f.write("src/lib/foo.test.ts")
    const got = collectTestFiles(["src/lib/foo.ts"], f.dir)
    expect(got).toEqual(["src/lib/foo.test.ts"])
  })

  it("maps a staged source to a __tests__/<name>.test.ts sibling", () => {
    const f = makeFixture()
    f.write("src/lib/bar.ts")
    f.write("src/lib/__tests__/bar.test.ts")
    const got = collectTestFiles(["src/lib/bar.ts"], f.dir)
    expect(got).toEqual(["src/lib/__tests__/bar.test.ts"])
  })

  it("maps a staged scripts/*.mjs to scripts/__tests__/<name>.test.ts (repo convention)", () => {
    const f = makeFixture()
    f.write("scripts/check-js-budget.mjs")
    f.write("scripts/__tests__/check-js-budget.test.ts")
    const got = collectTestFiles(["scripts/check-js-budget.mjs"], f.dir)
    expect(got).toEqual(["scripts/__tests__/check-js-budget.test.ts"])
  })

  it("maps nothing for staged non-source files (yml/md/json)", () => {
    const f = makeFixture()
    f.write("docs/bundle-report.md")
    f.write(".github/workflows/ci.yml")
    f.write("package.json")
    const got = collectTestFiles(["docs/bundle-report.md", ".github/workflows/ci.yml", "package.json"], f.dir)
    expect(got).toEqual([])
  })

  it("maps NOTHING for a staged gate file .sh even when its heavy co-located suite exists (sec 11.15 - the co-location cost guard)", () => {
    // The Gate 3 cost guard (scan-push-full-suite GATE_CONTRACT #5, sec
    // 11.15) pins the mapper's SOURCE_RE surface (ts/tsx/mjs) so a gate
    // file like verify-encoding.sh maps to no suite. This test pins the
    // SAME class at the mapper level, closing the bypass that the
    // declaration pin alone would miss: a special-case in collectTestFiles
    // (e.g. rel.endsWith(".sh")) that mapped gate files to their
    // co-located heavy suite (scripts/__tests__/verify-encoding.test.ts,
    // ~36.5s - sec 11.14) would make EVERY gate-file push pay the worst
    // case (~77s) without touching SOURCE_RE. Belt-and-suspenders with
    // the declaration pin: the .sh file IS present on disk (written) and
    // its co-located test EXISTS - the mapping must still be empty.
    const f = makeFixture()
    f.write("scripts/verify-encoding.sh")
    f.write("scripts/__tests__/verify-encoding.test.ts") // the heavy suite exists on disk
    const got = collectTestFiles(["scripts/verify-encoding.sh"], f.dir)
    expect(got).toEqual([])
  })

  it("maps nothing when the staged source has no test file", () => {
    const f = makeFixture()
    f.write("src/lib/only-source.ts") // no test sibling anywhere
    const got = collectTestFiles(["src/lib/only-source.ts"], f.dir)
    expect(got).toEqual([])
  })

  it("dedupes: a staged source and its staged test produce a single entry", () => {
    const f = makeFixture()
    f.write("src/lib/foo.ts")
    f.write("src/lib/foo.test.ts")
    // foo.ts maps to foo.test.ts (same-dir sibling) AND foo.test.ts is staged
    // as-is — the Set must collapse them into one entry.
    const got = collectTestFiles(["src/lib/foo.ts", "src/lib/foo.test.ts"], f.dir)
    expect(got).toEqual(["src/lib/foo.test.ts"])
  })

  it("skips test candidates that do not exist on disk", () => {
    const f = makeFixture()
    f.write("src/lib/foo.ts")
    // No foo.test.ts exists — the missing candidate must be skipped, not thrown.
    const got = collectTestFiles(["src/lib/foo.ts"], f.dir)
    expect(got).toEqual([])
  })

  it("maps a staged source DELETION (diff-filter D) to its still-existing test", () => {
    const f = makeFixture()
    // Source was removed from disk, but its co-located test remains staged
    // history — the test must still run (it fails loudly on the missing import).
    f.write("src/lib/foo.test.ts")
    const got = collectTestFiles(["src/lib/foo.ts"], f.dir)
    expect(got).toEqual(["src/lib/foo.test.ts"])
  })

  it("skips a staged DELETED test file (not on disk — nothing to run)", () => {
    const f = makeFixture()
    // The test itself was removed: passing its path to vitest would error,
    // so the mapping must drop it entirely.
    const got = collectTestFiles(["src/lib/foo.test.ts"], f.dir)
    expect(got).toEqual([])
  })

  it("classifies test vs source files", () => {
    expect(isTestFile("src/lib/foo.test.tsx")).toBe(true)
    expect(isTestFile("src/lib/foo.test.ts")).toBe(true)
    expect(isSourceFile("src/lib/foo.ts")).toBe(true)
    expect(isSourceFile("scripts/foo.mjs")).toBe(true)
    expect(isSourceFile("src/lib/foo.test.ts")).toBe(false)
    expect(isSourceFile("README.md")).toBe(false)
  })
})

describe("scripts/pre-commit-tests.mjs push scope (pre-push Gate 3)", () => {
  it("parseArgs: defaults to cached scope with no args (pre-commit behavior)", () => {
    expect(parseArgs([])).toEqual({ scope: "cached", since: null })
  })

  it("parseArgs: reads --scope push and --since", () => {
    expect(parseArgs(["--scope", "push", "--since", "abc123def"])).toEqual({
      scope: "push",
      since: "abc123def",
    })
  })

  it("parseArgs: unknown scope falls back to cached (never silently invents a scope)", () => {
    expect(parseArgs(["--scope", "bogus"])).toEqual({ scope: "cached", since: null })
  })

  it("parseArgs: explicit empty --since (from the hook's :- expansion) yields empty string — which isValidSince rejects (honest skip)", () => {
    expect(parseArgs(["--scope", "push", "--since", ""])).toEqual({ scope: "push", since: "" })
    expect(isValidSince("")).toBe(false)
  })

  it("isValidSince: rejects empty, null and all-zeros (first push of a branch)", () => {
    expect(isValidSince("")).toBe(false)
    expect(isValidSince(null)).toBe(false)
    expect(isValidSince("0000000000000000000000000000000000000000")).toBe(false)
    expect(isValidSince("abc123def")).toBe(true)
  })

  it("mergePushScope: unions staged + HEAD + range files with dedup", () => {
    const got = mergePushScope(
      ["src/lib/a.ts", "src/lib/b.ts"],
      ["src/lib/b.ts", "src/lib/c.ts"],
      ["src/lib/c.ts", "src/lib/d.ts"],
    )
    expect(got.sort()).toEqual(["src/lib/a.ts", "src/lib/b.ts", "src/lib/c.ts", "src/lib/d.ts"])
  })

  it("mergePushScope: empty sources yield no files", () => {
    expect(mergePushScope([], [], [])).toEqual([])
  })

  it("collectTestFiles still maps merged push-scope sources to co-located tests", () => {
    const f = makeFixture()
    f.write("src/lib/a.ts")
    f.write("src/lib/a.test.ts")
    const merged = mergePushScope(["src/lib/a.ts"], [], [])
    expect(collectTestFiles(merged, f.dir)).toEqual(["src/lib/a.test.ts"])
  })
})
