/**
 * Unit tests for the ANTI-REGRESSION GATE in scripts/bundle-report.mjs — the
 * gate that fails the budget job when the rolling "main" row (push to main,
 * ci.yml) worsens more than the threshold vs the last versioned release.
 *
 * Same harness as check-js-budget.test.ts: the script resolves everything
 * against process.cwd() and calls process.exit(), so it is exercised as a
 * subprocess with cwd pointed at a synthetic fixture tree — a minimal `.next`
 * (so check-js-budget --json, which bundle-report spawns, produces real JSON
 * with initialSource "prerendered-html") plus a docs/bundle-report.md table
 * holding the versioned baseline row the gate compares against.
 *
 * The TOTAL delta is deterministic from the analyzer chartData gzip sizes
 * (framework 60_000 + main-app 30_000 = 90_000 bytes → 87.9 KB), so it is the
 * reliable lever for the fail/pass cases — the initial transfer is measured
 * from gzipped synthetic files and is only meaningful for "within limits".
 *
 * Covered scenarios:
 *   1. Total worsened beyond the threshold  → exit 1, "ANTI-REGRESSION GATE"
 *   2. Initial JS worsened beyond the threshold (the metric the gate was
 *      built for — the user-facing "+50 KB de initial" example)
 *   3. Within the threshold                 → exit 0, "gate anti-regressão: ok"
 *   4. No versioned baseline (first main)   → exit 0, "skipped — sem baseline"
 *   5. initialSource fallback (rootMainFiles, non-comparable) → exit 0, skipped
 *   6. Delta EXACTLY equal to the threshold → exit 0 (strictly-greater >
 *      contract: a regression exactly at the limit passes)
 *   7. A ROUTE's real transfer (check 7: prerendered HTML script-list sum)
 *      worsens beyond its per-route threshold → exit 1 "rota /busca piorou"
 *      — the case that escapes the Initial/Total gate alone
 *   8. ROUTE delta within the threshold → exit 0, "rotas:" in the ok log
 *   9. No route baseline in the report (route added since the release) →
 *      skip, exit 0 — only routes measured on BOTH sides are compared
 *  10. Default 30 KB per-route threshold applies without env override
 *  11. Route in the baseline but absent in the entry (REAL_ROUTE_CHECKS
 *      shrank) → skip, exit 0 — a removed route can't regress
 */
import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// Resolve from the repo root — vitest runs with cwd = project root, and the
// script itself uses process.cwd() as its ROOT (the fixture dir we point it
// at). Same convention as check-js-budget.test.ts.
const SCRIPT = path.resolve(process.cwd(), "scripts", "bundle-report.mjs")

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-report-fixture-"))
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
function asset(label: string, gzipSize: number): Record<string, unknown> {
  return { label, isAsset: true, statSize: gzipSize * 2, parsedSize: gzipSize, gzipSize, groups: [] }
}

/** Baseline report table: header + ONE versioned release row (v0.4.2). */
function baselineReport(initialKB: string, totalKB: string): string {
  return (
    "# Bundle Report — Severinno\n\n" +
    "> Gerado automaticamente a cada release pelo CI (job `budget`). Não editar manualmente.\n" +
    "> Fonte: `ANALYZE=true next build --webpack` + `scripts/check-js-budget.mjs` (KB gzip).\n" +
    "> Δ = variação vs a versão anterior da tabela.\n\n" +
    "## Histórico\n\n" +
    "| Versão | Data | Initial (/) | Δ Init | Total | Δ Total | Largest | Δ Largest | Maplibre | Recharts | Framer | Δ Framer | Gate |\n" +
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|\n" +
    `| v0.4.2 | 2026-08-08 | ${initialKB} | — | ${totalKB} | — | 58.6 | — | 266.9 | 85.4 | — | — | ✅ |\n`
  )
}

/** Prerendered route HTML under .next/server/app/ — feeds REAL_ROUTE_CHECKS
 * (check 7). References the given chunk rel-paths (under .next/static/chunks)
 * so realTransferFromHtmlFile can resolve and sum their gzip bytes. */
function writeRouteHtml(f: Fixture, htmlRel: string, chunkRels: string[]): void {
  const scripts = chunkRels
    .map((c) => `<script src="/_next/static/chunks/${c}"></script>`)
    .join("")
  f.write(
    `.next/server/app/${htmlRel}`,
    `<html><head>${scripts}</head><body></body></html>`,
  )
}

/** Baseline report + a "## Rotas" block with one route row (v0.4.2). */
function baselineReportWithRoute(initialKB: string, totalKB: string, routeKB: string): string {
  return (
    baselineReport(initialKB, totalKB) +
    "\n## Rotas (real transfer, KB gzip)\n\n" +
    "### v0.4.2 — 2026-08-08\n" +
    "| Rota | Params | KB gzip | Δ |\n" +
    "|---|---|---|---|\n" +
    `| /busca | 1 | ${routeKB} | — |\n`
  )
}

/**
 * Minimal .next fixture where check-js-budget --json succeeds with
 * initialSource "prerendered-html" and a deterministic total (87.9 KB gzip
 * from the chartData). Real chunk files on disk so the initial transfer is
 * measurable (tiny, well under every default budget).
 */
function writePassBuild(f: Fixture): void {
  // bundle-report resolves CHECK = <cwd>/scripts/check-js-budget.mjs and
  // spawns it against the SAME cwd (the fixture) — so the fixture must
  // provide the script itself. check-js-budget.mjs imports only node builtins
  // (fs/path/zlib — no relative imports), so a copy is fully functional and
  // reads the fixture's own .next tree, exactly like the real flow.
  const budgetSrc = fs.readFileSync(path.resolve(process.cwd(), "scripts", "check-js-budget.mjs"), "utf8")
  f.write("scripts/check-js-budget.mjs", budgetSrc)
  f.write(
    ".next/analyze/client.html",
    chartDataHtml([asset("static/chunks/framework-abc.js", 60_000), asset("static/chunks/main-app-def.js", 30_000)]),
  )
  f.write(".next/static/chunks/framework-abc.js", "export const f = 1;")
  f.write(".next/static/chunks/main-app-def.js", "export const m = 2;")
  f.write(
    ".next/server/app/index.html",
    '<html><head><script src="/_next/static/chunks/framework-abc.js"></script>' +
      '<script src="/_next/static/chunks/main-app-def.js"></script></head><body></body></html>',
  )
}

/** Run bundle-report --version <v> against a fixture dir (default main). */
function runReport(dir: string, env: Record<string, string> = {}, version = "main") {
  return spawnSync(process.execPath, [SCRIPT, "--version", version], {
    cwd: dir,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 30_000,
  })
}

describe("scripts/bundle-report.mjs anti-regression gate", () => {
  it("fails (exit 1) when 'main' Total worsens beyond the threshold vs the last release", () => {
    const f = makeFixture()
    writePassBuild(f)
    // Baseline v0.4.2 total = 80.0 KB; measured total = 87.9 KB → Δ +7.9 KB.
    // Threshold 5 → the gate must fail, BEFORE the success log, and the
    // report/badge must still have been written (CI's always() commit).
    f.write("docs/bundle-report.md", baselineReport("219.1", "80.0"))

    const r = runReport(f.dir, { JS_BUDGET_MAIN_DELTA_TOTAL_KB: "5" })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("ANTI-REGRESSION GATE")
    expect(r.stderr).toContain("'main' Total piorou")
    expect(r.stderr).toContain("v0.4.2")
    // Docs written before the gate exits → the regressed row is recorded.
    expect(fs.readFileSync(path.join(f.dir, "docs", "bundle-report.md"), "utf8")).toContain("| main |")
    expect(fs.existsSync(path.join(f.dir, "docs", "bundle-badge.json"))).toBe(true)
  })

  it("passes (exit 0) when the delta is within the threshold, logging the ok delta", () => {
    const f = makeFixture()
    writePassBuild(f)
    f.write("docs/bundle-report.md", baselineReport("219.1", "80.0"))

    // Δ total +7.9 KB < 200 → ok. The observability line must show the delta
    // against the baseline so a green run is distinguishable from a skip.
    const r = runReport(f.dir, { JS_BUDGET_MAIN_DELTA_TOTAL_KB: "200" })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("gate anti-regressão: ok")
    expect(r.stdout).toContain("Δ total +7.9 KB")
    expect(r.stdout).toContain("v0.4.2")
    expect(r.stdout).toContain("registrado em docs/bundle-report.md")
  })

  it("fails (exit 1) when 'main' Initial JS (/) worsens beyond the threshold — the metric the gate was built for", () => {
    const f = makeFixture()
    writePassBuild(f) // script copy + analyze + prerendered HTML (tiny chunks)
    // Overwrite the chunk files with REAL payload (mostly-incompressible:
    // unique tokens) so the prerendered-HTML initial transfer is measured
    // well ABOVE the baseline + threshold.
    const payload = Array.from({ length: 8000 }, (_, i) => `"x${i}${i * 7}"`).join(",")
    f.write(".next/static/chunks/framework-abc.js", `export const f = [${payload}];`)
    f.write(".next/static/chunks/main-app-def.js", `export const m = [${payload}];`)
    // Baseline v0.4.2 initial is tiny (0.01 KB) → any real measured initial
    // (tens of KB) exceeds it by far more than the 1 KB threshold.
    f.write("docs/bundle-report.md", baselineReport("0.01", "80.0"))

    const r = runReport(f.dir, { JS_BUDGET_MAIN_DELTA_INITIAL_KB: "1", JS_BUDGET_MAIN_DELTA_TOTAL_KB: "99999" })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("ANTI-REGRESSION GATE")
    expect(r.stderr).toContain("'main' Initial JS (/) piorou")
    expect(r.stderr).toContain("v0.4.2")
    expect(fs.readFileSync(path.join(f.dir, "docs", "bundle-report.md"), "utf8")).toContain("| main |")
  })

  it("passes (exit 0) when the delta is EXACTLY equal to the threshold — the strict > contract", () => {
    const f = makeFixture()
    writePassBuild(f)
    f.write("docs/bundle-report.md", baselineReport("219.1", "80.0"))

    // Δ total = 87.9 - 80.0 = +7.9 KB. Threshold 7.9 → 7.9 > 7.9 is false →
    // the gate must NOT fire, locking in the documented strictly-greater
    // semantics (only +7.91+ blocks).
    const r = runReport(f.dir, { JS_BUDGET_MAIN_DELTA_TOTAL_KB: "7.9" })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("gate anti-regressão: ok")
    expect(r.stdout).toContain("Δ total +7.9 KB")
  })

  it("develop row sorts BELOW main but ABOVE releases, with Δ vs the row below", () => {
    const f = makeFixture()
    writePassBuild(f)
    // Report with one release (v0.4.2, total 80.0). A develop run (total
    // 87.9) must rank above the release but below any main row.
    f.write("docs/bundle-report.md", baselineReport("219.1", "80.0"))

    const r = runReport(f.dir, {}, "develop")
    expect(r.status).toBe(0)
    const md = fs.readFileSync(path.join(f.dir, "docs", "bundle-report.md"), "utf8")
    // develop row present and above the release; Δ total +7.9 vs v0.4.2
    // (table cell format, e.g. "| 87.9 | +7.9 |").
    expect(md).toContain("| develop |")
    expect(md.indexOf("| develop |")).toBeLessThan(md.indexOf("| v0.4.2 |"))
    expect(md).toContain("| 87.9 | +7.9 |")
    // No gate for develop: tracking-only by design.
    expect(r.stdout).toContain("gate anti-regressão: n/a — develop é tracking-only")
  })

  it("develop upsert: re-runs never accumulate duplicate develop rows", () => {
    const f = makeFixture()
    writePassBuild(f)
    f.write("docs/bundle-report.md", baselineReport("219.1", "80.0"))

    runReport(f.dir, {}, "develop")
    runReport(f.dir, {}, "develop")
    const md = fs.readFileSync(path.join(f.dir, "docs", "bundle-report.md"), "utf8")
    expect(md.match(/\| develop \|/g)?.length).toBe(1)
  })

  it("develop is tracking-only: a regression with a tiny threshold still exits 0 (no gate)", () => {
    const f = makeFixture()
    writePassBuild(f)
    f.write("docs/bundle-report.md", baselineReport("219.1", "80.0"))

    // Measured total 87.9 vs baseline 80.0 = +7.9 KB — a +7.9 KB regression.
    // With a 0.05 KB threshold the main gate would fail; develop must NOT.
    const r = runReport(f.dir, { JS_BUDGET_MAIN_DELTA_TOTAL_KB: "0.05" }, "develop")
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("gate anti-regressão: n/a — develop é tracking-only")
    expect(r.stdout).toContain("registrado em docs/bundle-report.md")
  })

  it("main gate baseline IGNORES the develop row — compares vs the latest release even when develop exists", () => {
    const f = makeFixture()
    writePassBuild(f)
    // Report with BOTH a develop row (total 83.0) and a release (v0.4.2,
    // total 80.0). Measured main total 87.9: Δ vs release = +7.9 (fails a
    // 5 KB threshold) while Δ vs develop = +4.9 (passes). The gate must use
    // the release baseline, not develop — otherwise the regression that
    // develop carries would be hidden once it reaches main.
    f.write(
      "docs/bundle-report.md",
      baselineReport("219.1", "80.0") +
        "| develop | 2026-08-08 | 219.1 | — | 83.0 | — | 58.6 | — | 266.9 | 85.4 | — | — | ✅ |\n",
    )

    const r = runReport(f.dir, { JS_BUDGET_MAIN_DELTA_TOTAL_KB: "5" })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("ANTI-REGRESSION GATE")
    expect(r.stderr).toContain("'main' Total piorou +7.9 KB")
    expect(r.stderr).toContain("v0.4.2")
    // Full ordering contract: main above develop above the release.
    const md = fs.readFileSync(path.join(f.dir, "docs", "bundle-report.md"), "utf8")
    expect(md.indexOf("| main |")).toBeLessThan(md.indexOf("| develop |"))
    expect(md.indexOf("| develop |")).toBeLessThan(md.indexOf("| v0.4.2 |"))
  })

  it("skips (exit 0) with the rolling-only message when the report has ONLY develop rows and no release (main run)", () => {
    const f = makeFixture()
    writePassBuild(f)
    // Report with a develop row but NO versioned release. Running --version
    // main: releaseBaseline is null (develop is rolling), so the gate skips —
    // and the message must say "sem release versionado ainda" (this branch
    // was once broken: rows.some(isRollingRow) is always true because the
    // just-pushed main entry is itself rolling).
    // baselineReport() emits the header + a v0.4.2 row; the v0.4.2 line is
    // stripped right below so only the develop row remains.
    f.write(
      "docs/bundle-report.md",
      baselineReport("219.1", "80.0") +
        "| develop | 2026-08-08 | 219.1 | — | 83.0 | — | 58.6 | — | 266.9 | 85.4 | — | — | ✅ |\n",
    )
    // Remove the v0.4.2 row so ONLY the develop row remains.
    const p = path.join(f.dir, "docs", "bundle-report.md")
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/\| v0\.4\.2 \|.*\n/, ""))

    const r = runReport(f.dir, { JS_BUDGET_MAIN_DELTA_TOTAL_KB: "0.01" })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("gate anti-regressão: skipped — sem release versionado ainda")
    expect(r.stdout).toContain("registrado em docs/bundle-report.md")
  })

  it("skips (exit 0) when there is no versioned baseline yet (first-ever main run)", () => {
    const f = makeFixture()
    writePassBuild(f)
    // No docs/bundle-report.md at all → no versioned baseline → gate skipped.
    // Even a tiny threshold must not fail: there is nothing to compare against.
    const r = runReport(f.dir, { JS_BUDGET_MAIN_DELTA_TOTAL_KB: "0.01" })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("gate anti-regressão: skipped — sem baseline")
    expect(r.stdout).toContain("registrado em docs/bundle-report.md")
  })

  it("skips (exit 0) when the initial metric came from the rootMainFiles fallback (non-comparable)", () => {
    const f = makeFixture()
    writePassBuild(f)
    // Remove the prerendered HTML → check-js-budget falls back to the
    // build-manifest rootMainFiles list (framework chunks only). The delta is
    // not comparable to real-transfer versions, so the gate must skip instead
    // of falsely blocking a merge on the Windows fallback metric.
    fs.rmSync(path.join(f.dir, ".next", "server", "app", "index.html"))
    f.write(
      ".next/build-manifest.json",
      JSON.stringify({ rootMainFiles: ["static/chunks/framework-abc.js", "static/chunks/main-app-def.js"] }),
    )
    f.write("docs/bundle-report.md", baselineReport("219.1", "80.0"))

    const r = runReport(f.dir, { JS_BUDGET_MAIN_DELTA_TOTAL_KB: "0.01" })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("gate anti-regressão: skipped — initial veio do fallback")
    expect(r.stdout).toContain("registrado em docs/bundle-report.md")
  })

  it("fails (exit 1) when a ROUTE's real transfer worsens beyond its threshold even with Initial/Total fine", () => {
    const f = makeFixture()
    writePassBuild(f)
    // Route chunk: a heavy, mostly-incompressible payload so the prerendered
    // /busca real transfer (sum of referenced chunk gzip bytes) is measured
    // far ABOVE the tiny baseline route value.
    const payload = Array.from({ length: 30000 }, (_, i) => `"r${i}${i * 31}qz"`).join(",")
    f.write(".next/static/chunks/busca-heavy-zz.js", `export const b = [${payload}];`)
    writeRouteHtml(f, "busca.html", ["busca-heavy-zz.js"])
    // Baseline v0.4.2: /busca real transfer = 0.1 KB; Initial/Total deltas
    // stay within limits (initial tiny vs 219.1 → negative; total +7.9 < 200)
    // so ONLY the route gate can trip — the escape case the gate was built for.
    f.write("docs/bundle-report.md", baselineReportWithRoute("219.1", "80.0", "0.1"))

    const r = runReport(f.dir, { JS_BUDGET_MAIN_DELTA_ROUTE_BUSCA_KB: "5" })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("ANTI-REGRESSION GATE")
    expect(r.stderr).toContain("rota /busca piorou")
    expect(r.stderr).toContain("v0.4.2")
    expect(r.stderr).toContain("limite +5.0 KB")
    // Docs written before the gate exits → the regressed row is recorded.
    expect(fs.readFileSync(path.join(f.dir, "docs", "bundle-report.md"), "utf8")).toContain("| main |")
  })

  it("passes (exit 0) when route deltas are within threshold, logging the per-route delta", () => {
    const f = makeFixture()
    writePassBuild(f)
    // Same tiny chunks referenced by /busca as by / — the measured route
    // transfer ≈ the / initial, well within the 30 KB route threshold.
    writeRouteHtml(f, "busca.html", ["framework-abc.js", "main-app-def.js"])
    f.write("docs/bundle-report.md", baselineReportWithRoute("219.1", "80.0", "0.1"))

    const r = runReport(f.dir, {})
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("gate anti-regressão: ok")
    expect(r.stdout).toContain("rotas: /busca")
    expect(r.stdout).toContain("v0.4.2")
  })

  it("skips (exit 0) routes with no baseline row — a route added since the release is never compared", () => {
    const f = makeFixture()
    writePassBuild(f)
    // Heavy /busca payload (would blow any threshold) BUT the baseline report
    // has NO Rotas section at all → releaseBaseline.routes = [] → the route
    // exists only on the entry side and must be skipped, not falsely blocked.
    const payload = Array.from({ length: 30000 }, (_, i) => `"r${i}${i * 31}qz"`).join(",")
    f.write(".next/static/chunks/busca-heavy-zz.js", `export const b = [${payload}];`)
    writeRouteHtml(f, "busca.html", ["busca-heavy-zz.js"])
    f.write("docs/bundle-report.md", baselineReport("219.1", "80.0"))

    const r = runReport(f.dir, { JS_BUDGET_MAIN_DELTA_ROUTE_BUSCA_KB: "0.01" })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("gate anti-regressão: ok")
    expect(r.stdout).toContain("registrado em docs/bundle-report.md")
    // Camada B: o gate de rota está DESARMADO (baseline sem blocos Rotas) —
    // o run deve emitir o ::warning:: de desarme, nunca passar em silêncio.
    expect(r.stdout).toContain("::warning:: gate de rota desarmado")
    expect(r.stdout).toContain("v0.4.2")
  })

  it("emits ::warning:: for PARTIAL disarm — baseline has Rotas blocks but ZERO label overlap with the entry", () => {
    const f = makeFixture()
    writePassBuild(f)
    // Entry measures /busca (check 7) from the prerendered HTML.
    writeRouteHtml(f, "busca.html", ["framework-abc.js", "main-app-def.js"])
    // Baseline v0.4.2 HAS a Rotas section, but only /dashboard — NO label in
    // common with the entry's /busca → gdRoutes is empty → the per-route gate
    // is silently skipped. Camada B must warn (partial disarm) instead of
    // passing quietly, and the log must say "sem overlap de labels" — not the
    // misleading "sem baseline por rota ainda".
    f.write(
      "docs/bundle-report.md",
      baselineReport("219.1", "80.0") +
        "\n## Rotas (real transfer, KB gzip)\n\n" +
        "### v0.4.2 — 2026-08-08\n" +
        "| Rota | Params | KB gzip | Δ |\n" +
        "|---|---|---|---|\n" +
        "| /dashboard | 1 | 218.1 | — |\n",
    )

    const r = runReport(f.dir, {})
    expect(r.status).toBe(0) // warning is non-blocking
    expect(r.stdout).toContain("gate anti-regressão: ok")
    expect(r.stdout).toContain("::warning:: gate de rota PARCIALMENTE desarmado")
    expect(r.stdout).toContain("/dashboard")
    expect(r.stdout).toContain("/busca")
    expect(r.stdout).toContain("v0.4.2")
    expect(r.stdout).toContain("baseline sem overlap de labels")
    expect(r.stdout).toContain("registrado em docs/bundle-report.md")
    // Exclusividade do if/else-if: o warning de desarme TOTAL (baseline sem
    // blocos) NÃO pode disparar junto no caso parcial — são estados distintos.
    expect(r.stdout).not.toContain("::warning:: gate de rota desarmado — baseline")
    expect(r.stdout).not.toContain("sem baseline por rota ainda")
  })

  it("INTEGRATION release→main: a real release run WITHOUT route HTML leaves no Rotas block, and the next main push (now measuring /busca) fires the FULL-disarm ::warning:: on stdout", () => {
    const f = makeFixture()
    writePassBuild(f)
    // Release run FIRST — the fixture has NO busca.html, so check 7 measures
    // no routes and the v0.4.3 row is written WITHOUT a Rotas block (exactly
    // what a pre-blocks release looks like). The docs state here is PRODUCED
    // by a real subprocess run, not hand-written — the hand-written fixture
    // test above could drift from the real release output; this locks the
    // full release→main chain (the user-visible disarm path in CI).
    const rel = runReport(f.dir, {}, "v0.4.3")
    expect(rel.status).toBe(0)
    const mdAfterRelease = fs.readFileSync(path.join(f.dir, "docs", "bundle-report.md"), "utf8")
    expect(mdAfterRelease).toContain("| v0.4.3 |")
    expect(mdAfterRelease).not.toContain("## Rotas (real transfer")

    // Later, on main, the build now measures /busca (route HTML present).
    // Baseline v0.4.3 has NO route blocks → FULL disarm: the ::warning:: must
    // appear on stdout (that is exactly what the GitHub Actions CI log
    // consumes as an annotation), the gate must NOT block (exit 0), and the
    // log must say "sem baseline por rota ainda" — the tri-valued routeLog's
    // honest state for this case.
    writeRouteHtml(f, "busca.html", ["framework-abc.js", "main-app-def.js"])
    const r = runReport(f.dir, {})
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("::warning:: gate de rota desarmado")
    expect(r.stdout).toContain("v0.4.3") // baseline = the release just made
    expect(r.stdout).toContain("O próximo release re-arma") // guidance tail
    expect(r.stdout).toContain("sem baseline por rota ainda")
    expect(r.stdout).toContain("gate anti-regressão: ok")
    // Exclusividade do if/else-if: baseline sem blocos ≠ sem overlap — o
    // warning PARCIAL não pode disparar junto com o total.
    expect(r.stdout).not.toContain("PARCIALMENTE desarmado")
    // Both rows survive the round-trip; the main block is now in the report.
    const md = fs.readFileSync(path.join(f.dir, "docs", "bundle-report.md"), "utf8")
    expect(md).toContain("| main |")
    expect(md).toContain("| v0.4.3 |")
    expect(md).toContain("### main")
    expect(md).toContain("| /busca |")
  })

  it("skips (exit 0) a route present in the baseline but absent in the entry (REAL_ROUTE_CHECKS shrank)", () => {
    const f = makeFixture()
    writePassBuild(f)
    // Baseline v0.4.2 HAS a /busca row, but the fixture writes NO busca.html
    // → check 7 measures nothing → entry.routes is empty → the loop over
    // entry.routes never compares /busca. A removed route can't regress, so
    // even a 0.01 KB threshold must not fail.
    f.write("docs/bundle-report.md", baselineReportWithRoute("219.1", "80.0", "250.0"))

    const r = runReport(f.dir, { JS_BUDGET_MAIN_DELTA_ROUTE_BUSCA_KB: "0.01" })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("gate anti-regressão: ok")
    expect(r.stdout).toContain("registrado em docs/bundle-report.md")
  })

  it("parses a CRLF baseline (Windows checkout via .gitattributes text=auto) — route gate still fires and blocks drop no data", () => {
    const f = makeFixture()
    writePassBuild(f)
    // Heavy /busca payload (same shape as the other route tests).
    const payload = Array.from({ length: 30000 }, (_, i) => `"r${i}${i * 31}qz"`).join(",")
    f.write(".next/static/chunks/busca-heavy-zz.js", `export const b = [${payload}];`)
    writeRouteHtml(f, "busca.html", ["busca-heavy-zz.js"])
    // Windows checkouts (core.autocrlf / .gitattributes `* text=auto`) leave
    // the committed LF docs as CRLF on disk. The $-anchored parse regexes
    // used to fail on a trailing \r, so releaseBaseline.routes parsed empty
    // (gate skipped with "sem baseline por rota ainda") AND the next
    // regeneration silently DROPPED the v0.4.2 Rotas/Top-5 blocks. Both
    // must not happen: the gate fires and the baseline row keeps its block.
    const crlf = baselineReportWithRoute("219.1", "80.0", "0.1").replace(/\n/g, "\r\n")
    f.write("docs/bundle-report.md", crlf)

    const r = runReport(f.dir, { JS_BUDGET_MAIN_DELTA_ROUTE_BUSCA_KB: "5" })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("ANTI-REGRESSION GATE")
    expect(r.stderr).toContain("rota /busca piorou")
    expect(r.stderr).toContain("v0.4.2")
    // Round-trip must NOT lose the baseline block: the regenerated report
    // (LF on write) must still contain the v0.4.2 Rotas block header AND its
    // row (baseline route 0.1 KB — distinguishable from the heavy main row),
    // plus the main row. "| /busca |" alone could come from the main block
    // and "| v0.4.2 |" from the table row, so pin the block row explicitly.
    const md = fs.readFileSync(path.join(f.dir, "docs", "bundle-report.md"), "utf8")
    expect(md).toContain("### v0.4.2")
    expect(md).toContain("| /busca | 1 | 0.1 |")
    expect(md).toContain("| main |")
  })

  it("applies the 30 KB DEFAULT per-route threshold when no env override is set", () => {
    const f = makeFixture()
    writePassBuild(f)
    // Heavy payload guarantees the measured /busca transfer is FAR above
    // 30 KB gzip (baseline 0.1 KB) → the default threshold must trip.
    const payload = Array.from({ length: 50000 }, (_, i) => `"d${i}${i * 17}qz"`).join(",")
    f.write(".next/static/chunks/busca-heavy-zz.js", `export const b = [${payload}];`)
    writeRouteHtml(f, "busca.html", ["busca-heavy-zz.js"])
    f.write("docs/bundle-report.md", baselineReportWithRoute("219.1", "80.0", "0.1"))

    // No JS_BUDGET_MAIN_DELTA_ROUTE_*_KB env → the 30 KB default applies.
    const r = runReport(f.dir, {})
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("ANTI-REGRESSION GATE")
    expect(r.stderr).toContain("rota /busca piorou")
    expect(r.stderr).toContain("limite +30.0 KB")
  })

  it("RELEASE run self-heals the route baseline: a tag with measured routes writes its own Rotas block even when the last release had none", () => {
    const f = makeFixture()
    writePassBuild(f)
    // /busca prerendered HTML → check 7 measures the route for the release.
    writeRouteHtml(f, "busca.html", ["framework-abc.js", "main-app-def.js"])
    // Baseline v0.4.2 exists but has NO Rotas section (pre-blocks release).
    f.write("docs/bundle-report.md", baselineReport("219.1", "80.0"))

    // Release run (tracking-only — no gate). The regenerated docs MUST
    // contain the tag's OWN Rotas block with a /busca row — that block is
    // what the next main push uses as per-route baseline AND what the
    // release-deploy.yml assert step (Camada A) requires.
    const r = runReport(f.dir, {}, "v0.4.3")
    expect(r.status).toBe(0)
    const md = fs.readFileSync(path.join(f.dir, "docs", "bundle-report.md"), "utf8")
    // Pin to the ## Rotas section (the only version with a block there is the
    // run's own v0.4.3 — the baseline has none): the /busca row must live in
    // THAT block, so a stale row from a future fixture can't false-pass.
    const rotas = md.slice(md.indexOf("## Rotas (real transfer"))
    expect(rotas).toContain("### v0.4.3")
    expect(rotas).toContain("| /busca |")
    // Baseline row survives the regeneration (round-trip, no data loss).
    expect(md).toContain("| v0.4.2 |")
  })
})
