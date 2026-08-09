/**
 * health-check-script.test.ts — the SINGLE versioned health-check script
 * (scripts/health-check.sh) replaces the THREE inline loops that used to live
 * in the workflows:
 *   1. deploy.yml docker-test 'Wait for health check'  (20 attempts, sleep 3)
 *   2. deploy.yml deploy job                           (12 attempts, sleep 5, + docker prune)
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
 *     HTTP codes and logs its URL argument, seq/sleep are inert, docker logs
 *     its invocation. Asserts exit 0 on 200, exit 1 after N attempts, retry-
 *     then-pass, prune on/off, custom URL + EXPECT_CODE, and the
 *     `|| echo "000"` curl-failure fallback.
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

afterEach(cleanupTempDirs)

// ---------------------------------------------------------------------------
// Wiring extraction (source of truth = the workflows themselves)
// ---------------------------------------------------------------------------

interface WfStep {
  name?: string
  uses?: string
  run?: string
  env?: Record<string, string | number>
  with?: { source?: string; target?: string; script?: string }
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
  dockerCalls: string
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
  const dockerLog = path.join(dir, "docker.log")
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
    'docker() { printf "%s\\n" "$*" >> "$SHIM_DOCKER_LOG"; if [ "$SHIM_DOCKER_FAIL" = "1" ]; then return 1; fi; }',
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
      SHIM_DOCKER_LOG: dockerLog,
      SHIM_CURL_LOG: curlLog,
      SHIM_CURL_FAIL: opts.failCurl ? "1" : "0",
    },
  })
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    dockerCalls: fs.existsSync(dockerLog) ? fs.readFileSync(dockerLog, "utf8") : "",
    curlArgs: fs.existsSync(curlLog) ? fs.readFileSync(curlLog, "utf8") : "",
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
      expect(steps[0]?.uses).toBe("actions/checkout@v4")
      const scp = steps.find((s) => s.uses === "appleboy/scp-action@v1")
      expect(scp?.with?.source).toBe("scripts/health-check.sh")
      expect(scp?.with?.target).toBe("${{ secrets.DEPLOY_PATH }}")
      const ssh = steps.find((s) => s.uses === "appleboy/ssh-action@v1")
      const script = ssh?.with?.script ?? ""
      expect(script).toContain("docker compose pull app realtime email-worker notification-worker")
      expect(script).toContain("docker compose up -d --no-deps --remove-orphans app realtime")
      expect(script).toContain("HEALTH_ATTEMPTS=${{ inputs.attempts }}")
      expect(script).toContain("HEALTH_SLEEP=${{ inputs.sleep }}")
      expect(script).toContain("HEALTH_EXPECT_CODE=${{ inputs.expect-code }}")
      expect(script).toContain("HEALTH_URL=\"${{ inputs.url }}\"")
      expect(script).toContain("HEALTH_DOCKER_PRUNE=${{ inputs.docker-prune && '1' || '0' }}")
      expect(script).toContain("bash scripts/health-check.sh")
    })

    it("CONTRACT: health-check.yml input defaults match the caller values (single source of truth for the retry params)", () => {
      const inputs = loadWorkflow(HEALTH_WF).on?.workflow_call?.inputs ?? {}
      expect(inputs.url?.default).toBe("http://localhost:3000/api/health")
      expect(inputs.attempts?.default).toBe(12)
      expect(inputs.sleep?.default).toBe(5)
      expect(inputs["expect-code"]?.default).toBe(200)
      expect(inputs["docker-prune"]?.default).toBe(true)
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
    })

    it("fails with exit 1 after the default 12 attempts on persistent 503", () => {
      const r = runScript({ codes: ["503"] })
      expect(r.status).toBe(1)
      expect(r.stdout).toContain("Health check failed after 12 attempts")
      expect(r.stdout).toContain("Attempt 1/12 - HTTP 503, retrying...")
      expect(r.stdout).toContain("Attempt 12/12 - HTTP 503, retrying...")
    })

    it("respects HEALTH_ATTEMPTS=20 (docker-test smoke test behavior)", () => {
      const r = runScript({ env: { HEALTH_ATTEMPTS: "20" }, codes: ["503"] })
      expect(r.status).toBe(1)
      expect(r.stdout).toContain("Health check failed after 20 attempts")
      expect(r.stdout).toContain("Attempt 20/20 - HTTP 503, retrying...")
    })

    it("retries and succeeds on the 3rd attempt (503, 503, 200)", () => {
      const r = runScript({ codes: ["503", "503", "200"] })
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("Health check passed (HTTP 200) after attempt 3/12")
    })

    it("runs `docker image prune -f` on success ONLY when HEALTH_DOCKER_PRUNE=1", () => {
      const on = runScript({ env: { HEALTH_DOCKER_PRUNE: "1" }, codes: ["200"] })
      expect(on.status).toBe(0)
      expect(on.dockerCalls).toContain("image prune -f")

      const off = runScript({ codes: ["200"] })
      expect(off.status).toBe(0)
      expect(off.dockerCalls).toBe("")
    })

    it("NON-FATAL prune: a green health check stays exit 0 even when docker prune fails (exit 1)", () => {
      // Under `set -e` the old inline `docker image prune -f` (before `exit 0`)
      // would flip a green deploy to red if prune failed — the deploy verdict
      // is the HEALTH CHECK, not the disk cleanup. The `|| echo` keeps the
      // OR-list exit 0 and surfaces the failure in the logs.
      const r = runScript({ env: { HEALTH_DOCKER_PRUNE: "1", SHIM_DOCKER_FAIL: "1" }, codes: ["200"] })
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("Health check passed (HTTP 200) after attempt 1/12")
      expect(r.stdout).toContain("docker image prune -f falhou (não-fatal — deploy segue verde)")
      expect(r.dockerCalls).toContain("image prune -f")
    })

    it("probes a custom HEALTH_URL (curl receives the configured URL)", () => {
      const url = "http://localhost:9090/api/health"
      const r = runScript({ env: { HEALTH_URL: url }, codes: ["200"] })
      expect(r.status).toBe(0)
      expect(r.curlArgs).toContain(url)
    })

    it("honors a custom HEALTH_EXPECT_CODE (e.g. 503 maintenance gate)", () => {
      const r = runScript({ env: { HEALTH_EXPECT_CODE: "503" }, codes: ["503"] })
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("Health check passed (HTTP 503) after attempt 1/12")
    })

    it("falls back to HTTP 000 and keeps retrying when curl itself fails", () => {
      const r = runScript({ failCurl: true, codes: ["503"] })
      expect(r.status).toBe(1)
      expect(r.stdout).toContain("Attempt 1/12 - HTTP 000, retrying...")
      expect(r.stdout).toContain("Health check failed after 12 attempts")
    })
  })

  it("script is syntactically valid bash (bash -n)", () => {
    const r = runSubprocess({ command: "bash", args: ["-n", SCRIPT] })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe("")
  })
})
