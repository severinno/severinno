/**
 * severinno-scp-golden.test.ts — divergence guard for the VPS file-copy
 * path of the Severinno repo.
 *
 * Context: VPS access is 100% centralized in local composite actions.
 * .github/actions/severinno-ssh wraps appleboy/ssh-action@v1 and
 * .github/actions/severinno-scp wraps appleboy/scp-action@v1. The health-check
 * workflow used to repeat the appleboy/scp-action@v1 block inline (the
 * host/username/key trio copy-pasted across scp AND ssh steps) — the same
 * duplication severinno-ssh was created to kill on the ssh side.
 *
 * What this suite guards:
 *   1. WIRING — the health-check.yml scp step must use the composite, not the
 *      appleboy pin inline, and must pass the full credential trio.
 *   2. PIN GUARD — the appleboy pins live ONLY inside the composite actions:
 *      no workflow step (parsed, so comments don't count) may use
 *      appleboy/{scp,ssh}-action@vN inline at ANY version. Complements the
 *      raw-text scan:
 *      not even a comment reference should remain (the ci.yml example now
 *      shows the composites).
 *   3. CONTRACT — severinno-scp/action.yml declares the required inputs
 *      (host/username/key/source/target) and forwards every declared input to
 *      EXACTLY ONE appleboy/scp-action@vN pin (version-agnostic on purpose:
 *      Renovate with pinVersions bumps @v1 → @v1.x.y, and the guard must
 *      survive the bump while still rejecting a second pin).
 *   4. CREDENTIAL-TRIO GUARD — every workflow step using either composite
 *      must pass host + username + key (a caller dropping one secret would
 *      silently deploy with broken auth).
 *   5. MUTATIONS — prove each guard actually bites: an inline appleboy step
 *      and a composite call missing a credential both fail the guard.
 *
 * Unlike the awk/prove-gate suites there is NO golden copy of the composite:
 * the action.yml IS versioned in git (it is already the source of truth), so
 * a duplicated fixture would be a second source to drift. The divergence risk
 * is inline workflow usage — that is what the pin + trio guards hunt.
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

// js-yaml has no @types in this repo (see release-assert-route-gate.test.ts).
// @ts-expect-error js-yaml is untyped in this repo; only yaml.load is used
import yaml from "js-yaml"

const ACTIONS_DIR = path.resolve(process.cwd(), ".github", "actions")
const WORKFLOWS_DIR = path.resolve(process.cwd(), ".github", "workflows")

interface Step {
  name?: string
  uses?: string
  with?: Record<string, unknown>
  run?: string
}

interface Job {
  steps?: Step[]
}

interface WorkflowDoc {
  jobs?: Record<string, Job>
}

interface CompositeDoc {
  name?: string
  description?: string
  inputs?: Record<string, { required?: boolean; default?: string; description?: string }>
  runs?: { using?: string; steps?: Step[] }
}

/** Parse one YAML file (workflow or composite action). */
function loadYaml<T>(file: string): T {
  return yaml.load(fs.readFileSync(file, "utf8")) as T
}

/** Every step of every workflow file (parsed — YAML comments are excluded). */
function allWorkflowSteps(): Array<{ file: string; step: Step }> {
  const out: Array<{ file: string; step: Step }> = []
  for (const f of fs.readdirSync(WORKFLOWS_DIR)) {
    if (!/\.ya?ml$/.test(f)) continue
    const doc = loadYaml<WorkflowDoc>(path.join(WORKFLOWS_DIR, f))
    for (const job of Object.values(doc.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        out.push({ file: f, step })
      }
    }
  }
  return out
}

/** Inline appleboy usages among parsed steps (empty = pin only in composites). */
function findInlineAppleboy(steps: Array<{ step: Step }>): string[] {
  return steps
    .filter(({ step }) => /^appleboy\/(scp|ssh)-action@/.test(step.uses ?? ""))
    .map(({ step }) => `uses: ${step.uses} (${step.name ?? "unnamed step"})`)
}

/** Composite callers missing any of the required credentials. */
function findMissingCredentials(steps: Array<{ file: string; step: Step }>): string[] {
  const REQUIRED = ["host", "username", "key"]
  return steps
    .filter(({ step }) => /^\.\/\.github\/actions\/severinno-(ssh|scp)$/.test(step.uses ?? ""))
    .filter(({ step }) => REQUIRED.some((k) => !(k in (step.with ?? {}))))
    .map(({ file, step }) => `${file} :: ${step.name ?? "unnamed"} :: missing of ${REQUIRED.join("/")}`)
}

/** Appleboy scp pins inside a composite doc (version-agnostic: @v1 or @v1.2.0). */
function findScpPins(doc: CompositeDoc): Step[] {
  return (doc.runs?.steps ?? []).filter((s) => /^appleboy\/scp-action@v/.test(s.uses ?? ""))
}

interface RenovateConfig {
  enabledManagers?: string[]
  "github-actions"?: { pinVersions?: boolean; fileMatch?: string[] }
}

/** Read renovate.json (the controlled-bump contract). */
function loadRenovateConfig(): RenovateConfig {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "renovate.json"), "utf8")) as RenovateConfig
}

/**
 * Validate the controlled-bump contract. Returns violation messages
 * (empty = valid). Shared by the happy-path test AND the mutation tests, so
 * a mutation genuinely exercises the validator instead of re-reading the
 * same file.
 */
function validateRenovateConfig(cfg: RenovateConfig): string[] {
  const problems: string[] = []
  // The manager must be ENABLED, or the whole github-actions block is inert
  // (Renovate only runs managers listed in enabledManagers). A mutation
  // flipping it to ["npm"] would otherwise pass every check below while
  // silently disabling the pin updates.
  if (!(cfg.enabledManagers ?? []).includes("github-actions")) {
    problems.push("enabledManagers must include github-actions (otherwise the block is inert)")
  }
  const ga = cfg["github-actions"]
  if (!ga) {
    problems.push("github-actions manager config missing")
    return problems
  }
  if (ga.pinVersions !== true) {
    problems.push("github-actions.pinVersions must be true (floating @v1 would silently drift)")
  }
  const fileMatch = ga.fileMatch ?? []
  // The composites are the pin home — the root `action.yml` pattern (pattern
  // 3) would ALSO match their paths, so pin the .github/actions pattern's
  // EXISTENCE separately: dropping it must fail even if other patterns still
  // match the composite paths.
  if (!fileMatch.some((p) => p.includes(".github/actions"))) {
    problems.push("github-actions.fileMatch must include a .github/actions/ pattern (composites are the pin home)")
  }
  // Every pin location must be inside Renovate's scan scope.
  for (const rel of [
    ".github/actions/severinno-ssh/action.yml",
    ".github/actions/severinno-scp/action.yml",
    ".github/workflows/ci.yml",
  ]) {
    if (!fileMatch.some((p) => new RegExp(p).test(rel))) {
      problems.push("github-actions.fileMatch must match " + rel)
    }
  }
  return problems
}

/** The proof job's severinno-ssh step (found by its composite `uses`). */
function findProofSshStep(steps: Step[]): Step | undefined {
  return steps.find((s) => s.uses === "./.github/actions/severinno-ssh")
}

/**
 * Validate the runtime proof wiring in .github/workflows/ssh-composite-proof.yml.
 * Returns violation messages (empty = valid). Shared by the happy-path test
 * AND the mutation tests, so a mutation genuinely exercises the validator.
 *
 * The one fact this pins hard: appleboy/ssh-action is a DOCKER container
 * action. It runs as a sibling container on the runner's bridge network, so
 * `localhost` inside it is the container itself — NOT the runner host. A
 * local docker sshd is only reachable via the bridge gateway 172.17.0.1.
 * `host: localhost` would silently fail; the mutation test proves the
 * validator rejects it.
 */
function validateProofHost(steps: Step[]): string[] {
  const problems: string[] = []
  const ssh = findProofSshStep(steps)
  if (!ssh) {
    problems.push("proof job must run ./.github/actions/severinno-ssh")
    return problems
  }
  const withVals = ssh.with ?? {}
  if (withVals.host !== "172.17.0.1") {
    problems.push("proof host must be the docker bridge gateway 172.17.0.1 (docker container action cannot reach runner localhost)")
  }
  if (withVals.port !== "2222") {
    problems.push("proof port must be 2222 (the sshd container's published port)")
  }
  if (withVals.username !== "severinno") {
    problems.push("proof username must match the sshd USER_NAME (severinno)")
  }
  // The key must flow from the keygen step (a hardcoded/empty key would only
  // be caught by the slow docker job — the fast suite pins the wiring).
  if (!String(withVals.key ?? "").includes("steps.gen.outputs")) {
    problems.push("proof key must reference the generated ephemeral keypair (steps.gen.outputs)")
  }
  // The remote script must self-assert and write the marker that the verify
  // step reads back INSIDE the container — that is the semantic proof that
  // the composite really ran a command over ssh.
  const script = String(withVals.script ?? "")
  if (!script.includes("severinno-ssh-proof-ok")) {
    problems.push("proof script must write the /tmp/severinno-proof-marker payload")
  }
  return problems
}

describe("severinno-scp composite — VPS access 100% centralized", () => {
  it("WIRING: the health-check.yml scp step uses the composite with the full credential trio", () => {
    const doc = loadYaml<WorkflowDoc>(path.join(WORKFLOWS_DIR, "health-check.yml"))
    const job = Object.values(doc.jobs ?? {})[0]
    const copyStep = (job?.steps ?? []).find((s) => (s.name ?? "").includes("Copy health check script"))
    expect(copyStep).toBeDefined()
    expect(copyStep?.uses).toBe("./.github/actions/severinno-scp")
    expect(copyStep?.with).toMatchObject({
      host: "${{ secrets.DEPLOY_HOST }}",
      username: "${{ secrets.DEPLOY_USER }}",
      key: "${{ secrets.DEPLOY_KEY }}",
      source: "scripts/health-check.sh",
      target: "${{ secrets.DEPLOY_PATH }}",
    })
  })

  it("PIN GUARD: no workflow step uses appleboy/{scp,ssh}-action inline", () => {
    const steps = allWorkflowSteps().map(({ step }) => ({ step }))
    expect(findInlineAppleboy(steps)).toEqual([])
  })

  it("PIN GUARD (raw text): not even a comment reference to the appleboy pins remains in workflows", () => {
    // The ci.yml deploy example was migrated to the composites — the claim
    // 'the appleboy pin lives ONLY in .github/actions/' must hold literally.
    const offenders: string[] = []
    for (const f of fs.readdirSync(WORKFLOWS_DIR)) {
      if (!/\.ya?ml$/.test(f)) continue
      const content = fs.readFileSync(path.join(WORKFLOWS_DIR, f), "utf8")
      for (const line of content.split(/\r?\n/)) {
        if (/appleboy\/(scp|ssh)-action@/.test(line)) {
          offenders.push(`${f}: ${line.trim()}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("CONTRACT: severinno-scp declares the required inputs and forwards them all", () => {
    const doc = loadYaml<CompositeDoc>(path.join(ACTIONS_DIR, "severinno-scp", "action.yml"))
    expect(doc.runs?.using).toBe("composite")

    const required = ["host", "username", "key", "source", "target"]
    for (const k of required) {
      expect(doc.inputs?.[k]?.required).toBe(true)
    }

    // Exactly ONE appleboy scp pin inside the composite (a second pin would
    // silently split the contract). Version-agnostic on purpose: Renovate
    // (pinVersions) bumps @v1 → @v1.x.y with a reviewable PR, and this guard
    // must keep passing through the bump — it validates the SINGLE pin, not
    // the exact version.
    const pinned = findScpPins(doc)
    expect(pinned).toHaveLength(1)
    const step = pinned[0]
    expect(step?.uses).toMatch(/^appleboy\/scp-action@v\d/)
    expect(step?.with).toBeDefined()

    // Every declared input must be forwarded to the pinned step (a typo'd
    // ${{ inputs.x }} would silently pass empty → broken auth silently).
    // NOTE: string concatenation — `${{` inside a template literal is parsed
    // by esbuild as an interpolation opener and fails the transform.
    for (const k of Object.keys(doc.inputs ?? {})) {
      expect(step?.with?.[k]).toBe("${{ inputs." + k + " }}")
    }
    // And no forwarded key may reference an undeclared input.
    for (const k of Object.keys(step?.with ?? {})) {
      expect(doc.inputs?.[k]).toBeDefined()
    }
  })

  it("CREDENTIAL-TRIO GUARD: every composite caller passes host + username + key", () => {
    const steps = allWorkflowSteps()
    expect(findMissingCredentials(steps)).toEqual([])
  })

  it("MUTATION: an inline appleboy step is caught by the pin guard (version-agnostic)", () => {
    const inline: Array<{ step: Step }> = [
      { step: { name: "bad", uses: "appleboy/scp-action@v1" } },
      { step: { name: "worse", uses: "appleboy/ssh-action@v1.2.0" } },
      { step: { name: "bump-any", uses: "appleboy/scp-action@v1.3.1" } },
    ]
    const hits = findInlineAppleboy(inline)
    expect(hits).toHaveLength(3)
    expect(hits[0]).toContain("appleboy/scp-action@v1")
    expect(hits[2]).toContain("appleboy/scp-action@v1.3.1")
  })

  it("MUTATION: a composite caller missing one credential is caught by the trio guard", () => {
    const cases: Array<{ file: string; step: Step }> = [
      { file: "x.yml", step: { name: "no-key", uses: "./.github/actions/severinno-ssh", with: { host: "h", username: "u" } } },
      { file: "y.yml", step: { name: "no-host", uses: "./.github/actions/severinno-scp", with: { username: "u", key: "k" } } },
      { file: "z.yml", step: { name: "ok", uses: "./.github/actions/severinno-ssh", with: { host: "h", username: "u", key: "k" } } },
    ]
    const hits = findMissingCredentials(cases)
    expect(hits).toHaveLength(2)
    expect(hits[0]).toContain("no-key")
    expect(hits[1]).toContain("no-host")
  })

  it("MUTATION (no false positive): benign composites and non-credential actions never trip the trio guard", () => {
    // The trio guard must ONLY inspect callers of the two severinno composites.
    // A future edit broadening the walk to all `uses:` would flag checkout /
    // setup-bun on every PR — this mutation pins the safe-side boundary.
    const cases: Array<{ file: string; step: Step }> = [
      { file: "a.yml", step: { name: "checkout", uses: "actions/checkout@v4" } },
      { file: "b.yml", step: { name: "setup-bun", uses: "oven-sh/setup-bun@v2" } },
      { file: "c.yml", step: { name: "custom non-ssh action", uses: "acme/format@v1", with: { host: "h" } } },
      { file: "d.yml", step: { name: "severinno-ssh complete", uses: "./.github/actions/severinno-ssh", with: { host: "h", username: "u", key: "k", script: "x" } } },
      { file: "e.yml", step: { name: "severinno-scp complete", uses: "./.github/actions/severinno-scp", with: { host: "h", username: "u", key: "k", source: "s", target: "t" } } },
    ]
    expect(findMissingCredentials(cases)).toEqual([])
  })

  it("MUTATION: a SECOND scp pin inside the composite trips the single-pin contract (post-bump versions too)", () => {
    // The single-pin invariant must hold even after Renovate bumps @v1 →
    // @v1.2.0: exactly one scp pin, never two. Two pins would silently split
    // the contract (each step a half-configuration).
    const doc: CompositeDoc = {
      runs: {
        using: "composite",
        steps: [
          { name: "pin1", uses: "appleboy/scp-action@v1.2.0" },
          { name: "pin2", uses: "appleboy/scp-action@v1.3.1" },
        ],
      },
    }
    const pinned = findScpPins(doc)
    expect(pinned).toHaveLength(2)
    // And the mutation ALSO proves the version-agnostic filter: a bumped
    // @v1.2.0 pin is still found (a naive `=== "@v1"` filter would miss it
    // and the guard would silently die on the first Renovate PR).
    expect(pinned[0].uses).toMatch(/^appleboy\/scp-action@v\d/)
    expect(pinned[0].uses).not.toBe("appleboy/scp-action@v1")
  })

  it("RENOVATE: renovate.json manages the appleboy pins with pinVersions (controlled full-version bumps)", () => {
    // The whole bump story depends on renovate.json: without pinVersions the
    // @v1 major tag floats silently; without the fileMatch the composite
    // action.yml files are never scanned. The shared validator pins the
    // contract (this test AND the mutations below exercise the same code).
    expect(validateRenovateConfig(loadRenovateConfig())).toEqual([])
  })

  it("RENOVATE (mutation): pinVersions=false is REJECTED by the validator", () => {
    // A reviewer flipping pinVersions off to 'quiet' a Renovate PR must fail
    // CI: the whole point is that version bumps are reviewable, not silent.
    // The mutation passes a REAL mutated config to the shared validator, so
    // this is not a vacuous re-read of the file.
    const cfg = loadRenovateConfig()
    const mutated: RenovateConfig = {
      "github-actions": { ...cfg["github-actions"], pinVersions: false },
    }
    const problems = validateRenovateConfig(mutated)
    expect(problems.some((p) => p.includes("pinVersions must be true"))).toBe(true)
  })

  it("RENOVATE (mutation): removing the .github/actions fileMatch pattern is REJECTED even when pattern 3 still matches the composites", () => {
    // The root `action.yml` pattern (pattern 3) ALSO matches the composite
    // paths (they end in /action.yml) — so a per-path match check alone would
    // let a reviewer delete the .github/actions/ pattern unnoticed. The
    // validator separately requires the actions-dir pattern to exist.
    const cfg = loadRenovateConfig()
    const mutated: RenovateConfig = {
      "github-actions": {
        ...cfg["github-actions"],
        fileMatch: ["(^|/)\\.github/workflows/.+\\.ya?ml$", "(^|/)action\\.ya?ml$"],
      },
    }
    const problems = validateRenovateConfig(mutated)
    expect(problems.some((p) => p.includes(".github/actions/ pattern"))).toBe(true)
  })

  it("RENOVATE (mutation): dropping github-actions from enabledManagers is REJECTED — the block would be inert", () => {
    // The manager must stay enabled, or Renovate never scans the composites
    // even though the github-actions block looks valid. This is the one drift
    // hole the per-field checks alone cannot see.
    const cfg = loadRenovateConfig()
    const mutated: RenovateConfig = {
      ...cfg,
      enabledManagers: ["npm"],
    }
    const problems = validateRenovateConfig(mutated)
    expect(problems.some((p) => p.includes("enabledManagers must include github-actions"))).toBe(true)
  })

  it("PROOF: ssh-composite-proof.yml boots a local docker sshd and runs the real composite against it", () => {
    const doc = loadYaml<WorkflowDoc>(path.join(WORKFLOWS_DIR, "ssh-composite-proof.yml"))
    const job = Object.values(doc.jobs ?? {})[0]
    const steps = job?.steps ?? []
    // The runtime contract (host/port/username/script) — NOT just YAML shape.
    expect(validateProofHost(steps)).toEqual([])
    // The proof must boot a REAL sshd and verify REMOTE execution inside the
    // container — deleting either step would turn the proof into a no-op.
    const boot = steps.find((s) => (s.name ?? "").includes("Start local sshd"))
    expect(boot?.run).toContain("lscr.io/linuxserver/openssh-server")
    const verify = steps.find((s) => (s.name ?? "").includes("Verify remote execution"))
    expect(verify?.run).toContain("docker exec severinno-sshd")
    expect(verify?.run).toContain("severinno-ssh-proof-ok")
  })

  it("PROOF (mutation): host=localhost is REJECTED — a docker container action cannot reach the runner's localhost", () => {
    // The naive 'fix' (localhost instead of 172.17.0.1) would silently break
    // the proof at runtime with zero YAML errors — this mutation proves the
    // validator genuinely rejects it.
    const doc = loadYaml<WorkflowDoc>(path.join(WORKFLOWS_DIR, "ssh-composite-proof.yml"))
    const job = Object.values(doc.jobs ?? {})[0]
    const steps = (job?.steps ?? []).map((s) => ({ ...s }))
    const ssh = findProofSshStep(steps)
    if (ssh) {
      ssh.with = { ...(ssh.with ?? {}), host: "localhost" }
    }
    const problems = validateProofHost(steps)
    expect(problems.some((p) => p.includes("bridge gateway"))).toBe(true)
  })

  it("PROOF (mutation): removing the severinno-ssh step from the proof job is REJECTED", () => {
    // A reviewer deleting the composite call (e.g. 'the proof is flaky, drop
    // it') must fail CI — the runtime contract would silently lose its only
    // real verification.
    const doc = loadYaml<WorkflowDoc>(path.join(WORKFLOWS_DIR, "ssh-composite-proof.yml"))
    const job = Object.values(doc.jobs ?? {})[0]
    const steps = (job?.steps ?? []).filter((s) => s.uses !== "./.github/actions/severinno-ssh")
    const problems = validateProofHost(steps)
    expect(problems.some((p) => p.includes("must run ./.github/actions/severinno-ssh"))).toBe(true)
  })
})
