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
 * The Type sections are validated differently, matching each list's nature
 * (see the doc's sections 3 and 5):
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
 *   Type D - workflow_dispatch reachability (a WORKFLOW contract, not one of
 *     the three list kinds - see the doc's section 5): the SET of workflows
 *     with `workflow_dispatch:` must equal the documented dispatch set,
 *     `workflow_dispatch:` is never the ONLY trigger (hermetic, blocking),
 *     and dispatch workflows missing on the default branch emit the Prova 7
 *     warning (git-aware, SOFT - a workflow added in the current PR branch is
 *     legitimately absent from the default branch until merged, so the check
 *     must not block the PR that introduces it).
 *
 *   Type E - ci-proof branch template (a WORKFLOW contract, like Type D):
 *     the SAFETY invariant that makes `ci-proof/*` the permanent proof
 *     branch - no workflow's `push:`/`pull_request:` filter may match a
 *     `ci-proof/*` branch, and every PRESENT push/PR trigger must carry a
 *     `branches:`/`tags:` filter (a filter-less push fires on EVERY branch,
 *     silently breaking the template). Main push fires deploy.yml and v*
 *     tags fire release-deploy.yml (the DANGER refs the doc names); the
 *     matrix and the invariant are pinned below.
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
  MJS_GATE_PATTERNS,
  OPS_SH_PATTERNS,
  VPS_SH_PATTERNS,
  YAML_GATE_PATTERNS,
} from "../encoding-surface.mjs"
import { EXCLUDED_TREES, TARGET_DIRS } from "../fragile-range-patterns.mjs"
import { ALWAYS_RUN_SET, CI_PROOF_NAMESPACE, CI_PROOF_PATTERN, CI_PROOF_PROBE, DANGER_REFS, DISPATCH_SET, GUARD_NET, GUARD_NET_JOB } from "../workflow-contracts.mjs"
import { isCiProofBranch } from "../ci-proof-run.mjs"
import { runSubprocess } from "./golden-copy-utils"

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

/**
 * Package-manager INVOCATION detector (Type F, negative contract).
 *
 * Two shapes: `(pnpm|npm|npx) <verb>` with a known install verb, and
 * `npx <command>` (npx takes a package/command, not a verb - `npx tsx`).
 * Requires WHITESPACE after the manager name, so prose
 * ("bunx (nao npx)" - the hook-parallel-race comment) and layout
 * DETECTION ("node_modules/.pnpm" - check-health defensive check) never
 * trip: `.pnpm` has a `/` right after pnpm, not whitespace. "pnpm hoisting"
 * (prose in check-health.sh) has a non-verb after pnpm - also safe.
 */
const PKG_MGR_INVOCATION_RE =
  /\b(?:pnpm|npm|npx)\s+(?:install|add|run|exec|ci|dlx|audit|rebuild|update|remove|uninstall|link|outdated|why|test|t|start|init|publish|pack|prune|dedupe|version|whoami|login|logout|view|search|help|docs|i|un|up|rm|rb|ls|--)(?:\s|$)|\bnpx\s+[\w@.\/-]+/

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
 * The shared glob core (rule of two - used by BOTH pathCovered and
 * branchPatternMatches): a pattern to a RegExp string where `**` crosses
 * directory separators, `*` stays within a segment, everything else is
 * escaped. The two matchers differ only in the BARE-token semantics:
 * pathCovered (doc tokens) treats a bare token as a SUBSTRING, while
 * branchPatternMatches (branch filters) treats it as an EXACT match.
 */
function globToRegExp(pattern: string): string {
  return (
    "^" +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "__DS__")
      .replace(/\*/g, "[^/]*")
      .replace(/__DS__/g, ".*") +
    "$"
  )
}

/**
 * Coverage matcher for a documented trigger token against an actual path:
 *   - trailing `/`  -> dir-prefix match (doc's `src/lib/`)
 *   - contains `*`  -> glob match (`**` crosses dirs, `*` stays in a segment)
 *   - otherwise     -> substring match (doc's bare `severinno-ssh`/`health-check.yml`)
 */
function pathCovered(pattern: string, p: string): boolean {
  if (pattern.endsWith("/")) return p.startsWith(pattern)
  if (pattern.includes("*")) return new RegExp(globToRegExp(pattern)).test(p)
  return p.includes(pattern)
}

/**
 * Known GitHub Actions trigger keys (the `on:` block's allowed names). ONLY
 * these are kept when parsing triggers, so YAML noise under a trigger (e.g.
 * `inputs:` under `workflow_dispatch:`, `branches:`/`paths:` under `push:`)
 * never pollutes the parsed trigger set.
 */
const TRIGGER_KEYS = new Set([
  "push",
  "pull_request",
  "pull_request_target",
  "schedule",
  "workflow_dispatch",
  "workflow_call",
  "workflow_run",
  "repository_dispatch",
  "issue_comment",
  "issues",
  "discussion",
  "discussion_comment",
  "watch",
  "fork",
  "star",
  "create",
  "delete",
  "release",
  "page_build",
  "registry_package",
  "project",
  "project_card",
  "project_column",
  "milestone",
  "deployment",
  "deployment_status",
  "merge_group",
  "gollum",
  "member",
  "public",
  "status",
  "team_add",
])

/**
 * Minimal `on:` trigger extractor (js-yaml is NOT a dependency; the trigger
 * block is a top-level `on:`/`"on":` key with indented trigger keys, or the
 * flow form `on: [push, workflow_dispatch]`). Returns the deduped trigger
 * keys in document order (a workflow has a single `on:` block).
 */
function extractTriggers(src: string): string[] {
  const out: string[] = []
  const lines = src.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:"on"|on)\s*:/)
    if (!m) continue
    const flow = lines[i].match(/\[([^\]]*)\]/)
    if (flow) {
      for (const raw of flow[1].split(",")) {
        const name = raw.trim().split(/[:\s]/)[0]
        if (TRIGGER_KEYS.has(name)) out.push(name)
      }
      continue
    }
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]
      // next top-level key ends the on: block; a column-0 COMMENT between
      // trigger keys (valid YAML) must not end it early (under-flag risk).
      if (/^\S/.test(l) && !l.trim().startsWith("#")) break
      const inner = l.match(/^\s+([A-Za-z_][\w-]*)\s*:/)
      if (inner && TRIGGER_KEYS.has(inner[1])) out.push(inner[1])
    }
  }
  return [...new Set(out)]
}

/** dispatch-only = `workflow_dispatch:` present and no other trigger. */
function dispatchOnly(src: string): boolean {
  const t = extractTriggers(src)
  return t.includes("workflow_dispatch") && t.length === 1
}

/** Pure diff: local dispatch workflows absent from the default branch's set. */
function missingOnDefault(local: string[], onDefault: string[]): string[] {
  const present = new Set(onDefault)
  return [...new Set(local)].filter((f) => !present.has(f))
}

/** The Prova 7 warning line (pinned by mutation; emitted, never a gate). */
function dispatchWarning(missing: string[], ref: string): string {
  return `[scan-surfaces] Prova 7: dispatch via API/UI 404s for workflows outside the default branch - ${missing.join(", ")} not on ${ref}; they cannot be dispatched from the Actions tab until merged`
}

/** Resolve the remote default branch (origin/HEAD); null when unavailable. */
function defaultBranchRef(): string | null {
  const r = runSubprocess({ command: "git", args: ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], timeoutMs: 15_000 })
  return r.status === 0 ? r.stdout.trim() || null : null
}

/**
 * Workflow file NAMES present on the given ref's tree (one spawn). Returns
 * null on a FAILED spawn - the caller must SKIP, not treat every dispatch
 * workflow as "missing" (a transient ls-tree failure would otherwise emit a
 * full-file Prova 7 warning burst). An empty array is the genuine "ref valid
 * but no workflows" state.
 */
function workflowFilesOnDefault(ref: string): string[] | null {
  const r = runSubprocess({ command: "git", args: ["ls-tree", "-r", "--name-only", ref, "--", ".github/workflows"], timeoutMs: 30_000 })
  if (r.status !== 0) return null
  return r.stdout
    .split(/\r?\n/)
    .filter((p) => p.endsWith(".yml"))
    .map((p) => p.replace(/^\.github\/workflows\//, ""))
}

/**
 * Type D section text (throws if the header moved - same rule as sectionBetween).
 * Bound at "### Type E": the Type D dispatch-set extraction counts backticked
 * `*.yml` tokens in ITS section only - section 6's matrix backticks OTHER
 * workflows (deploy.yml, release-deploy.yml, ...) that are NOT dispatch
 * targets, and an unbounded slice would leak them into the CONTRACT set.
 */
function typeDText(doc: string): string {
  const i = doc.indexOf("### Type D")
  if (i === -1) throw new Error(`scan-surfaces.md: header "### Type D" not found - update this extractor`)
  const j = doc.indexOf("### Type E", i)
  if (j === -1) throw new Error(`scan-surfaces.md: header "### Type E" not found after "### Type D" - update this extractor`)
  return doc.slice(i, j)
}

/** Type E section text (throws if the header moved - same rule as sectionBetween). */
function typeEText(doc: string): string {
  const i = doc.indexOf("### Type E")
  if (i === -1) throw new Error(`scan-surfaces.md: header "### Type E" not found - update this extractor`)
  const j = doc.indexOf("### Type F", i)
  if (j === -1) throw new Error(`scan-surfaces.md: header "### Type F" not found after "### Type E" - update this extractor`)
  return doc.slice(i, j)
}

/** Type F section text (throws if the header moved - same rule as sectionBetween). */
function typeFText(doc: string): string {
  const i = doc.indexOf("### Type F")
  if (i === -1) throw new Error(`scan-surfaces.md: header "### Type F" not found - update this extractor`)
  return doc.slice(i)
}

interface TriggerFilterInfo {
  /** The trigger key (`push`/`pull_request`) exists in the on: block. */
  present: boolean
  /** `branches-ignore:`/`tags-ignore:` - INVERTED semantics: fires on every branch EXCEPT the listed patterns. */
  ignore: boolean
  /** Branch/tag patterns from branches:/tags: lists (quotes stripped, deduped). */
  patterns: string[]
  /** The trigger block carries a branches:/tags: (or -ignore) filter at all. */
  hasFilter: boolean
}

/**
 * Branch/tag filter of a workflow trigger (`push:`/`pull_request:`). Parses
 * the flow form (`branches: [main, develop]`), the block form (`branches:`
 * + `- main`) and the `tags:` variant (release-deploy pushes v* TAGS, never
 * branches). `present=false` means the trigger is absent (workflow_call-only
 * workflows) - distinct from `present=true && hasFilter=false`, which means
 * the trigger fires on EVERY branch: the ci-proof template breaker.
 */
function triggerFilter(src: string, trigger: "push" | "pull_request"): TriggerFilterInfo {
  const patterns: string[] = []
  let hasFilter = false
  let ignore = false
  let present = false
  const lines = src.split(/\r?\n/)
  let inOn = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!inOn) {
      if (/^(?:"on"|on)\s*:/.test(line)) inOn = true
      continue
    }
    // top-level key (not a comment) ends the on: block
    if (/^\S/.test(line) && !line.trim().startsWith("#")) break
    const tm = line.match(new RegExp(`^\\s+${trigger}:\\s*(.*)$`))
    if (!tm) continue
    present = true
    const flow = tm[1].match(/\[([^\]]*)\]/)
    if (flow) {
      // trigger line itself in flow form (rare: `push: [main]`)
      hasFilter = true
      for (const b of flow[1].split(",")) {
        const t = b.trim().replace(/^["']|["']$/g, "")
        if (t) patterns.push(t)
      }
      continue
    }
    // block form: scan sub-keys for branches:/tags: (or -ignore variants)
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]
      if (/^\S/.test(l) && !l.trim().startsWith("#")) break // next top-level key
      const keyM = l.match(/^\s+(branches|tags)(-ignore)?:\s*(.*)$/)
      if (!keyM) continue
      hasFilter = true
      if (keyM[2]) ignore = true
      const bflow = keyM[3].match(/\[([^\]]*)\]/)
      if (bflow) {
        for (const b of bflow[1].split(",")) {
          const t = b.trim().replace(/^["']|["']$/g, "")
          if (t) patterns.push(t)
        }
        break // the filter for this trigger is found
      }
      // block list: following `- pattern` lines
      for (let k = j + 1; k < lines.length; k++) {
        const item = lines[k].match(/^\s+-\s+(.+?)\s*$/)
        if (!item) break
        patterns.push(item[1].trim().replace(/^["']|["']$/g, ""))
      }
      break
    }
  }
  return { present, ignore, patterns: [...new Set(patterns)], hasFilter }
}

/**
 * Does a workflow branch/tag PATTERN match a concrete branch? Exact match or
 * minimatch-style glob (`*` stays within a segment, `**` crosses `/`).
 * Substring is NOT a match (branch filters are exact/glob, unlike the
 * doc-token coverage matcher above - the shared glob core lives in
 * globToRegExp).
 */
function branchPatternMatches(pattern: string, branch: string): boolean {
  if (pattern === branch) return true
  if (!pattern.includes("*")) return false
  return new RegExp(globToRegExp(pattern)).test(branch)
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
      { name: "MJS_GATE_PATTERNS", manifest: MJS_GATE_PATTERNS },
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
      // paths: block BY DESIGN (same decision as utf8-check.yml) - a filter
      // limited to e2e/** src/** would silently skip the net on exactly the
      // gate-file changes the guard suites exist to catch.
      // The membership fact lives in the workflow-contracts MANIFEST (the
      // single source of truth) - the doc must retell exactly that set, in
      // the MANIFEST'S document order (not sorted - the sorted comparison
      // below is the anti-drift literal pin in the doc's own order).
      expect(docAlwaysRun).toEqual(ALWAYS_RUN_SET)
      expect(docAlwaysRun).toEqual(["ci.yml", "deploy.yml", "pr-check.yml", "guard-gates.yml"])
    })

    it("MANIFEST: the live always-run workflows (push BRANCHES-triggered with NO paths:) equal the workflow-contracts ALWAYS_RUN_SET", () => {
      // The always-run membership is a manifest fact (workflow-contracts.mjs):
      // the workflows that RUN on every push/PR to a BRANCH with NO paths:
      // filter BY DESIGN (the 8.4 guarantee: a push to main always runs them).
      // Two no-paths lookalikes are EXCLUDED by design: utf8-check.yml is a
      // REUSABLE workflow (workflow_call - the always-run contract is about
      // workflows that gate the push themselves, not the ones called BY the
      // gates) and release-deploy.yml pushes on TAGS (v*) only - its trigger
      // is a release event, not a branch push. A workflow gaining a branch
      // push/PR trigger without a paths: filter - or losing paths: from an
      // always-run member - must update the manifest, not drift silently.
      const wfFiles = fs.readdirSync(WF_DIR).filter((f) => f.endsWith(".yml")).sort()
      const alwaysRunLive = wfFiles.filter((f) => {
        const src = fs.readFileSync(path.join(WF_DIR, f), "utf8")
        // push or pull_request trigger present...
        const hasPushPr = /^\s+(push|pull_request):\s*$/m.test(src)
        if (!hasPushPr || extractPaths(src).length > 0) return false
        // ...but a REUSABLE workflow (workflow_call: under on:) is called by
        // the gates, not an always-run gate itself - excluded.
        if (/^\s+workflow_call:\s*$/m.test(src)) return false
        // ...and the push trigger must fire on BRANCHES (a tags:-only push is
        // a release event, never a main-branch always-run).
        if (/^\s+push:\s*$/m.test(src) && !/^\s+branches(?:-ignore)?:/m.test(src)) return false
        return true
      })
      expect(alwaysRunLive).toEqual([...ALWAYS_RUN_SET].sort())
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

    it("MANIFEST: the live always-run workflows (push BRANCHES-triggered with NO paths:) equal the workflow-contracts ALWAYS_RUN_SET", () => {
      // The always-run membership is a manifest fact (workflow-contracts.mjs):
      // the workflows that RUN on every push/PR to a BRANCH with NO paths:
      // filter BY DESIGN (the 8.4 guarantee: a push to main always runs them).
      // Two no-paths lookalikes are EXCLUDED by design: utf8-check.yml is a
      // REUSABLE workflow (workflow_call - the always-run contract is about
      // workflows that gate the push themselves, not the ones called BY the
      // gates) and release-deploy.yml pushes on TAGS (v*) only - its trigger
      // is a release event, not a branch push. A workflow gaining a branch
      // push/PR trigger without a paths: filter - or losing paths: from an
      // always-run member - must update the manifest, not drift silently.
      const wfFiles = fs.readdirSync(WF_DIR).filter((f) => f.endsWith(".yml")).sort()
      const alwaysRunLive = wfFiles.filter((f) => {
        const src = fs.readFileSync(path.join(WF_DIR, f), "utf8")
        // push or pull_request trigger present...
        const hasPushPr = /^\s+(push|pull_request):\s*$/m.test(src)
        if (!hasPushPr || extractPaths(src).length > 0) return false
        // ...but a REUSABLE workflow (workflow_call: under on:) is called by
        // the gates, not an always-run gate itself - excluded.
        if (/^\s+workflow_call:\s*$/m.test(src)) return false
        // ...and the push trigger must fire on BRANCHES (a tags:-only push is
        // a release event, never a main-branch always-run).
        if (/^\s+push:\s*$/m.test(src) && !/^\s+branches(?:-ignore)?:/m.test(src)) return false
        return true
      })
      expect(alwaysRunLive).toEqual([...ALWAYS_RUN_SET].sort())
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

  describe("Type D - workflow_dispatch reachability (Prova 7: dispatch 404s off the default branch)", () => {
    const typeD = typeDText(doc)

    const wfFiles = fs.readdirSync(WF_DIR).filter((f) => f.endsWith(".yml")).sort()
    const dispatchWorkflows = wfFiles.filter((f) =>
      extractTriggers(fs.readFileSync(path.join(WF_DIR, f), "utf8")).includes("workflow_dispatch"),
    )
    // Documented dispatch set: every backticked `name.yml` in the Type D
    // section (the section's prose must ONLY backtick dispatch workflows).
    const docDispatch = [...typeD.matchAll(/`([\w-]+\.yml)`/g)].map((m) => m[1])

    it("CONTRACT: the SET of workflows with workflow_dispatch: equals the documented dispatch set", () => {
      expect([...dispatchWorkflows].sort()).toEqual([...new Set(docDispatch)].sort())
    })

    it("MANIFEST: the LIVE dispatch set equals the workflow-contracts DISPATCH_SET (a workflow gaining/losing workflow_dispatch: must update the manifest, not just the doc)", () => {
      // The manifest is the single source of truth for the dispatch facts;
      // this pins the LIVE tree against it (the registry cannot drift from
      // reality - the workflow-contracts.test.ts suite pins the reverse
      // direction on a synthetic copy). The doc retelling is validated
      // against the manifest below.
      expect([...dispatchWorkflows].sort()).toEqual([...DISPATCH_SET].sort())
    })

    it("HERMETIC: workflow_dispatch: is never the ONLY trigger of a workflow (dispatch-only compounds the Prova 7 404: unreachable AND undispatchable)", () => {
      const offenders = wfFiles.filter((f) => dispatchOnly(fs.readFileSync(path.join(WF_DIR, f), "utf8")))
      expect(offenders).toEqual([])
    })

    it("GIT-AWARE: dispatch workflows missing on the default branch emit the Prova 7 warning (skips when the default-branch ref is unavailable)", { timeout: 60000 }, () => {
      const ref = defaultBranchRef()
      if (!ref) return // graceful skip: shallow CI checkout or no origin/HEAD
      const onDefault = workflowFilesOnDefault(ref)
      if (!onDefault) return // ls-tree failed: skip, never warn-burst (null vs [])
      const missing = missingOnDefault(dispatchWorkflows, onDefault)
      if (missing.length > 0) {
        process.stderr.write(dispatchWarning(missing, ref) + "\n")
      }
      // WARNING posture, not a gate: a workflow added in the current PR
      // branch is legitimately absent from the default branch until merged.
      // The assertion pins that the git path executed end-to-end (non-vacuous).
      expect(Array.isArray(onDefault)).toBe(true)
    })

    it("MUTATION: extractTriggers parses block, flow, quoted-on and nested-noise forms", () => {
      expect(
        extractTriggers("on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n    inputs:\n      env:\n        required: true\n"),
      ).toEqual(["push", "workflow_dispatch"])
      expect(extractTriggers("on: [push, workflow_dispatch]")).toEqual(["push", "workflow_dispatch"])
      expect(extractTriggers('"on":\n  pull_request:\n  workflow_call:')).toEqual(["pull_request", "workflow_call"])
      expect(extractTriggers("on:\n  schedule:\n    - cron: '0 0 * * *'\n  workflow_dispatch:")).toEqual(["schedule", "workflow_dispatch"])
    })

    it("MUTATION: dispatchOnly flags dispatch-without-sibling and nothing else", () => {
      expect(dispatchOnly("on:\n  workflow_dispatch:")).toBe(true)
      expect(dispatchOnly("on:\n  workflow_dispatch:\n    inputs:\n      tag:\n")).toBe(true) // inputs noise is not a trigger
      expect(dispatchOnly("on:\n  push:\n  workflow_dispatch:")).toBe(false)
      expect(dispatchOnly("on:\n  workflow_call:")).toBe(false)
    })

    it("MUTATION: missingOnDefault diffs local vs default-branch sets (dedupes)", () => {
      expect(missingOnDefault(["a.yml", "b.yml", "a.yml"], ["a.yml", "c.yml"])).toEqual(["b.yml"])
      expect(missingOnDefault(["a.yml"], ["a.yml"])).toEqual([])
    })

    it("MUTATION: dispatchWarning names the class, the offenders and the ref", () => {
      const w = dispatchWarning(["x.yml"], "origin/release/v0.4.0")
      expect(w).toContain("Prova 7")
      expect(w).toContain("x.yml")
      expect(w).toContain("origin/release/v0.4.0")
    })
  })

  describe("Type E - ci-proof branch template (Prova 7: main fires deploy; ci-proof/* must fire nothing)", () => {
    const typeE = typeEText(doc)
    const wfFiles = fs.readdirSync(WF_DIR).filter((f) => f.endsWith(".yml")).sort()
    // The canonical probe: a branch named ci-proof/<slug> must match ZERO
    // push/PR filters for the template to be safe. CONSUMED FACT: the probe
    // derives from the workflow-contracts manifest (CI_PROOF_PROBE =
    // ci-proof/proof-branch, derived from CI_PROOF_NAMESPACE) - the Type E
    // rule stays a live-tree scan, but the branch it tests against is no
    // longer a hardcoded literal here (renaming the namespace re-derives
    // the probe automatically; pinned in workflow-contracts.test.ts).
    const PROBE = CI_PROOF_PROBE

    it("SAFETY invariant: no workflow's push/pull_request filter matches a ci-proof/* branch (the template is a contract, not a convention)", () => {
      for (const f of wfFiles) {
        const src = fs.readFileSync(path.join(WF_DIR, f), "utf8")
        for (const trig of ["push", "pull_request"] as const) {
          const flt = triggerFilter(src, trig)
          if (flt.present && (!flt.hasFilter || flt.ignore)) {
            // filter-less push fires on EVERY branch; -ignore fires on every
            // branch EXCEPT the listed ones - both would hit ci-proof/*.
            // expect(false) is the conditional-fail: reached only when the
            // invariant is violated, so the suite fails with the file:trig.
            expect(
              false,
              `${f}: ${trig} block is filter-less or -ignore (${JSON.stringify(flt.patterns)}) - it fires on ci-proof/* branches, breaking the proof template`,
            ).toBe(true)
          }
          for (const p of flt.patterns) {
            expect(
              branchPatternMatches(p, PROBE),
              `${f}: ${trig} filter "${p}" matches the ci-proof/* probe - pushing a proof branch would fire this workflow`,
            ).toBe(false)
          }
        }
      }
    })

    it("doc-alignment: the risk matrix names the two DANGER refs (main -> deploy, v* tags -> release) and cross-checks them against the real YAMLs", () => {
      // The doc section backticks the two dangerous workflows and the safe
      // namespace; the real YAMLs must confirm the DANGER rows. The DANGER
      // ref facts live in the workflow-contracts MANIFEST (the canonical
      // matrix) - the doc must name exactly those workflows + the namespace.
      expect(typeE).toContain("`deploy.yml`")
      expect(typeE).toContain("`release-deploy.yml`")
      expect(typeE).toContain(CI_PROOF_NAMESPACE)
      for (const { ref, workflow } of DANGER_REFS) {
        const wf = fs.readFileSync(path.join(WF_DIR, workflow), "utf8")
        const push = triggerFilter(wf, "push")
        expect(push.patterns, `${workflow} must fire on the manifest DANGER ref ${ref}`).toContain(ref)
      }
      // deploy.yml is push-only to main: it must have NO pull_request block
      // (the doc claims PRs never deploy - that is exactly why).
      expect(triggerFilter(fs.readFileSync(path.join(WF_DIR, "deploy.yml"), "utf8"), "pull_request").present).toBe(false)
    })

    it("MUTATION: a push block with only paths: (no branches:/tags:) is the template breaker - it fires on every branch", () => {
      const f = triggerFilter("on:\n  push:\n    paths:\n      - src/**\n", "push")
      expect(f.present).toBe(true)
      expect(f.hasFilter).toBe(false)
      expect(f.patterns).toEqual([])
    })

    it("MUTATION: branches: ['**'] / CI_PROOF_PATTERN match the probe; main and v* tags do not; branches-ignore is INVERTED (also a breaker)", () => {
      // O glob proibido deriva do MANIFEST (CI_PROOF_PATTERN = ci-proof/**,
      // a forma glob da mesma shape do probe) - o teste nunca hardcoda o
      // literal (renomear o namespace re-deriva probe E pattern juntos).
      expect(branchPatternMatches("**", PROBE)).toBe(true)
      expect(branchPatternMatches(CI_PROOF_PATTERN, PROBE)).toBe(true)
      expect(branchPatternMatches("main", PROBE)).toBe(false)
      expect(branchPatternMatches("v*", PROBE)).toBe(false)
      const inv = triggerFilter("on:\n  push:\n    branches-ignore: [main]\n", "push")
      expect(inv.ignore).toBe(true)
    })

    it("CONTRACT: o probe CI_PROOF_PROBE casa com o isCiProofBranch real (a shape ci-proof/<segment> e UNICA nas 3 derivacoes: manifest, helper, Type E glob)", () => {
      // A shape ci-proof/<segment> e derivada em TRES lugares separados: o
      // fato do manifest (CI_PROOF_PROBE = ci-proof/proof-branch), o
      // validador do helper (isCiProofBranch, regex ^ci-proof/[^/]+$) e o
      // glob do Type E (CI_PROOF_PATTERN = ci-proof/**, a forma glob da
      // MESMA shape - tambem um fato do manifest, nao um literal deste
      // bloco). Um drift em QUALQUER um (ex.: o probe ganhar um 2o segmento,
      // ou o regex aceitar aninhamento) faria o probe deixar de ser um
      // branch de prova valido sem nenhum teste apontar a divergencia. Este
      // pin trava a shape unica: o probe (o FATO do manifest) DEVE ser
      // aceito pelo validador REAL do helper E pelo glob do Type E - os
      // tres consomem a mesma shape.
      expect(isCiProofBranch(CI_PROOF_PROBE)).toBe(true)
      expect(branchPatternMatches(CI_PROOF_PATTERN, CI_PROOF_PROBE)).toBe(true)
      // A fronteira e assertada no validador (o mesmo regex que o probe
      // precisa casar): um branch aninhado ci-proof/a/b NAO e um branch de
      // prova valido (o regex recusa; o probe e um unico segmento, nunca
      // aninhado) - a shape e exatamente <ns>/<segment>. O glob do Type E
      // (CI_PROOF_PATTERN) e MAIS ABRANGENTE por construcao (`**` cruza
      // `/`, entao o pattern casaria ate um aninhado) - e exatamente por
      // isso que o invariant testa o PROBE concreto de UM segmento, nao um
      // padrao; so o namespace puro e excluido pelos dois lados.
      expect(isCiProofBranch("ci-proof/a/b")).toBe(false)
      expect(isCiProofBranch(CI_PROOF_NAMESPACE)).toBe(false)
      // O probe e o pattern derivam do namespace: renomear o namespace
      // re-deriva os dois (pinned no workflow-contracts GROWTH) E o regex
      // do helper (default param) - todos seguem o mesmo fato, sem literal
      // hardcoded.
      expect(CI_PROOF_PROBE).toBe(`${CI_PROOF_NAMESPACE}/proof-branch`)
      expect(CI_PROOF_PATTERN).toBe(`${CI_PROOF_NAMESPACE}/**`)
    })

    it("MUTATION: flow and block branch forms parse identically (quotes stripped, deduped); tags: counts as a filter; workflow_call-only has no push", () => {
      const flow = triggerFilter("on:\n  push:\n    branches: [main, develop]\n", "push")
      expect(flow.present).toBe(true)
      expect(flow.hasFilter).toBe(true)
      expect(flow.patterns).toEqual(["main", "develop"])
      const block = triggerFilter('on:\n  push:\n    branches:\n      - "main"\n      - develop\n', "push")
      expect(block.patterns).toEqual(["main", "develop"])
      const tags = triggerFilter('on:\n  push:\n    tags:\n      - "v*"\n', "push")
      expect(tags.hasFilter).toBe(true)
      expect(tags.patterns).toEqual(["v*"])
      // workflow_call-only workflow: push trigger absent (present=false).
      const callOnly = triggerFilter("on:\n  workflow_call:\n    inputs:\n      url:\n", "push")
      expect(callOnly.present).toBe(false)
    })
  })

  describe("Type F - package manager single-source (bun is the ONLY package manager)", () => {
    const typeF = typeFText(doc)

    it("the doc documents the single-package-manager contract and names the removed lockfiles", () => {
      expect(typeF).toContain("bun.lock")
      expect(typeF).toContain("pnpm-lock.yaml")
      expect(typeF).toContain("pnpm-workspace.yaml")
      expect(typeF).toContain("package-lock.json")
      expect(typeF).toContain("mini-services/realtime")
    })

    it(
      "CONTRACT: the ROOT tracked lockfile set equals EXACTLY ['bun.lock'] (root-anchored git ls-files; realtime/ is a separate unit and keeps its own)",
      { timeout: 60_000 },
      () => {
      // Root-anchored: only paths with NO slash. realtime/bun.lock and
      // realtime/package-lock.json live under a subdir and are excluded by
      // the anchor - the separate deployment unit keeps its own lockfiles.
      const r = runSubprocess({ command: "git", args: ["ls-files"], timeoutMs: 60_000 })
      expect(r.status).toBe(0)
      const rootLockfiles = r.stdout
        .split(/\r?\n/)
        .filter((p) => !p.includes("/") && /^(bun\.lock|pnpm-lock\.yaml|pnpm-workspace\.yaml|package-lock\.json|yarn\.lock|npm-shrinkwrap\.json)$/.test(p))
        expect(rootLockfiles).toEqual(["bun.lock"])
      },
    )

    it("NEGATIVE: no executable surface INVOKES pnpm/npm/npx (workflows, composite actions, hooks, scripts/*.{mjs,sh,ps1}, .zscripts, Makefile, package.json, root *.sh)", () => {
      // Scan the executable surfaces for package-manager INVOCATIONS. The
      // regex needs a whitespace+verb (or an npx command) after the manager
      // name, so prose ("bunx (nao npx)") and layout DETECTION
      // ("node_modules/.pnpm" has no whitespace after pnpm) never trip.
      const offenders: string[] = []
      const scan = (file: string, label: string) => {
        // Directory guard: .husky/_ (husky v9 internals), readdir noise, etc.
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return
        const src = fs.readFileSync(file, "utf8")
        src.split(/\r?\n/).forEach((line, i) => {
          // Comment lines are skipped: the doc's contract says prose does not
          // count ("mencao em prosa nao conta") - a comment like
          // "# bunx (nao npx)" or a future "# use npx tsx here" is NOT an
          // invocation. Only run lines (workflow `run:`, Makefile recipes,
          // shell/ps1 bodies) trip the detector. All comment styles are
          // covered because the surface includes .ts/.mjs root tooling
          // (`//` + `*` docblock continuation lines) as well as
          // sh/yml/ps1/Makefile (`#` comments). A real run line never
          // starts with any of these (a YAML `*anchor` ref is a value, not
          // a `run:` command - and it cannot carry a package-manager verb).
          const t = line.trim()
          if (t.startsWith("#") || t.startsWith("//") || t.startsWith("*")) return
          if (PKG_MGR_INVOCATION_RE.test(line)) offenders.push(`${label}:${i + 1}: ${line.trim()}`)
        })
      }
      for (const f of fs.readdirSync(path.join(ROOT, ".github", "workflows")).filter((f) => f.endsWith(".yml"))) {
        scan(path.join(ROOT, ".github", "workflows", f), `.github/workflows/${f}`)
      }
      const actionsDir = path.join(ROOT, ".github", "actions")
      if (fs.existsSync(actionsDir)) {
        const walk = (dir: string) => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name)
            if (e.isDirectory()) walk(p)
            else if (e.name.endsWith(".yml")) scan(p, path.relative(ROOT, p).split(path.sep).join("/"))
          }
        }
        walk(actionsDir)
      }
      for (const f of fs.readdirSync(path.join(ROOT, ".husky"))) scan(path.join(ROOT, ".husky", f), `.husky/${f}`)
      for (const f of fs.readdirSync(path.join(ROOT, "scripts")).filter((f) => /\.(mjs|sh|ps1)$/.test(f))) {
        scan(path.join(ROOT, "scripts", f), `scripts/${f}`)
      }
      const z = path.join(ROOT, ".zscripts")
      if (fs.existsSync(z)) for (const f of fs.readdirSync(z).filter((f) => f.endsWith(".sh"))) scan(path.join(z, f), `.zscripts/${f}`)
      scan(path.join(ROOT, "Makefile"), "Makefile")
      scan(path.join(ROOT, "package.json"), "package.json")
      // Root executable scripts: .sh, .ps1 AND .mjs/.ts tooling
      // (start-server.sh, dev.ps1, test-prisma7.mjs, eslint.config.mjs,
      // next.config.ts, ... - the ROOT_TOOLING surface). A package-manager
      // invocation hidden in a root config script is the same class.
      for (const f of fs.readdirSync(ROOT).filter((f) => /\.(sh|ps1|mjs|ts)$/.test(f))) scan(path.join(ROOT, f), f)
      expect(offenders, `pnpm/npm/npx invocation in an executable surface:\n${offenders.join("\n")}`).toEqual([])
    })

    it("MUTATION: the invocation regex sees real package-manager commands but NOT bun/prose/.pnpm layout", () => {
      expect(PKG_MGR_INVOCATION_RE.test("pnpm install --frozen-lockfile")).toBe(true)
      expect(PKG_MGR_INVOCATION_RE.test("npm run dev")).toBe(true)
      expect(PKG_MGR_INVOCATION_RE.test("npm uninstall foo")).toBe(true)
      expect(PKG_MGR_INVOCATION_RE.test("npm test")).toBe(true)
      expect(PKG_MGR_INVOCATION_RE.test("npm start")).toBe(true)
      expect(PKG_MGR_INVOCATION_RE.test("npm publish")).toBe(true)
      expect(PKG_MGR_INVOCATION_RE.test("npx tsx scripts/coverage-gaps.ts --ci")).toBe(true)
      expect(PKG_MGR_INVOCATION_RE.test("bun install --frozen-lockfile")).toBe(false)
      expect(PKG_MGR_INVOCATION_RE.test("bunx tsx scripts/coverage-gaps.ts --ci")).toBe(false)
      expect(PKG_MGR_INVOCATION_RE.test("# bunx (nao npx) - a convencao bun")).toBe(false)
      expect(PKG_MGR_INVOCATION_RE.test('Test-Path "node_modules/.pnpm"')).toBe(false)
      expect(PKG_MGR_INVOCATION_RE.test("pnpm hoisting correctly")).toBe(false)
      // A whitespace-followed prose mention would trip the raw regex - the
      // NEGATIVE scan skips comment lines so this stays a non-invocation.
      expect(PKG_MGR_INVOCATION_RE.test("# use npx tsx here")).toBe(true)
    })
  })
})
