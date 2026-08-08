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
function asset(label: string, gzipSize: number): Record<string, unknown> {
  return { label, isAsset: true, statSize: gzipSize * 2, parsedSize: gzipSize, gzipSize, groups: [] }
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
})
