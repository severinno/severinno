/**
 * Golden-copy guards for the OTHER embedded programs in the workflows — the
 * awk of the 'Assert Rotas blocks' step is not the only logic buried in YAML.
 * This suite covers the two health-check loops:
 *
 *   1. deploy.yml — 'Wait for health check' step (run block): the Docker
 *      smoke-test loop (20 attempts, sleep 3, curl /api/health).
 *   2. release-deploy.yml — the deploy health-check LOOP inside the
 *      'Deploy via SSH' step's appleboy/ssh-action `script:` (12 attempts,
 *      sleep 5, curl + docker image prune on success).
 *
 * Same pattern as release-assert-route-gate.test.ts: the programs are EXTRACTED
 * FROM THE WORKFLOWS at test time (js-yaml — single source of truth; if someone
 * edits a run block, this suite exercises the NEW program automatically; if a
 * step is renamed, extraction throws loudly), compared canonically against
 * versioned golden copies (fixtures/*-healthcheck.sh — editing one without the
 * other fails the suite), and run BEHAVIORALLY through bash function shims for
 * curl/seq/sleep/docker so the loops complete in milliseconds with no network.
 *
 * Covered:
 *   - extraction wiring (both programs found, key markers present)
 *   - divergence guards (canonical form, diagnostics before the expect)
 *   - behavioral: deploy loop passes on 200 / fails after 20 / retries
 *   - behavioral: release loop passes on 200 / fails after 12
 *   - parity: golden copies behave IDENTICALLY to the workflow programs
 *     across the scenario matrix (same exit code in every case)
 */
import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// js-yaml has no @types in this repo (see release-assert-route-gate.test.ts —
// the dist is an untyped ESM module, so a `declare module` fails TS2665).
// @ts-expect-error js-yaml is untyped in this repo; only yaml.load is used
import yaml from "js-yaml"

const DEPLOY_WF = path.resolve(process.cwd(), ".github", "workflows", "deploy.yml")
const RELEASE_WF = path.resolve(process.cwd(), ".github", "workflows", "release-deploy.yml")
const GOLDEN_DEPLOY = path.resolve(process.cwd(), "scripts", "__tests__", "fixtures", "deploy-healthcheck.sh")
const GOLDEN_RELEASE = path.resolve(process.cwd(), "scripts", "__tests__", "fixtures", "release-healthcheck.sh")

const tempDirs: string[] = []
afterEach(() => {
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

/** Extract the deploy.yml 'Wait for health check' run block (source of truth). */
function extractDeployHealthCheck(): string {
  const doc = yaml.load(fs.readFileSync(DEPLOY_WF, "utf8")) as {
    jobs?: { "docker-test"?: { steps?: Array<{ name?: string; run?: string }> } }
  }
  const step = (doc.jobs?.["docker-test"]?.steps ?? []).find((s) => (s.name ?? "").includes("Wait for health check"))
  if (!step?.run) {
    throw new Error("step 'Wait for health check' not found in deploy.yml — a rename broke this test's wiring")
  }
  return step.run.replace(/\r\n/g, "\n")
}

/** Extract the release-deploy.yml deploy health-check LOOP (ssh script regex). */
function extractReleaseHealthCheck(): string {
  const doc = yaml.load(fs.readFileSync(RELEASE_WF, "utf8")) as {
    jobs?: { deploy?: { steps?: Array<{ name?: string; with?: { script?: string } }> } }
  }
  const step = (doc.jobs?.deploy?.steps ?? []).find((s) => (s.name ?? "").includes("Deploy via SSH"))
  const script = (step?.with?.script ?? "").replace(/\r\n/g, "\n")
  // The loop lives at the END of the ssh script: from `for i in $(seq 1 12); do`
  // through `echo "Health check failed after 12 attempts"` + `exit 1` (the
  // `exit 1` is on its OWN line — not `&& exit 1`, verified by probe).
  const m = script.match(/for i in \$\(seq 1 12\); do\n[\s\S]*?\n\s*echo "Health check failed after 12 attempts"\n\s*exit 1/)
  if (!m) throw new Error("deploy health-check loop not found in release-deploy.yml — a rename broke this test's wiring")
  return m[0]
}

/**
 * Canonical form for the divergence comparison: the workflow extraction carries
 * the YAML block indentation per line, while the golden copies are written
 * clean — so compare CONTENT, not layout. CRLF-tolerant and drops blank +
 * `#` comment lines (golden copy headers must not matter). A changed shell
 * STATEMENT still fails because its tokens land on a line.
 */
function canonicalShell(program: string): string {
  return program
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .join("\n")
}

interface RunResult {
  status: number | null
  stdout: string
}

/**
 * Run an extracted/golden health-check program through `bash -c` with shell
 * FUNCTION shims (no PATH games, no network, no real sleeps):
 *   - curl()    emits the configured HTTP code — a single `codes` value or a
 *               rotating sequence (nth line per invocation, last line repeats)
 *   - seq()     `seq 1 N` → 1..N (Git Bash may not ship coreutils seq)
 *   - sleep()   no-op so a 20-iteration loop completes in milliseconds
 *   - docker()  no-op (release loop calls `docker image prune -f` on success)
 * The shims are defined in the SAME shell that runs the program, so the loop's
 * `exit 0/1` becomes bash's exit code — exactly what the workflow relies on.
 */
function runHealthProgram(program: string, codes: string[] = ["200"]): RunResult {
  // CRLF-tolerant: the golden copies are read RAW from disk (fs.readFileSync)
  // and piped into `bash -c`. On a Windows checkout (* text=auto → CRLF), a
  // `done\r` or `exit 1\r` would break bash parsing (bash does NOT treat \r as
  // whitespace). The workflow-extracted programs are already normalized in
  // their extraction functions, but the golden path must be hardened the same
  // way — one normalization here covers BOTH sides of the parity matrix.
  const normalized = program.replace(/\r\n/g, "\n")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "healthcheck-run-"))
  tempDirs.push(dir)
  const codesFile = path.join(dir, "codes")
  fs.writeFileSync(codesFile, codes.join("\n") + "\n")
  const shims = [
    "curl() {",
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
    "docker() { :; }",
  ].join("\n")
  const r = spawnSync("bash", ["-c", `${shims}\n${normalized}`], {
    env: { ...process.env, SHIM_HTTP_CODE: "200", SHIM_CODES_FILE: codesFile },
    encoding: "utf8",
    timeout: 30_000,
  })
  return { status: r.status, stdout: r.stdout ?? "" }
}

describe("workflow golden copies — health-check loops (deploy.yml + release-deploy.yml)", () => {
  it("extracts the deploy.yml 'Wait for health check' run block (source-of-truth wiring)", () => {
    const p = extractDeployHealthCheck()
    expect(p).toContain("for i in $(seq 1 20); do")
    expect(p).toContain("curl -s -o /dev/null -w \"%{http_code}\"")
    expect(p).toContain("Health check failed after 20 attempts")
    expect(p).toContain("exit 1")
  })

  it("extracts the release-deploy.yml deploy health-check loop (ssh script wiring)", () => {
    const p = extractReleaseHealthCheck()
    expect(p).toContain("for i in $(seq 1 12); do")
    expect(p).toContain("docker image prune -f")
    expect(p).toContain("Health check failed after 12 attempts")
    expect(p).toContain("exit 1")
  })

  it("DIVERGENCE GUARD: deploy.yml health check never diverges from its golden copy", () => {
    const extracted = extractDeployHealthCheck()
    const golden = fs.readFileSync(GOLDEN_DEPLOY, "utf8")
    const cEx = canonicalShell(extracted)
    const cGo = canonicalShell(golden)
    // Diagnostics MUST run before the expect — expect().toBe() throws on a
    // mismatch, so a dump after it would be unreachable dead code.
    if (cEx !== cGo) {
      console.error(
        "\nDIVERGÊNCIA health check (deploy.yml):\n--- extraído do workflow ---\n" +
          cEx +
          "\n--- golden copy (fixtures/deploy-healthcheck.sh) ---\n" +
          cGo,
      )
    }
    expect(cEx).toBe(cGo)
  })

  it("DIVERGENCE GUARD: release-deploy.yml health-check loop never diverges from its golden copy", () => {
    const extracted = extractReleaseHealthCheck()
    const golden = fs.readFileSync(GOLDEN_RELEASE, "utf8")
    const cEx = canonicalShell(extracted)
    const cGo = canonicalShell(golden)
    if (cEx !== cGo) {
      console.error(
        "\nDIVERGÊNCIA health check (release-deploy.yml):\n--- extraído do workflow ---\n" +
          cEx +
          "\n--- golden copy (fixtures/release-healthcheck.sh) ---\n" +
          cGo,
      )
    }
    expect(cEx).toBe(cGo)
  })

  it("BEHAVIORAL deploy loop: exits 0 with 'Health check passed' when the API answers 200", () => {
    const r = runHealthProgram(extractDeployHealthCheck(), ["200"])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("Health check passed (HTTP 200) after 1s")
  })

  it("BEHAVIORAL deploy loop: exits 1 after 20 failed attempts", () => {
    const r = runHealthProgram(extractDeployHealthCheck(), ["503"])
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("Health check failed after 20 attempts")
    expect(r.stdout).toContain("Attempt 1/20 - HTTP 503")
    expect(r.stdout).toContain("Attempt 20/20 - HTTP 503")
  })

  it("BEHAVIORAL deploy loop: retries and succeeds on the 3rd attempt (503, 503, 200)", () => {
    const r = runHealthProgram(extractDeployHealthCheck(), ["503", "503", "200"])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("Health check passed (HTTP 200) after 3s")
  })

  it("BEHAVIORAL release loop: exits 0 with 'Health check passed' when the API answers 200", () => {
    const r = runHealthProgram(extractReleaseHealthCheck(), ["200"])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("Health check passed (HTTP 200)")
  })

  it("BEHAVIORAL release loop: exits 1 after 12 failed attempts", () => {
    const r = runHealthProgram(extractReleaseHealthCheck(), ["503"])
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("Health check failed after 12 attempts")
    expect(r.stdout).toContain("Attempt 1/12 - HTTP 503")
    expect(r.stdout).toContain("Attempt 12/12 - HTTP 503")
  })

  it(
    "golden copies behave IDENTICALLY to the workflow programs across the scenario matrix",
    // vitest signature: it(name, fn, timeout) — 5 cases × 2 programs = 10 bash
    // spawns (each ~0.5-1s on Windows Git Bash), well past the 5s default.
    () => {
    const extractedDeploy = extractDeployHealthCheck()
    const extractedRelease = extractReleaseHealthCheck()
    const goldenDeploy = fs.readFileSync(GOLDEN_DEPLOY, "utf8")
    const goldenRelease = fs.readFileSync(GOLDEN_RELEASE, "utf8")
    const matrix: Array<{ prog: string; golden: string; codes: string[]; expectPass: boolean }> = [
      { prog: extractedDeploy, golden: goldenDeploy, codes: ["200"], expectPass: true },
      { prog: extractedDeploy, golden: goldenDeploy, codes: ["503"], expectPass: false },
      { prog: extractedDeploy, golden: goldenDeploy, codes: ["503", "503", "200"], expectPass: true },
      { prog: extractedRelease, golden: goldenRelease, codes: ["200"], expectPass: true },
      { prog: extractedRelease, golden: goldenRelease, codes: ["503"], expectPass: false },
    ]
    for (const c of matrix) {
      const w = runHealthProgram(c.prog, c.codes)
      const g = runHealthProgram(c.golden, c.codes)
      // The golden copy must pass/fail exactly like the workflow program.
      expect(g.status).toBe(c.expectPass ? 0 : 1)
      expect(w.status).toBe(g.status)
    }
    },
    30_000,
  )
})
