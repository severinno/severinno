/**
 * budget-routes.test.ts - the versioned ROUTE REGISTRY suite.
 *
 * Pins the single source of truth for the audited routes across the three
 * surfaces that used to hardcode their own copy (the drift class this module
 * exists to kill):
 *   - scripts/check-js-budget.mjs  check 7 REAL_ROUTE_CHECKS (real transfer
 *     per route, parsed from prerendered HTML)
 *   - scripts/bundle-report.mjs    the per-route anti-regression thresholds
 *     (ROUTE_DELTA_KB) on the rolling 'main' row
 *   - lighthouserc*.json + the Lighthouse CI smoke-test loop  the LHCI
 *     audited URL list
 *
 * The ABSOLUTE PINS below are the drift guard (same rule as the golden-copy
 * absolute pins): edit a route in the registry and the pin fails, forcing a
 * deliberate review of every consumer. The CONTRACT tests prove each
 * consumer DERIVES from the module instead of holding a second copy.
 *
 * The GROWTH CONTRACT is the FORWARD direction of the same contract (the
 * mirror of the fragile-range SPREAD CONTRACT + the encoding-surface GROWTH
 * CONTRACT, applied to this THIRD single-source manifest): a 5th route / new
 * LHC path added to the registry is reflected live by the --print-* queries
 * on a temp module copy AND breaks the CONTRACT tests that pin the mirrored
 * consumers (workflow envKey/deltaEnvKey declarations + lighthouserc*.json
 * URL lists) until they are updated in the same commit — the drift class
 * this module exists to kill can never land silently in any of the three
 * manifests.
 *
 * ENV HERMETICITY (why the module is loaded via DYNAMIC import, not a static
 * top-level import): the registry computes `budgetKB` at module scope from
 * env overrides (JS_BUDGET_REAL_*_KB, the documented env-overridable
 * contract). Static imports are HOISTED — they evaluate before any test
 * body runs, so clearing those env keys inside a test could never help. A
 * dev who exported JS_BUDGET_REAL_BUSCA_KB in their shell (the module's own
 * docblock advertises the overrides) would spuriously break the absolute
 * budgetKB pin. beforeAll clears the four override keys, THEN dynamically
 * imports the module, so the pin is hermetic regardless of the runner env.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { cleanupTempDirs, createTempDir, runSubprocess, writeModuleCopy, type ModulePatchOp } from "./golden-copy-utils"

const ROOT = process.cwd()
const MODULE = path.join(ROOT, "scripts", "budget-routes.mjs")

/** The registry exports (loaded hermetically — see the env note above). */
type Registry = typeof import("../budget-routes.mjs")
let registry: Registry

// Env keys the registry reads at module scope for the budgetKB defaults.
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

afterEach(() => {
  cleanupTempDirs()
})

/** Run the registry CLI with the given args. */
function runCli(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = runSubprocess({ command: "node", args: [MODULE, ...args] })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

/**
 * GROWTH CONTRACT harness (mirror of the fragile-range SPREAD CONTRACT + the
 * encoding-surface GROWTH CONTRACT): the registry is a LIVE derivation source,
 * not a frozen snapshot. A 5th route in REAL_ROUTE_CHECKS (or a new LHC path)
 * must be (a) reflected by the --print-* queries on a temp module copy and
 * (b) BREAK the CONTRACT tests that pin the MIRRORED copies (the workflow
 * envKey/deltaEnvKey declarations + the lighthouserc*.json URL lists) until
 * they are updated in the same commit. Built on the SHARED writeModuleCopy
 * scaffold (golden-copy-utils.ts — the rule-of-three extraction): anchors
 * fail loud on shape drift (same posture as writePatchedSurfaceModule /
 * writePatchedModule) instead of a silent no-op.
 */
function writePatchedRoutesModule(
  dir: string,
  patch: { addRoute?: { label: string; envKey: string; deltaEnvKey: string }; lhcPath?: string },
): string {
  const ops: ModulePatchOp[] = []
  if (patch.addRoute) {
    // The array close: the first "\n]" after the opening. Route objects end
    // with "},\n" and never contain a newline-bracket (labels like
    // "/categoria/[slug]" have no "\n]"), so the closing bracket is the only
    // match. Inject the 5th entry right before it — expressed as a single
    // anchor-replace op (open-to-close span → same span + the new entry).
    const route = [
      "  {",
      `    label: ${JSON.stringify(patch.addRoute.label)},`,
      '    htmlRel: "workers/*.html",',
      `    envKey: ${JSON.stringify(patch.addRoute.envKey)},`,
      `    deltaEnvKey: ${JSON.stringify(patch.addRoute.deltaEnvKey)},`,
      "    budgetKB: 250,",
      "  },",
    ].join("\n")
    ops.push({
      anchor: /export const REAL_ROUTE_CHECKS = \[[\s\S]*?\n\]/,
      replace: (m) => m.slice(0, -2) + "\n" + route + "\n]",
      onMissing:
        "GROWTH CONTRACT: could not locate the open-to-close span of REAL_ROUTE_CHECKS in budget-routes.mjs (shape changed) — update this harness",
    })
  }
  if (patch.lhcPath) {
    ops.push({
      anchor: /^export const LHC_PATHS = \[[^\]]*\]$/m,
      replace: (m) => {
        const current = JSON.parse(m.replace(/^export const LHC_PATHS = /, "")) as string[]
        return `export const LHC_PATHS = ${JSON.stringify([...current, patch.lhcPath])}`
      },
      onMissing:
        "GROWTH CONTRACT: could not locate the single-line LHC_PATHS declaration in budget-routes.mjs (shape changed) — update this harness",
    })
  }
  return writeModuleCopy(dir, MODULE, ops)
}

/**
 * Load a (patched) module copy in a real node subprocess and return its
 * registry exports as parsed JSON — the env-hermetic load (a fresh process
 * inherits the cleared BUDGET_ENV_KEYS from the parent, so budgetKB defaults
 * stay stable) AND a transform-free one (no vitest import cache on a temp
 * file path). Same shape as patchModuleCopy's runner in golden-copy-utils.
 */
function runRegistry(
  modPath: string,
): { routes: Array<{ label: string; envKey: string; deltaEnvKey: string }>; paths: string[]; urls: string[] } {
  const dir = createTempDir("br-registry-run-")
  const runnerPath = path.join(dir, "run-registry.mjs")
  fs.writeFileSync(
    runnerPath,
    [
      `import { REAL_ROUTE_CHECKS, LHC_PATHS, LHC_URLS } from ${JSON.stringify(pathToFileURL(modPath).href)}`,
      `process.stdout.write(JSON.stringify({ routes: REAL_ROUTE_CHECKS, paths: LHC_PATHS, urls: LHC_URLS }))`,
      "",
    ].join("\n"),
  )
  const r = runSubprocess({ command: process.execPath, args: [runnerPath] })
  expect(r.status).toBe(0)
  return JSON.parse(r.stdout)
}

describe("budget-routes.mjs - versioned route registry", () => {
  it("module is syntactically valid (node --check)", () => {
    const r = runSubprocess({ command: "node", args: ["--check", MODULE] })
    expect(r.status).toBe(0)
  }, 60000)

  it("ABSOLUTE PIN: REAL_ROUTE_CHECKS (check-7 real-transfer routes, gate + report labels)", () => {
    // The gate's check 7 and the report's ROUTE_DELTA_KB must share ONE label
    // list. Pin the exact entries (label + htmlRel + envKey + deltaEnvKey +
    // budgetKB default) so adding/removing a route forces a deliberate
    // review of both consumers. budgetKB is the env-cleared DEFAULT (see the
    // ENV HERMETICITY note in the docblock).
    expect(registry.REAL_ROUTE_CHECKS).toEqual([
      {
        label: "/busca",
        htmlRel: "busca.html",
        envKey: "JS_BUDGET_REAL_BUSCA_KB",
        deltaEnvKey: "JS_BUDGET_MAIN_DELTA_ROUTE_BUSCA_KB",
        budgetKB: 320,
      },
      {
        label: "/dashboard",
        htmlRel: "dashboard.html",
        envKey: "JS_BUDGET_REAL_DASHBOARD_KB",
        deltaEnvKey: "JS_BUDGET_MAIN_DELTA_ROUTE_DASHBOARD_KB",
        budgetKB: 270,
      },
      {
        label: "/u/[slug]",
        htmlRel: "u/*.html",
        envKey: "JS_BUDGET_REAL_U_KB",
        deltaEnvKey: "JS_BUDGET_MAIN_DELTA_ROUTE_U_KB",
        budgetKB: 280,
      },
      {
        label: "/categoria/[slug]",
        htmlRel: "categoria/*.html",
        envKey: "JS_BUDGET_REAL_CATEGORIA_KB",
        deltaEnvKey: "JS_BUDGET_MAIN_DELTA_ROUTE_CATEGORIA_KB",
        budgetKB: 320,
      },
    ])
  })

  it("ABSOLUTE PIN: LHC_PATHS / LHC_URLS (the LHCI audited surface)", () => {
    // LHCI audits home (covered by check 1, not check 7) + concrete slugs of
    // the pattern routes — intentionally NOT identical to REAL_ROUTE_CHECKS
    // (no /dashboard: authenticated page; home included: not a check-7 route).
    expect(registry.LHC_PATHS).toEqual(["/", "/busca", "/categoria/limpeza", "/u/carlos-encanador"])
    expect(registry.LHC_URLS).toEqual([
      "http://localhost:3000/",
      "http://localhost:3000/busca",
      "http://localhost:3000/categoria/limpeza",
      "http://localhost:3000/u/carlos-encanador",
    ])
  })

  it("CLI: --print-routes prints the check-7 labels space-joined", () => {
    const r = runCli("--print-routes")
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe("/busca /dashboard /u/[slug] /categoria/[slug]")
  }, 60000)

  it("CLI: --print-lhci-paths / --print-lhci-urls match the exported arrays", () => {
    const paths = runCli("--print-lhci-paths")
    expect(paths.status).toBe(0)
    expect(paths.stdout.trim()).toBe(registry.LHC_PATHS.join(" "))
    const urls = runCli("--print-lhci-urls")
    expect(urls.status).toBe(0)
    expect(urls.stdout.trim()).toBe(registry.LHC_URLS.join(" "))
  }, 60000)

  it("CLI: zero flags is a usage error (exit 2, no silent default)", () => {
    const r = runCli()
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("usage:")
  }, 60000)

  it("CLI: two print flags is a usage error (exit 2, no-silent-ignore)", () => {
    const r = runCli("--print-routes", "--print-lhci-paths")
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("usage:")
  }, 60000)

  it("CONTRACT: check-js-budget.mjs IMPORTS REAL_ROUTE_CHECKS from the registry (no inline copy)", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts", "check-js-budget.mjs"), "utf8")
    expect(src).toContain('import { REAL_ROUTE_CHECKS } from "./budget-routes.mjs"')
    // The old inline const is gone — the registry owns the route list.
    expect(src).not.toMatch(/const REAL_ROUTE_CHECKS = \[/)
  })

  it("CONTRACT: bundle-report.mjs IMPORTS the registry and DERIVES ROUTE_DELTA_KB from deltaEnvKey", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts", "bundle-report.mjs"), "utf8")
    expect(src).toContain('import { REAL_ROUTE_CHECKS } from "./budget-routes.mjs"')
    expect(src).toContain("REAL_ROUTE_CHECKS.map((r) => [r.label, numEnv(process.env[r.deltaEnvKey], 30)])")
    // The old hardcoded per-label map is gone — a route added to the registry
    // is gated on the next main push without a second list to update.
    expect(src).not.toMatch(/"\/busca": numEnv\(/)
  })

  it("CONTRACT: lighthouserc.json + lighthouserc.mobile.json derive their URL list from the registry", () => {
    // The committed LHCI configs must match the registry's LHC_URLS exactly —
    // a route added/removed here fails until the JSONs are updated in the
    // same commit (the golden-copy update rule).
    for (const file of ["lighthouserc.json", "lighthouserc.mobile.json"]) {
      const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"))
      expect(cfg.ci.collect.url, file).toEqual(registry.LHC_URLS)
    }
  })

  it("CONTRACT: lighthouse-ci.yml smoke test DERIVES its route list from --print-lhci-paths", () => {
    const src = fs.readFileSync(path.join(ROOT, ".github", "workflows", "lighthouse-ci.yml"), "utf8")
    expect(src).toContain("budget-routes.mjs --print-lhci-paths")
    // The old hardcoded route loop is gone — the smoke test can never drift
    // from the audited surface.
    expect(src).not.toContain('for route in "/" "/busca" "/categoria/limpeza" "/u/carlos-encanador"')
  })

  it("CONTRACT: ci.yml + release-deploy.yml declare the registry's JS_BUDGET_REAL_*_KB env keys", () => {
    // The budgets are mirrored as workflow inputs (policy, not code) — every
    // registry envKey must exist in BOTH pipelines so a new route's budget is
    // settable in CI (or defaults). An envKey absent from a workflow would
    // silently use the registry default — the policy mirror drifted.
    for (const file of ["ci.yml", "release-deploy.yml"]) {
      const src = fs.readFileSync(path.join(ROOT, ".github", "workflows", file), "utf8")
      for (const r of registry.REAL_ROUTE_CHECKS) {
        expect(src, `${file} must declare ${r.envKey}`).toContain(`${r.envKey}:`)
      }
    }
  })

  it("CONTRACT: ci.yml declares the registry's deltaEnvKeys (main anti-regression per-route policy)", () => {
    const src = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8")
    for (const r of registry.REAL_ROUTE_CHECKS) {
      expect(src, `ci.yml must declare ${r.deltaEnvKey}`).toContain(`${r.deltaEnvKey}:`)
    }
  })

  describe("GROWTH CONTRACT (the registry is a LIVE derivation source: a 5th route / new LHC path breaks the CONTRACT tests automatically)", () => {
    // The forward mirror of the fragile-range SPREAD CONTRACT + the
    // encoding-surface GROWTH CONTRACT, applied to the THIRD single-source
    // manifest. The ABSOLUTE PINS above pin the CURRENT state; THIS describe
    // proves the DERIVATION direction: a route/path added to the registry is
    // (a) reflected live by the --print-* queries (CLI-level, temp module
    // copy — no second literal list to forget), and (b) a growth the MIRRORED
    // consumers do NOT absorb silently — the CONTRACT tests that pin the
    // workflow envKey/deltaEnvKey declarations and the lighthouserc*.json URL
    // lists would FAIL until updated in the same commit. The sentinel values
    // are genuinely absent from the real repo (control asserts), so a failure
    // in these tests can only be attributed to the injected growth, never to
    // pre-existing drift (sole-failure-source, same posture as the golden
    // copy divergence tests).
    const SENTINEL_ROUTE = {
      label: "/workers",
      envKey: "JS_BUDGET_REAL_WORKERS_KB",
      deltaEnvKey: "JS_BUDGET_MAIN_DELTA_ROUTE_WORKERS_KB",
    }
    const SENTINEL_LHC_PATH = "/workers-check"

    it("CONTROL: the sentinel route/path is absent from the real registry and the real consumers (sole-failure-source attribution)", () => {
      expect(registry.REAL_ROUTE_CHECKS.some((r) => r.label === SENTINEL_ROUTE.label)).toBe(false)
      expect(registry.LHC_PATHS).not.toContain(SENTINEL_LHC_PATH)
      for (const file of ["ci.yml", "release-deploy.yml"]) {
        const src = fs.readFileSync(path.join(ROOT, ".github", "workflows", file), "utf8")
        expect(src).not.toContain(SENTINEL_ROUTE.envKey)
      }
      for (const file of ["lighthouserc.json", "lighthouserc.mobile.json"]) {
        const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"))
        expect(cfg.ci.collect.url).not.toContain(registry.LHC_BASE_URL + SENTINEL_LHC_PATH)
      }
    })

    it("CLI-level: a 5th REAL_ROUTE_CHECKS entry is reflected by --print-routes on a temp module copy", () => {
      const dir = createTempDir("br-growth-route-")
      const modPath = writePatchedRoutesModule(dir, { addRoute: SENTINEL_ROUTE })
      const r = runSubprocess({ command: "node", args: [modPath, "--print-routes"] })
      expect(r.status).toBe(0)
      expect(r.stdout.trim().split(" ")).toContain(SENTINEL_ROUTE.label)
    }, 60000)

    it("CLI-level: a new LHC path is reflected by --print-lhci-paths / --print-lhci-urls on a temp module copy", () => {
      const dir = createTempDir("br-growth-lhc-")
      const modPath = writePatchedRoutesModule(dir, { lhcPath: SENTINEL_LHC_PATH })
      const paths = runSubprocess({ command: "node", args: [modPath, "--print-lhci-paths"] })
      expect(paths.status).toBe(0)
      expect(paths.stdout.trim().split(" ")).toContain(SENTINEL_LHC_PATH)
      const urls = runSubprocess({ command: "node", args: [modPath, "--print-lhci-urls"] })
      expect(urls.status).toBe(0)
      expect(urls.stdout).toContain(`${registry.LHC_BASE_URL}${SENTINEL_LHC_PATH}`)
    }, 60000)

    it("CONTRACT-bite: under growth the envKey CONTRACT test fails EXACTLY on the new route (only the injected envKey is undeclared)", () => {
      // The existing envKey CONTRACT test loops registry.REAL_ROUTE_CHECKS
      // and requires ci.yml + release-deploy.yml to declare each envKey.
      // Under growth, the injected envKey is the ONLY one missing — the
      // failure is attributable to the growth alone (sole-failure-source).
      const dir = createTempDir("br-growth-bite-env-")
      const modPath = writePatchedRoutesModule(dir, { addRoute: SENTINEL_ROUTE })
      const grew = runRegistry(modPath)
      for (const file of ["ci.yml", "release-deploy.yml"]) {
        const src = fs.readFileSync(path.join(ROOT, ".github", "workflows", file), "utf8")
        const missing = grew.routes.filter((r) => !src.includes(`${r.envKey}:`)).map((r) => r.envKey)
        expect(missing, `${file}: the ONLY undeclared envKey must be the injected one`).toEqual([SENTINEL_ROUTE.envKey])
      }
    })

    it("CONTRACT-bite: under growth the deltaEnvKey CONTRACT test fails EXACTLY on the new route (only the injected deltaEnvKey is undeclared in ci.yml)", () => {
      const dir = createTempDir("br-growth-bite-delta-")
      const modPath = writePatchedRoutesModule(dir, { addRoute: SENTINEL_ROUTE })
      const grew = runRegistry(modPath)
      const ciSrc = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8")
      const missing = grew.routes.filter((r) => !ciSrc.includes(`${r.deltaEnvKey}:`)).map((r) => r.deltaEnvKey)
      expect(missing, "ci.yml: the ONLY undeclared deltaEnvKey must be the injected one").toEqual([SENTINEL_ROUTE.deltaEnvKey])
    })

    it("CONTRACT-bite: under growth the lighthouserc URL toEqual CONTRACT fails while the JSONs stay in sync with the CURRENT surface", () => {
      const dir = createTempDir("br-growth-bite-lhc-")
      const modPath = writePatchedRoutesModule(dir, { lhcPath: SENTINEL_LHC_PATH })
      const grew = runRegistry(modPath)
      for (const file of ["lighthouserc.json", "lighthouserc.mobile.json"]) {
        const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"))
        // The JSONs are in sync with the CURRENT surface (the real CONTRACT
        // test passes today)...
        expect(cfg.ci.collect.url, file).toEqual(registry.LHC_URLS)
        // ...but under growth they do NOT match the grown list — the toEqual
        // CONTRACT test would fail exactly on the new URL (sole source).
        expect(cfg.ci.collect.url, file).not.toEqual(grew.urls)
      }
    })
  })
})
