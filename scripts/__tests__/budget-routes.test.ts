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
import { beforeAll, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { runSubprocess } from "./golden-copy-utils"

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

/** Run the registry CLI with the given args. */
function runCli(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = runSubprocess({ command: "node", args: [MODULE, ...args] })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

describe("budget-routes.mjs - versioned route registry", () => {
  it("module is syntactically valid (node --check)", () => {
    const r = runSubprocess({ command: "node", args: ["--check", MODULE] })
    expect(r.status).toBe(0)
  })

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
  })

  it("CLI: --print-lhci-paths / --print-lhci-urls match the exported arrays", () => {
    const paths = runCli("--print-lhci-paths")
    expect(paths.status).toBe(0)
    expect(paths.stdout.trim()).toBe(registry.LHC_PATHS.join(" "))
    const urls = runCli("--print-lhci-urls")
    expect(urls.status).toBe(0)
    expect(urls.stdout.trim()).toBe(registry.LHC_URLS.join(" "))
  })

  it("CLI: zero flags is a usage error (exit 2, no silent default)", () => {
    const r = runCli()
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("usage:")
  })

  it("CLI: two print flags is a usage error (exit 2, no-silent-ignore)", () => {
    const r = runCli("--print-routes", "--print-lhci-paths")
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("usage:")
  })

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
    expect(src).not.toMatch(/\"\/busca\": numEnv\(/)
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
})
