/**
 * Tests for the Camada A route-gate assert step in
 * .github/workflows/release-deploy.yml — the awk that FAILS a tag release
 * unless the tag's own "Rotas (real transfer)" block in docs/bundle-report.md
 * contains a `| /busca |` row INSIDE the tag's `### <tag>` block.
 *
 * The awk program is EXTRACTED FROM THE WORKFLOW at test time (single source
 * of truth — js-yaml parse + regex, with CRLF-normalized line endings), then
 * executed with the real `awk` binary against synthetic report fixtures. If
 * someone edits the awk in the workflow, this suite exercises the NEW program
 * automatically; if the step is renamed, extraction fails loudly instead of
 * silently testing nothing.
 *
 * This replaces the one-off manual simulation that proved the assert (route-
 * gate plan, Camada A). Covered cases:
 *   - /busca present inside the tag block            → exit 0 (release proceeds)
 *   - tag block exists but no /busca row             → exit 1 (release blocked)
 *   - tag block missing (only an older release)      → exit 1
 *   - no ## Rotas section at all                     → exit 1
 *   - version-prefix collision (v0.4.30 vs tag v0.4.3) → exit 1 (trailing space
 *     in `tag="### $TAG "` disambiguates)
 *   - real em-dash block header (`### v0.4.3 — <date>`) → exit 0
 *   - CRLF line endings (Windows checkout, text=auto) → exit 0
 *   - route order inside the block does not matter    → exit 0
 */
import { describe, it, expect, afterEach } from "vitest"
import fs from "node:fs"
import path from "node:path"

// js-yaml has no @types package in this repo (and its dist is an untyped
// ESM module, so a `declare module` augmentation fails with TS2665). The
// type surface used here is tiny — suppress the import error locally instead
// of shimming the module project-wide.
// @ts-expect-error js-yaml is untyped in this repo; only yaml.load is used
import yaml from "js-yaml"
import { canonicalProgram, cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"

const WORKFLOW = path.resolve(process.cwd(), ".github", "workflows", "release-deploy.yml")
// Versioned golden copy of the awk program (single source of truth for the
// DIVERGENCE guard — see the test below: editing the workflow without this
// file, or vice-versa, fails the suite).
const GOLDEN_AWK = path.resolve(process.cwd(), "scripts", "__tests__", "fixtures", "route-gate-assert.awk")

afterEach(cleanupTempDirs)

interface AssertStep {
  name?: string
  run?: string
}

/** Extract the awk program from the workflow's assert step (source of truth). */
function extractAwkProgram(): string {
  const doc = yaml.load(fs.readFileSync(WORKFLOW, "utf8")) as { jobs?: { budget?: { steps?: AssertStep[] } } }
  const steps = doc?.jobs?.budget?.steps ?? []
  const step = steps.find((s) => (s.name ?? "").includes("Assert Rotas blocks"))
  if (!step?.run) {
    throw new Error(
      "step 'Assert Rotas blocks in bundle report (route gate stays armed)' not found in release-deploy.yml — a rename broke this test's wiring",
    )
  }
  // CRLF-normalize first: the workflow checks out as CRLF on Windows via
  // `* text=auto`, and the `'\n` anchors below would miss `\r\n`.
  const run = step.run.replace(/\r\n/g, "\n")
  const m = run.match(/awk -v tag="### \$TAG " '\n([\s\S]*?)\n\s*' "\$REPORT"/)
  if (!m) throw new Error("could not extract the awk program from the assert step's run block")
  return m[1]
}

/** Run ANY awk program against a synthetic report; returns its exit code. */
function runAwkProgram(program: string, tag: string, reportMd: string, eol = "\n"): number {
  const dir = createTempDir("route-gate-awk-")
  const reportPath = path.join(dir, "report.md")
  fs.writeFileSync(reportPath, reportMd.replace(/\n/g, eol))
  // Mirror the shell invocation `awk -v tag="### $TAG " '<program>' "$REPORT"`
  // — the trailing space in the tag value is the prefix-disambiguation.
  const r = runSubprocess({ command: "awk", args: ["-v", `tag=### ${tag} `, program, reportPath] })
  return r.status ?? -1
}

/** Run the workflow's awk against a synthetic report; returns its exit code. */
function runAssert(tag: string, reportMd: string, eol = "\n"): number {
  return runAwkProgram(extractAwkProgram(), tag, reportMd, eol)
}

/** One version's Rotas block (real em-dash header) — NO document header. */
function block(version: string, routes: string[]): string {
  const rows = routes.map((rt) => `| ${rt} | 1 | 261.1 | — |`).join("\n")
  return (
    `### ${version} — 2026-08-08\n` +
    "| Rota | Params | KB gzip | Δ |\n" +
    "|---|---|---|---|\n" +
    `${rows}`
  )
}

/** Synthetic report: document header + Rotas section with the given blocks. */
function reportWithBlocks(blocks: string[]): string {
  return (
    "# Bundle Report — Severinno\n\n" +
    "## Rotas (real transfer, KB gzip)\n\n" +
    blocks.join("\n\n") +
    "\n"
  )
}

/** Single-block convenience (most cases need exactly one version). */
function reportWithBlock(version: string, routes: string[]): string {
  return reportWithBlocks([block(version, routes)])
}

describe("release-deploy.yml Camada A assert (awk Rotas block)", () => {
  it("extracts the awk program from the workflow (source-of-truth wiring)", () => {
    const program = extractAwkProgram()
    expect(program).toContain("/^## Rotas/")
    expect(program).toContain("in_routes")
    expect(program).toContain("\\/busca")
    expect(program).toContain("END { exit")
  })

  it("awk binary resolves in this environment (so failures below are logic failures, not spawn errors)", () => {
    const r = runSubprocess({ command: "awk", args: ["--version"] })
    expect(r.status).toBe(0)
  }, 60000)

  it("passes (exit 0) when the tag's own Rotas block contains a /busca row", () => {
    expect(runAssert("v0.4.3", reportWithBlock("v0.4.3", ["/busca", "/dashboard"]))).toBe(0)
  }, 60000)

  it("fails (exit 1) when the tag block has routes but NO /busca row", () => {
    expect(runAssert("v0.4.3", reportWithBlock("v0.4.3", ["/dashboard"]))).toBe(1)
  }, 60000)

  it("fails (exit 1) when the tag's block is missing entirely (only an older release's block)", () => {
    expect(runAssert("v0.4.3", reportWithBlock("v0.4.2", ["/busca"]))).toBe(1)
  }, 60000)

  it("fails (exit 1) when the report has NO ## Rotas section at all", () => {
    const md = "# Bundle Report — Severinno\n\n## Histórico\n\n| Versão | Gate |\n|---|---|\n| v0.4.3 | ✅ |\n"
    expect(runAssert("v0.4.3", md)).toBe(1)
  }, 60000)

  it("fails (exit 1) on version-prefix collision: tag v0.4.3 must NOT match a v0.4.30 block", () => {
    expect(runAssert("v0.4.3", reportWithBlock("v0.4.30", ["/busca"]))).toBe(1)
  }, 60000)

  it("passes (exit 0) with the real em-dash block header (`### v0.4.3 — <date>`)", () => {
    expect(runAssert("v0.4.3", reportWithBlock("v0.4.3", ["/busca"]))).toBe(0)
  }, 60000)

  it("passes (exit 0) with CRLF line endings (Windows checkout via * text=auto)", () => {
    expect(runAssert("v0.4.3", reportWithBlock("v0.4.3", ["/busca"]), "\r\n")).toBe(0)
  }, 60000)

  it("passes (exit 0) when /busca is not the first route row (block row order is irrelevant)", () => {
    expect(runAssert("v0.4.3", reportWithBlock("v0.4.3", ["/dashboard", "/u/[slug]", "/busca"]))).toBe(0)
  }, 60000)

  it("fails (exit 1) on combined scoping: tag block has /dashboard AND an older release's block has /busca (the /busca must NOT satisfy the assert)", () => {
    // The awk scopes to the tag's own block (in_block) — a /busca row inside
    // an OLDER release's block must not count. This is the exact scenario the
    // `in_block` guard exists to prevent. Real report layout: ONE `## Rotas`
    // section, multiple `### version` blocks joined by blank lines.
    const md = reportWithBlocks([block("v0.4.3", ["/dashboard"]), block("v0.4.2", ["/busca"])])
    expect(runAssert("v0.4.3", md)).toBe(1)
  }, 60000)

  it("DIVERGENCE GUARD: the workflow's awk program and the versioned golden copy (fixtures/route-gate-assert.awk) never diverge", () => {
    // Editing the awk inside release-deploy.yml's YAML literal block is easy
    // to miss in review; the golden copy is the diffable, versioned reference
    // of that exact program. If someone edits one without the other, this
    // test fails — the whole point of the copy. The comparison is on the
    // canonical CONTENT (rules), not the YAML indentation or comment layout.
    const extracted = extractAwkProgram()
    const golden = fs.readFileSync(GOLDEN_AWK, "utf8")
    const cExtracted = canonicalProgram(extracted)
    const cGolden = canonicalProgram(golden)
    // Diagnostics MUST run BEFORE the expect — expect().toBe() throws on a
    // mismatch, so a dump after it would be unreachable dead code. Show both
    // canonical forms so the culprit (workflow vs golden copy) is obvious.
    if (cExtracted !== cGolden) {
      console.error(
        "\nDIVERGÊNCIA awk:\n--- extraído do release-deploy.yml ---\n" +
          cExtracted +
          "\n--- golden copy (fixtures/route-gate-assert.awk) ---\n" +
          cGolden,
      )
    }
    expect(cExtracted).toBe(cGolden)
  })

  it("golden copy is a WORKING awk program with identical behavior to the workflow's across the fixture matrix", () => {
    // The divergence guard proves the text matches; this proves the copy is
    // functionally the same program — every fixture case (pass/fail/collision/
    // CRLF/order/scoping) must yield the SAME exit code from both the
    // workflow-extracted program and the golden copy. Guards against a golden
    // file that accidentally "matches" canonically while being corrupt.
    const extracted = extractAwkProgram()
    const golden = fs.readFileSync(GOLDEN_AWK, "utf8")
    const cases: Array<{ md: string; eol?: string; expected: number }> = [
      { md: reportWithBlock("v0.4.3", ["/busca", "/dashboard"]), expected: 0 },
      { md: reportWithBlock("v0.4.3", ["/dashboard"]), expected: 1 },
      { md: reportWithBlock("v0.4.2", ["/busca"]), expected: 1 },
      { md: reportWithBlock("v0.4.30", ["/busca"]), expected: 1 },
      { md: reportWithBlock("v0.4.3", ["/busca"]), eol: "\r\n", expected: 0 },
      { md: reportWithBlock("v0.4.3", ["/dashboard", "/u/[slug]", "/busca"]), expected: 0 },
      {
        md: reportWithBlocks([block("v0.4.3", ["/dashboard"]), block("v0.4.2", ["/busca"])]),
        expected: 1,
      },
    ]
    for (const c of cases) {
      const fromWorkflow = runAwkProgram(extracted, "v0.4.3", c.md, c.eol)
      const fromGolden = runAwkProgram(golden, "v0.4.3", c.md, c.eol)
      expect(fromGolden).toBe(c.expected)
      expect(fromWorkflow).toBe(fromGolden)
    }
  }, 60000)
})
