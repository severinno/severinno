/**
 * Unit tests for scripts/pre-commit-tests.mjs — the pre-commit hook that runs
 * unit tests related to the git-staged files.
 *
 * collectTestFiles is exported pure (entry-point guarded), so it is tested
 * directly with a synthetic fixture tree — no git, no vitest subprocess
 * needed for the mapping logic itself.
 *
 * Covered scenarios:
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
import { collectTestFiles, isTestFile, isSourceFile } from "../pre-commit-tests.mjs"

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
