#!/usr/bin/env node
/**
 * budget-routes.mjs - the versioned ROUTE REGISTRY for the JS budget gates.
 *
 * WHY THIS EXISTS (read before you hardcode a route list in a consumer):
 *   the audited routes used to be defined in FOUR places that could
 *   silently drift - check-js-budget.mjs (check 7 REAL_ROUTE_CHECKS, the
 *   real-transfer-per-route byte gate), bundle-report.mjs (the per-route
 *   anti-regression ROUTE_DELTA_KB map), lighthouserc*.json (the LHCI
 *   audited URL arrays) and the Lighthouse CI workflow's smoke-test loop.
 *   Adding a route meant editing gate + report + config + workflow, and
 *   nothing enforced they stayed in sync - the same drift class that
 *   fragile-range-patterns.mjs TARGET_DIRS and encoding-surface.mjs close
 *   for scan surfaces. THIS module is the canonical list: export the
 *   arrays, expose --print-* query modes, and every consumer DERIVES from
 *   the module - there is no second copy to keep in sync.
 *
 * API (importable - entry-point guarded):
 *   import { REAL_ROUTE_CHECKS, LHC_URLS, LHC_PATHS } from "./budget-routes.mjs"
 *
 *   REAL_ROUTE_CHECKS  check-7 real-transfer route checks (check-js-budget
 *                      consumes the array directly; bundle-report derives
 *                      its per-route main-delta thresholds from the SAME
 *                      labels + deltaEnvKey, so the gate and the report can
 *                      never diverge - a route added here is audited by
 *                      both in the same commit)
 *   LHC_URLS           the audited Lighthouse CI URLs. The lighthouserc*.json
 *                      `ci.collect.url` arrays are DERIVED from this list -
 *                      the CONTRACT test in budget-routes.test.ts fails if
 *                      the committed JSONs drift from it. NOTE: the LHCI
 *                      surface is NOT identical to REAL_ROUTE_CHECKS - LHCI
 *                      audits the home page (covered by check 1, not check
 *                      7) and CONCRETE slugs (/categoria/limpeza,
 *                      /u/carlos-encanador) of the pattern routes, while
 *                      /dashboard is a check-7 route but not LHCI-audited
 *                      (authenticated page). The two lists are intentionally
 *                      separate; both are versioned HERE.
 *   LHC_PATHS          the URL paths of LHC_URLS (the lighthouse-ci.yml
 *                      smoke-test loop derives its route list from
 *                      --print-lhci-paths, so it can never drift from the
 *                      audited surface)
 *
 * CLI (what workflows/tests call - STANDALONE ONLY, one flag per call):
 *   node scripts/budget-routes.mjs --print-routes
 *     prints REAL_ROUTE_CHECKS labels space-joined (the check-7 routes)
 *   node scripts/budget-routes.mjs --print-lhci-paths
 *     prints LHC_PATHS space-joined (lighthouse-ci.yml smoke-test loop)
 *   node scripts/budget-routes.mjs --print-lhci-urls
 *     prints LHC_URLS space-joined (LHCI config derivation / guards)
 *   Zero flags or two+ flags is a usage error (exit 2) - the same
 *   no-silent-ignore posture every gate in this repo keeps.
 *
 * Exit codes: 0 = printed a surface - 2 = usage error (wrong/missing flag).
 */
import { pathToFileURL } from "node:url"

function num(raw, fallback) {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// Real transfer per route - the exact first-paint JS the browser downloads,
// parsed from each static/ISR route's prerendered HTML (Next 16 emits one
// flat .html per route: busca.html, u/carlos-encanador.html). `htmlRel` is
// relative to .next/server/app; `*` matches any prerendered segment, so for
// dynamic-param routes the WORST-CASE file is enforced (the heaviest variant
// defines the user experience).
// Budgets = measured 2026-08-08 (recalibrated after the dashboard panels and
// the /busca search page became next/dynamic ssr:false / pure CSS) + ~20%
// headroom: /busca 261.1 KB -> 320 (was 301.4 with the search page eager),
// /dashboard 218.2 KB -> 270 (was 623.8 statically bundling the 3 panels +
// framer/recharts - now lazy via dashboard-page-client), /u/[slug] 228.6 KB
// -> 280. Same values are mirrored as inputs in .github/workflows/ci.yml and
// .github/workflows/release-deploy.yml.
// deltaEnvKey = the per-route threshold env of the bundle-report 'main'
// anti-regression gate (bundle-report derives its ROUTE_DELTA_KB from here).
export const REAL_ROUTE_CHECKS = [
  {
    label: "/busca",
    htmlRel: "busca.html",
    envKey: "JS_BUDGET_REAL_BUSCA_KB",
    deltaEnvKey: "JS_BUDGET_MAIN_DELTA_ROUTE_BUSCA_KB",
    budgetKB: num(process.env.JS_BUDGET_REAL_BUSCA_KB, 320),
  },
  {
    label: "/dashboard",
    htmlRel: "dashboard.html",
    envKey: "JS_BUDGET_REAL_DASHBOARD_KB",
    deltaEnvKey: "JS_BUDGET_MAIN_DELTA_ROUTE_DASHBOARD_KB",
    budgetKB: num(process.env.JS_BUDGET_REAL_DASHBOARD_KB, 270),
  },
  {
    label: "/u/[slug]",
    htmlRel: "u/*.html",
    envKey: "JS_BUDGET_REAL_U_KB",
    deltaEnvKey: "JS_BUDGET_MAIN_DELTA_ROUTE_U_KB",
    budgetKB: num(process.env.JS_BUDGET_REAL_U_KB, 280),
  },
  // /categoria/[slug] - added 2026-08-08: the proof-of-gate exercise proved
  // check 6 (layout+page chunk sum) is STRUCTURALLY blind to route code in
  // Next 16's app router (the page-*.js is a tiny entry stub; all real page
  // code + imports live in numbered chunks outside the route dir that
  // routeGzip never sums). The real-transfer technique (parse the
  // prerendered HTML script list, sum gzip - worst case over params) sees
  // those numbered chunks, so a heavy static import on any /categoria page
  // IS caught here. Budget calibrated via --update 2026-08-08: measured
  // 259.0 KB (worst of 27 prerendered params) + ~20% headroom -> 320 KB.
  // NOTE: /categoria/[slug]/[child] is NOT wired - findPrerenderedHtml
  // supports one `*` glob level only (last segment); the child route is
  // backstopped by check 2 (total) + check 3 (largest chunk).
  {
    label: "/categoria/[slug]",
    htmlRel: "categoria/*.html",
    envKey: "JS_BUDGET_REAL_CATEGORIA_KB",
    deltaEnvKey: "JS_BUDGET_MAIN_DELTA_ROUTE_CATEGORIA_KB",
    budgetKB: num(process.env.JS_BUDGET_REAL_CATEGORIA_KB, 320),
  },
]

// Audited Lighthouse CI URLs (desktop + mobile share the same list - see the
// lighthouserc*.json CONTRACT test). The home page is LHCI-audited but not a
// check-7 route (its initial JS is check 1's metric); /dashboard is a
// check-7 route but not LHCI-audited (authenticated page).
export const LHC_BASE_URL = "http://localhost:3000"
export const LHC_PATHS = ["/", "/busca", "/categoria/limpeza", "/u/carlos-encanador"]
export const LHC_URLS = LHC_PATHS.map((p) => LHC_BASE_URL + p)

// Query mode -> resolver (module exports are NOT on globalThis, so a lookup
// map is required - same convention as encoding-surface.mjs).
const QUERIES = {
  "--print-routes": () => REAL_ROUTE_CHECKS.map((r) => r.label).join(" "),
  "--print-lhci-paths": () => LHC_PATHS.join(" "),
  "--print-lhci-urls": () => LHC_URLS.join(" "),
}

function main() {
  const args = process.argv.slice(2)
  if (args.length !== 1 || !(args[0] in QUERIES)) {
    console.error(
      "usage: node scripts/budget-routes.mjs <--print-routes|--print-lhci-paths|--print-lhci-urls>",
    )
    process.exit(2)
  }
  console.log(QUERIES[args[0]]())
}

// Entry-point guard: only run the CLI when executed directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
