/**
 * golden-copy-utils.test.ts — direct coverage for the SHARED helpers the
 * golden-copy suites rely on but never exercise in isolation.
 *
 * The core property under test (MUTATION): canonicalProgram must be SENSITIVE
 * to real token changes — a program with `exit 1` and the same program with
 * `exit 2` MUST canonicalize differently. canonicalProgram is the single
 * point of trust behind every divergence guard in the repo (workflow vs
 * golden copy); if a bug there collapsed real differences, every guard would
 * pass silently while the workflows and their copies diverged.
 *
 * The counter-property (TOLERANCE): canonicalProgram must be INSENSITIVE to
 * layout noise — YAML block indent (the workflow extraction carries it per
 * line), CRLF line endings (a Windows checkout via `* text=auto`), blank
 * lines and `#` comment lines all collapse away, exactly as the guards
 * expect (the extraction carries indent; the golden copy is written clean).
 *
 * Both properties must hold TOGETHER for the guards to be simultaneously
 * non-flaky (noise tolerated) and protective (mutations caught).
 */
import { afterEach, describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  CI_JOB_BLOCKS,
  ENCODING_CI_NET,
  GUARD_PR_TWIN,
  GUARD_PUSH_BASE,
  GUARD_PUSH_NET,
  PR_JOB_BLOCKS,
  assertScopeMatchesGolden,
  canonicalProgram,
  cleanupTempDirs,
  createTempDir,
  normalizeCrlf,
  writeModuleCopy,
} from "./golden-copy-utils"

/** A representative shell program (the shape the prove-gate suite guards). */
const SHELL = [
  "set -e",
  "out=$(node scripts/check-js-budget.mjs 2>&1)",
  "code=$?",
  'if [ "$code" -eq 0 ]; then',
  "  exit 1",
  "fi",
].join("\n")

/** A representative awk program (the shape the route-gate suite guards). */
const AWK = [
  "/^## Rotas/ { in_routes = 1 }",
  "in_routes && index($0, tag) == 1 { in_block = 1; next }",
  "in_block && /^### / { in_block = 0 }",
  "in_block && /^\\| \\/busca \\|/ { found = 1 }",
  "END { exit (found ? 0 : 1) }",
].join("\n")

const MODULE_SRC = path.resolve(process.cwd(), "scripts", "fragile-range-patterns.mjs")
const SCOPE_GOLDEN = path.resolve(process.cwd(), "scripts", "__tests__", "fixtures", "fragile-range-scope.txt")

/** The golden copy's two declaration lines, in canonical form (the shape
 * the harness compares against). Pinned below so the divergence guard is
 * not vacuous. */
function goldenDecls(): string {
  return canonicalProgram(fs.readFileSync(SCOPE_GOLDEN, "utf8"))
}

describe("fragile-range scope golden copy (REVERSE-MUTATION harness anchor)", () => {
  it("DIVERGENCE GUARD: the golden copy matches the live module declarations (no drift today)", () => {
    // The harness lifts the contracts on a temp copy of the module by
    // locating the TARGET_DIRS/TARGET_EXTS declarations and replacing them.
    // The expected declarations live in the VERSIONED golden copy
    // (fixtures/fragile-range-scope.txt) - if the module changes a
    // declaration without updating the snapshot, THIS test fails (the same
    // divergence-guard posture every golden copy keeps).
    const live = fs.readFileSync(MODULE_SRC, "utf8")
    expect(() => assertScopeMatchesGolden(live)).not.toThrow()
  })

  it("DIVERGENCE GUARD (absolute pin): the golden copy holds exactly the two expected declaration lines", () => {
    // Pins the snapshot CONTENT so the guard cannot silently pass on an
    // emptied/renamed fixture - the canonical form must be exactly the two
    // declarations, in the module's declaration order (TARGET_EXTS then
    // TARGET_DIRS). IMPORTANT: if the fixture is legitimately edited, this
    // pin must be updated in the same change - a pin failure means "update
    // the pin", not "the harness broke" (the mutation tests above cover the
    // inverse).
    const expected = [
      "const TARGET_EXTS = /^\\.(sh|mjs|js|cjs|mts|ts|tsx|jsx|py|ps1|ya?ml)$/",
      'export const TARGET_DIRS = ["e2e", "src", "mini-services", ".zscripts"]',
    ].join("\n")
    expect(goldenDecls()).toBe(expected)
  })

  it("MUTATION: a TARGET_DIRS declaration drift throws a CLEAR DIFF (golden vs live lines)", () => {
    // The old harness failed with a bare "anchor not found". The golden-copy
    // version must surface WHAT drifted: the expected golden line vs the
    // actual live line, plus the fixture path to update - so a module change
    // is actionable at a glance (no silent "anchor not found" dead end).
    const live = fs.readFileSync(MODULE_SRC, "utf8")
    const mutated = live.replace(
      'export const TARGET_DIRS = ["e2e", "src", "mini-services", ".zscripts"]',
      'export const TARGET_DIRS = ["e2e", "src", "mini-services", ".zscripts", "new-tree"]',
    )
    // Sanity: the mutation is a real text difference.
    expect(mutated).not.toBe(live)
    expect(() => assertScopeMatchesGolden(mutated)).toThrowError(/drifted from the golden copy/)
    // The throw must carry BOTH sides of the diff - expected (golden) and
    // actual (live) - plus the fixture path.
    let err = ""
    try {
      assertScopeMatchesGolden(mutated)
    } catch (e) {
      err = (e as Error).message
    }
    expect(err).toContain('export const TARGET_DIRS = ["e2e", "src", "mini-services", ".zscripts"]')
    expect(err).toContain('export const TARGET_DIRS = ["e2e", "src", "mini-services", ".zscripts", "new-tree"]')
    expect(err).toContain("fragile-range-scope.txt")
  })

  it("MUTATION: a TARGET_EXTS declaration drift throws the same clear diff (both declarations guarded)", () => {
    const live = fs.readFileSync(MODULE_SRC, "utf8")
    const mutated = live.replace(
      "const TARGET_EXTS = /^\\.(sh|mjs|js|cjs|mts|ts|tsx|jsx|py|ps1|ya?ml)$/",
      "const TARGET_EXTS = /^\\.(sh|mjs|js|cjs|mts|ts|tsx|jsx|py|ps1|ya?ml|md)$/",
    )
    expect(mutated).not.toBe(live)
    let err = ""
    try {
      assertScopeMatchesGolden(mutated)
    } catch (e) {
      err = (e as Error).message
    }
    expect(err).toContain("drifted from the golden copy")
    expect(err).toContain("|md)$/") // the live (mutated) declaration
    expect(err).toContain("fragile-range-scope.txt")
  })

  it("MUTATION: a structurally-renamed declaration (shape change) throws the extraction error, not a silent pass", () => {
    // If the module's declaration is RENAMED (not just re-valued), the
    // structural locator cannot find it - the harness must fail loudly with
    // the fixture path, never silently patch nothing.
    const live = fs.readFileSync(MODULE_SRC, "utf8")
    const mutated = live.replace("export const TARGET_DIRS =", "export const SCAN_TREES =")
    expect(mutated).not.toBe(live)
    expect(() => assertScopeMatchesGolden(mutated)).toThrowError(/could not locate the TARGET_DIRS\/TARGET_EXTS declarations/)
  })
})

describe("golden-copy-utils — canonicalProgram (shared canonicalizer)", () => {
  it("MUTATION: a changed exit-code token (exit 1 → exit 2) changes the canonical form", () => {
    const mutated = SHELL.replace("exit 1", "exit 2")
    // Sanity: the mutation IS a real text difference (otherwise the assertion
    // below would be vacuous).
    expect(mutated).not.toBe(SHELL)
    expect(canonicalProgram(mutated)).not.toBe(canonicalProgram(SHELL))
  })

  it("MUTATION: a changed awk rule token inside a statement line is caught", () => {
    const mutated = AWK.replace("found = 1", "found = 0")
    expect(mutated).not.toBe(AWK)
    expect(canonicalProgram(mutated)).not.toBe(canonicalProgram(AWK))
  })

  it("ABSOLUTE: the canonical form is the exact pinned output (guards against silent transformation drift)", () => {
    // The relative tests (noise collapses, mutations differ) hold even if
    // canonicalProgram silently changed its transformation in a relationship-
    // preserving way (e.g. lowercasing, stripping a different char class) —
    // which would silently change every divergence guard's semantics. Pinning
    // the exact output catches over-collapsing, over-splitting and any such
    // drift. Note: `  exit 1` (indented in the fixture) trims to `exit 1`.
    const expectedShell = [
      "set -e",
      "out=$(node scripts/check-js-budget.mjs 2>&1)",
      "code=$?",
      'if [ "$code" -eq 0 ]; then',
      "exit 1",
      "fi",
    ].join("\n")
    expect(canonicalProgram(SHELL)).toBe(expectedShell)
    // Same pin for the awk fixture — the awk RULES must survive verbatim.
    // IMPORTANT: if a fixture is legitimately edited, this pin must be updated
    // in the same change — a pin failure means "update the pin", not
    // "canonicalProgram broke" (the mutation tests above cover the inverse).
    const expectedAwk = [
      "/^## Rotas/ { in_routes = 1 }",
      "in_routes && index($0, tag) == 1 { in_block = 1; next }",
      "in_block && /^### / { in_block = 0 }",
      "in_block && /^\\| \\/busca \\|/ { found = 1 }",
      "END { exit (found ? 0 : 1) }",
    ].join("\n")
    expect(canonicalProgram(AWK)).toBe(expectedAwk)
  })

  it("TOLERANCE: identical content canonicalizes to the same form (stability)", () => {
    expect(canonicalProgram(SHELL)).toBe(canonicalProgram(SHELL))
    expect(canonicalProgram(AWK)).toBe(canonicalProgram(AWK))
  })

  it("TOLERANCE: YAML block indent + CRLF + blank lines collapse away", () => {
    // The workflow extraction carries per-line YAML indent; a Windows
    // checkout delivers CRLF; trailing blank lines are layout, not content.
    const noisy = SHELL.split("\n")
      .map((l) => "      " + l)
      .join("\r\n") + "\r\n\r\n"
    expect(canonicalProgram(noisy)).toBe(canonicalProgram(SHELL))
  })

  it("TOLERANCE: `#` comment lines are dropped (golden-copy headers must not matter)", () => {
    const withHeader = "# Golden copy — generated reference\n" + AWK + "\n"
    expect(canonicalProgram(withHeader)).toBe(canonicalProgram(AWK))
  })

  it("MUTATION vs TOLERANCE: noise → same form, token change → different form (the guard's discriminator)", () => {
    // The whole point of the canonicalizer: layout noise collapses, real
    // changes survive. Both must hold for the divergence guards to be both
    // non-flaky (noise tolerated) and protective (mutations caught).
    const noisy = AWK.split("\n").map((l) => "  " + l).join("\r\n")
    const mutated = AWK.replace("in_block = 0", "in_block = 9")
    expect(canonicalProgram(noisy)).toBe(canonicalProgram(AWK)) // noise tolerated
    expect(canonicalProgram(mutated)).not.toBe(canonicalProgram(AWK)) // mutation caught
  })
})

describe("golden-copy-utils — writeModuleCopy (shared module-patch scaffold)", () => {
  // Direct coverage for the RULE-OF-THREE extraction (2026-08): the patch
  // scaffold behind the 3 manifest harnesses (fragile REVERSE MUTATION via
  // writePatchedModule, encoding-surface GROWTH CONTRACT via
  // writePatchedSurfaceModule, budget-routes GROWTH CONTRACT via
  // writePatchedRoutesModule). A bug in the scaffold would silently weaken
  // ALL of them at once — so it is exercised here in isolation, not only
  // transitively inside the suites that import it. (The `$`-literal test is
  // the critical one: a plain String.replace string replacement would
  // interpret `$&`/`$1` in the NEW text; the scaffold must splice via a
  // function replacement to keep patches whose content legitimately
  // contains `$` intact.)
  afterEach(() => {
    cleanupTempDirs()
  })

  it("MUTATION: a missing STRING anchor throws the onMissing error (no silent no-op)", () => {
    const dir = createTempDir("wmc-missing-str-")
    const f = path.join(dir, "demo.mjs")
    fs.writeFileSync(f, "export const A = [1]\n")
    let err = ""
    try {
      writeModuleCopy(dir, f, [
        { anchor: "export const B =", replace: "export const B = [2]", onMissing: "ANCHOR-B-MISSING" },
      ])
    } catch (e) {
      err = (e as Error).message
    }
    expect(err).toContain("ANCHOR-B-MISSING")
  })

  it("MUTATION: a missing REGEX anchor throws the onMissing error (fail-loudly on shape drift)", () => {
    const dir = createTempDir("wmc-missing-re-")
    const f = path.join(dir, "demo.mjs")
    fs.writeFileSync(f, "export const A = [1]\n")
    let err = ""
    try {
      writeModuleCopy(dir, f, [
        { anchor: /^export const MISSING = \[[^\]]*\]$/m, replace: "x", onMissing: "ANCHOR-REGEX-MISSING" },
      ])
    } catch (e) {
      err = (e as Error).message
    }
    expect(err).toContain("ANCHOR-REGEX-MISSING")
  })

  it("string anchor: the matched text is replaced (first occurrence)", () => {
    const dir = createTempDir("wmc-str-")
    const f = path.join(dir, "demo.mjs")
    fs.writeFileSync(f, "export const A = [1]\nexport const A = [2]\n")
    const out = writeModuleCopy(dir, f, [
      { anchor: "export const A = [1]", replace: "export const A = [9]", onMissing: "A" },
    ])
    expect(fs.readFileSync(out, "utf8")).toBe("export const A = [9]\nexport const A = [2]\n")
  })

  it("regex anchor: the matched span is passed to the replacer and rewritten (single-line array lift)", () => {
    const dir = createTempDir("wmc-re-")
    const f = path.join(dir, "demo.mjs")
    fs.writeFileSync(f, 'export const LHC_PATHS = ["/", "/busca"]\n')
    const out = writeModuleCopy(dir, f, [
      {
        anchor: /^export const LHC_PATHS = \[[^\]]*\]$/m,
        replace: (m) => {
          const cur = JSON.parse(m.replace(/^export const LHC_PATHS = /, "")) as string[]
          return `export const LHC_PATHS = ${JSON.stringify([...cur, "/workers-check"])}`
        },
        onMissing: "LHC",
      },
    ])
    // The replacer re-serializes via JSON.stringify — compact (no spaces),
    // like the real harnesses' LHC_PATHS lift.
    expect(fs.readFileSync(out, "utf8")).toBe('export const LHC_PATHS = ["/","/busca","/workers-check"]\n')
  })

  it("MUTATION (the `$` property): a `$&`/`$1` sequence in the NEW text stays LITERAL (function splice)", () => {
    // The scaffold splices via String.replace(found, () => replacement) — a
    // FUNCTION replacement, so `$` sequences in the new text are never
    // interpreted as capture references. A naive string replacement would
    // silently mangle patches whose content legitimately contains `$`
    // (e.g. a shell program with `$1`). The anchor covers the WHOLE line so
    // the splice replaces it outright (no dangling tail).
    const dir = createTempDir("wmc-dollar-")
    const f = path.join(dir, "demo.mjs")
    fs.writeFileSync(f, "const cmd = 'echo ok'\n")
    const out = writeModuleCopy(dir, f, [
      { anchor: "const cmd = 'echo ok'", replace: "const cmd = '$1 & $&'", onMissing: "CMD" },
    ])
    expect(fs.readFileSync(out, "utf8")).toBe("const cmd = '$1 & $&'\n")
  })

  it("multiple ops apply in ORDER (each anchor resolves against the previous output)", () => {
    const dir = createTempDir("wmc-multi-")
    const f = path.join(dir, "demo.mjs")
    fs.writeFileSync(f, "export const A = [1]\nexport const B = [2]\n")
    const out = writeModuleCopy(dir, f, [
      { anchor: "export const A = [1]", replace: "export const A = [9]", onMissing: "A" },
      { anchor: "export const B = [2]", replace: "export const B = [8]", onMissing: "B" },
    ])
    expect(fs.readFileSync(out, "utf8")).toBe("export const A = [9]\nexport const B = [8]\n")
  })

  it("the copy is written under the module's own BASENAME in the target dir (no rename)", () => {
    // The patch harnesses rely on the copy keeping the module's filename so
    // the temp runner / env override can import it by the same name.
    const dir = createTempDir("wmc-base-")
    const f = path.join(dir, "budget-routes.mjs")
    fs.writeFileSync(f, "export const A = [1]\n")
    const out = writeModuleCopy(dir, f, [])
    expect(path.basename(out)).toBe("budget-routes.mjs")
    expect(fs.readFileSync(out, "utf8")).toBe("export const A = [1]\n")
  })
})

/**
 * FIXTURE-vs-REAL drift contract (sec 11.25, 2026-08): the shared PR-twin
 * job blocks (PR_JOB_BLOCKS) and the push-net base (GUARD_PUSH_BASE) mirror
 * the REAL workflows (pr-check.yml / guard-gates.yml) the guard parses. The
 * synthetic fixtures are MINIMAL by design - the real jobs carry checkout /
 * setup-bun / cache / install steps the fixtures intentionally omit - so
 * the contract is a canonical SUBSET (every fixture line must appear in the
 * real job block), never equality. Catches the golden-copy drift class
 * applied to the fixture family: a renamed step, a renamed job key, a
 * changed run: value, a removed job - exactly the drift that would leave
 * the synthetic mutations testing a shape the real workflow no longer has.
 * Pure fs reads (no subprocess) - no explicit timeout needed.
 */
describe("golden-copy fixture blocks vs the REAL workflows (fixture-vs-real drift contract, sec 11.25)", () => {
  /** Extract a real job block: from the 2-space-indented `<key>:` line until
   * the next 2-space job key or EOF (the fixture blocks mirror job blocks).
   * Throws when the job key is absent - a renamed/removed job is fail-loud,
   * never a silent empty block. */
  function realJobBlock(yaml: string, jobKey: string): string[] {
    const lines = normalizeCrlf(yaml).split("\n")
    const start = lines.findIndex((l) => l === `  ${jobKey}:`)
    if (start < 0) throw new Error(`fixture-vs-real: job "${jobKey}" not found in the real workflow`)
    const block: string[] = []
    for (let i = start; i < lines.length; i++) {
      const line = lines[i]
      if (i > start && /^  [a-z0-9_-]+:$/.test(line)) break // next 2-space job key ends the block
      block.push(line)
    }
    return block
  }

  /** Assert the fixture block is a canonical SUBSET of the real job block. */
  function assertFixtureSubset(fixture: string[], realBlock: string[], label: string): void {
    const fixtureLines = canonicalProgram(fixture.join("\n")).split("\n")
    const realLines = canonicalProgram(realBlock.join("\n")).split("\n")
    for (const line of fixtureLines) {
      expect(realLines, `${label}: fixture line ${JSON.stringify(line)} missing from the real ${label}`).toContain(line)
    }
  }

  it("REAL: every shared PR-twin job block is a canonical SUBSET of its real job in pr-check.yml (no drift today)", () => {
    const real = fs.readFileSync(path.join(process.cwd(), GUARD_PR_TWIN), "utf8")
    for (const [key, fixture] of Object.entries(PR_JOB_BLOCKS)) {
      assertFixtureSubset(fixture, realJobBlock(real, key), key)
    }
  }, 30000)

  it("REAL: the push-net base (GUARD_PUSH_BASE) is a canonical SUBSET of the real guard-gates.yml (the same drift class, push side)", () => {
    const real = fs.readFileSync(path.join(process.cwd(), GUARD_PUSH_NET), "utf8")
    const realLines = canonicalProgram(real).split("\n")
    for (const line of canonicalProgram(GUARD_PUSH_BASE.join("\n")).split("\n")) {
      expect(realLines, `push-net base line ${JSON.stringify(line)} missing from the real guard-gates.yml`).toContain(line)
    }
  }, 30000)

  it("SHAPE PIN: the shared PR family covers EXACTLY the 5 scanner-anchored jobs (a 6th anchored job must grow the record + this pin)", () => {
    // The guard anchors utf8-check (call site) + check + fuzz + benchmark +
    // fragile-guard. If a 6th job becomes scanner-anchored, the fixture
    // family MUST grow a block AND this pin - otherwise the fixture-vs-real
    // contract would silently ignore the new job (the growth direction).
    expect(Object.keys(PR_JOB_BLOCKS).sort()).toEqual(["benchmark", "check", "fragile-guard", "fuzz", "utf8-check"])
  })

  it("MUTATION: a renamed STEP in the real pr-check.yml breaks the subset (the fixture line no longer appears)", () => {
    const real = normalizeCrlf(fs.readFileSync(path.join(process.cwd(), GUARD_PR_TWIN), "utf8"))
    // UNIQUENESS ASSUMPTION (reviewer nit, sec 11.25): "- name: Run fuzz
    // tests" is unique in pr-check.yml today - .replace touches the FIRST
    // occurrence, and a future edit that duplicates the step name across
    // jobs would make this mutation not-apply to the fuzz block (the subset
    // would still find the fixture line in the OTHER block and NOT throw -
    // a confusing failure). Keep the name unique or pin the fuzz block
    // directly if it ever duplicates.
    const mutated = real.replace("- name: Run fuzz tests", "- name: Run fuzz testz")
    // Sanity: the mutation IS a real text difference.
    expect(mutated).not.toBe(real)
    expect(() => assertFixtureSubset(PR_JOB_BLOCKS.fuzz, realJobBlock(mutated, "fuzz"), "fuzz")).toThrow()
  })

  it("MUTATION: a renamed JOB KEY in the real pr-check.yml is fail-loud (realJobBlock throws - no silent empty block)", () => {
    const real = normalizeCrlf(fs.readFileSync(path.join(process.cwd(), GUARD_PR_TWIN), "utf8"))
    const mutated = real.replace(/^  fuzz:$/m, "  fuzz-test:")
    expect(mutated).not.toBe(real)
    expect(() => realJobBlock(mutated, "fuzz")).toThrowError(/not found/)
  })

  it("MUTATION: a changed run: value in the real pr-check.yml breaks the subset (the anchor the scanner reads)", () => {
    const real = normalizeCrlf(fs.readFileSync(path.join(process.cwd(), GUARD_PR_TWIN), "utf8"))
    const mutated = real.replace("run: bun run test:guard", "run: bun run test:guard2")
    expect(mutated).not.toBe(real)
    expect(() => assertFixtureSubset(PR_JOB_BLOCKS["fragile-guard"], realJobBlock(mutated, "fragile-guard"), "fragile-guard")).toThrow()
  })

  it("REAL: every shared CI job block (CI_JOB_BLOCKS, sec 11.34) is a canonical SUBSET of its real job in ci.yml (no drift today)", () => {
    const real = fs.readFileSync(path.join(process.cwd(), ENCODING_CI_NET), "utf8")
    for (const [key, fixture] of Object.entries(CI_JOB_BLOCKS)) {
      assertFixtureSubset(fixture, realJobBlock(real, key), key)
    }
  }, 30000)

  it("SHAPE PIN: the shared CI family covers EXACTLY the 2 jobs of the shared base (lint filler + utf8-check call-site anchor) - a 3rd job must grow the record + this pin", () => {
    // Honest rationale (reviewer nit, sec 11.34): lint is NOT guard-anchored
    // - no rule of scan-guard-gates scans it (rule 8 anchors the utf8-check
    // call site; rule 11 anchors the needs graph). It is a cosmetic filler
    // job in the shared base (the minimal jobs: section). The pin still
    // protects the family: if a 3rd job joins the shared base, the record
    // AND this pin must grow - otherwise the fixture-vs-real contract
    // would silently ignore it.
    expect(Object.keys(CI_JOB_BLOCKS).sort()).toEqual(["lint", "utf8-check"])
  })

  it("MUTATION: a renamed STEP in the real ci.yml breaks the subset (the lint run: anchor the scanner reads)", () => {
    const real = normalizeCrlf(fs.readFileSync(path.join(process.cwd(), ENCODING_CI_NET), "utf8"))
    // UNIQUENESS: "run: bun run lint" appears once in ci.yml today - the
    // .replace touches the FIRST occurrence (same assumption as the
    // pr-check fuzz step mutation, sec 11.25).
    const mutated = real.replace("run: bun run lint", "run: bun run lint2")
    expect(mutated).not.toBe(real)
    expect(() => assertFixtureSubset(CI_JOB_BLOCKS.lint, realJobBlock(mutated, "lint"), "lint")).toThrow()
  })

  it("MUTATION: a renamed JOB KEY in the real ci.yml is fail-loud (realJobBlock throws - no silent empty block)", () => {
    const real = normalizeCrlf(fs.readFileSync(path.join(process.cwd(), ENCODING_CI_NET), "utf8"))
    const mutated = real.replace(/^  lint:$/m, "  lint-test:")
    expect(mutated).not.toBe(real)
    expect(() => realJobBlock(mutated, "lint")).toThrowError(/not found/)
  })

  it("MUTATION: a changed uses: value in the real ci.yml breaks the subset (the utf8-check call-site anchor)", () => {
    const real = normalizeCrlf(fs.readFileSync(path.join(process.cwd(), ENCODING_CI_NET), "utf8"))
    const mutated = real.replace("uses: ./.github/workflows/utf8-check.yml", "uses: ./.github/workflows/utf8-check2.yml")
    expect(mutated).not.toBe(real)
    expect(() => assertFixtureSubset(CI_JOB_BLOCKS["utf8-check"], realJobBlock(mutated, "utf8-check"), "utf8-check")).toThrow()
  })
})
