/**
 * workflow-contracts.test.ts - the versioned WORKFLOW-CONTRACTS MANIFEST suite.
 *
 * Pins the single source of truth for "quais workflows carregam quais
 * contratos" (scripts/workflow-contracts.mjs), in the same pattern as the
 * encoding-surface manifest suite: the exported facts ARE the contract, the
 * --print-* CLI must reflect them exactly, and every consumer (the
 * scan-guard-gates guard, the scan-surfaces-contract Type D/E validation)
 * DERIVES from the manifest - never hardcodes a second copy (that was the
 * drift class this module exists to kill: the guard-net pair used to be
 * inline in scan-guard-gates.mjs, the dispatch set lived only as the doc's
 * retelling + a live-tree derivation).
 *
 * The LIVE-TREE pins are the drift guard: the manifest facts are validated
 * against the ACTUAL .github/workflows tree, so a workflow added/removed/
 * renamed - or a workflow_dispatch:/paths: block gained/lost - fails LOUDLY
 * until the manifest (and the docs that retell it) are updated together.
 *
 * The GROWTH CONTRACT is the FORWARD direction: the manifest facts are LIVE
 * derivation sources. A 5th guard-net workflow added to GUARD_NET must be
 * reflected by --print-guard-net (and picked up by scan-guard-gates via the
 * WORKFLOW_CONTRACTS_MODULE override - the FRAGILE_MODULE pattern).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { GUARD_PR_TWIN, cleanupTempDirs, createTempDir, runSubprocess, writeModuleCopy, type ModulePatchOp } from "./golden-copy-utils"
import {
  ALWAYS_RUN_SET,
  BENCHMARK_JOB,
  CI_PROOF_NAMESPACE,
  CI_PROOF_PROBE,
  DANGER_REFS,
  DISPATCH_SET,
  ENCODING_JOB,
  ENCODING_NET,
  FUZZ_JOB,
  GUARD_NET,
  GUARD_NET_FILES,
  GUARD_NET_JOB,
} from "../workflow-contracts.mjs"

const ROOT = process.cwd()
const MODULE = path.join(ROOT, "scripts", "workflow-contracts.mjs")
const WF_DIR = path.join(ROOT, ".github", "workflows")

/** Run the manifest CLI with the given args. */
function runCli(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = runSubprocess({ command: "node", args: [MODULE, ...args] })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

/** The live workflow-file names (sorted) - the tree the facts must match. */
function liveWorkflowFiles(): string[] {
  return fs
    .readdirSync(WF_DIR)
    .filter((f) => f.endsWith(".yml"))
    .sort()
}

/**
 * The closing bracket must anchor to a line containing ONLY `]` (the
 * multi-line array terminator), never to the first `]` at any line end: a
 * lazy match to an earlier line-ending `]` (a future array entry whose line
 * ends with the bracket) would truncate the patch span silently and produce
 * a broken module copy instead of the intended WORKFLOW MISSING. The
 * alternation keeps the single-line form (encoding-surface style, `]`
 * mid-line) working: alt 1 forbids newlines and `]` inside (single-line),
 * alt 2 requires the closing `]` alone on its line (multi-line).
 */
function factDecl(name: string): RegExp {
  // `\\[` -> `\[` in the template value -> a literal `[` in the regex
  // (a `\` + `[` would match a BACKSLASH before the bracket - the bug the
  // GROWTH harness hit against the multi-line GUARD_NET declaration).
  return new RegExp(`^export const ${name} = (?:\\[[^\\]\\n]*\\]|[\\s\\S]*?^\\]\\s*$)`, "m")
}

/**
 * Write a TEMP COPY of the workflow-contracts module with one array fact
 * replaced (the GROWTH CONTRACT direction). Built on the SHARED
 * writeModuleCopy scaffold (golden-copy-utils.ts): the declaration is
 * located by STRUCTURAL SHAPE, so a value drift is patched onto whatever the
 * module declares today and a SHAPE drift (rename/restructure) fails LOUDLY
 * with the name - the same fail-loudly posture as the encoding-surface
 * growth harness. Returns the copy path.
 */
function writePatchedManifest(dir: string, name: string, entries: string[]): string {
  const ops: ModulePatchOp[] = [
    {
      anchor: factDecl(name),
      replace: `export const ${name} = ${JSON.stringify(entries)}`,
      onMissing: `GROWTH CONTRACT: could not locate the ${name} declaration in workflow-contracts.mjs (single-line shape changed) - update this harness`,
    },
  ]
  // writeModuleCopy reads the SOURCE module (MODULE) to locate the anchor and
  // writes the patched copy to the temp dir - never pass the copy path as
  // the anchor source (it does not exist yet).
  return writeModuleCopy(dir, MODULE, ops)
}

afterEach(() => {
  cleanupTempDirs()
})

describe("workflow-contracts.mjs - versioned workflow-contracts manifest", () => {
  it("module is syntactically valid (node --check)", () => {
    const r = runSubprocess({ command: "node", args: ["--check", MODULE] })
    expect(r.status).toBe(0)
  }, 60000)

  it("ABSOLUTE PIN: GUARD_NET (the guard vitest net: push + PR twin)", () => {
    expect(GUARD_NET).toEqual([
      ".github/workflows/guard-gates.yml",
      ".github/workflows/pr-check.yml",
    ])
    expect(GUARD_NET_FILES).toEqual(["guard-gates.yml", "pr-check.yml"])
  })

  it("ABSOLUTE PIN: GUARD_NET_JOB (the pr-check.yml guard job key)", () => {
    expect(GUARD_NET_JOB).toBe("fragile-guard")
  })

  it("ABSOLUTE PIN: FUZZ_JOB (the pr-check.yml batched fuzz:ci authority job key)", () => {
    expect(FUZZ_JOB).toBe("fuzz")
  })

  it("ABSOLUTE PIN: ENCODING_NET (the merge-path encoding-gate callers: ci.yml + pr-check.yml)", () => {
    expect(ENCODING_NET).toEqual([
      ".github/workflows/ci.yml",
      ".github/workflows/pr-check.yml",
    ])
    expect(ENCODING_JOB).toBe("utf8-check")
  })

  it("ABSOLUTE PIN: BENCHMARK_JOB (the pr-check.yml geo benchmark gate job key)", () => {
    expect(BENCHMARK_JOB).toBe("benchmark")
  })

  it("ABSOLUTE PIN: ALWAYS_RUN_SET (NO paths: BY DESIGN)", () => {
    expect(ALWAYS_RUN_SET).toEqual(["ci.yml", "deploy.yml", "pr-check.yml", "guard-gates.yml"])
  })

  it("ABSOLUTE PIN: DISPATCH_SET (the workflow_dispatch reachable set)", () => {
    expect([...DISPATCH_SET].sort()).toEqual(
      [
        "deploy.yml",
        "e2e-cache.yml",
        "guard-gates.yml",
        "hook-parallel-race.yml",
        "lighthouse-ci.yml",
        "pr-check.yml",
        "release-deploy.yml",
        "ssh-composite-proof.yml",
      ].sort(),
    )
  })

  it("ABSOLUTE PIN: CI_PROOF_NAMESPACE + CI_PROOF_PROBE + DANGER_REFS (the risk matrix facts)", () => {
    expect(CI_PROOF_NAMESPACE).toBe("ci-proof")
    expect(CI_PROOF_PROBE).toBe("ci-proof/proof-branch")
    expect(CI_PROOF_PROBE).toBe(`${CI_PROOF_NAMESPACE}/proof-branch`)
    expect(DANGER_REFS).toEqual([
      { ref: "main", workflow: "deploy.yml" },
      { ref: "v*", workflow: "release-deploy.yml" },
    ])
  })

  it("GROWTH/DERIVATION: CI_PROOF_PROBE follows the namespace (rename the namespace, the probe follows - the Type E probe cannot drift from the template)", () => {
    // The probe is DERIVED from the namespace (ci-proof/<segment> - the
    // same shape isCiProofBranch accepts): changing CI_PROOF_NAMESPACE must
    // change the probe, so the Type E safety scan tests the CURRENT
    // namespace, never a stale literal. This pin proves the derivation is
    // structural (template literal), not a second hardcoded copy.
    expect(CI_PROOF_PROBE.startsWith(`${CI_PROOF_NAMESPACE}/`)).toBe(true)
    expect(CI_PROOF_PROBE.split("/")).toEqual([CI_PROOF_NAMESPACE, "proof-branch"])
  })

  it("CLI: --print-guard-net prints the space-joined GUARD_NET", () => {
    const r = runCli("--print-guard-net")
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe(GUARD_NET.join(" "))
  }, 60000)

  it("CLI: --print-guard-net-job / --print-encoding-net / --print-encoding-job / --print-fuzz-job / --print-benchmark-job / --print-always-run / --print-dispatch match the exports", () => {
    const job = runCli("--print-guard-net-job")
    expect(job.status).toBe(0)
    expect(job.stdout.trim()).toBe(GUARD_NET_JOB)
    const encNet = runCli("--print-encoding-net")
    expect(encNet.status).toBe(0)
    expect(encNet.stdout.trim()).toBe(ENCODING_NET.join(" "))
    const encJob = runCli("--print-encoding-job")
    expect(encJob.status).toBe(0)
    expect(encJob.stdout.trim()).toBe(ENCODING_JOB)
    const fuzz = runCli("--print-fuzz-job")
    expect(fuzz.status).toBe(0)
    expect(fuzz.stdout.trim()).toBe(FUZZ_JOB)
    const bench = runCli("--print-benchmark-job")
    expect(bench.status).toBe(0)
    expect(bench.stdout.trim()).toBe(BENCHMARK_JOB)
    const always = runCli("--print-always-run")
    expect(always.status).toBe(0)
    expect(always.stdout.trim()).toBe([...ALWAYS_RUN_SET].sort().join(" "))
    const dispatch = runCli("--print-dispatch")
    expect(dispatch.status).toBe(0)
    expect(dispatch.stdout.trim()).toBe([...DISPATCH_SET].sort().join(" "))
  }, 60000)

  it("CLI: zero flags is a usage error (exit 2, no silent default)", () => {
    const r = runCli()
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("usage:")
  }, 60000)

  it("CLI: two print flags is a usage error (exit 2, no-silent-ignore)", () => {
    const r = runCli("--print-dispatch", "--print-always-run")
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("usage:")
  }, 60000)

  it("LIVE TREE: the GUARD_NET files exist in .github/workflows (the net is real, not a phantom pair)", () => {
    const live = new Set(liveWorkflowFiles())
    for (const f of GUARD_NET_FILES) {
      expect(live.has(f), `${f} must exist in .github/workflows (guard-net workflow deleted?)`).toBe(true)
    }
  })

  it("LIVE TREE: the dispatch set equals DISPATCH_SET (a workflow gaining/losing workflow_dispatch: must update the manifest)", () => {
    // The scanner-side mirror of the scan-surfaces-contract Type D manifest
    // pin: the live tree cannot drift from the registry. Uses the SAME
    // trigger extraction as that suite (workflow_dispatch: presence).
    const dispatchLive = liveWorkflowFiles().filter((f) =>
      fs.readFileSync(path.join(WF_DIR, f), "utf8").includes("workflow_dispatch:"),
    )
    expect(dispatchLive.sort()).toEqual([...DISPATCH_SET].sort())
  })

  it("LIVE TREE: the guard-net workflows really carry the test:guard step (the guard's premise, pinned at manifest level)", () => {
    // The scan-guard-gates guard asserts this per-workflow; this pin makes
    // the manifest-level expectation explicit: both GUARD_NET workflows
    // must run the guard vitest suite today.
    for (const rel of GUARD_NET) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8")
      expect(src).toMatch(/^\s+run:\s+bun run test:guard\s*$/m)
    }
    // The PR twin carries the guarded job key.
    const pr = fs.readFileSync(path.join(ROOT, GUARD_PR_TWIN), "utf8")
    expect(pr).toMatch(new RegExp(`^  ${GUARD_NET_JOB}:$`, "m"))
  })

  it("LIVE TREE: pr-check.yml carries the FUZZ_JOB key with the batched fuzz:ci step (the 11.11/11.12 authority)", () => {
    const pr = fs.readFileSync(path.join(ROOT, GUARD_PR_TWIN), "utf8")
    expect(pr).toMatch(new RegExp(`^  ${FUZZ_JOB}:$`, "m"))
    expect(pr).toMatch(/^\s+run:\s+bun run fuzz:ci\b/m)
    // Standalone immunity: the fuzz job must NOT depend on the check job
    // (a check failing on pre-existing lint debt must never skip fuzz).
    expect(pr).not.toMatch(/^\s+needs:/m)
  })

  it("LIVE TREE: every ENCODING_NET workflow carries the encoding-gate call site WITHOUT needs: (rule 8 - the 2026-08 network audit)", () => {
    // The 2026-08 audit of the workflow network (ci.yml + quality-gate.yml)
    // found both encoding call sites currently WITHOUT needs: (immune to a
    // lint skip today) but NOTHING pinned that immunity - a future
    // `needs: lint` would silently recreate the skip vector. This pin makes
    // the manifest-level expectation explicit; scan-guard-gates rule 8
    // enforces it per-workflow. The call-site job key + uses: line must
    // exist in EACH ENCODING_NET workflow.
    for (const rel of ENCODING_NET) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8")
      expect(src).toMatch(new RegExp(`^  ${ENCODING_JOB}:$`, "m"))
      expect(src).toMatch(/^\s+uses:\s+\.\/\.github\/workflows\/utf8-check\.yml\s*$/m)
    }
  })

  it("LIVE TREE: pr-check.yml carries the BENCHMARK_JOB key with the run-benchmark step (rule 9 - the 2026-08 network audit)", () => {
    // Rule 9's manifest-level expectation: the geo benchmark gate must be a
    // real standalone PR job (present at root + run-benchmark step), so a
    // rename that silently stops the benchmark from running fails here
    // before the guard's per-workflow scan is even needed.
    const pr = fs.readFileSync(path.join(ROOT, GUARD_PR_TWIN), "utf8")
    expect(pr).toMatch(new RegExp(`^  ${BENCHMARK_JOB}:$`, "m"))
    expect(pr).toMatch(/^\s+node scripts\/run-benchmark\.mjs\b/m)
    // Standalone immunity: the benchmark job must not depend on the check
    // job (a check failing on pre-existing lint debt must never skip the
    // geo gate).
    expect(pr).not.toMatch(/^\s+needs:/m)
  })

  it("GROWTH CONTRACT: a 5th GUARD_NET entry (temp manifest copy) is reflected by --print-guard-net AND consumed by scan-guard-gates", () => {
    // The forward direction: the guard-net is a LIVE derivation source. A
    // hypothetical 5th net workflow added to the manifest must (a) appear in
    // the --print-guard-net query and (b) make scan-guard-gates scan it -
    // via the WORKFLOW_CONTRACTS_MODULE override (the FRAGILE_MODULE /
    // ENCODING_SURFACE_MODULE pattern), zero edits in the guard itself.
    const sentinel = ".github/workflows/worker-gates.yml"
    const dir = createTempDir("wc-growth-")
    const modPath = writePatchedManifest(dir, "GUARD_NET", [...GUARD_NET, sentinel])

    const q = runSubprocess({ command: "node", args: [modPath, "--print-guard-net"] })
    expect(q.status).toBe(0)
    expect(q.stdout.trim()).toBe([...GUARD_NET, sentinel].join(" "))

    // scan-guard-gates with the patched manifest: the sentinel workflow is
    // ABSENT from the real tree -> the guard must flag it as the missing
    // net workflow (proving the guard derives from the manifest, not a
    // hardcoded pair). Control: the real manifest -> clean.
    const control = runSubprocess({ command: "node", args: [path.join(ROOT, "scripts", "scan-guard-gates.mjs")] })
    expect(control.status).toBe(0)
    const mut = runSubprocess({
      command: "node",
      args: [path.join(ROOT, "scripts", "scan-guard-gates.mjs")],
      env: { WORKFLOW_CONTRACTS_MODULE: modPath },
    })
    expect(mut.status).toBe(1)
    expect(mut.stdout).toContain("WORKFLOW MISSING")
    expect(mut.stdout).toContain(sentinel)
  }, 60000)

  it("GROWTH CONTRACT: a 3rd ENCODING_NET entry (temp manifest copy) is reflected by --print-encoding-net AND consumed by scan-guard-gates rule 8", () => {
    // The forward direction of rule 8: a hypothetical 3rd encoding caller
    // added to the manifest must (a) appear in the --print-encoding-net
    // query and (b) make scan-guard-gates rule 8 scan it via the
    // WORKFLOW_CONTRACTS_MODULE override - zero edits in the guard.
    const sentinel = ".github/workflows/e2e-cache.yml"
    const dir = createTempDir("wc-encgrowth-")
    const modPath = writePatchedManifest(dir, "ENCODING_NET", [...ENCODING_NET, sentinel])

    const q = runSubprocess({ command: "node", args: [modPath, "--print-encoding-net"] })
    expect(q.status).toBe(0)
    expect(q.stdout.trim()).toBe([...ENCODING_NET, sentinel].join(" "))

    // scan-guard-gates with the patched manifest: e2e-cache.yml EXISTS in
    // the real tree but its utf8-check call site is a DEPLOY-path caller
    // (documented as out of the rule 8 surface) - wait, e2e-cache.yml
    // actually carries the call site. The sentinel MUST therefore be a
    // workflow that (a) exists and (b) has no call site, so the guard flags
    // the MISSING call site - proving rule 8 derives from the manifest.
    // .github/workflows/guard-gates.yml exists and has no utf8-check call
    // site: the perfect sentinel for the rule 8 growth direction.
    const sentinel2 = ".github/workflows/guard-gates.yml"
    const modPath2 = writePatchedManifest(dir, "ENCODING_NET", [...ENCODING_NET, sentinel2])
    const mut = runSubprocess({
      command: "node",
      args: [path.join(ROOT, "scripts", "scan-guard-gates.mjs")],
      env: { WORKFLOW_CONTRACTS_MODULE: modPath2 },
    })
    expect(mut.status).toBe(1)
    expect(mut.stdout).toContain("ENCODING CALL SITE MISSING in .github/workflows/guard-gates.yml")
    // Control: the real manifest stays clean.
    const control = runSubprocess({ command: "node", args: [path.join(ROOT, "scripts", "scan-guard-gates.mjs")] })
    expect(control.status).toBe(0)
  }, 60000)
})
