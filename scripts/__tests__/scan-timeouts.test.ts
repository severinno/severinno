/**
 * scan-timeouts.test.ts — behavior tests for scripts/scan-timeouts.mjs, the
 * versioned guard that fails on any subprocess-heavy it()/test() WITHOUT an
 * explicit timeout.
 *
 * WHY (the class this pins): in 2026-08 the CI flaked because subprocess-
 * heavy tests ran on vitest's IMPLICIT default timeout (5000ms) — a test
 * that shells out (spawnSync / runSubprocess / execSync) on a slow runner
 * can exceed 5s even when deterministic. The one-off sweep standardized an
 * explicit 60000 on 137 tests, but a sweep is point-in-time: nothing stops
 * a NEW subprocess-heavy test from landing without a timeout. This suite
 * pins the sweep as a permanent contract. (Since 2026-08 the global
 * testTimeout in vitest.config.unit.ts is 30000 — a safety net for tests
 * this guard does NOT flag; the per-test explicit timeout is still the
 * required contract for subprocess-heavy tests, and the guard ignores the
 * global value by design.)
 *
 *   - BASELINE (the live net): scanning the WHOLE vitest surface (scripts/
 *     + src/ *.test.{ts,tsx}) finds ZERO subprocess-heavy tests without an
 *     explicit timeout — if someone adds one, this breaks with its exact
 *     file:line. Also pins subprocessHeavy > 0 so the guard demonstrably
 *     scans a non-empty class (a detector that silently matches nothing
 *     would be a vacuous pass).
 *   - MUTATION: a synthetic subprocess-heavy test WITHOUT a timeout trips
 *     the scan; the SAME test WITH an explicit timeout (positional or
 *     options-object form) passes — proving the detector keys on the
 *     timeout, not on the token's presence.
 *   - PARSER edges: it.each table + template-literal forms, comment/string
 *     masking (a docblock quoting "spawnSync" cannot false-positive), line
 *     numbers, the options-object timeout form.
 *   - HELPER-SPAN edges (the 2026-08 matchParen-on-brace class): a helper
 *     body is bounded by BRACE depth, not paren depth — a pure helper
 *     returning a template literal must not leak into the next helper's
 *     subprocess span (false positive), and a subprocess call after an
 *     earlier balanced paren must not be truncated out of the span (false
 *     negative). Both directions are pinned below with synthetic helpers.
 *
 * Exported pure functions are imported directly (same pattern as
 * pre-commit-tests.test.ts / scan-non-ascii.test.ts); the CLI is exercised
 * via subprocess (TIMEOUT_SCAN_ROOT env override — same fixture-driven
 * pattern as FRAGILE_SCAN_ROOT in the fragile-range suites) to pin exit
 * codes end-to-end.
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"
import { codeMask, findTestCalls, scanSurface, scanTestFile } from "../scan-timeouts.mjs"

const ROOT = process.cwd()
const SCRIPT = path.join(ROOT, "scripts", "scan-timeouts.mjs")

const SH_SNIPPET = "spawnSync('git', ['ls-files'], { encoding: 'utf8' })"

function runCli(extraEnv: Record<string, string> = {}, files: string[] = []) {
  return runSubprocess({
    command: process.execPath,
    args: [SCRIPT, ...files],
    env: extraEnv,
    timeoutMs: 60_000,
  })
}

afterEach(() => {
  cleanupTempDirs()
})

describe("scripts/scan-timeouts.mjs — parser", () => {
  it("codeMask: string literals and comments are masked, newlines preserved", () => {
    const src = "it('x', () => {})\n// spawnSync comment\ntest('y', () => {})\n"
    const masked = codeMask(src)
    // The comment's spawnSync becomes spaces; the it(/test( calls stay code.
    expect(masked).toContain("it(")
    expect(masked).toContain("test(")
    // 3 newlines -> 4 parts when split; the point is the count is UNCHANGED
    // from the raw source (newlines survive masking, nothing is joined).
    expect(masked.split("\n")).toHaveLength(src.split("\n").length)
  })

  it("findTestCalls: plain it() with a positional timeout -> hasTimeout true", () => {
    const calls = findTestCalls(`it("shells out", () => { ${SH_SNIPPET} }, 60000)\n`)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('"shells out"')
    expect(calls[0].subprocessHeavy).toBe(true)
    expect(calls[0].hasTimeout).toBe(true)
    expect(calls[0].line).toBe(1)
  })

  it("findTestCalls: subprocess-heavy it() WITHOUT a timeout -> hasTimeout false (the violation class)", () => {
    const calls = findTestCalls(`it("shells out", () => { ${SH_SNIPPET} })\n`)
    expect(calls[0].subprocessHeavy).toBe(true)
    expect(calls[0].hasTimeout).toBe(false)
  })

  it("findTestCalls: a NON-subprocess it() without a timeout is NOT a violation", () => {
    const calls = findTestCalls('it("pure math", () => { expect(1 + 1).toBe(2) })\n')
    expect(calls[0].subprocessHeavy).toBe(false)
    expect(calls[0].hasTimeout).toBe(false)
  })

  it("findTestCalls: a comment or string QUOTING a subprocess token cannot flag a test", () => {
    // The token appears only in the name string and a comment — both masked.
    const src = `// ${SH_SNIPPET}\nit("spawnSync mentioned in prose", () => { expect(1).toBe(1) })\n`
    const calls = findTestCalls(src)
    expect(calls).toHaveLength(1)
    expect(calls[0].subprocessHeavy).toBe(false)
  })

  it("ACCEPTED false-negative (the template-interpolation frontier, sec 11.37): a subprocess token INSIDE a ${...} interpolation escapes subprocessHeavy - masked whole, and this is DECIDED (the counterfactual proves the detector works)", () => {
    // The frontier named in the header (masked whole) is now a contract: a
    // subprocess token inside a template-literal ${...} interpolation is
    // consumed by codeMask - no token survives for SUBPROCESS_RE, so the
    // test is NOT subprocess-heavy. ACCEPTED (no test in this repo does
    // it; closing it would require interpolation tracking for a form with
    // 0 uses - the same cost sec 11.30 refused) - pinning it keeps a
    // reader from reading the named frontier as an undecided hole. The
    // \\${...} escapes keep the sequence LITERAL in this test's source
    // (it must not interpolate HERE - it must stay a masked string).
    const hidden = `it("x", () => { eval(\`\${execSync}("node x.mjs")\`) })`
    expect(findTestCalls(hidden)[0].subprocessHeavy).toBe(false)
    // WHY it passes (the mechanism, pinned on the SAME source): codeMask
    // consumes the interpolation - the token disappears.
    expect(codeMask(hidden)).not.toContain("execSync")
    // COUNTERFACTUAL (the decision is DELIBERATE, not a dead detector):
    // the SAME token DIRECT (outside any template) IS flagged.
    const direct = `it("x", () => { execSync("node x.mjs") })`
    expect(findTestCalls(direct)[0].subprocessHeavy).toBe(true)
    // The real idiom (distinct, still detected): the token OUTSIDE the
    // template with only ARGS interpolated - the token stays literal.
    const idiom = `it("x", () => { execSync(\`node \${file}.mjs\`) })`
    expect(findTestCalls(idiom)[0].subprocessHeavy).toBe(true)
  })

  it("findTestCalls: it.each TABLE form parses the args paren after the table", () => {
    const calls = findTestCalls(
      `it.each([1, 2])("case %i", () => { ${SH_SNIPPET} }, 60000)\n`,
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].subprocessHeavy).toBe(true)
    expect(calls[0].hasTimeout).toBe(true)
  })

  it("findTestCalls: it.each TABLE form without a timeout -> violation", () => {
    const calls = findTestCalls(`it.each([1, 2])("case", () => { ${SH_SNIPPET} })\n`)
    expect(calls[0].subprocessHeavy).toBe(true)
    expect(calls[0].hasTimeout).toBe(false)
  })

  it("findTestCalls: it.each TEMPLATE-LITERAL form (it.each`a,b`) parses too", () => {
    const calls = findTestCalls("it.each`a,b`(\"case\", () => { " + SH_SNIPPET + " }, 60000)\n")
    expect(calls).toHaveLength(1)
    expect(calls[0].subprocessHeavy).toBe(true)
    expect(calls[0].hasTimeout).toBe(true)
  })

  it("findTestCalls: options-object timeout form (jest-style) is accepted", () => {
    const calls = findTestCalls(
      `it("shells out", { timeout: 60000 }, () => { ${SH_SNIPPET} })\n`,
    )
    expect(calls[0].subprocessHeavy).toBe(true)
    expect(calls[0].hasTimeout).toBe(true)
  })

  it("findTestCalls: underscore numeric timeout (60_000) counts as explicit", () => {
    const calls = findTestCalls(`it("shells out", () => { ${SH_SNIPPET} }, 60_000)\n`)
    expect(calls[0].hasTimeout).toBe(true)
  })

  it("findTestCalls: line numbers are 1-based across the file", () => {
    const src = `describe("x", () => {\n  it("first", () => { ${SH_SNIPPET} }, 60000)\n  it("second", () => { ${SH_SNIPPET} })\n})\n`
    const calls = findTestCalls(src)
    expect(calls.map((c) => c.line)).toEqual([2, 3])
  })

  it("findTestCalls: a REGEX LITERAL with an escaped paren cannot unbalance the matcher (the budget-routes false positive class)", () => {
    // The 2026-08 false positive: a toMatch(/numEnv\()/ regex literal — the
    // `\(` is CODE to a naive paren matcher and would swallow the closing
    // `)` of the test call. codeMask treats the whole regex literal as
    // prose, so the call parses cleanly and stays NON-subprocess-heavy.
    const calls = findTestCalls(
      'it("contract check", () => { expect(src).not.toMatch(/"\\/busca": numEnv\\(/) })\n',
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].subprocessHeavy).toBe(false)
    expect(calls[0].hasTimeout).toBe(false)
  })

  it("scanTestFile: aggregates tests, subprocessHeavy count and violations", () => {
    const dir = createTempDir("scan-timeouts-aggregate-")
    const file = path.join(dir, "agg.test.ts")
    fs.writeFileSync(
      file,
      `it("ok", () => { ${SH_SNIPPET} }, 60000)\nit("bad", () => { ${SH_SNIPPET} })\nit("pure", () => { expect(1).toBe(1) })\n`,
      "utf8",
    )
    const r = scanTestFile(file)
    expect(r.tests).toHaveLength(3)
    expect(r.subprocessHeavy).toBe(2)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].name).toBe('"bad"')
    expect(r.violations[0].line).toBe(2)
  })
})

describe("scripts/scan-timeouts.mjs — CLI + BASELINE (the live net)", () => {
  it("BASELINE: the whole vitest surface has ZERO subprocess-heavy tests without an explicit timeout", () => {
    // The permanent sweep: scan scripts/ + src/ (the exact trees
    // vitest.config.unit.ts includes). If a new subprocess-heavy test
    // lands without a timeout, THIS breaks with its file:line — the class
    // cannot silently return. (The 137 tests standardized to 60000 in
    // 2026-08 are all in scripts/__tests__; src/ has no subprocess tokens
    // today but is scanned so it cannot regress either.)
    const r = scanSurface(ROOT)
    expect(r.violations).toEqual([])
  })

  it("BASELINE companion: the guard demonstrably scans a NON-EMPTY subprocess-heavy class", () => {
    // A detector that matches nothing would pass vacuously. Pin that the
    // real repo actually has subprocess-heavy tests (the 2026-08 sweep
    // standardized 137 of them) — the class this guard exists for exists.
    const r = scanSurface(ROOT)
    expect(r.subprocessHeavy).toBeGreaterThan(100)
    expect(r.files).toBeGreaterThan(20)
  })

  it("LOCAL HELPER (regression): a pure template-literal helper does NOT leak into the next helper's subprocess span (the dispatchWarning false-positive class)", () => {
    // The 2026-08 bug: localDefs bounded a helper's body with matchParen
    // (PAREN depth) on the opening `{`. A body with no parens (a masked
    // template-literal return) leaked forward into the NEXT function and
    // captured its runSubprocess(...), wrongly marking the pure helper
    // heavy -> its callers demanded a timeout. Bodies are brace-bounded.
    const dir = createTempDir("scan-timeouts-brace-leak-")
    const file = path.join(dir, "leak.test.ts")
    fs.writeFileSync(
      file,
      [
        "function pureMsg(a, b) {",
        '  return `msg ${a.join(", ")} on ${b}`',
        "}",
        "function heavyRunner() {",
        `  ${SH_SNIPPET}`,
        "}",
        'it("calls only the pure helper", () => { expect(pureMsg(["x"], "y")).toContain("msg") })',
        'it("calls the heavy helper", () => { heavyRunner() }, 60000)',
        "",
      ].join("\n"),
      "utf8",
    )
    const r = scanTestFile(file)
    expect(r.subprocessHeavy).toBe(1) // ONLY the heavyRunner caller
    expect(r.violations).toEqual([])
  })

  it("LOCAL HELPER (regression): a subprocess call after an earlier balanced paren in the same body is still seen (the truncation class)", () => {
    // The same matchParen-on-brace bug could UNDER-flag: a body like
    // `{ foo(); runSubprocess(x) }` ended at foo()'s `)` (the first
    // balanced paren), truncating the span BEFORE the subprocess token.
    // Brace-bounded spans see the whole body, so the caller is flagged.
    const dir = createTempDir("scan-timeouts-trunc-")
    const file = path.join(dir, "trunc.test.ts")
    fs.writeFileSync(
      file,
      [
        "function lateHeavy() {",
        "  const x = (1 + 1)",
        `  ${SH_SNIPPET}`,
        "}",
        'it("calls lateHeavy without a timeout", () => { lateHeavy() })',
        "",
      ].join("\n"),
      "utf8",
    )
    const r = scanTestFile(file)
    expect(r.subprocessHeavy).toBe(1)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].line).toBe(5)
  })

  it("IMPORTED HELPER (regression): an `export function` helper in a local module is detected as heavy (the golden-copy-utils form)", () => {
    // The reviewer-caught gap: golden-copy-utils exports its heavy helpers
    // as `export function runSubprocess(...)` / `export function
    // expectLayer3FailsThroughWrapper(...)`, and localDefs must see the
    // `export` prefix or the imported-helper path silently finds nothing.
    // Synthetic: a local module with an EXPORTED heavy helper + a test
    // file importing and calling it WITHOUT a timeout -> must be flagged.
    const dir = createTempDir("scan-timeouts-import-")
    const helper = path.join(dir, "my-runner.ts")
    fs.writeFileSync(
      helper,
      `export function myRunner() {\n  ${SH_SNIPPET}\n}\n`,
      "utf8",
    )
    const testFile = path.join(dir, "uses-runner.test.ts")
    fs.writeFileSync(
      testFile,
      `import { myRunner } from "./my-runner"\nit("shells out via imported helper", () => { myRunner() })\n`,
      "utf8",
    )

    const r = scanTestFile(testFile)
    expect(r.subprocessHeavy).toBe(1)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].line).toBe(2)
    // And with an explicit timeout the same test passes (the detector keys
    // on the timeout, not on the token being in the same file).
    fs.writeFileSync(
      testFile,
      `import { myRunner } from "./my-runner"\nit("shells out via imported helper", () => { myRunner() }, 60000)\n`,
      "utf8",
    )
    expect(scanTestFile(testFile).violations).toEqual([])
  })

  it("MUTATION (CLI): a synthetic subprocess-heavy test without a timeout -> exit 1 with exact path:line", () => {
    const dir = createTempDir("scan-timeouts-mut-")
    const subdir = path.join(dir, "scripts", "__tests__")
    fs.mkdirSync(subdir, { recursive: true })
    const file = path.join(subdir, "dirty.test.ts")
    fs.writeFileSync(file, `it("shells out", () => { ${SH_SNIPPET} })\n`, "utf8")

    const r = runCli({ TIMEOUT_SCAN_ROOT: dir })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("1 subprocess-heavy test(s) WITHOUT an explicit timeout")
    expect(r.stderr).toContain(`${file}:1`)
  }, 60000)

  it("MUTATION (CLI): the SAME synthetic test WITH an explicit timeout -> exit 0", () => {
    const dir = createTempDir("scan-timeouts-clean-")
    const subdir = path.join(dir, "scripts", "__tests__")
    fs.mkdirSync(subdir, { recursive: true })
    fs.writeFileSync(
      path.join(subdir, "clean.test.ts"),
      `it("shells out", () => { ${SH_SNIPPET} }, 60000)\n`,
      "utf8",
    )

    const r = runCli({ TIMEOUT_SCAN_ROOT: dir })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
    expect(r.stdout).toContain("1 subprocess-heavy")
  }, 60000)

  it("MUTATION (CLI): src/ tree is scanned too (a dirty src test trips the same gate)", () => {
    const dir = createTempDir("scan-timeouts-src-")
    const subdir = path.join(dir, "src")
    fs.mkdirSync(subdir, { recursive: true })
    const file = path.join(subdir, "app.test.ts")
    fs.writeFileSync(file, `it("shells out", () => { ${SH_SNIPPET} })\n`, "utf8")

    const r = runCli({ TIMEOUT_SCAN_ROOT: dir })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`${file}:1`)
  }, 60000)

  it("CLI: explicit file args scan exactly those files (targeted mode)", () => {
    const dir = createTempDir("scan-timeouts-files-")
    const clean = path.join(dir, "clean.test.ts")
    fs.writeFileSync(clean, `it("ok", () => { ${SH_SNIPPET} }, 60000)\n`, "utf8")

    const r = runCli({}, [clean])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("1 test file")
  }, 60000)

  it("CLI: unknown flag -> exit 2 (usage error, no silent ignore)", () => {
    const r = runCli({}, ["--bogus"])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("usage")
  }, 60000)
})
