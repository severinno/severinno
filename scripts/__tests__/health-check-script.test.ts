/**
 * health-check-script.test.ts — the SINGLE versioned health-check script
 * (scripts/health-check.sh) replaces the THREE inline loops that used to live
 * in the workflows:
 *   1. deploy.yml docker-test 'Wait for health check'  (20 attempts, sleep 3)
 *   2. deploy.yml deploy job                           (12 attempts, sleep 5, + docker prune [historical])
 *   3. release-deploy.yml deploy job                   (12 attempts, sleep 5, + docker prune)
 *
 * The ssh deploy call sites (2 and 3) now delegate to the REUSABLE workflow
 * .github/workflows/health-check.yml (job-level `uses:`), which owns the
 * checkout + scp + ssh sequence and forwards the retry/URL params from its
 * `with:` inputs to the shared script. The docker-test call site (1) stays
 * INLINE by design: its container runs on the docker-test job's own runner,
 * and a reusable workflow runs on a fresh runner that could not reach it.
 *
 * This suite covers:
 *   - WIRING: the docker-test step calls the script with the 20/3 smoke-test
 *     env; both deploy jobs call the reusable workflow with 12/5 + prune
 *     inputs + the 4 DEPLOY secrets; the reusable workflow itself contains the
 *     checkout + scp (scripts/health-check.sh) + ssh sequence forwarding the
 *     inputs as HEALTH_* env; and NO inline `for i in $(seq ...)` health loop
 *     remains in ANY workflow — the consolidation is complete.
 *   - BEHAVIORAL: the ACTUAL script runs through `bash` with shell FUNCTION
 *     shims (no PATH games, no network, no real sleeps): curl emits rotating
 *     HTTP codes and logs its URL argument, seq/sleep are inert. Asserts exit
 *     0 on 200, exit 1 after N attempts, retry-then-pass, custom URL +
 *     EXPECT_CODE, and the `|| echo "000"` curl-failure fallback.
 *
 * Housekeeping is SEPARATE from the health check (by design): `docker image
 * prune -f` is NOT in the script anymore — it is an optional POST-DEPLOY step
 * in health-check.yml gated on `success() && inputs.docker-prune`, so the
 * deploy verdict is the health check ALONE and prune failure can never flip a
 * green deploy to red. The prune tests live in the WIRING section (workflow
 * step) instead of the BEHAVIORAL section (script).
 */
import { describe, it, expect, afterEach } from "vitest"
import fs from "node:fs"
import path from "node:path"

// js-yaml has no @types in this repo (see release-assert-route-gate.test.ts).
// @ts-expect-error js-yaml is untyped in this repo; only yaml.load is used
import yaml from "js-yaml"
import { cleanupTempDirs, createTempDir, normalizeCrlf, runSubprocess } from "./golden-copy-utils"

const ROOT = process.cwd()
const SCRIPT = path.resolve(ROOT, "scripts", "health-check.sh")
const DEPLOY_WF = path.resolve(ROOT, ".github", "workflows", "deploy.yml")
const RELEASE_WF = path.resolve(ROOT, ".github", "workflows", "release-deploy.yml")
const HEALTH_WF = path.resolve(ROOT, ".github", "workflows", "health-check.yml")
const WORKFLOWS_DIR = path.resolve(ROOT, ".github", "workflows")
const SSH_ACTION = path.resolve(ROOT, ".github", "actions", "severinno-ssh", "action.yml")
const SSH_COMPOSITE = "./.github/actions/severinno-ssh"
const SCP_COMPOSITE = "./.github/actions/severinno-scp"

afterEach(cleanupTempDirs)

// ---------------------------------------------------------------------------
// Wiring extraction (source of truth = the workflows themselves)
// ---------------------------------------------------------------------------

interface WfStep {
  name?: string
  uses?: string
  run?: string
  if?: string
  env?: Record<string, string | number>
  with?: {
    source?: string
    target?: string
    script?: string
    host?: string
    username?: string
    key?: string
  }
}

interface WfJob {
  uses?: string
  with?: Record<string, string | number | boolean>
  secrets?: Record<string, string>
  steps?: WfStep[]
  [key: string]: unknown // covers `runs-on` (must be ABSENT on uses: jobs)
}

interface WfInputs {
  on?: {
    workflow_call?: {
      inputs?: Record<string, { default?: string | number | boolean }>
    }
  }
}

function loadWorkflow(wf: string): { jobs?: Record<string, WfJob> } & WfInputs {
  return yaml.load(fs.readFileSync(wf, "utf8")) as { jobs?: Record<string, WfJob> } & WfInputs
}

function findStep(wf: string, job: string, nameIncludes: string): WfStep | undefined {
  return (loadWorkflow(wf).jobs?.[job]?.steps ?? []).find((s) => (s.name ?? "").includes(nameIncludes))
}

// ---------------------------------------------------------------------------
// Behavioral runner (the ACTUAL script, with bash function shims)
// ---------------------------------------------------------------------------

interface RunResult {
  status: number | null
  stdout: string
  curlArgs: string
}

/**
 * Run scripts/health-check.sh through `bash` with function shims:
 *   - curl()  emits rotating HTTP codes (nth line per invocation, last line
 *             repeats) OR a fixed code; logs "$*" (URL arg) to a file; can be
 *             forced to fail (exit 1) to exercise the `|| echo "000"` path
 *   - seq()   `seq 1 N` → 1..N (Git Bash may not ship coreutils seq)
 *   - sleep() no-op so a 20-iteration loop completes in milliseconds
 *   - docker() logs "image prune -f" to a file (assert prune on/off) and can
 *     be forced to FAIL (SHIM_DOCKER_FAIL=1) to prove the prune is NON-FATAL
 * The script reads HEALTH_* env vars directly, so we pass them via env.
 */
function runScript(opts: {
  env?: Record<string, string>
  codes?: string[]
  failCurl?: boolean
}): RunResult {
  const dir = createTempDir("healthcheck-script-")
  const codesFile = path.join(dir, "codes")
  fs.writeFileSync(codesFile, (opts.codes ?? ["200"]).join("\n") + "\n")
  const curlLog = path.join(dir, "curl.log")
  const shims = [
    "curl() {",
    '  printf "%s\\n" "$*" >> "$SHIM_CURL_LOG"',
    '  if [ "$SHIM_CURL_FAIL" = "1" ]; then return 1; fi',
    '  if [ -n "$SHIM_CODES_FILE" ] && [ -f "$SHIM_CODES_FILE" ]; then',
    '    local n=0',
    '    [ -f "$SHIM_CODES_FILE.n" ] && n=$(cat "$SHIM_CODES_FILE.n")',
    "    n=$((n + 1)); echo \"$n\" > \"$SHIM_CODES_FILE.n\"",
    '    local i=0 c="200"',
    "    while IFS= read -r line; do",
    '      i=$((i + 1)); c="$line"',
    '      if [ "$i" -ge "$n" ]; then break; fi',
    "    done < \"$SHIM_CODES_FILE\"",
    '    echo "$c"',
    "  else",
    '    echo "${SHIM_HTTP_CODE:-200}"',
    "  fi",
    "}",
    'seq() { local s=$1 e=$2 i=$1; while [ "$i" -le "$e" ]; do echo "$i"; i=$((i + 1)); done; }',
    "sleep() { :; }",
  ].join("\n")
  // CRLF-tolerant: *.sh is eol=lf in git, but a Windows checkout may still
  // deliver CRLF until renormalized — bash would choke on `done\r`.
  const script = normalizeCrlf(fs.readFileSync(SCRIPT, "utf8"))
  const r = runSubprocess({
    command: "bash",
    args: ["-c", `${shims}\n${script}`],
    env: {
      ...opts.env,
      SHIM_CODES_FILE: codesFile,
      SHIM_CURL_LOG: curlLog,
      SHIM_CURL_FAIL: opts.failCurl ? "1" : "0",
    },
  })
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    curlArgs: fs.existsSync(curlLog) ? fs.readFileSync(curlLog, "utf8") : "",
  }
}

// ---------------------------------------------------------------------------
// Housekeeping step-gate harness (synthetic GitHub Actions runner)
// ---------------------------------------------------------------------------

interface HousekeepingRun {
  status: number | null
  stdout: string
  dockerLog: string
}

/**
 * Derive a bash gate from the workflow's OWN `if:` expression. GitHub Actions
 * evaluates `${{ success() && inputs.docker-prune }}` in the RUNNER before
 * the step body runs — when false, the script NEVER executes. The expression
 * is parsed from health-check.yml (not hardcoded) so the harness cannot drift
 * from CI: success() maps to $SHIM_SUCCESS, inputs.<name> maps to a
 * SHIM_<NAME> env (the exact input name comes from the YAML).
 */
function buildStepGate(ifExpr: string | undefined): string {
  const m = /^\$\{\{ success\(\) && inputs\.([a-z0-9-]+) \}\}$/.exec(ifExpr ?? "")
  expect(m, `unexpected step gate expression: ${ifExpr}`).not.toBeNull()
  const inputEnv = `SHIM_${m![1].toUpperCase().replace(/-/g, "_")}`
  // `\$${inputEnv}` renders as `$SHIM_DOCKER_PRUNE` in the generated bash —
  // the `$` must reach the shell so bash EXPANDS the env var; without it the
  // gate would compare the literal string "SHIM_DOCKER_PRUNE" and always be
  // false (the exact bug this test suite caught on its first run).
  return `[ "$SHIM_SUCCESS" = "1" ] && [ "\$${inputEnv}" = "1" ]`
}

/**
 * Run the Housekeeping step from health-check.yml as a synthetic runner:
 *   - the gate is built from the workflow's real `if:` expression
 *   - the step body (composite script) runs through bash with ${{ secrets.DEPLOY_PATH }}
 *     interpolated to a temp dir (GitHub interpolates secrets before the script
 *     reaches the runner)
 *   - a docker() shim logs invocations to a file (empty log = step never ran)
 *     and can be forced to FAIL (SHIM_DOCKER_FAIL=1) to prove the || echo is
 *     non-fatal under set -e
 * The assertion contract: when the gate is false, the docker shim log must be
 * EMPTY — the prune command physically never executes, exactly like CI.
 */
function runHousekeepingStep(opts: {
  success: boolean
  dockerPrune: boolean
  dockerFail?: boolean
}): HousekeepingRun {
  const steps = loadWorkflow(HEALTH_WF).jobs?.["check"]?.steps ?? []
  const house = steps.find((s) => (s.name ?? "").includes("Housekeeping"))
  if (!house?.if || !house?.with?.script) {
    throw new Error("Housekeeping step missing from health-check.yml")
  }
  const dir = createTempDir("housekeeping-gate-").replace(/\\/g, "/")
  // Windows os.tmpdir() returns backslash paths (C:\\Users\\) which bash would
  // treat as escape chars in `cd <dir>` — normalize to forward slashes so the
  // body runs identically on win32 and Linux (the gate fix made the body run).
  // Note: the workflow body is `cd ${{ secrets.DEPLOY_PATH }}` (unquoted) —
  // a Windows profile with a space in the username would word-split here, but
  // the real VPS DEPLOY_PATH has no spaces, so the harness mirrors CI as-is.
  const body = normalizeCrlf(house.with.script).replaceAll("${{ secrets.DEPLOY_PATH }}", dir)
  const gate = buildStepGate(house.if)
  // Forward-slash join: path.join would re-convert to backslashes on win32,
  // and THIS path is consumed by the bash shim (>> "$SHIM_DOCKER_LOG").
  const dockerLog = `${dir}/docker.log`
  const shims = [
    'docker() { echo "image prune -f" >> "$SHIM_DOCKER_LOG"; [ "$SHIM_DOCKER_FAIL" = "1" ] && return 1; return 0; }',
  ].join("\n")
  const r = runSubprocess({
    command: "bash",
    args: ["-c", `${shims}\nset -euo pipefail\nif ${gate}; then\n${body}\nfi\n`],
    env: {
      SHIM_SUCCESS: opts.success ? "1" : "0",
      SHIM_DOCKER_PRUNE: opts.dockerPrune ? "1" : "0",
      SHIM_DOCKER_LOG: dockerLog,
      SHIM_DOCKER_FAIL: opts.dockerFail ? "1" : "0",
    },
  })
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    dockerLog: fs.existsSync(dockerLog) ? fs.readFileSync(dockerLog, "utf8") : "",
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("health-check.sh — single versioned health check (consolidation of the 3 workflow loops)", () => {
  describe("WIRING", () => {
    it("deploy.yml docker-test 'Wait for health check' calls the script with the 20/3 smoke-test env", () => {
      const step = findStep(DEPLOY_WF, "docker-test", "Wait for health check")
      expect(step).toBeDefined()
      expect(step!.run).toBe("bash scripts/health-check.sh")
      expect(step!.env?.HEALTH_ATTEMPTS).toBe(20)
      expect(step!.env?.HEALTH_SLEEP).toBe(3)
    })

    it("deploy.yml deploy job calls the reusable health-check workflow with 12/5 + prune inputs + DEPLOY secrets", () => {
      const job = loadWorkflow(DEPLOY_WF).jobs?.["deploy"]
      expect(job?.uses).toBe("./.github/workflows/health-check.yml")
      expect(job?.with?.attempts).toBe(12)
      expect(job?.with?.sleep).toBe(5)
      expect(job?.with?.["expect-code"]).toBe(200)
      expect(job?.with?.["docker-prune"]).toBe(true)
      expect(job?.with?.url).toBe("http://localhost:3000/api/health")
      expect(job?.secrets?.DEPLOY_HOST).toBe("${{ secrets.DEPLOY_HOST }}")
      expect(job?.secrets?.DEPLOY_USER).toBe("${{ secrets.DEPLOY_USER }}")
      expect(job?.secrets?.DEPLOY_KEY).toBe("${{ secrets.DEPLOY_KEY }}")
      expect(job?.secrets?.DEPLOY_PATH).toBe("${{ secrets.DEPLOY_PATH }}")
      // The reusable workflow OWNS the scp/ssh now — the deploy job must NOT
      // re-add its own Copy health check script / Deploy via SSH steps, and a
      // job-level `uses:` call cannot carry `runs-on` (invalid YAML in CI).
      expect(job?.steps).toBeUndefined()
      expect(job?.["runs-on"]).toBeUndefined()
    })

    it("release-deploy.yml deploy job calls the reusable health-check workflow with 12/5 + prune inputs + DEPLOY secrets", () => {
      const job = loadWorkflow(RELEASE_WF).jobs?.["deploy"]
      expect(job?.uses).toBe("./.github/workflows/health-check.yml")
      expect(job?.with?.attempts).toBe(12)
      expect(job?.with?.sleep).toBe(5)
      expect(job?.with?.["expect-code"]).toBe(200)
      expect(job?.with?.["docker-prune"]).toBe(true)
      expect(job?.secrets?.DEPLOY_HOST).toBe("${{ secrets.DEPLOY_HOST }}")
      expect(job?.secrets?.DEPLOY_USER).toBe("${{ secrets.DEPLOY_USER }}")
      expect(job?.secrets?.DEPLOY_KEY).toBe("${{ secrets.DEPLOY_KEY }}")
      expect(job?.secrets?.DEPLOY_PATH).toBe("${{ secrets.DEPLOY_PATH }}")
      expect(job?.steps).toBeUndefined()
      expect(job?.["runs-on"]).toBeUndefined()
    })

    it("health-check.yml (reusable) owns the checkout + scp + ssh sequence and forwards inputs as HEALTH_* env", () => {
      const doc = loadWorkflow(HEALTH_WF)
      const job = doc.jobs?.["check"]
      const steps = job?.steps ?? []
      // checkout → scp (script to VPS) → ssh (compose pull/up + health check)
      // BOTH transports go through the local composites (severinno-scp,
      // severinno-ssh) — the appleboy pins live ONLY there, never inline.
      expect(steps[0]?.uses).toBe("actions/checkout@v4")
      const scp = steps.find((s) => s.uses === SCP_COMPOSITE)
      expect(scp?.with?.source).toBe("scripts/health-check.sh")
      expect(scp?.with?.target).toBe("${{ secrets.DEPLOY_PATH }}")
      expect(scp?.with?.host).toBe("${{ secrets.DEPLOY_HOST }}")
      expect(scp?.with?.username).toBe("${{ secrets.DEPLOY_USER }}")
      expect(scp?.with?.key).toBe("${{ secrets.DEPLOY_KEY }}")
      // ssh access goes through the local composite (single pin) — the ssh
      // action version lives ONLY in .github/actions/severinno-ssh/action.yml.
      const ssh = steps.find((s) => s.uses === SSH_COMPOSITE)
      const script = ssh?.with?.script ?? ""
      expect(script).toContain("docker compose pull app realtime email-worker notification-worker")
      expect(script).toContain("docker compose up -d --no-deps --remove-orphans app realtime")
      expect(script).toContain("HEALTH_ATTEMPTS=${{ inputs.attempts }}")
      expect(script).toContain("HEALTH_SLEEP=${{ inputs.sleep }}")
      expect(script).toContain("HEALTH_EXPECT_CODE=${{ inputs.expect-code }}")
      expect(script).toContain("HEALTH_URL=\"${{ inputs.url }}\"")
      expect(script).toContain("bash scripts/health-check.sh")
      // The health-check ssh step is PURE probing — no prune inside.
      expect(script).not.toContain("prune")
    })

    it("CONTRACT: health-check.yml input defaults match the caller values (single source of truth for the retry params)", () => {
      const inputs = loadWorkflow(HEALTH_WF).on?.workflow_call?.inputs ?? {}
      expect(inputs.url?.default).toBe("http://localhost:3000/api/health")
      expect(inputs.attempts?.default).toBe(12)
      expect(inputs.sleep?.default).toBe(5)
      expect(inputs["expect-code"]?.default).toBe(200)
      expect(inputs["docker-prune"]?.default).toBe(true)
    })

    it("HOUSEKEEPING SEPARATE: prune is an optional post-deploy step in health-check.yml gated on success() && docker-prune (non-fatal, ASCII)", () => {
      const steps = loadWorkflow(HEALTH_WF).jobs?.["check"]?.steps ?? []
      const ssh = steps.find((s) => s.uses === SSH_COMPOSITE)
      const house = steps.find((s) => (s.name ?? "").includes("Housekeeping"))
      expect(house).toBeDefined()
      expect(ssh).toBeDefined()
      expect(house!.if).toBe("${{ success() && inputs.docker-prune }}")
      expect(house!.uses).toBe(SSH_COMPOSITE)
      expect(house!.with?.script).toContain("docker image prune -f")
      // NON-FATAL: the || echo keeps the OR-list exit 0 under set -e.
      expect(house!.with?.script).toContain(
        '|| echo "WARNING: docker image prune -f failed (non-fatal - deploy stays green)"',
      )
      // Order matters: the health-check ssh step runs BEFORE housekeeping.
      expect(steps.indexOf(house!)).toBeGreaterThan(steps.indexOf(ssh!))
    })

    it("SEVERINNO-SSH COMPOSITE: the ssh action is pinned ONCE in the composite action, not in any workflow", () => {
      const action = yaml.load(fs.readFileSync(SSH_ACTION, "utf8")) as {
        runs?: { using?: string; steps?: WfStep[] }
        inputs?: Record<string, { required?: boolean; default?: string | number | boolean }>
      }
      expect(action.runs?.using).toBe("composite")
      // The single appleboy pin lives HERE — EXACTLY one inner step (a second
      // pin inside the composite would silently split the contract).
      // Version-agnostic on purpose: Renovate (pinVersions) bumps @v1 →
      // @v1.x.y with a reviewable PR; this guard validates the SINGLE pin,
      // not the exact version, so the first bump does not break CI.
      const pinned = action.runs?.steps?.filter((s) => /^appleboy\/ssh-action@v/.test(s.uses ?? "")) ?? []
      expect(pinned).toHaveLength(1)
      const inner = pinned[0]
      expect(inner!.with?.host).toBe("${{ inputs.host }}")
      expect(inner!.with?.username).toBe("${{ inputs.username }}")
      expect(inner!.with?.key).toBe("${{ inputs.key }}")
      expect(inner!.with?.script).toBe("${{ inputs.script }}")
      // The 3 required secrets + script are mandatory inputs of the composite.
      for (const k of ["host", "username", "key", "script"]) {
        expect(action.inputs?.[k]?.required).toBe(true)
      }
      // Transport defaults pinned as part of the single-source-of-truth
      // contract (the whole point of this action).
      expect(action.inputs?.port?.default).toBe("22")
      expect(action.inputs?.timeout?.default).toBe("30s")
      // Divergence guard: NO workflow may reference the appleboy pins
      // directly at ANY version — ssh-action@vN lives only in
      // severinno-ssh/action.yml and scp-action@vN in severinno-scp/action.yml
      // (guarded in detail by scripts/__tests__/severinno-scp-golden.test.ts).
      for (const f of fs.readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".yml"))) {
        const content = fs.readFileSync(path.join(WORKFLOWS_DIR, f), "utf8")
        expect(content).not.toMatch(/appleboy\/ssh-action@v/)
      }
    })

    it("CONSOLIDATION: no inline `for i in $(seq` health loop remains in any workflow", () => {
      const offenders: string[] = []
      for (const f of fs.readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".yml"))) {
        const content = fs.readFileSync(path.join(WORKFLOWS_DIR, f), "utf8")
        if (/for i in \$\{?seq/.test(content) || /seq 1 (12|20)/.test(content)) {
          offenders.push(f)
        }
      }
      expect(offenders).toEqual([])
    })
  })

  describe("BEHAVIORAL (actual script + shims)", () => {
    it("passes with exit 0 when the API answers 200 (default env = 12 attempts)", () => {
      const r = runScript({ codes: ["200"] })
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("Health check passed (HTTP 200) after attempt 1/12")
    }, 60000)

    it("fails with exit 1 after the default 12 attempts on persistent 503", () => {
      const r = runScript({ codes: ["503"] })
      expect(r.status).toBe(1)
      expect(r.stdout).toContain("Health check failed after 12 attempts")
      expect(r.stdout).toContain("Attempt 1/12 - HTTP 503, retrying...")
      expect(r.stdout).toContain("Attempt 12/12 - HTTP 503, retrying...")
    }, 60000)

    it("respects HEALTH_ATTEMPTS=20 (docker-test smoke test behavior)", () => {
      const r = runScript({ env: { HEALTH_ATTEMPTS: "20" }, codes: ["503"] })
      expect(r.status).toBe(1)
      expect(r.stdout).toContain("Health check failed after 20 attempts")
      expect(r.stdout).toContain("Attempt 20/20 - HTTP 503, retrying...")
    }, 60000)

    it("retries and succeeds on the 3rd attempt (503, 503, 200)", () => {
      const r = runScript({ codes: ["503", "503", "200"] })
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("Health check passed (HTTP 200) after attempt 3/12")
    }, 60000)

    it("probes a custom HEALTH_URL (curl receives the configured URL)", () => {
      const url = "http://localhost:9090/api/health"
      const r = runScript({ env: { HEALTH_URL: url }, codes: ["200"] })
      expect(r.status).toBe(0)
      expect(r.curlArgs).toContain(url)
    }, 60000)

    it("honors a custom HEALTH_EXPECT_CODE (e.g. 503 maintenance gate)", () => {
      const r = runScript({ env: { HEALTH_EXPECT_CODE: "503" }, codes: ["503"] })
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("Health check passed (HTTP 503) after attempt 1/12")
    }, 60000)

    it("falls back to HTTP 000 and keeps retrying when curl itself fails", () => {
      const r = runScript({ failCurl: true, codes: ["503"] })
      expect(r.status).toBe(1)
      expect(r.stdout).toContain("Attempt 1/12 - HTTP 000, retrying...")
      expect(r.stdout).toContain("Health check failed after 12 attempts")
    }, 60000)
  })

  describe("HOUSEKEEPING INTEGRATION (synthetic workflow step gate)", () => {
    it("the step gate derives from the workflow's real `if:` expression (success() && inputs.docker-prune)", () => {
      const steps = loadWorkflow(HEALTH_WF).jobs?.["check"]?.steps ?? []
      const house = steps.find((s) => (s.name ?? "").includes("Housekeeping"))
      expect(house?.if).toBe("${{ success() && inputs.docker-prune }}")
      // The harness builds the bash gate from this exact expression — proving
      // the derivation below does not silently rewrite the gate semantics.
      expect(buildStepGate(house?.if)).toBe('[ "$SHIM_SUCCESS" = "1" ] && [ "$SHIM_DOCKER_PRUNE" = "1" ]')
    })

    it("docker-prune=false: the Housekeeping step is SKIPPED — the prune command never executes", () => {
      const r = runHousekeepingStep({ success: true, dockerPrune: false })
      expect(r.status).toBe(0)
      // Empty docker log = the step body physically never ran (runner gate).
      expect(r.dockerLog).toBe("")
    }, 60000)

    it("success=false (health check failed): the Housekeeping step is SKIPPED even when the caller opted in", () => {
      const r = runHousekeepingStep({ success: false, dockerPrune: true })
      expect(r.status).toBe(0)
      expect(r.dockerLog).toBe("")
    }, 60000)

    it("docker-prune=true + success: the prune executes against DEPLOY_PATH", () => {
      const r = runHousekeepingStep({ success: true, dockerPrune: true })
      expect(r.status).toBe(0)
      expect(r.dockerLog).toContain("image prune -f")
    }, 60000)

    it("docker-prune=true + success + prune FAILS: non-fatal — exit 0 with the ASCII warning", () => {
      const r = runHousekeepingStep({ success: true, dockerPrune: true, dockerFail: true })
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("WARNING: docker image prune -f failed (non-fatal - deploy stays green)")
    }, 60000)
  })

  it("script is syntactically valid bash (bash -n)", () => {
    const r = runSubprocess({ command: "bash", args: ["-n", SCRIPT] })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe("")
  }, 60000)
})
