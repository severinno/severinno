#!/usr/bin/env node
/**
 * manifest-registry.mjs - the versioned SURFACE-MANIFEST REGISTRY (the
 * "guard of the manifests", 2026-08).
 *
 * WHY THIS EXISTS (read before you add a surface manifest):
 *   the repo's surface manifests - workflow-contracts.mjs (workflow
 *   contract facts), encoding-surface.mjs (encoding scan surfaces),
 *   budget-routes.mjs (JS budget route registry) and
 *   fragile-range-patterns.mjs (fragile-range scan scope) - all follow the
 *   SAME 3-component shape: (1) exported facts (importable), (2) a
 *   --print-* query CLI (entry-point guarded - what gates/wrappers call to
 *   derive their args) and (3) a CONTRACT suite in scripts/__tests__/ that
 *   pins the facts against the live tree. The shape was convention, not
 *   contract: a 5th manifest could be added with exports but no CLI, or a
 *   CLI but no suite, and nothing would fail. THIS module is the canonical
 *   list of surface manifests (module + canonical query + suite); the form
 *   test (scripts/__tests__/manifest-registry.test.ts) verifies EVERY
 *   registered manifest has all 3 components, and the LIVE-TREE direction
 *   (discoverSurfaceManifests) fails if a new --print-* module appears
 *   without being registered - the guard of the manifests.
 *
 * WHAT IS HERE (the FACTS - decisions, not parsers):
 *   SURFACE_MANIFESTS  [{ module, query, suite }] - the registered surface
 *                      manifests. `query` is the CANONICAL --print-* flag
 *                      (what the form test runs to prove the CLI surface
 *                      exists); `suite` is the manifest's contract suite,
 *                      EXPLICIT (not derived by name: the fragile-range
 *                      suite is fragile-range-guard.test.ts, NOT
 *                      fragile-range-patterns.test.ts - a name-derived
 *                      guess would be wrong).
 *   discoverSurfaceManifests(root) -> string[] - the LIVE-TREE scan of
 *                      every scripts/*.mjs carrying a --print-* CLI surface
 *                      (a QUERIES map or an inline --print query mode),
 *                      excluding the registry itself (it lists the
 *                      manifests, it is not one). The form test asserts
 *                      discovered == registered, so a 5th manifest with a
 *                      --print surface but no registry entry FAILS LOUDLY.
 *
 * OUT OF SHAPE (documented, not registered): fuzz-targets.mjs IS a
 *   manifest (FUZZ_TARGETS exports + a CONTRACT suite fuzz-mapped.test.ts)
 *   but its CLI is a DEFAULT-PRINT + --check-coverage runner, NOT a
 *   --print-* query mode - a different CLI contract, so it is OUT of the
 *   surface-manifest shape this registry guards (its own suite pins it).
 *
 * API (importable - entry-point guarded):
 *   import { SURFACE_MANIFESTS, discoverSurfaceManifests } from "./manifest-registry.mjs"
 *
 * CLI (STANDALONE ONLY):
 *   node scripts/manifest-registry.mjs --print-manifests
 *     prints the registered module rel-paths space-joined (what the form
 *     test's CLI pin asserts)
 *   Zero/two flags is a usage error (exit 2) - same no-silent-ignore
 *   posture as the sibling manifests.
 *
 * Exit codes: 0 = printed a fact - 2 = usage error (wrong/missing flag).
 */
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

/** The registered surface manifests: module, canonical --print query, contract suite. */
export const SURFACE_MANIFESTS = [
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
]

/** The registry's own file (it lists the manifests, it is not one of them). */
const REGISTRY_SELF = "manifest-registry.mjs"

/**
 * A scripts/*.mjs is a surface manifest when it carries a --print-* CLI
 * query surface: a QUERIES map (the workflow-contracts/encoding-surface/
 * budget-routes shape) or an inline --print query (the fragile-range
 * --print-target-dirs shape). The registry itself is excluded - it IS the
 * list, not a listed manifest. Returns sorted rel-paths. The regex runs on
 * the RAW source (a --print mention in a docblock of a NON-manifest would
 * over-flag it - safe-side: the LIVE TREE fails and forces a registration
 * or a fix, never a silent miss).
 * @param {string} [root]  repo root (default: the process CWD)
 * @returns {string[]}  e.g. ["scripts/budget-routes.mjs", ...] sorted
 */
export function discoverSurfaceManifests(root = process.cwd()) {
  const scriptsDir = path.join(root, "scripts")
  const found = []
  let entries
  try {
    entries = readdirSync(scriptsDir)
  } catch {
    return [] // missing scripts/ (minimal synthetic root) = empty
  }
  for (const f of entries) {
    if (!f.endsWith(".mjs") || f === REGISTRY_SELF) continue
    let src
    try {
      src = readFileSync(path.join(scriptsDir, f), "utf8")
    } catch {
      continue // dangling symlink / race - skip (same posture as gateFiles())
    }
    if (/QUERIES\s*=\s*\{/.test(src) || /--print-[a-z-]+/.test(src)) {
      found.push(`scripts/${f}`)
    }
  }
  return found.sort()
}

// Query mode -> exported fact (module exports are NOT on globalThis, so a
// lookup map is required - same pattern as the sibling manifests).
const QUERIES = {
  "--print-manifests": () => SURFACE_MANIFESTS.map((m) => m.module).join(" "),
}

function main() {
  const args = process.argv.slice(2)
  if (args.length !== 1 || !(args[0] in QUERIES)) {
    // process.stderr.write (not console.error): the query payload and the
    // usage error are CLI streams, and the repo lint allows only
    // warn/error - stdout payload goes through process.stdout.write (the
    // same convention fragile-range-patterns.mjs documents).
    process.stderr.write("usage: node scripts/manifest-registry.mjs <--print-manifests>\n")
    process.exit(2)
  }
  process.stdout.write(QUERIES[args[0]]() + "\n")
}

// Entry-point guard: only run the CLI when executed directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
