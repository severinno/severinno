/**
 * manifest-registry.test.ts - the SHARED FORM TEST of the surface manifests
 * (the "guard of the manifests", 2026-08).
 *
 * WHY THIS SUITE EXISTS: the repo's surface manifests (workflow-contracts,
 * encoding-surface, budget-routes, fragile-range-patterns - the 4 registered
 * in scripts/manifest-registry.mjs) all follow the SAME 3-component shape:
 *   1. EXPORTS: importable facts (export const / export function)
 *   2. CLI: a --print-* query mode, entry-point guarded, that gates/wrappers
 *      call to DERIVE their args (no second copy)
 *   3. CONTRACT SUITE: a scripts/__tests__/<name>.test.ts that pins the
 *      facts against the live tree
 * The shape was convention, not contract: a 5th manifest could be added
 * with exports but no CLI, or a CLI but no suite, and nothing would fail.
 * THIS suite makes the shape a CONTRACT - the guard of the manifests:
 *
 *   - FORM test: iterates SURFACE_MANIFESTS and verifies every registered
 *     manifest has all 3 components (import succeeds + exports exist, the
 *     canonical --print-* query exits 0 with non-empty output, the pinned
 *     suite file exists).
 *   - LIVE TREE (GROWTH direction): discoverSurfaceManifests(ROOT) must
 *     EQUAL the registered set - a NEW scripts/*.mjs with a --print-*
 *     surface that is NOT registered FAILS loudly (the drift class the
 *     registry exists to kill).
 *   - GROWTH (hermetic): a synthetic root with a 5th --print module is
 *     DISCOVERED (proving the discovery is live-tree-driven, not
 *     registry-derived).
 *
 * OUT OF SHAPE (documented, not registered): fuzz-targets.mjs is a manifest
 * (FUZZ_TARGETS exports + fuzz-mapped.test.ts) but its CLI is a
 * DEFAULT-PRINT + --check-coverage runner, NOT a --print-* query mode - a
 * different CLI contract, excluded by design (its own suite pins it).
 * FRONTIERS (scan-curl-timeouts.mjs, sec 11.40) is also out of shape:
 * export + contract suite (FRONTIER GUARD), no --print-* query surface -
 * a contract-support artifact like fuzz-targets, excluded by design (its
 * own suite pins it; the LIVE TREE check proves no drift).
 *
 * Subprocess-heavy (every CLI check spawns `node <module> <query>` via
 * runSubprocess) -> an EXPLICIT timeout on every it() (the scan-timeouts
 * guard requires it).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"
import { SURFACE_MANIFESTS, discoverSurfaceManifests } from "../manifest-registry.mjs"

const ROOT = process.cwd()
const REGISTRY = path.resolve(ROOT, "scripts", "manifest-registry.mjs")

/** Run `node <module> <query>` and return the subprocess result. */
function runQuery(moduleRel: string, query: string) {
  return runSubprocess({
    command: process.execPath,
    args: [path.resolve(ROOT, moduleRel), query],
  })
}

function runCli(...args: string[]) {
  return runSubprocess({ command: process.execPath, args: [REGISTRY, ...args] })
}

afterEach(() => {
  cleanupTempDirs()
})

describe("manifest-registry.mjs - the guard of the manifests (3-component shape)", () => {
  it("ABSOLUTE PIN: the 4 registered surface manifests (module + canonical query + suite)", () => {
    expect(SURFACE_MANIFESTS).toEqual([
      {
        module: "scripts/workflow-contracts.mjs",
        query: "--print-guard-net",
        suite: "scripts/__tests__/workflow-contracts.test.ts",
      },
      {
        module: "scripts/encoding-surface.mjs",
        query: "--print-always-dirs",
        suite: "scripts/__tests__/encoding-surface.test.ts",
      },
      {
        module: "scripts/budget-routes.mjs",
        query: "--print-routes",
        suite: "scripts/__tests__/budget-routes.test.ts",
      },
      {
        module: "scripts/fragile-range-patterns.mjs",
        query: "--print-target-dirs",
        suite: "scripts/__tests__/fragile-range-guard.test.ts",
      },
    ])
  })

  it("FORM: every registered manifest has the 3 components (exports + CLI + contract suite)", () => {
    for (const m of SURFACE_MANIFESTS) {
      const src = fs.readFileSync(path.resolve(ROOT, m.module), "utf8")
      // 1. EXPORTS: the module declares importable facts (export const /
      //    export function at line start - the manifest shape).
      expect(src, `${m.module} must export facts (export const|function)`).toMatch(
        /^export (?:const|function) /m,
      )
      // 2. CLI: the canonical --print-* query exits 0 with non-empty stdout
      //    (the query surface gates/wrappers derive their args from).
      const r = runQuery(m.module, m.query)
      expect(r.status, `${m.module} ${m.query} must exit 0`).toBe(0)
      expect(r.stdout.trim().length, `${m.module} ${m.query} must print a fact`).toBeGreaterThan(0)
      // 3. CONTRACT SUITE: the pinned suite file exists (the manifest's own
      //    regression lock - a manifest without a suite is an orphan).
      expect(
        fs.existsSync(path.resolve(ROOT, m.suite)),
        `${m.module} must have its contract suite at ${m.suite}`,
      ).toBe(true)
    }
  }, 60000)

  it("LIVE TREE: discovered --print-* modules == registered (a 5th manifest without registration fails)", () => {
    const discovered = discoverSurfaceManifests(ROOT)
    const registered = SURFACE_MANIFESTS.map((m) => m.module).sort()
    expect(discovered).toEqual(registered)
  })

  it("GROWTH (hermetic): a synthetic 5th --print manifest is DISCOVERED (the LIVE TREE would catch it unregistered)", () => {
    const dir = createTempDir("manifest-registry-")
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true })
    // A future surface manifest with exports + QUERIES map + --print-*.
    fs.writeFileSync(
      path.join(dir, "scripts", "future-surface.mjs"),
      ['export const FUTURE_SURFACE = ["x"]', 'const QUERIES = { "--print-future": FUTURE_SURFACE }', ""].join("\n"),
    )
    // A NON-manifest script (no --print surface) must NOT be discovered.
    fs.writeFileSync(
      path.join(dir, "scripts", "plain-helper.mjs"),
      ['export const PLAIN = "no query surface"', ""].join("\n"),
    )
    const found = discoverSurfaceManifests(dir)
    expect(found).toEqual(["scripts/future-surface.mjs"])
  })

  it("CLI: --print-manifests prints the registered modules (space-joined)", () => {
    const r = runCli("--print-manifests")
    expect(r.status).toBe(0)
    expect(r.stdout.trim().split(" ").sort()).toEqual(SURFACE_MANIFESTS.map((m) => m.module).sort())
  }, 60000)

  it("CLI: zero/two flags is a usage error (exit 2, no silent default)", () => {
    const zero = runCli()
    expect(zero.status).toBe(2)
    expect(zero.stderr).toContain("usage:")
    const two = runCli("--print-manifests", "--print-manifests")
    expect(two.status).toBe(2)
  }, 60000)
})
