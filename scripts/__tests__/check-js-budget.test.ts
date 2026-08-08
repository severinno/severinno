/**
 * Unit tests for scripts/check-js-budget.mjs — the JS bundle budget gate.
 *
 * The script resolves everything against process.cwd() and calls
 * process.exit(), so it is exercised as a subprocess with cwd pointed at a
 * synthetic `.next` fixture tree (analyze client.html + build-manifest.json +
 * route chunks). This keeps the gate itself under test without touching the
 * real build artifacts.
 *
 * Covered scenarios:
 *   1. Pass — all budgets within limits → exit 0
 *   2. Route violation via env override (JS_BUDGET_ROUTE_BUSCA_KB) → exit 1
 *   3. Skip — missing chunks produce skipped checks, still exit 0
 *   4. Exit 2 — analyze report absent
 */
import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// Resolve from the repo root — vitest runs with cwd = project root, and the
// script itself uses process.cwd() as its ROOT (the fixture dir we point it
// at). import.meta.url is not reliably a file-scheme URL under vitest's
// transform, so a plain path from the root is the robust choice.
const SCRIPT = path.resolve(process.cwd(), "scripts", "check-js-budget.mjs")

interface Fixture {
  dir: string
  /** Write a file inside the fixture root (mkdir -p included). */
  write(rel: string, content: string): void
}

const tempDirs: string[] = []
afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true })
  }
})

function makeFixture(): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "js-budget-fixture-"))
  tempDirs.push(dir)
  return {
    dir,
    write(rel, content) {
      const p = path.join(dir, rel)
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, content)
    },
  }
}

/** Minimal analyzer HTML with `window.chartData = [...]` (shape the gate parses). */
function chartDataHtml(assets: unknown[]): string {
  return `<html><body><script>window.chartData = ${JSON.stringify(assets)};</script></body></html>`
}

/** Synthetic analyzer asset node (only label/isAsset/gzipSize/groups matter). */
function asset(
  label: string,
  gzipSize: number,
  groups: Record<string, unknown>[] = [],
): Record<string, unknown> {
  return { label, isAsset: true, statSize: gzipSize * 2, parsedSize: gzipSize, gzipSize, groups }
}

/** Run the gate against a fixture dir; returns stdout/stderr/status. */
function runBudget(dir: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 30_000,
  })
}

describe("scripts/check-js-budget.mjs", () => {
  it("passes (exit 0) when all budgets are within limits", () => {
    const f = makeFixture()
    f.write(
      ".next/analyze/client.html",
      chartDataHtml([
        asset("static/chunks/framework-abc.js", 60_000),
        asset("static/chunks/main-app-def.js", 30_000),
        asset("static/chunks/app/layout-abc.js", 10_000),
        asset("static/chunks/app/page-xyz.js", 5_000),
      ]),
    )
    // Prerendered home HTML referencing real chunk files on disk → initial JS
    // is measured from the REAL transfer (not the rootMainFiles fallback).
    f.write(".next/static/chunks/framework-abc.js", "export const f = 1;")
    f.write(".next/static/chunks/main-app-def.js", "export const m = 2;")
    f.write(
      ".next/server/app/index.html",
      '<html><head><script src="/_next/static/chunks/framework-abc.js"></script>' +
        '<script src="/_next/static/chunks/main-app-def.js"></script></head><body></body></html>',
    )
    // Route chunks: root (layout + page) and /busca (page only, root layout shared).
    f.write(".next/static/chunks/app/layout-abc.js", "export const layout = 1;")
    f.write(".next/static/chunks/app/page-xyz.js", "export const page = 1;")
    f.write(".next/static/chunks/app/busca/page-def.js", "export const busca = 1;")

    const r = runBudget(f.dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("All JS budgets within limits")
  })

  it("fails (exit 1) when a route budget is exceeded via env override", () => {
    const f = makeFixture()
    f.write(
      ".next/analyze/client.html",
      chartDataHtml([asset("static/chunks/framework-abc.js", 60_000), asset("static/chunks/main-app-def.js", 30_000)]),
    )
    f.write(".next/static/chunks/app/layout-abc.js", "export const layout = 1;")
    // /busca page with enough unique content to gzip well above 1 KB.
    const bigPage = Array.from({ length: 3000 }, (_, i) => `export const v${i} = ${i};`).join("\n")
    f.write(".next/static/chunks/app/busca/page-def.js", bigPage)

    const r = runBudget(f.dir, { JS_BUDGET_ROUTE_BUSCA_KB: "1" })
    expect(r.status).toBe(1)
    // Check lines print to stdout with parens: "(budget 1 KB)"; the violation
    // string "X KB > budget 1 KB (gzip)" goes to stderr via console.error.
    expect(r.stdout).toContain("route: /busca initial")
    expect(r.stdout).toContain("(budget 1 KB)")
    expect(r.stderr).toContain("> budget 1 KB")
    expect(r.stderr).toContain("route: /busca initial")
  })

  it("falls back to build-manifest rootMainFiles for initial JS when the prerendered HTML is absent", () => {
    const f = makeFixture()
    f.write(
      ".next/analyze/client.html",
      chartDataHtml([asset("static/chunks/framework-abc.js", 60_000), asset("static/chunks/main-app-def.js", 30_000)]),
    )
    // No .next/server/app/index.html → the gate must fall back to the
    // build-manifest rootMainFiles list (gzipped, real files on disk).
    f.write(".next/static/chunks/framework-abc.js", "export const f = 1;")
    f.write(".next/static/chunks/main-app-def.js", "export const m = 2;")
    f.write(
      ".next/build-manifest.json",
      JSON.stringify({ rootMainFiles: ["static/chunks/framework-abc.js", "static/chunks/main-app-def.js"] }),
    )

    const r = runBudget(f.dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("Initial JS (/) rootMainFiles")
    expect(r.stdout).toContain("All JS budgets within limits")
  })

  it("skips route/initial checks (still exit 0) when chunks are missing", () => {
    const f = makeFixture()
    // Analyze report present (total/largest/libs still evaluated and pass),
    // but NO prerendered HTML, NO build-manifest and NO app chunks → initial
    // and every route check must be reported as skipped, not as failures.
    f.write(
      ".next/analyze/client.html",
      chartDataHtml([asset("static/chunks/framework-abc.js", 60_000), asset("static/chunks/main-app-def.js", 30_000)]),
    )

    const r = runBudget(f.dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("All JS budgets within limits")
    expect(r.stdout).toContain("route chunks not found (build may be stale)")
  })

  it("exits 2 when the analyze report does not exist", () => {
    const f = makeFixture()
    // No .next/analyze/client.html at all.
    const r = runBudget(f.dir)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("Bundle report not found")
  })

  it("guard fails (exit 1) when a heavy lib reaches a NON-home route's prerendered HTML", () => {
    const f = makeFixture()
    // Analyzer attributes a chunk to maplibre-gl via its module tree.
    f.write(
      ".next/analyze/client.html",
      chartDataHtml([
        asset("static/chunks/framework-abc.js", 60_000),
        asset("static/chunks/map-lib-abc.js", 260_000, [
          {
            label: "static/chunks/map-lib-abc.js",
            groups: [{ label: "node_modules/maplibre-gl/dist/maplibre-gl.js", groups: [] }],
          },
        ]),
      ]),
    )
    // Home HTML is CLEAN — the regression is on /busca, so only the
    // multi-route guard extension (not the old home-only check) catches it.
    f.write(".next/static/chunks/framework-abc.js", "export const f = 1;")
    f.write(
      ".next/server/app/index.html",
      '<html><body><script src="/_next/static/chunks/framework-abc.js"></script></body></html>',
    )
    f.write(
      ".next/server/app/busca.html",
      '<html><body><script src="/_next/static/chunks/framework-abc.js"></script>' +
        '<script src="/_next/static/chunks/map-lib-abc.js"></script></body></html>',
    )

    const r = runBudget(f.dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("guard: maplibre-gl not in initial JS (all prerendered routes)")
    expect(r.stderr).toContain("maplibre-gl is statically bundled")
    // Route label is formatted with a leading slash: "/busca (map-lib-abc.js)".
    expect(r.stderr).toContain("/busca (map-lib-abc.js)")
  })

  it("guard (check 5): home HTML with a heavy lib eager fails (exit 1, route / attribution)", () => {
    const f = makeFixture()
    // The original check-5 scope: the HOME page's first-paint script list
    // contains a chunk attributed to recharts (still-guarded lib; framer-motion
    // was removed from the app 2026-08-08).
    f.write(
      ".next/analyze/client.html",
      chartDataHtml([
        asset("static/chunks/framework-abc.js", 60_000),
        asset("static/chunks/main-app-def.js", 30_000),
        asset("static/chunks/chart-abc.js", 40_000, [
          {
            label: "static/chunks/chart-abc.js",
            groups: [{ label: "node_modules/recharts/es6/Recharts.js", groups: [] }],
          },
        ]),
      ]),
    )
    f.write(".next/static/chunks/framework-abc.js", "export const f = 1;")
    f.write(".next/static/chunks/chart-abc.js", "export const ch = 1;")
    f.write(
      ".next/server/app/index.html",
      '<html><body><script src="/_next/static/chunks/framework-abc.js"></script>' +
        '<script src="/_next/static/chunks/chart-abc.js"></script></body></html>',
    )

    const r = runBudget(f.dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("guard: recharts not in initial JS (all prerendered routes)")
    expect(r.stderr).toContain("recharts is statically bundled")
    // Home route formats as "/" — the offender site is "/ (chart-abc.js)".
    // The initial-JS check is MEASURED (framework 60K + chart 40K = 100K,
    // under the 270 KB budget) — the guard is the sole failure cause.
    expect(r.stderr).toContain("/ (chart-abc.js)")
  })

  it("guard (check 5): clean home HTML passes with all 4 guard checks green", () => {
    const f = makeFixture()
    writePassBuild(f) // no heavy libs anywhere in the analyzer or the HTML

    const r = runBudget(f.dir)
    expect(r.status).toBe(0)
    // Every guarded lib reports a green check for the prerendered-routes source.
    expect(r.stdout).toContain("guard: maplibre-gl not in initial JS (all prerendered routes)")
    expect(r.stdout).toContain("guard: recharts not in initial JS (all prerendered routes)")
    expect(r.stdout).toContain("guard: socket.io-client not in initial JS (all prerendered routes)")
    expect(r.stdout).toContain("guard: framer-motion not in initial JS (all prerendered routes)")
    expect(r.stdout).toContain("All JS budgets within limits")
  })

  it("guard (check 5): rootMainFiles fallback with a heavy lib eager fails (exit 1)", () => {
    const f = makeFixture()
    // NO prerendered route HTML at all → the guard must fall back to the
    // build-manifest rootMainFiles list. The recharts chunk is listed there,
    // so first paint is tainted even without any HTML to scan.
    f.write(
      ".next/analyze/client.html",
      chartDataHtml([
        asset("static/chunks/framework-abc.js", 60_000),
        asset("static/chunks/main-app-def.js", 30_000),
        asset("static/chunks/chart-abc.js", 40_000, [
          {
            label: "static/chunks/chart-abc.js",
            groups: [{ label: "node_modules/recharts/es6/Recharts.js", groups: [] }],
          },
        ]),
      ]),
    )
    f.write(".next/static/chunks/framework-abc.js", "export const f = 1;")
    f.write(".next/static/chunks/chart-abc.js", "export const ch = 1;")
    f.write(
      ".next/build-manifest.json",
      JSON.stringify({
        rootMainFiles: ["static/chunks/framework-abc.js", "static/chunks/chart-abc.js"],
      }),
    )

    const r = runBudget(f.dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("guard: recharts not in initial JS (rootMainFiles)")
    expect(r.stderr).toContain("recharts is statically bundled")
    expect(r.stderr).toContain("rootMainFiles (chart-abc.js)")
  })

  it("guard (check 5): clean rootMainFiles fallback passes with all 4 guard checks green", () => {
    const f = makeFixture()
    f.write(
      ".next/analyze/client.html",
      chartDataHtml([
        asset("static/chunks/framework-abc.js", 60_000),
        asset("static/chunks/main-app-def.js", 30_000),
      ]),
    )
    f.write(".next/static/chunks/framework-abc.js", "export const f = 1;")
    f.write(".next/static/chunks/main-app-def.js", "export const m = 2;")
    f.write(
      ".next/build-manifest.json",
      JSON.stringify({
        rootMainFiles: ["static/chunks/framework-abc.js", "static/chunks/main-app-def.js"],
      }),
    )

    const r = runBudget(f.dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("guard: maplibre-gl not in initial JS (rootMainFiles)")
    expect(r.stdout).toContain("guard: recharts not in initial JS (rootMainFiles)")
    expect(r.stdout).toContain("guard: socket.io-client not in initial JS (rootMainFiles)")
    expect(r.stdout).toContain("guard: framer-motion not in initial JS (rootMainFiles)")
    expect(r.stdout).toContain("All JS budgets within limits")
  })

  it("source lint: lazy dynamic-import targets may statically import heavy libs (exit 0)", () => {
    const f = makeFixture()
    writePassBuild(f)
    // The page loads the map via next/dynamic → tracking-map is a lazy root,
    // so its static maplibre CSS import must be exempt (the real pattern from
    // /tracking/[id]). The `@/` alias must resolve through the fixture tsconfig.
    f.write(
      "src/app/tracking/[id]/page.tsx",
      'import dynamic from "next/dynamic";\n' +
        'const TrackingMap = dynamic(() => import("@/components/tracking-map"), { ssr: false });\n' +
        "export default function Page() { return null }\n",
    )
    f.write(
      "src/components/tracking-map.tsx",
      'import "maplibre-gl/dist/maplibre-gl.css";\nexport function TrackingMap() { return null }\n',
    )
    f.write(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    )

    const r = runBudget(f.dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("guard: static heavy-lib imports (source lint)")
    expect(r.stdout).toContain("All JS budgets within limits")
  })

  it("source lint: an eager route statically importing a heavy lib fails WITHOUT a bundle report (exit 1)", () => {
    const f = makeFixture()
    // No .next artifacts at all — the source lint must fire first, proving the
    // gate works on a fresh checkout with no build.
    f.write(
      "src/app/busca/page.tsx",
      'import { Map } from "react-map-gl";\nexport default function Page() { return null }\n',
    )

    const r = runBudget(f.dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("EAGER-GRAPH LINT VIOLATIONS")
    expect(r.stderr).toContain("react-map-gl statically imported")
    expect(r.stderr).toContain("src/app/busca/page.tsx")
    expect(r.stderr).toContain("/busca")
  })

  it("source lint: an eager page statically importing framer-motion fails WITHOUT a bundle report (exit 1)", () => {
    const f = makeFixture()
    // No .next artifacts at all — the source lint must fire pre-build. This
    // closes the gap where only check 5 (build OUTPUT, post-build) carried
    // the framer-motion sentinel: a static import of the removed lib is now
    // also caught by the source lint (check 8) on a fresh checkout, before
    // any ANALYZE build runs.
    f.write(
      "src/app/page.tsx",
      'import { motion } from "framer-motion";\nexport default function Page() { return null }\n',
    )

    const r = runBudget(f.dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("EAGER-GRAPH LINT VIOLATIONS")
    expect(r.stderr).toContain("framer-motion statically imported")
    expect(r.stderr).toContain("src/app/page.tsx")
    expect(r.stderr).toContain("reachable from /")
  })

  it("source lint: transitive static import through an eager component is caught with route attribution (exit 1)", () => {
    const f = makeFixture()
    // Bundle report present → the violation must surface as a check + failure.
    f.write(
      ".next/analyze/client.html",
      chartDataHtml([asset("static/chunks/framework-abc.js", 60_000), asset("static/chunks/main-app-def.js", 30_000)]),
    )
    // hero.tsx itself is not a route entry — only reachable eagerly via /.
    f.write(
      "src/app/page.tsx",
      'import Hero from "./hero";\nexport default function Page() { return <Hero /> }\n',
    )
    f.write(
      "src/app/hero.tsx",
      'import { BarChart } from "recharts";\nexport default function Hero() { return null }\n',
    )

    const r = runBudget(f.dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("guard: static heavy-lib imports (source lint)")
    expect(r.stderr).toContain("recharts statically imported")
    expect(r.stderr).toContain("src/app/hero.tsx")
    expect(r.stderr).toContain("/")
  })

  it("source lint: JS_BUDGET_EAGER_ALLOW_FILES whitelists a flagged file (exit 0)", () => {
    const f = makeFixture()
    writePassBuild(f)
    f.write(
      "src/app/busca/page.tsx",
      'import { Map } from "react-map-gl";\nexport default function Page() { return null }\n',
    )

    const r = runBudget(f.dir, { JS_BUDGET_EAGER_ALLOW_FILES: "src/app/busca/page.tsx" })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("All JS budgets within limits")
  })

  it("source lint: a bare dynamic import() of a heavy lib in an eager file is the sanctioned lazy pattern (exit 0)", () => {
    const f = makeFixture()
    writePassBuild(f)
    // providers-map pattern: the lib itself is fetched via await import() — a
    // separate lazy chunk, NOT a static import. Must not be flagged.
    f.write(
      "src/app/page.tsx",
      'export default async function Page() { await import("maplibre-gl"); return null }\n',
    )

    const r = runBudget(f.dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("All JS budgets within limits")
  })

  it("source lint: an eager page importing @/components/foo (tsconfig alias) which statically imports a heavy lib is caught (exit 1)", () => {
    const f = makeFixture()
    f.write(
      ".next/analyze/client.html",
      chartDataHtml([asset("static/chunks/framework-abc.js", 60_000), asset("static/chunks/main-app-def.js", 30_000)]),
    )
    // Alias resolution end-to-end: the page statically imports via the
    // tsconfig `paths` alias, and foo.tsx (NOT a route entry) statically
    // imports maplibre — the BFS must follow "@/", resolve src/components/
    // foo.tsx, and flag it with the eager route attribution.
    f.write(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    )
    f.write(
      "src/app/page.tsx",
      'import Foo from "@/components/foo";\nexport default function Page() { return <Foo /> }\n',
    )
    f.write(
      "src/components/foo.tsx",
      'import "maplibre-gl/dist/maplibre-gl.css";\nexport default function Foo() { return null }\n',
    )

    const r = runBudget(f.dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("maplibre-gl statically imported")
    expect(r.stderr).toContain("src/components/foo.tsx")
  })

  it("artifact consistency: analyzer and prerendered HTML from DIFFERENT builds fail (exit 1)", () => {
    const f = makeFixture()
    // The analyzer report is from build A (framework-abc / main-app-def)…
    f.write(
      ".next/analyze/client.html",
      chartDataHtml([asset("static/chunks/framework-abc.js", 60_000), asset("static/chunks/main-app-def.js", 30_000)]),
    )
    f.write(".next/static/chunks/framework-abc.js", "export const f = 1;")
    f.write(".next/static/chunks/main-app-def.js", "export const m = 2;")
    // …but the prerendered HTMLs are from build B (different chunk hashes).
    // On a fresh ANALYZE build these share the framework chunk names; an
    // empty intersection proves a mixed .next and must fail the gate loudly
    // instead of emitting a misleading guard verdict.
    f.write(".next/static/chunks/framework-xyz.js", "export const f = 1;")
    f.write(
      ".next/server/app/index.html",
      '<html><head><script src="/_next/static/chunks/framework-xyz.js"></script>' +
        '<script src="/_next/static/chunks/main-app-xyz.js"></script></head><body></body></html>',
    )

    const r = runBudget(f.dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("artifact consistency (analyzer vs prerendered HTML)")
    expect(r.stderr).toContain("DIFFERENT builds")
  })

  it("guard (check 5): socket.io-client eager in home HTML fails (exit 1)", () => {
    const f = makeFixture()
    // socket.io-client must stay lazy (use-realtime.ts imports it via
    // await import()) — a chunk attributed to it in the home first-paint
    // list is a regression the extended guard must catch.
    f.write(
      ".next/analyze/client.html",
      chartDataHtml([
        asset("static/chunks/framework-abc.js", 60_000),
        asset("static/chunks/main-app-def.js", 30_000),
        asset("static/chunks/socket-abc.js", 12_400, [
          {
            label: "static/chunks/socket-abc.js",
            groups: [{ label: "node_modules/socket.io-client/dist/socket.io.esm.min.js", groups: [] }],
          },
        ]),
      ]),
    )
    f.write(".next/static/chunks/framework-abc.js", "export const f = 1;")
    f.write(".next/static/chunks/socket-abc.js", "export const s = 1;")
    f.write(
      ".next/server/app/index.html",
      '<html><body><script src="/_next/static/chunks/framework-abc.js"></script>' +
        '<script src="/_next/static/chunks/socket-abc.js"></script></body></html>',
    )

    const r = runBudget(f.dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("guard: socket.io-client not in initial JS (all prerendered routes)")
    expect(r.stderr).toContain("socket.io-client is statically bundled")
    expect(r.stderr).toContain("/ (socket-abc.js)")
  })

  it("guard (check 5): framer-motion sentinel — a re-added chunk in a route HTML fails (exit 1)", () => {
    const f = makeFixture()
    // framer-motion was fully removed from the app (2026-08-08, pure CSS), but
    // it stays in EAGER_GUARD_LIBS as a zero-cost regression sentinel: if the
    // lib is ever re-added to an eager graph, the analyzer attributes a chunk
    // to it, that chunk lands in a prerendered route's script list, and this
    // guard fires — the exact regression the removal eliminated, caught in CI
    // instead of at runtime. (There is no size budget for it: the lib cannot
    // legitimately exist, so the guard is the sole failure cause.)
    f.write(
      ".next/analyze/client.html",
      chartDataHtml([
        asset("static/chunks/framework-abc.js", 60_000),
        asset("static/chunks/main-app-def.js", 30_000),
        asset("static/chunks/framer-abc.js", 40_000, [
          {
            label: "static/chunks/framer-abc.js",
            groups: [{ label: "node_modules/framer-motion/dist/es/index.mjs", groups: [] }],
          },
        ]),
      ]),
    )
    f.write(".next/static/chunks/framework-abc.js", "export const f = 1;")
    f.write(".next/static/chunks/framer-abc.js", "export const fm = 1;")
    f.write(
      ".next/server/app/index.html",
      '<html><body><script src="/_next/static/chunks/framework-abc.js"></script>' +
        '<script src="/_next/static/chunks/framer-abc.js"></script></body></html>',
    )

    const r = runBudget(f.dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("guard: framer-motion not in initial JS (all prerendered routes)")
    expect(r.stderr).toContain("framer-motion is statically bundled")
    expect(r.stderr).toContain("/ (framer-abc.js)")
  })

  it("lib size (check 3): @tanstack/react-query over budget fails via env override (exit 1)", () => {
    const f = makeFixture()
    // react-query is the data layer (eager by design — NOT presence-guarded);
    // its growth is bounded by the per-library SIZE budget, which must fail
    // when exceeded via the env override.
    f.write(
      ".next/analyze/client.html",
      chartDataHtml([
        asset("static/chunks/framework-abc.js", 60_000),
        asset("static/chunks/main-app-def.js", 30_000),
        asset("static/chunks/query-abc.js", 100_000, [
          {
            label: "static/chunks/query-abc.js",
            groups: [
              {
                label: "node_modules/@tanstack/react-query/build/modern/index.js",
                gzipSize: 100_000,
                groups: [],
              },
            ],
          },
        ]),
      ]),
    )
    f.write(".next/static/chunks/framework-abc.js", "export const f = 1;")
    f.write(".next/static/chunks/query-abc.js", "export const q = 1;")
    f.write(
      ".next/server/app/index.html",
      '<html><body><script src="/_next/static/chunks/framework-abc.js"></script>' +
        '<script src="/_next/static/chunks/query-abc.js"></script></body></html>',
    )

    const r = runBudget(f.dir, { JS_BUDGET_LIB_REACTQUERY_KB: "1" })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("lib: @tanstack/react-query")
    expect(r.stdout).toContain("(budget 1 KB)")
    expect(r.stderr).toContain("> budget 1 KB")
  })
})

/** Minimal .next fixture where every byte check passes (no heavy libs). */
function writePassBuild(f: Fixture): void {
  f.write(
    ".next/analyze/client.html",
    chartDataHtml([
      asset("static/chunks/framework-abc.js", 60_000),
      asset("static/chunks/main-app-def.js", 30_000),
      asset("static/chunks/app/layout-abc.js", 10_000),
      asset("static/chunks/app/page-xyz.js", 5_000),
    ]),
  )
  f.write(".next/static/chunks/framework-abc.js", "export const f = 1;")
  f.write(".next/static/chunks/main-app-def.js", "export const m = 2;")
  f.write(
    ".next/server/app/index.html",
    '<html><head><script src="/_next/static/chunks/framework-abc.js"></script>' +
      '<script src="/_next/static/chunks/main-app-def.js"></script></head><body></body></html>',
  )
  f.write(".next/static/chunks/app/layout-abc.js", "export const layout = 1;")
  f.write(".next/static/chunks/app/page-xyz.js", "export const page = 1;")
}
