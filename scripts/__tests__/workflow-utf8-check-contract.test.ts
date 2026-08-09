/**
 * workflow-utf8-check-contract.test.ts — guards the SINGLE SOURCE OF TRUTH
 * contract for the encoding gate: the gate command (verify-encoding.sh --ci
 * src/) lives ONLY in .github/workflows/utf8-check.yml, and every caller
 * (ci.yml, pr-check.yml, deploy.yml, e2e-cache.yml, release-deploy.yml)
 * must invoke it via `uses: ./.github/workflows/utf8-check.yml`
 * (workflow_call) — never as an inline copy of the job.
 *
 * History (root cause this guard kills): the encoding gate used to be
 * TRIPLICATED on PR — utf8-check.yml's own pull_request trigger + ci.yml's
 * workflow_call + pr-check.yml's inline copy of the job (whose step name
 * "Run UTF-8 validation on all .ts files" drifted to an obsolete name the
 * moment the gate moved to verify-encoding.sh). The inline copy was removed
 * (2026-08): pr-check.yml now calls the reusable workflow, and utf8-check.yml
 * no longer self-triggers on PR. This suite pins that state so the
 * divergence cannot silently come back:
 *
 *   1. pr-check.yml's utf8-check job is a `uses:` call to the reusable
 *      workflow — NO inline name/runs-on/steps.
 *   2. utf8-check.yml exposes workflow_call (is reusable).
 *   3. Every caller workflow that references utf8-check.yml does so via the
 *      SAME `uses: ./.github/workflows/utf8-check.yml` path (no inline job,
 *      no alternate path spelling that would bypass the reusable file).
 *   4. MUTATION: injecting an inline step into pr-check's utf8-check job
 *      fails the guard (proves the check really bites).
 *
 * Parsing via js-yaml (same untyped-import pattern as
 * workflow-prove-gate-golden.test.ts / release-assert-route-gate.test.ts).
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

// js-yaml has no @types in this repo (see release-assert-route-gate.test.ts).
// @ts-expect-error js-yaml is untyped in this repo; only yaml.load is used
import yaml from "js-yaml"

const WF_DIR = path.resolve(process.cwd(), ".github", "workflows")
const REUSABLE = ".github/workflows/utf8-check.yml"
const REUSABLE_USES = "./.github/workflows/utf8-check.yml"

/** Callers that must invoke the reusable workflow (not copy it inline). */
const CALLERS = ["ci.yml", "pr-check.yml", "deploy.yml", "e2e-cache.yml", "release-deploy.yml"]

interface Step {
  name?: string
  run?: string
  uses?: string
}

interface Job {
  uses?: string
  name?: string
  "runs-on"?: string
  steps?: Step[]
}

interface WorkflowDoc {
  on?: Record<string, unknown> | string[] | string
  jobs?: Record<string, Job>
}

function loadWorkflow(file: string): WorkflowDoc {
  return yaml.load(fs.readFileSync(path.join(WF_DIR, file), "utf8")) as WorkflowDoc
}

/** True when the job is a reusable `uses:` call (not an inline copy). */
function isReusableCall(job: Job | undefined): boolean {
  if (!job || typeof job !== "object") return false
  return (
    typeof job.uses === "string" &&
    job.name === undefined &&
    job["runs-on"] === undefined &&
    (job.steps === undefined || job.steps.length === 0)
  )
}

describe("utf8-check single-source-of-truth contract", () => {
  it("reusable workflow exists, exposes workflow_call, and does NOT self-trigger on pull_request", () => {
    const wf = loadWorkflow("utf8-check.yml")
    const on = wf.on
    // `on` may be object mapping triggers or a compact list; workflow_call
    // must appear in whichever shape.
    const triggers = typeof on === "object" && on !== null ? Object.keys(on) : Array.isArray(on) ? on : []
    expect(triggers).toContain("workflow_call")
    // The triplication root cause was utf8-check.yml's OWN pull_request
    // self-trigger on top of ci.yml's call + pr-check.yml's inline copy.
    // Pin that it stays off: PR coverage comes only from the callers.
    expect(triggers).not.toContain("pull_request")
  })

  it("pr-check.yml's utf8-check job is a uses: call, NOT an inline copy", () => {
    const wf = loadWorkflow("pr-check.yml")
    const job = wf.jobs?.["utf8-check"]
    expect(job).toBeDefined()
    expect(isReusableCall(job)).toBe(true)
    expect(job?.uses).toBe(REUSABLE_USES)
  })

  it("every caller invokes the reusable workflow via the SAME uses path", () => {
    for (const caller of CALLERS) {
      const wf = loadWorkflow(caller)
      const job = wf.jobs?.["utf8-check"]
      expect(job, `${caller}: utf8-check job missing`).toBeDefined()
      expect(job?.uses, `${caller}: utf8-check job must be a uses: call to ${REUSABLE}`).toBe(REUSABLE_USES)
      expect(isReusableCall(job), `${caller}: inline utf8-check job (name/runs-on/steps present)`).toBe(true)
    }
  })

  it("no workflow anywhere calls utf8-check.yml by an alternate path spelling", () => {
    // Scan EVERY workflow in .github/workflows/ for actual `uses:` calls to
    // utf8-check.yml and pin the path to the exact reusable one. Catches a
    // missing `./` prefix (GitHub treats that as an external action
    // reference -> silently forks the gate) or any other path drift.
    // Scope to `uses:` KEY lines only: comment lines legitimately mention
    // the path ("# Reusable via .github/workflows/utf8-check.yml") and must
    // NOT be flagged.
    const files = fs.readdirSync(WF_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    const offenders: string[] = []
    let calls = 0
    for (const f of files) {
      const lines = fs.readFileSync(path.join(WF_DIR, f), "utf8").split(/\r?\n/)
      for (const l of lines) {
        const trimmed = l.trim()
        // Only lines that are `uses:` keys (value after `uses:` contains the path).
        if (!/^uses:\s/.test(trimmed)) continue
        if (trimmed.includes("utf8-check.yml")) {
          calls++
          if (trimmed !== `uses: ${REUSABLE_USES}`) offenders.push(`${f}: ${trimmed}`)
        }
      }
    }
    expect(calls, "at least one workflow must call the reusable utf8-check.yml via uses:").toBeGreaterThan(0)
    expect(offenders, "alternate path spellings of utf8-check.yml (must all be exactly `uses: ./.github/workflows/utf8-check.yml`)").toEqual([])
  })

  it("MUTATION: an inline step in pr-check's utf8-check job fails the guard", () => {
    const wf = loadWorkflow("pr-check.yml")
    // Fabricate the pre-refactor inline copy the guard must reject.
    const mutated: WorkflowDoc = {
      ...wf,
      jobs: {
        ...wf.jobs,
        "utf8-check": {
          name: "UTF-8 Check",
          "runs-on": "ubuntu-latest",
          steps: [{ name: "Run UTF-8 validation on all .ts files", run: "bash scripts/check-utf8.sh --ci src/" }],
        },
      },
    }
    const job = mutated.jobs?.["utf8-check"]
    expect(isReusableCall(job)).toBe(false)
    expect(job?.uses).toBeUndefined()
  })
})
