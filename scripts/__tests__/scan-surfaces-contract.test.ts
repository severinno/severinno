/**
 * scan-surfaces-contract.test.ts - doc<->code contract for docs/scan-surfaces.md.
 *
 * The doc is the canonical taxonomy of the repo's THREE KINDS of fixed lists
 * (code surface / runtime routes / trigger filters) and states each list's
 * source of truth (manifest export or inline paths:). This suite makes the
 * DOC a first-class contract: it parses the documented lists OUT of the
 * markdown and asserts they match the real manifests, so the doc cannot
 * silently drift from the code (or the code from the doc) when TARGET_DIRS,
 * a surface array, a route budget, or a workflow trigger set changes.
 *
 * The three Type sections are validated differently, matching each list's
 * nature (see the doc's section 3):
 *
 *   Type A - code surface (CONTRACT): every parenthesized list after each
 *     manifest export name (ALWAYS_SCAN_DIRS, VPS_SH_PATTERNS, ...,
 *     TARGET_DIRS, EXCLUDED_TREES) is extracted and compared EXACTLY
 *     (normalized: doc uses trailing slashes like `scripts/`, manifests do
 *     not). TARGET_EXTS is a regex with no enumerated list, so only its
 *     name-presence is pinned here (its value is pinned by the
 *     fragile-range-guard suite).
 *
 *   Type B - runtime routes (PRODUCT decision): the documented route labels
 *     (the "for `/busca`, `/dashboard`, ..." list) must match
 *     REAL_ROUTE_CHECKS labels in order, and the documented "budgetKB
 *     320/270/280/320" sequence must match the manifest's default budgets.
 *     The LHCI concrete slugs the doc mentions must exist in LHC_PATHS.
 *     (budget-routes.test.ts already pins the manifests; THIS suite pins the
 *     doc's retelling of them.)
 *
 *   Type C - trigger filters (HINTS, but the SET is a contract): the SET of
 *     workflow files with a `paths:` block must equal the documented trigger
 *     set (adding `paths:` to ci.yml/deploy.yml/pr-check.yml or any new
 *     workflow fails), and every actual `paths:` entry of each documented
 *     trigger workflow must be COVERED by the doc's documented tokens for
 *     that workflow (glob / dir-prefix / bare-substring / own workflow
 *     file). The doc may summarize specific files as globs - the coverage
 *     direction is what matters: a path outside the documented summary means
 *     the doc is stale and the test fails.
 *
 * The doc is parsed with small targeted regexes, not a markdown AST - if the
 * doc's format drifts, extraction throws a clear "section/pattern not found"
 * error and the extractor is updated together with the doc (same rule as the
 * golden-copy pins: fail loudly, never silently ignore).
 */
import { beforeAll, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  ALWAYS_SCAN_DIRS,
  DOCS_PATTERNS,
  OPS_SH_PATTERNS,
  VPS_SH_PATTERNS,
  YAML_GATE_PATTERNS,
} from "../encoding-surface.mjs"
import { EXCLUDED_TREES, TARGET_DIRS } from "../fragile-range-patterns.mjs"

const ROOT = process.cwd()
const DOC = path.join(ROOT, "docs", "scan-surfaces.md")
const WF_DIR = path.join(ROOT, ".github", "workflows")

/** The budget-routes registry (loaded hermetically - see the env note below). */
type Registry = typeof import("../budget-routes.mjs")
let registry: Registry

// Env keys the registry reads at module scope for the budgetKB defaults -
// mirror the budget-routes.test.ts hermetic pattern (delete BEFORE import).
const BUDGET_ENV_KEYS = [
  "JS_BUDGET_REAL_BUSCA_KB",
  "JS_BUDGET_REAL_DASHBOARD_KB",
  "JS_BUDGET_REAL_U_KB",
  "JS_BUDGET_REAL_CATEGORIA_KB",
]

beforeAll(async () => {
  for (const k of BUDGET_ENV_KEYS) delete process.env[k]
  registry = await import("../budget-routes.mjs")
})

function docText(): string {
  return fs.readFileSync(DOC, "utf8")
}

/** Extract the doc text between two section headers (throws if a header moved). */
function sectionBetween(doc: string, start: string, end: string): string {
  const i = doc.indexOf(start)
  if (i === -1) throw new Error(`scan-surfaces.md: header "${start}" not found - update this extractor`)
  const j = doc.indexOf(end, i + start.length)
  if (j === -1) throw new Error(`scan-surfaces.md: header "${end}" not found after "${start}" - update this extractor`)
  return doc.slice(i, j)
}

/**
 * Extract a Type A parenthesized list: `` `NAME` (`item`, `item`, ...) ``.
 * Returns null when the name is mentioned WITHOUT a list (TARGET_EXTS) or
 * when the pattern drifted (name renamed / format changed).
 */
function docSurfaceList(section: string, name: string): string[] | null {
  const m = section.match(new RegExp(`\`${name}\`\\s*\\(([^)]*)\\)`))
  if (!m) return null
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^`|`$/g, "").replace(/\/$/, ""))
}

/**
 * Minimal `paths:` block extractor (js-yaml is NOT a dependency; the trigger
 * blocks are simple `paths:` + `- "..."` lines). Handles the YAML anchor form
 * `paths: &cache_paths` (collects the following entries) and skips the anchor
 * reference `paths: *cache_paths` (no inline list). Returns the deduped
 * entries across all blocks in the file.
 */
function extractPaths(src: string): string[] {
  const paths: string[] = []
  const lines = src.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*paths:\s*(&[\w-]+)?\s*$/.test(lines[i])) continue
    for (let j = i + 1; j < lines.length; j++) {
      const item = lines[j].match(/^\s+-\s+"([^"]+)"\s*$/)
      if (item) {
        paths.push(item[1])
        continue
      }
      // End of the block: a non-item line that is not the anchor reference.
      if (!/^\s*paths:\s*\*[\w-]+\s*$/.test(lines[j]) && lines[j].trim() !== "" && !lines[j].trim().startsWith("-")) break
    }
  }
  return [...new Set(paths)]
}

/**
 * Coverage matcher for a documented trigger token against an actual path:
 *   - trailing `/`  -> dir-prefix match (doc's `src/lib/`)
 *   - contains `*`  -> glob match (`**` crosses dirs, `*` stays in a segment)
 *   - otherwise     -> substring match (doc's bare `severinno-ssh`/`health-check.yml`)
 */
function pathCovered(pattern: string, p: string): boolean {
  if (pattern.endsWith("/")) return p.startsWith(pattern)
  if (pattern.includes("*")) {
    const re =
      "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "__DS__")
        .replace(/\*/g, "[^/]*")
        .replace(/__DS__/g, ".*") +
      "$"
    return new RegExp(re).test(p)
  }
  return p.includes(pattern)
}

describe("scan-surfaces.md <-> real manifests (doc cannot drift from code)", () => {
  const doc = docText()

  it("the doc file exists and is non-empty (the contract anchor)", () => {
    expect(doc.length).toBeGreaterThan(1000)
  })

  describe("Type A - code surface (exact list equality, doc vs manifest exports)", () => {
    const typeA = sectionBetween(doc, "### Type A", "### Type B")

    it("the doc points at the two surface manifests (sanity: right modules)", () => {
      expect(typeA).toContain("encoding-surface.mjs")
      expect(typeA).toContain("fragile-range-patterns.mjs")
    })

    // name -> expected manifest export. The doc normalizes with trailing
    // slashes; docSurfaceList strips them before comparing.
    const SURFACE_CASES: Array<{ name: string; manifest: string[] }> = [
      { name: "ALWAYS_SCAN_DIRS", manifest: ALWAYS_SCAN_DIRS },
      { name: "VPS_SH_PATTERNS", manifest: VPS_SH_PATTERNS },
      { name: "OPS_SH_PATTERNS", manifest: OPS_SH_PATTERNS },
      { name: "YAML_GATE_PATTERNS", manifest: YAML_GATE_PATTERNS },
      { name: "DOCS_PATTERNS", manifest: DOCS_PATTERNS },
      { name: "TARGET_DIRS", manifest: TARGET_DIRS },
      { name: "EXCLUDED_TREES", manifest: EXCLUDED_TREES },
    ]

    for (const { name, manifest } of SURFACE_CASES) {
      it(`CONTRACT: doc's \`${name}\` list equals the manifest export`, () => {
        const documented = docSurfaceList(typeA, name)
        expect(documented, `doc must document \`${name}\` with a parenthesized list (format drifted?)`).not.toBeNull()
        expect(documented).toEqual(manifest)
      })
    }

    it("TARGET_EXTS is documented by name (no enumerated list - regex pinned by fragile-range-guard)", () => {
      expect(typeA).toContain("`TARGET_EXTS`")
    })
  })

  describe("Type B - runtime routes (doc retelling vs budget-routes registry)", () => {
    const typeB = sectionBetween(doc, "### Type B", "### Type C")

    it("CONTRACT: the documented route labels match REAL_ROUTE_CHECKS labels in order", () => {
      // Extract every backticked `/...` token in Type B, keep only the ones
      // that are actual registry labels (drops the LHCI concrete slugs and
      // the bare `/`), and compare ORDER (the doc lists them in order).
      // Dedupe with Set: the prose ALSO mentions labels again later (e.g.
      // "`/dashboard` is auth-gated", "route PATTERNS (`/categoria/[slug]`,
      // `/u/[slug]`)") - first-occurrence order is the documented list.
      const docTokens = [...typeB.matchAll(/`(\/[^`]+)`/g)].map((m) => m[1])
      const docRoutes = [...new Set(docTokens.filter((t) => registry.REAL_ROUTE_CHECKS.some((r) => r.label === t)))]
      expect(docRoutes).toEqual(registry.REAL_ROUTE_CHECKS.map((r) => r.label))
    })

    it("CONTRACT: the documented budgetKB sequence matches the manifest default budgets", () => {
      const m = typeB.match(/budgetKB`\s*([0-9/]+)/)
      expect(m, "doc must state the per-route budgetKB sequence").not.toBeNull()
      const docBudget = m![1].split("/").map(Number)
      expect(docBudget).toEqual(registry.REAL_ROUTE_CHECKS.map((r) => r.budgetKB))
    })

    it("CONTRACT: the LHCI concrete slugs the doc names exist in LHC_PATHS", () => {
      // The doc does not enumerate all LHC_PATHS (only cites two concrete
      // slugs as examples) - pin that those two are real audited paths.
      for (const slug of ["/categoria/limpeza", "/u/carlos-encanador"]) {
        expect(typeB).toContain(`\`${slug}\``)
        expect(registry.LHC_PATHS).toContain(slug)
      }
      expect(typeB).toContain("`LHC_PATHS`")
      expect(typeB).toContain("`LHC_URLS`")
    })
  })

  describe("Type C - trigger filters (the SET is a contract, paths are covered)", () => {
    const typeC = sectionBetween(doc, "### Type C", "## 2.")

    // Bullet chunks: split the section at every bullet marker ("- `"), so a
    // WRAPPED description stays one chunk (a per-line `(.*)$` regex would
    // truncate multi-line bullets and lose their continuation tokens). Each
    // chunk's first backticked `.yml` is the workflow file; the always-run
    // bullet ("NO `paths:`") lists three files comma-separated instead of
    // the "`name` - desc" shape - handle both from the same chunk.
    const chunks = typeC.split(/^\s*-\s*(?=`)/m).slice(1)
    const bullets = chunks.map((chunk) => {
      const files = [...chunk.matchAll(/`([\w-]+\.yml)`/g)].map((m) => m[1])
      const alwaysRun = chunk.includes("NO `paths:`")
      return {
        file: files[0],
        files,
        alwaysRun,
        // Coverage tokens: every backticked item in the chunk except the
        // leading workflow file name and YAML anchor names (&cache_paths).
        // Kept per-chunk so the coverage loop below reads them directly.
        tokens: alwaysRun ? [] : [...chunk.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((t) => t !== files[0] && !t.startsWith("&")),
      }
    })
    const docTriggers = bullets.filter((b) => !b.alwaysRun).map((b) => b.file)
    const docAlwaysRun = bullets.filter((b) => b.alwaysRun).flatMap((b) => b.files)

    it("the doc documents ci.yml/deploy.yml/pr-check.yml/guard-gates.yml as always-run (NO paths:)", () => {
      // guard-gates.yml joined the always-run set in 2026-08: the push net
      // for the guard vitest suites (fragile-range-guard + golden-copy-utils
      // em todo push a main/develop, imune a skip por lint). It has no
      // paths: block BY DESIGN (same decision as utf8-check.yml) — a filter
      // limited to e2e/** src/** would silently skip the net on exactly the
      // gate-file changes the guard suites exist to catch.
      expect(docAlwaysRun).toEqual(["ci.yml", "deploy.yml", "pr-check.yml", "guard-gates.yml"])
    })

    it("CONTRACT: the SET of workflows with a `paths:` block equals the documented trigger set", () => {
      // Adding a `paths:` block to any other workflow (ci/deploy/pr-check,
      // a new workflow) - or removing one from a documented trigger - fails
      // here: the trigger set is the contract, even though the globs inside
      // are hints.
      const wfFiles = fs.readdirSync(WF_DIR).filter((f) => f.endsWith(".yml")).sort()
      const withPaths = wfFiles.filter((f) => extractPaths(fs.readFileSync(path.join(WF_DIR, f), "utf8")).length > 0)
      expect(withPaths).toEqual([...docTriggers].sort())
    })

    it("ci.yml / deploy.yml / pr-check.yml actually have NO paths: block", () => {
      for (const f of docAlwaysRun) {
        expect(extractPaths(fs.readFileSync(path.join(WF_DIR, f), "utf8")), `${f} must have no paths: block`).toEqual([])
      }
    })

    for (const { file, tokens } of bullets.filter((b) => !b.alwaysRun)) {
      it(`COVERAGE: every actual \`paths:\` entry of ${file} is covered by the doc's documented tokens`, () => {
        // Documented tokens = the backticked items in the bullet chunk
        // (anchor names like &cache_paths and the workflow's own name are
        // not path patterns - already filtered in the chunk parse). The
        // workflow's own file is always covered (the doc says "+ its own
        // workflow file" where present).
        const actual = extractPaths(fs.readFileSync(path.join(WF_DIR, file), "utf8"))
        expect(actual.length, `${file} must have a non-empty paths: block`).toBeGreaterThan(0)
        for (const p of actual) {
          const covered = p === `.github/workflows/${file}` || tokens.some((t) => pathCovered(t, p))
          expect(
            covered,
            `${file}: doc tokens [${tokens.join(", ")}] must cover actual path ${p} - the trigger set changed, update docs/scan-surfaces.md (and this test's extractor if the doc format changed)`,
          ).toBe(true)
        }
      })
    }
  })
})
