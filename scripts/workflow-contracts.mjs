#!/usr/bin/env node
/**
 * workflow-contracts.mjs - the versioned WORKFLOW-CONTRACTS MANIFEST.
 *
 * Single source of truth for "quais workflows carregam quais contratos"
 * across the workflow guards. WHY THIS EXISTS (read before you hardcode a
 * workflow name/path in a guard or a test): the workflow contract FACTS
 * used to live in THREE places that could silently drift -
 *   - scan-guard-gates.mjs hardcoded the guard-net pair
 *     (.github/workflows/guard-gates.yml + pr-check.yml) inline,
 *   - scan-surfaces-contract.test.ts re-derived the workflow_dispatch set
 *     and the always-run (NO paths:) set from the live .github/workflows
 *     tree (a legitimate derivation, but the doc's retelling of the SETS
 *     was a second list to keep in sync),
 *   - docs/scan-surfaces.md documented the dispatch set and the risk
 *     matrix in prose (a third copy).
 * This module is the canonical list of WORKFLOW CONTRACT FACTS, in the
 * SAME pattern as encoding-surface.mjs (surface arrays) and
 * budget-routes.mjs (route registry): export the facts, expose --print-*
 * query modes, and every guard/consumer DERIVES its args from the module -
 * there is no second copy to keep in sync. The CONTRACT test suite
 * (workflow-contracts.test.ts) validates the manifest against the LIVE
 * .github/workflows tree, so a workflow added/removed/renamed without
 * updating this manifest fails loudly.
 *
 * WHAT IS HERE (the FACTS - decisions, not parsers):
 *   GUARD_NET           the guard vitest net: push net guard-gates.yml +
 *                       its PR-side twin pr-check.yml. scan-guard-gates.mjs
 *                       consumes this pair (no more inline hardcode) - the
 *                       guard's CONTRACT RULES (paths filter, test:guard
 *                       step, fragile-guard job, no needs:) stay in the
 *                       guard; the WORKFLOW NAMES live here. INDEX ORDER IS
 *                       LOAD-BEARING: GUARD_NET[0] is the push net (the
 *                       paths-filter scan target) and the LAST entry is the
 *                       PR-side twin (the prGuardJob target) - append a new
 *                       net workflow to the END and it becomes the PR twin,
 *                       so update scan-guard-gates.mjs's twin logic (or
 *                       pin the pair again) when the net grows.
 *   ENCODING_NET        the workflows that call the encoding gate
 *                       (utf8-check.yml) on the MERGE PATH - ci.yml + its
 *                       PR-side twin pr-check.yml. The 2026-08 audit of the
 *                       workflow network (ci.yml + quality-gate.yml) found
 *                       BOTH call sites currently WITHOUT `needs:` (immune
 *                       to a lint skip today) but NOTHING pinned that
 *                       immunity: a future `needs: lint` on the call site
 *                       would silently create the skip vector the
 *                       fragile-guard contract exists to close. scan-guard-
 *                       gates rule 8 consumes this pair: every call site
 *                       must exist (job key + uses: utf8-check.yml) and
 *                       carry NO needs: - the same standalone-immunity
 *                       contract as the guard/fuzz jobs. The OTHER callers
 *                       (deploy.yml, e2e-cache.yml, release-deploy.yml) are
 *                       deploy/release paths, NOT the merge path - the
 *                       audit documented them as out of the rule 8 surface
 *                       by design (scan-surfaces.md Type C).
 *   ENCODING_JOB        the job key of the encoding-gate call site inside
 *                       ENCODING_NET workflows (utf8-check). scan-guard-
 *                       gates rule 8 derives it from here.
 *   FUZZ_JOB            the job key inside pr-check.yml that must carry the
 *                       batched fuzz:ci step (the 11.11/11.12 fuzz authority).
 *                       scan-guard-gates.mjs consumes it with the SAME
 *                       standalone-immunity contract as GUARD_NET_JOB (job
 *                       present at root, no needs:, fuzz:ci step) - a PR
 *                       proof of the batched fuzz only needs to read the
 *                       fuzz job result, immune to a lint-failing check job.
 *   BENCHMARK_JOB       the job key inside pr-check.yml that must carry the
 *                       geo benchmark step (the 2026-08 network-audit rule
 *                       9). scan-guard-gates.mjs consumes it with the SAME
 *                       standalone-immunity contract (job present at root,
 *                       no needs:, run-benchmark step) - the benchmark is a
 *                       blocking gate on the merge path (fails the PR on
 *                       geo regression >threshold) and today has no needs:
 *                       (immune), but nothing pinned that immunity: a rename
 *                       would silently stop the benchmark from running and
 *                       a needs: would make it skippable by lint. The
 *                       OTHER pr-check jobs were AUDITED as out of surface
 *                       (scan-surfaces.md Type C, 2026-08): docs-encoding is
 *                       informational (continue-on-error + exit 0 - a skip
 *                       is harmless), security-headers curls a PRODUCTION
 *                       URL (not a repo gate), and check is the main job
 *                       whose loss is visible as a missing required check.
 *   GUARD_NET_JOB       the job key inside pr-check.yml that must carry
 *                       the test:guard step (the fragile-guard job).
 *   ALWAYS_RUN_SET      the workflows that run on EVERY push/PR with NO
 *                       paths: filter BY DESIGN (ci.yml, deploy.yml,
 *                       pr-check.yml, guard-gates.yml - the always-run
 *                       documented set of scan-surfaces.md Type C). The
 *                       trigger-filter contract (which workflows MAY have
 *                       paths:) keeps deriving from the live tree; the
 *                       always-run MEMBERSHIP is the fact pinned here.
 *   DISPATCH_SET        the workflows that carry workflow_dispatch: today
 *                       (the Type D set). scan-surfaces-contract Type D
 *                       validates that the LIVE dispatch set EQUALS this
 *                       manifest set - a workflow gaining/losing
 *                       workflow_dispatch: without updating the manifest
 *                       fails the contract test.
 *   CI_PROOF_INVARIANT  the ci-proof/* branch template facts: the proof
 *                       namespace itself, the canonical probe branch
 *                       (CI_PROOF_PROBE) and the two DANGER refs (push to
 *                       main fires deploy.yml; push v* tags fires
 *                       release-deploy.yml). FACT vs RULE split: the
 *                       NAMESPACE + PROBE + DANGER refs are FACTS (they
 *                       live here, consumed by ci-proof-run.mjs and Type
 *                       E); the SAFETY INVARIANT itself (the predicate "no
 *                       workflow's push/PR filter may match ci-proof/*")
 *                       is a RULE over the LIVE TREE - it stays enforced
 *                       by scan-surfaces-contract Type E against the
 *                       actual .github/workflows files, because a future
 *                       workflow must be caught WITHOUT an entry here
 *                       (pinning the forbidden set as a list would go
 *                       stale - the drift class this manifest kills). The
 *                       PROBE is the concrete branch the rule tests
 *                       against (ci-proof/<segment> shape derived from the
 *                       namespace - the same derivation ci-proof-run.mjs's
 *                       isCiProofBranch applies).
 *
 * API (importable - entry-point guarded):
 *   import {
 *     GUARD_NET, GUARD_NET_JOB, ENCODING_NET, ENCODING_JOB, FUZZ_JOB,
 *     BENCHMARK_JOB, ALWAYS_RUN_SET, DISPATCH_SET, CI_PROOF_NAMESPACE,
 *     CI_PROOF_PROBE, DANGER_REFS, QUERIES,
 *   } from "./workflow-contracts.mjs"
 *
 * CLI (what guards call - STANDALONE ONLY, one flag per invocation):
 *   node scripts/workflow-contracts.mjs --print-guard-net
 *     prints GUARD_NET.join(" ")  ->  ".github/workflows/guard-gates.yml .github/workflows/pr-check.yml"
 *   node scripts/workflow-contracts.mjs --print-guard-net-job
 *     prints GUARD_NET_JOB  ->  "fragile-guard"
 *   node scripts/workflow-contracts.mjs --print-encoding-net
 *     prints ENCODING_NET.join(" ")  ->  ".github/workflows/ci.yml .github/workflows/pr-check.yml"
 *   node scripts/workflow-contracts.mjs --print-encoding-job
 *     prints ENCODING_JOB  ->  "utf8-check"
 *   node scripts/workflow-contracts.mjs --print-fuzz-job
 *     prints FUZZ_JOB  ->  "fuzz"
 *   node scripts/workflow-contracts.mjs --print-benchmark-job
 *     prints BENCHMARK_JOB  ->  "benchmark"
 *   node scripts/workflow-contracts.mjs --print-always-run
 *     prints ALWAYS_RUN_SET.join(" ")  ->  "ci.yml deploy.yml pr-check.yml guard-gates.yml"
 *   node scripts/workflow-contracts.mjs --print-dispatch
 *     prints DISPATCH_SET.join(" ")  ->  the 8 dispatch workflows (sorted)
 *   Combining print flags (or passing no flag) is a usage error (exit 2) -
 *   same no-silent-ignore posture as encoding-surface.mjs.
 *
 * Exit codes: 0 = printed a fact - 2 = usage error (wrong/missing flag).
 */
import path from "node:path"
import { pathToFileURL } from "node:url"

/** The guard vitest net: push net + PR-side twin (scan-guard-gates.mjs). */
export const GUARD_NET = [
  ".github/workflows/guard-gates.yml",
  ".github/workflows/pr-check.yml",
]

/** The pr-check.yml job key that must run the test:guard step. */
export const GUARD_NET_JOB = "fragile-guard"

/** The merge-path workflows that call the encoding gate (utf8-check.yml). */
export const ENCODING_NET = [
  ".github/workflows/ci.yml",
  ".github/workflows/pr-check.yml",
]

/** The job key of the encoding-gate call site inside ENCODING_NET workflows. */
export const ENCODING_JOB = "utf8-check"

/** The pr-check.yml job key that must run the geo benchmark step (rule 9). */
export const BENCHMARK_JOB = "benchmark"

/** The pr-check.yml job key that must run the batched fuzz:ci step. */
export const FUZZ_JOB = "fuzz"

/** Workflows that run on every push/PR with NO paths: filter BY DESIGN. */
export const ALWAYS_RUN_SET = ["ci.yml", "deploy.yml", "pr-check.yml", "guard-gates.yml"]

/** The bare workflow-file names of GUARD_NET (the live-tree comparison form). */
export const GUARD_NET_FILES = GUARD_NET.map((p) => path.basename(p))

/** Workflows carrying workflow_dispatch: today (the Type D reachable set). */
export const DISPATCH_SET = [
  "deploy.yml",
  "e2e-cache.yml",
  "guard-gates.yml",
  "hook-parallel-race.yml",
  "lighthouse-ci.yml",
  "pr-check.yml",
  "release-deploy.yml",
  "ssh-composite-proof.yml",
]

/** The ci-proof branch template: the proof namespace. */
export const CI_PROOF_NAMESPACE = "ci-proof"

/**
 * The canonical ci-proof probe branch (Type E safety invariant): the
 * concrete branch the rule tests against - `ci-proof/<segment>` derived
 * from the namespace (the SAME shape ci-proof-run.mjs's isCiProofBranch
 * accepts). No workflow's push/PR filter may match this branch; the probe
 * is the FACT, the live-tree scan that proves it stays in Type E.
 */
export const CI_PROOF_PROBE = `${CI_PROOF_NAMESPACE}/proof-branch`

/** The two DANGER refs of the risk matrix (push main -> deploy, v* tags -> release). */
export const DANGER_REFS = [
  { ref: "main", workflow: "deploy.yml" },
  { ref: "v*", workflow: "release-deploy.yml" },
]

// Query mode -> exported fact (module exports are NOT on globalThis, so a
// lookup map is required - same pattern as encoding-surface.mjs QUERIES).
export const QUERIES = {
  "--print-guard-net": GUARD_NET,
  "--print-guard-net-job": [GUARD_NET_JOB],
  "--print-encoding-net": ENCODING_NET,
  "--print-encoding-job": [ENCODING_JOB],
  "--print-fuzz-job": [FUZZ_JOB],
  "--print-benchmark-job": [BENCHMARK_JOB],
  "--print-always-run": [...ALWAYS_RUN_SET].sort(),
  "--print-dispatch": [...DISPATCH_SET].sort(),
}

function main() {
  const args = process.argv.slice(2)
  if (args.length !== 1 || !(args[0] in QUERIES)) {
    console.error(
      "usage: node scripts/workflow-contracts.mjs <--print-guard-net|--print-guard-net-job|--print-encoding-net|--print-encoding-job|--print-fuzz-job|--print-benchmark-job|--print-always-run|--print-dispatch>",
    )
    process.exit(2)
  }
  console.log(QUERIES[args[0]].join(" "))
}

// Entry-point guard: only run the CLI when executed directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
