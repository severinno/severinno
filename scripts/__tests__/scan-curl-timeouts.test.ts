/**
 * scan-curl-timeouts.test.ts - behavior tests for scripts/scan-curl-timeouts.mjs,
 * the versioned guard that fails on any curl invocation in a CI gate script
 * WITHOUT an explicit --max-time.
 *
 * WHY (the class this pins): in 2026-08 the security-headers job dominated
 * the tail of every proof (9:08 in run 31430040398, sec 11.20 of
 * gates-proofs.md). The measurement showed the site responds in ~200ms - the
 * tail was NOT host slowness, it was the script's curl with NO --max-time:
 * a connect stall (HTTP 000000) left the job waiting minutes on every
 * trigger (PR, merge_group, workflow_dispatch of proofs). The fix
 * standardized --max-time 20 --connect-timeout 10 on the gate-script curls;
 * this suite pins the fix as a permanent contract (the verdict ADOTADO of
 * docs/security-headers-gate-2026-08.md).
 *
 *   - BASELINE (the live net): scanning the CI gate-script surface (the .sh
 *     files DERIVED from .github/workflows/*.yml) finds ZERO curls without
 *     --max-time. If someone adds a curl without a bound to a gate script,
 *     this breaks with its exact file:line.
 *   - BASELINE companion: the guard demonstrably scans a NON-EMPTY surface
 *     (a detector that silently matches nothing would pass vacuously).
 *   - MUTATION: a synthetic gate script with a curl without --max-time
 *     trips the scan; the SAME script WITH --max-time passes - proving the
 *     detector keys on the flag, not on the token's presence.
 *   - MASKING edges: prose that merely MENTIONS curl inside a string
 *     (`fail "curl falhou"`, `command -v curl`, echo text) cannot
 *     false-positive; a real invocation outside a string does.
 *   - CONTINUATION edge: the --max-time on a backslash-continuation line
 *     (the TLS check form) counts for the whole logical command.
 *   - DERIVATION edge: a .sh referenced by a workflow is scanned; one not
 *     referenced by any workflow is out of surface (local/ops scripts are
 *     outside by design).
 *
 * Exported pure functions are imported directly (same pattern as
 * scan-timeouts.test.ts); the CLI is exercised via subprocess
 * (CURL_TIMEOUTS_SCAN_ROOT env override - same fixture-driven pattern as
 * TIMEOUT_SCAN_ROOT / FRAGILE_SCAN_ROOT) to pin exit codes end-to-end.
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"
import {
  deriveGateScripts,
  maskBashStrings,
  scanCurlTimeouts,
  scanGateScript,
} from "../scan-curl-timeouts.mjs"

const ROOT = process.cwd()
const SCRIPT = path.join(ROOT, "scripts", "scan-curl-timeouts.mjs")

const GATE_CURL = `curl -s -o /dev/null -D "$HEADERS_FILE" -w "%{http_code}" "$url" 2>/dev/null || echo "000"`

function runCli(extraEnv: Record<string, string> = {}, extraArgs: string[] = []) {
  return runSubprocess({
    command: process.execPath,
    args: [SCRIPT, ...extraArgs],
    env: extraEnv,
    timeoutMs: 60_000,
  })
}

/** Build a synthetic root: a workflow citing gate scripts + the scripts. */
function writeSyntheticRoot(dir: string, gateCurlLine: string, gateName = "gate.sh") {
  const wf = path.join(dir, ".github", "workflows", "pr-check.yml")
  fs.mkdirSync(path.dirname(wf), { recursive: true })
  fs.writeFileSync(wf, `name: PR Check\non:\n  pull_request:\njobs:\n  check:\n    run: bash scripts/${gateName}\n`, "utf8")
  const gate = path.join(dir, "scripts", gateName)
  fs.mkdirSync(path.dirname(gate), { recursive: true })
  fs.writeFileSync(gate, `#!/usr/bin/env bash\nset -euo pipefail\n${gateCurlLine}\n`, "utf8")
}

afterEach(() => {
  cleanupTempDirs()
})

describe("scripts/scan-curl-timeouts.mjs - masking + parser", () => {
  it("maskBashStrings: double-quoted strings are masked, quotes stay, newlines survive", () => {
    const src = `fail "curl falhou"\n  curl -s "$URL" --max-time 20\n`
    const masked = maskBashStrings(src)
    // The prose curl token INSIDE the double-quoted string is masked (gone).
    expect(masked).not.toContain("curl falhou")
    // Quotes stay as boundaries; the string content became spaces.
    expect(masked).toContain('fail "')
    // The real invocation's curl token survives (it is OUTSIDE the quotes).
    expect(masked).toContain("curl -s")
    // Newline count unchanged (masking never joins lines).
    expect(masked.split("\n")).toHaveLength(src.split("\n").length)
  })

  it("maskBashStrings: single-quoted strings are masked too", () => {
    const masked = maskBashStrings(`echo 'via curl'\ncurl -s "$u"\n`)
    // The prose token inside the single-quoted string is masked; the real
    // invocation outside quotes survives.
    expect(masked).not.toContain("via curl")
    expect(masked).toContain("curl -s")
  })

  it("scanGateScript: a curl WITHOUT --max-time is a violation (the class)", () => {
    const dir = createTempDir("curl-timeouts-bare-")
    writeSyntheticRoot(dir, GATE_CURL)
    const v = scanGateScript("scripts/gate.sh", dir)
    expect(v).toHaveLength(1)
    expect(v[0].line).toBe(3) // shebang + set -euo pipefail, then the curl
  })

  it("scanGateScript: the SAME curl WITH --max-time passes", () => {
    const dir = createTempDir("curl-timeouts-bounded-")
    writeSyntheticRoot(dir, `${GATE_CURL} --max-time 20 --connect-timeout 10`)
    expect(scanGateScript("scripts/gate.sh", dir)).toEqual([])
  })

  it("scanGateScript: prose mentioning curl in a string or command -v cannot flag (masking)", () => {
    const dir = createTempDir("curl-timeouts-prose-")
    const gate = path.join(dir, "scripts", "gate.sh")
    fs.mkdirSync(path.dirname(gate), { recursive: true })
    fs.writeFileSync(
      gate,
      ['#!/usr/bin/env bash', 'fail "curl falhou: endpoint nao respondeu"', 'if ! command -v curl &>/dev/null; then', '  exit 1', 'fi', 'echo "Valida via curl"', ''].join("\n"),
      "utf8",
    )
    expect(scanGateScript("scripts/gate.sh", dir)).toEqual([])
  })

  it("scanGateScript: --max-time on a continuation line counts (the TLS-check form)", () => {
    const dir = createTempDir("curl-timeouts-continued-")
    const gate = path.join(dir, "scripts", "gate.sh")
    fs.mkdirSync(path.dirname(gate), { recursive: true })
    fs.writeFileSync(
      gate,
      ['#!/usr/bin/env bash', 'tls_info=$(curl -sI --tlsv1.2 --tls-max 1.3 \\', '  --max-time 20 --connect-timeout 10 \\', '  -o /dev/null -w "%{ssl_verify_result}" "$url")', ''].join("\n"),
      "utf8",
    )
    expect(scanGateScript("scripts/gate.sh", dir)).toEqual([])
  })
})

describe("scripts/scan-curl-timeouts.mjs - derivation + CLI + BASELINE (the live net)", () => {
  it("deriveGateScripts: reads the .sh references from the real workflows", () => {
    const derived = deriveGateScripts(ROOT)
    expect(derived.length).toBeGreaterThan(0)
    expect(derived).toContain("test-security-headers.sh")
    expect(derived).toContain("health-check.sh")
  })

  it("BASELINE: the CI gate-script surface has ZERO curls without --max-time", () => {
    // The permanent lock of the ADOTADO verdict: scan the real workflows'
    // gate scripts. If a new curl without a bound lands in a gate script,
    // THIS breaks with its exact file:line - the 9:08 class cannot return.
    const r = scanCurlTimeouts(ROOT)
    expect(r.violations).toEqual([])
  })

  it("BASELINE companion: the guard demonstrably scans a NON-EMPTY surface", () => {
    const r = scanCurlTimeouts(ROOT)
    expect(r.files.length).toBeGreaterThan(2)
    // The two known gate scripts with curls are in the surface.
    expect(r.files).toContain("test-security-headers.sh")
    expect(r.files).toContain("health-check.sh")
  })

  it("BASELINE companion: every derived gate-script name resolves to a REAL file (no vacuous pass)", () => {
    // The false-pass class this pins (2026-08-10, found in review):
    // scanCurlTimeouts originally resolved derived names directly against
    // the root (path.join(root, 'gate.sh')) while deriveGateScripts returns
    // BASENAMES captured from `scripts/<name>.sh` - so every scan hit a
    // NONEXISTENT path, returned [], and the CLI reported "clean" on a
    // surface it never actually read. A companion that only asserted
    // files.length > 2 could not catch it (the names were derived, just
    // never re-resolved). THIS pins the resolution: each derived name must
    // map back to an existing scripts/<name> file, so a vacuous clean can
    // never masquerade as a real one again.
    const r = scanCurlTimeouts(ROOT)
    expect(r.files.length).toBeGreaterThan(0)
    for (const f of r.files) {
      expect(fs.existsSync(path.join(ROOT, "scripts", f))).toBe(true)
    }
  })

  it("MUTATION (CLI): a synthetic gate script with a bare curl -> exit 1 with exact path:line", () => {
    const dir = createTempDir("curl-timeouts-mut-")
    writeSyntheticRoot(dir, GATE_CURL)
    const r = runCli({ CURL_TIMEOUTS_SCAN_ROOT: dir })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("CURL WITHOUT --max-time in scripts/gate.sh:3")
  }, 60000)

  it("MUTATION (CLI): the SAME synthetic script WITH --max-time -> exit 0", () => {
    const dir = createTempDir("curl-timeouts-clean-")
    writeSyntheticRoot(dir, `${GATE_CURL} --max-time 20 --connect-timeout 10`)
    const r = runCli({ CURL_TIMEOUTS_SCAN_ROOT: dir })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("DERIVATION edge: a .sh NOT cited by any workflow is out of surface (local/ops scripts are outside by design)", () => {
    const dir = createTempDir("curl-timeouts-ops-")
    // A local ops script with a bare curl, but NO workflow cites it.
    const ops = path.join(dir, "scripts", "deploy.sh")
    fs.mkdirSync(path.dirname(ops), { recursive: true })
    fs.writeFileSync(ops, `curl -s "$URL"\n`, "utf8")
    const r = runCli({ CURL_TIMEOUTS_SCAN_ROOT: dir })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("USAGE: an unknown flag exits 2 with the usage string (mirrors scan-timeouts)", () => {
    // The usage guard is a code path with NO surface to scan - a future
    // refactor could silently drop it, so it is pinned here like the
    // sibling's exit-2 contract: --bogus must not scan anything and must
    // fail fast with the usage line on stderr.
    const r = runCli({ CURL_TIMEOUTS_SCAN_ROOT: process.cwd() }, ["--bogus"])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("usage: node scripts/scan-curl-timeouts.mjs [--ci]")
  }, 60000)
})
