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
 *   - TRIPWIRE (sec 11.36): the eval+curl FORM on the same logical line now
 *     FAILS the CLI with a warning (EVAL CURL signal, exact path:line) -
 *     the early-warning of the 11.30 frontier. The --max-time detector is
 *     NOT closed (scanGateScript still returns [] for the masked token -
 *     the accepted false-negative stays); the tripwire is a SEPARATE
 *     check (scanEvalCurl) that forces a decision when the escape form
 *     actually appears on the surface, instead of a silent pass.
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
  FRONTIERS,
  deriveGateScripts,
  joinContinuations,
  maskBashStrings,
  scanCurlTimeouts,
  scanEvalCurl,
  scanGateScript,
} from "../scan-curl-timeouts.mjs"

const ROOT = process.cwd()
const SCRIPT = path.join(ROOT, "scripts", "scan-curl-timeouts.mjs")

const GATE_CURL = `curl -s -o /dev/null -D "$HEADERS_FILE" -w "%{http_code}" "$url" 2>/dev/null || echo "000"`

// The eval-built curl (the accepted frontier of sec 11.30): the curl token
// lives INSIDE the double-quoted CMD string (so maskBashStrings consumes it),
// and the eval line only references $CMD (masked too) - no real invocation
// survives for CURL_INVOKE_RE. The backslash-escaped inner quotes are the
// realistic bash form (literal \" inside the double-quoted string).
const EVAL_BUILT_CURL = 'CMD="curl -s -o /dev/null -w \\"%{http_code}\\" \\"$HEALTH_URL\\" 2>/dev/null"; eval "$CMD"'
// The SAME curl as a direct invocation (no CMD wrapper): the token is outside
// any string, so it IS a real invocation - the counterfactual half proves the
// accepted frontier is a deliberate boundary, never a dead detector.
const DIRECT_CURL = 'curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null'

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

  it("MUTATION (the $HEALTH_URL incident pattern): a curl whose URL is a parametrizable VARIABLE without --max-time IS flagged - the variable indirection does NOT create an escape (the detector keys on the curl token + flag, not the URL form)", () => {
    // The exact health-check.sh shape (scripts/health-check.sh:39) minus the
    // timeout: HTTP_CODE=$(curl ... "$HEALTH_URL" ...). The URL being a
    // variable is irrelevant to the scan - the curl token is literal and no
    // --max-time exists on the logical line, so the parametrizable pattern
    // of the incident cannot smuggle a bare curl past the guard.
    const dir = createTempDir("curl-timeouts-varurl-")
    writeSyntheticRoot(dir, `HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")`)
    const v = scanGateScript("scripts/gate.sh", dir)
    expect(v).toHaveLength(1)
    expect(v[0].line).toBe(3)
    expect(v[0].text).toContain("$HEALTH_URL")
  })

  it("MUTATION (positive - the SAME variable form WITH --max-time): a curl with a variable URL AND a variable TIMEOUT VALUE passes - the contract is the flag's PRESENCE (literal --max-time), not the flag's value or the URL's form", () => {
    // The parametrizable pair (HEALTH_URL + HEALTH_TIMEOUT): the --max-time
    // token survives the string masking (it is outside the quotes), so a
    // timeout defined via variable is still a bound - parametrizing the
    // VALUE is the healthy pattern (single source of truth), never a bypass.
    const dir = createTempDir("curl-timeouts-varurl-ok-")
    writeSyntheticRoot(
      dir,
      `HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$HEALTH_TIMEOUT" --connect-timeout "$HEALTH_CONNECT" "$HEALTH_URL" 2>/dev/null || echo "000")`,
    )
    expect(scanGateScript("scripts/gate.sh", dir)).toEqual([])
  })

  it("ACCEPTED false-negative (the eval frontier, sec 11.30): a curl HIDDEN in a string evaluated later via eval passes WITHOUT --max-time - the masked token is NOT a real invocation, and this is DECIDED (the counterfactual proves the detector works)", () => {
    // The frontier documented in sec 11.29 (prose) is now a contract: hiding
    // the curl TOKEN (not the URL) inside a string that is evaluated later
    // (`CMD="curl ..."; eval "$CMD"`) escapes the scan - the maskBashStrings
    // masking consumes the token (it is INSIDE the quotes), so there is no
    // real invocation for CURL_INVOKE_RE to see. This is ACCEPTED behavior
    // (no gate script uses the form today; closing it would require eval
    // tracking for a form that does not exist on the surface) - pinning it
    // here keeps a reader from reading the frontier as an undecided hole.
    const dir = createTempDir("curl-timeouts-eval-")
    writeSyntheticRoot(dir, EVAL_BUILT_CURL)
    expect(scanGateScript("scripts/gate.sh", dir)).toEqual([])
    // WHY it passes (the mechanism, pinned on the SAME string): the masking
    // consumes the curl token - the string content becomes spaces, so no
    // invocation survives for CURL_INVOKE_RE.
    expect(maskBashStrings(EVAL_BUILT_CURL)).not.toContain("curl")
    // COUNTERFACTUAL (the decision is DELIBERATE, not a dead detector): the
    // SAME curl (DIRECT_CURL - the eval form's inner curl without the CMD
    // wrapper) as a direct invocation (token outside the string) IS flagged.
    // If a future refactor made the detector silently match nothing, THIS
    // half breaks - the accepted frontier stays a named boundary, never a
    // vacuous pass.
    const dir2 = createTempDir("curl-timeouts-eval-ctr-")
    writeSyntheticRoot(dir2, DIRECT_CURL)
    expect(scanGateScript("scripts/gate.sh", dir2)).toHaveLength(1)
  })

  it("ACCEPTED false-negative (the quoted-token class, sec 11.31): a curl token QUOTED (\"/usr/bin/curl\", \"$(command -v curl)\") escapes WITHOUT --max-time - the masking consumes the token inside quotes, the sibling of the eval class WITHOUT the eval trigger, and this is DECIDED (the counterfactual proves the detector works)", () => {
    // The probe 2026-08-11 inverted the user's premise: the UNQUOTED
    // absolute path /usr/bin/curl and env curl DO match \bcurl\b (the /
    // and space are word boundaries) - COBERTO, pinned in the matrix. The
    // actual escape is the QUOTED token: maskBashStrings consumes the
    // string content, so `"/usr/bin/curl"` and `"$(command -v curl)"`
    // leave NO invocation token for CURL_INVOKE_RE. This is ACCEPTED
    // behavior (0 quoted-token uses on the derived surface - health-check
    // and test-security-headers both invoke bare curl; closing it would
    // require parsing quoted command position, the same cost class the
    // eval frontier refused) - pinning it here keeps a reader from
    // reading the frontier as an undecided hole.
    const quoted = '"/usr/bin/curl" -s -o /dev/null "$URL"'
    const dir = createTempDir("curl-timeouts-quoted-")
    writeSyntheticRoot(dir, quoted)
    expect(scanGateScript("scripts/gate.sh", dir)).toEqual([])
    // WHY it passes (the mechanism, pinned): the masking consumes the
    // quoted path - no invocation survives for CURL_INVOKE_RE.
    expect(maskBashStrings(quoted)).not.toContain("curl")
    // COUNTERFACTUAL (the decision is DELIBERATE, never a vacuous pass):
    // the SAME path UNQUOTED (token outside the string) IS flagged.
    const dir2 = createTempDir("curl-timeouts-quoted-ctr-")
    writeSyntheticRoot(dir2, "/usr/bin/curl -s -o /dev/null \"$URL\"")
    expect(scanGateScript("scripts/gate.sh", dir2)).toHaveLength(1)
  })

  it("TRIPWIRE (sec 11.36): the eval+curl FORM on the same logical line trips scanEvalCurl with the exact line (the 11.30 frontier now warns instead of silently passing)", () => {
    // The early-warning: the ACCEPTED false-negative of the DETECTOR
    // (scanGateScript [] for the masked token, pinned above) is unchanged,
    // but the FORM itself now trips a separate check - the maskBashStrings
    // consumption that defeats CURL_INVOKE_RE is exactly what makes the
    // raw-line tripwire the honest signal (no masking: masking would
    // consume the very token this check exists to warn about).
    const dir = createTempDir("curl-timeouts-tripwire-")
    writeSyntheticRoot(dir, EVAL_BUILT_CURL)
    const w = scanEvalCurl("scripts/gate.sh", dir)
    expect(w).toHaveLength(1)
    expect(w[0].line).toBe(3) // shebang + set -euo pipefail, then the line
    // The text is sliced at 80 chars (the same slice scanGateScript uses),
    // so the assertion targets the mechanism token (eval) that survives the
    // slice - the full `eval "$CMD"` tail is beyond the truncation.
    expect(w[0].text).toContain("eval")
  })

  it("TRIPWIRE form-based: a --max-time INSIDE the eval string still trips (the warning is about the FORM - the static check cannot verify the masked content)", () => {
    // The tripwire keys on eval+curl on the logical line, never on the flag
    // inside the string: a masked --max-time cannot be verified statically
    // (the content was consumed by maskBashStrings), so the form trips and
    // forces the decision (refactor to direct invocation or document
    // formally) regardless of what the string says.
    const dir = createTempDir("curl-timeouts-tripwire-bound-")
    writeSyntheticRoot(dir, 'CMD="curl -s --max-time 20 \"$HEALTH_URL\""; eval "$CMD"')
    expect(scanEvalCurl("scripts/gate.sh", dir)).toHaveLength(1)
  })

  it("TRIPWIRE: eval alone (no curl token on the line) and curl alone (no eval) do NOT trip", () => {
    // Both tokens must share the SAME logical line - the form the tripwire
    // exists to catch. An eval of a variable assigned elsewhere, or a plain
    // direct curl (already covered by the --max-time detector), is not the
    // escape form.
    const dir = createTempDir("curl-timeouts-tripwire-eval-")
    writeSyntheticRoot(dir, 'eval "$CMD"')
    expect(scanEvalCurl("scripts/gate.sh", dir)).toEqual([])
    const dir2 = createTempDir("curl-timeouts-tripwire-curl-")
    writeSyntheticRoot(dir2, `${GATE_CURL} --max-time 20 --connect-timeout 10`)
    expect(scanEvalCurl("scripts/gate.sh", dir2)).toEqual([])
  })

  it("TRIPWIRE: a comment line mentioning both tokens does NOT trip (comment lines excluded, the cheap consistent rule)", () => {
    const dir = createTempDir("curl-timeouts-tripwire-comment-")
    const gate = path.join(dir, "scripts", "gate.sh")
    fs.mkdirSync(path.dirname(gate), { recursive: true })
    fs.writeFileSync(
      gate,
      ['#!/usr/bin/env bash', '# nunca usar eval + curl na mesma linha logica', 'true'].join("\n"),
      "utf8",
    )
    expect(scanEvalCurl("scripts/gate.sh", dir)).toEqual([])
  })

  it("TRIPWIRE boundary (CONTRACT ACEITO, sec 11.30 pattern): CMD=... and eval \"$CMD\" on SEPARATE physical lines (no backslash continuation) do NOT trip - the tripwire covers the same-logical-line form only (closing the split form costs variable tracking, the exact cost sec 11.30 refused); the COUNTERFACTUAL (the SAME form on ONE line) DOES trip, pinning the split as the deliberate boundary, never a dead tripwire", () => {
    // The honest residual: the escape spread across two lines (assignment,
    // then eval on the next line without a continuation backslash) is
    // invisible to a same-logical-line grep. Closing it would require
    // tracking variable definitions - the cost the 11.30 decision refused
    // for a form with 0 uses on the surface. The boundary is NAMED here so
    // a reader never reads it as an unconsidered gap.
    const dir = createTempDir("curl-timeouts-tripwire-split-")
    const gate = path.join(dir, "scripts", "gate.sh")
    fs.mkdirSync(path.dirname(gate), { recursive: true })
    fs.writeFileSync(
      gate,
      ['#!/usr/bin/env bash', 'CMD="curl -s -o /dev/null \"$HEALTH_URL\""', 'eval "$CMD"'].join("\n"),
      "utf8",
    )
    expect(scanEvalCurl("scripts/gate.sh", dir)).toEqual([])
    // COUNTERFACTUAL (the decision is DELIBERATE, not a dead tripwire): the
    // SAME content joined on ONE logical line (the eval+curl form the
    // tripwire exists for) IS caught - the split is what escapes, not the
    // form itself. If a future refactor made scanEvalCurl silently match
    // nothing, THIS half breaks - the accepted split-form frontier stays a
    // named boundary, never a vacuous pass.
    const dir2 = createTempDir("curl-timeouts-tripwire-split-ctr-")
    const gate2 = path.join(dir2, "scripts", "gate.sh")
    fs.mkdirSync(path.dirname(gate2), { recursive: true })
    fs.writeFileSync(
      gate2,
      ['#!/usr/bin/env bash', 'CMD="curl -s -o /dev/null \"$HEALTH_URL\""; eval "$CMD"'].join("\n"),
      "utf8",
    )
    const w = scanEvalCurl("scripts/gate.sh", dir2)
    expect(w).toHaveLength(1)
    expect(w[0].line).toBe(2)
    // The text assert mirrors the 11.30 ACCEPTED pattern: the surviving
    // token names the mechanism (eval) that the same-line form exposes.
    expect(w[0].text).toContain("eval")
  })

  it("TRIPWIRE continuation: the form split by a backslash continuation is ONE logical line -> trips at the START line", () => {
    // joinContinuations (the same helper the --max-time detector uses for
    // the TLS-check form) makes the split-by-backslash pair a single
    // logical line, so the tripwire sees the form and reports the START
    // line of the logical command.
    const dir = createTempDir("curl-timeouts-tripwire-cont-")
    const gate = path.join(dir, "scripts", "gate.sh")
    fs.mkdirSync(path.dirname(gate), { recursive: true })
    fs.writeFileSync(
      gate,
      ['#!/usr/bin/env bash', 'set -euo pipefail', 'CMD="curl -s -o /dev/null \"$HEALTH_URL\"" \\', '  eval "$CMD"'].join("\n"),
      "utf8",
    )
    const w = scanEvalCurl("scripts/gate.sh", dir)
    expect(w).toHaveLength(1)
    expect(w[0].line).toBe(3)
  })

  it("INVOCATION-FORM MATRIX (sec 11.31): the guard recognizes ONLY the literal token curl + the literal flag --max-time - every other form is measured and pinned, and the connect-timeout-alone decision is FAIL (it bounds only the connect phase, never the total)", () => {
    // The measured surface (probe 2026-08-11, sec 11.31): the detector keys
    // on the literal `curl` token + the literal `--max-time` long form. The
    // short form `-m 20` OVER-FLAGS (safe direction - costs the same
    // explicit --max-time, the documented cost class); the wrapper DEF is
    // the chokepoint (the real token lives in the body, so an unbounded
    // wrapper FAILS exactly where the bound belongs); the wrapper CALL is
    // invisible (curl2 does not match \bcurl\b) but the DEF already guards
    // the script; --connect-timeout ALONE fails BY DECISION (it bounds the
    // connect phase, a stalled body still hangs CI - only --max-time bounds
    // the total, the class-killer).
    const cases: Array<[string, number, string]> = [
      ['curl -s -o /dev/null "$URL"', 1, "bare curl (the class)"],
      ['curl -s -o /dev/null -m 20 "$URL"', 1, "short form -m 20 OVER-FLAGS (only --max-time literal is recognized - accepted safe direction)"],
      ['curl -s -o /dev/null --MAX-TIME 20 "$URL"', 1, "case-variant --MAX-TIME OVER-FLAGS (MAX_TIME_RE is case-sensitive - only the lowercase literal matches; the form is also a curl ERROR - 'option --MAX-TIME: is unknown' - fails loudly, never hangs)"],
      ['curl -s -o /dev/null --Max-Time 20 "$URL"', 1, "case-variant --Max-Time OVER-FLAGS (same class - case-sensitivity pinned)"],
      ['curl -s -o /dev/null --max-time 20 "$URL"', 0, "long form --max-time (the contract flag)"],
      ['curl -s -o /dev/null --connect-timeout 10 "$URL"', 1, "--connect-timeout ALONE FAILS (the DECISION: it bounds only the connect phase, a stalled body still hangs - sec 11.31)"],
      ['curl -s -o /dev/null --max-time 20 --connect-timeout 10 "$URL"', 0, "--max-time + --connect-timeout (the healthy pair)"],
      ['curl2() { curl -s -o /dev/null "$@"; }', 1, "wrapper DEF without bound - the real curl token lives in the body -> flagged exactly where the bound belongs"],
      ['curl2() { curl -s -o /dev/null --max-time 20 "$@"; }', 0, "wrapper DEF WITH bound - the chokepoint is satisfied, the wrapper is a safe indirection"],
      ['curl2 -s -o /dev/null "$URL"', 0, "wrapper CALL - the curl2 token is invisible to \\bcurl\\b, but the DEF above already guards the script"],
      ["alias curl='curl --max-time 20'", 1, "alias def - the alias NAME token (outside the string) over-flags; safe direction"],
      ["CURL_BIN=curl", 1, "CURL_BIN=curl assignment - the documented over-flag of the header"],
      ["if ! command -v curl &>/dev/null; then exit 1; fi", 0, "command -v curl probe - explicitly excluded"],
      ['/usr/bin/curl -s -o /dev/null "$URL"', 1, "absolute path - COBERTO (the \\bcurl\\b boundary matches at the / edge - the under-flag premise is INVERTED by the probe)"],
      ['env curl -s -o /dev/null "$URL"', 1, "env wrapper - COBERTO (a space is a word boundary - same premise inversion)"],
      ['env CURL_TIMEOUT=20 curl -s -o /dev/null "$URL"', 1, "env with VAR= prefix - COBERTO (the VAR= does not change the boundary; the token is still outside any string - the fold row the probe measured)"],
      ['"/usr/bin/curl" -s -o /dev/null "$URL"', 0, "QUOTED absolute path - ESCAPE ACEITO (maskBashStrings consumes the token inside quotes - the sibling class of the eval 11.30 without the eval trigger; 0 uses on surface, sec 11.31)"],
      ['"$(command -v curl)" -s -o /dev/null "$URL"', 0, "QUOTED command substitution - ESCAPE ACEITO (the same masking escape; the portable-resolve idiom is exactly what the masking hides - accepted frontier)"],
      ['CURL=$(command -v curl); "$CURL" -s -o /dev/null "$URL"', 0, "command -v ASSIGNMENT + variable invocation - excluded by the PRE-EXISTING command -v probe rule (COMMAND_V_CURL_RE matches the whole logical line) - the doc-table row now test-pinned"],
    ]
    for (const [line, expected, label] of cases) {
      const dir = createTempDir("curl-timeouts-matrix-")
      writeSyntheticRoot(dir, line)
      const v = scanGateScript("scripts/gate.sh", dir)
      expect(v.length, label).toBe(expected)
    }
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

  it("BASELINE TRIPWIRE: the real gate-script surface has ZERO eval+curl forms (the 11.30 decision: 0 uses today - if the escape form appears, this breaks with its exact path:line)", () => {
    // The companion to the 11.30 decision: the accepted frontier says the
    // form does NOT exist on the surface - this pins that claim as a
    // baseline. The tripwire is the early-warning: the day the form
    // actually lands in a gate script, the guard fails with the exact
    // path:line instead of the escape arriving silently.
    const r = scanCurlTimeouts(ROOT)
    expect(r.evalWarnings).toEqual([])
  })

  it("BASELINE companion: the guard demonstrably scans a NON-EMPTY surface", () => {
    const r = scanCurlTimeouts(ROOT)
    expect(r.files.length).toBeGreaterThan(2)
    // The two known gate scripts with curls are in the surface.
    expect(r.files).toContain("test-security-headers.sh")
    expect(r.files).toContain("health-check.sh")
  })

  it("REAL-REPO CONTRACT (the live parametrizable pattern): health-check.sh's curl with \"$HEALTH_URL\" stays bounded - the --max-time flag shares the SAME logical line as the variable URL, and the guard scans the real file clean (the variable indirection never decouples the flag from the invocation)", () => {
    // The user's frontier: scripts/health-check.sh:39 is
    // `HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20
    // --connect-timeout 10 "$HEALTH_URL" ...)` - the URL is parametrizable
    // but the flag lives on the SAME logical line, so the detector (token +
    // flag) keeps it bounded. A future refactor that moves the URL to a
    // variable WITHOUT keeping --max-time on the invocation line breaks the
    // BASELINE; this test names the frontier explicitly instead of leaving
    // it implied by the whole-surface scan.
    const v = scanGateScript("scripts/health-check.sh", ROOT)
    expect(v).toEqual([])
    const raw = fs.readFileSync(path.join(ROOT, "scripts", "health-check.sh"), "utf8")
    // A co-locacao e em LINHA LOGICA (o mesmo joinContinuations do guard -
    // review nit, sec 11.29): se um refactor legitimo mover o --max-time
    // para uma linha de continuacao (a forma TLS-check), o guard segue
    // clean via join e o teste NAO pode false-failhar por linha fisica.
    const logical = joinContinuations(raw.split("\n"))
    const curlLine = logical.find((l) => l.includes("curl") && l.includes("$HEALTH_URL")) ?? ""
    expect(curlLine).toContain("$HEALTH_URL")
    expect(curlLine).toContain("--max-time")
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

  it("CLI TRIPWIRE (sec 11.36): the eval-built curl in a synthetic root -> exit 1 with the EVAL CURL signal + exact path:line (the 11.30 frontier MOVED: the --max-time detector stays open, the FORM now trips the early-warning)", () => {
    // The end-to-end pin of the frontier update: the accepted false-negative
    // of the DETECTOR (scanGateScript [] for the masked token) is unchanged,
    // but the CLI now FAILS the eval+curl form with a warning - someone
    // introducing the escape is warned at the CLI too, not only in the pure
    // function. The signal carries the exact path:line the fix depends on.
    const dir = createTempDir("curl-timeouts-eval-cli-")
    writeSyntheticRoot(dir, EVAL_BUILT_CURL)
    const r = runCli({ CURL_TIMEOUTS_SCAN_ROOT: dir })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("EVAL CURL (sec 11.30) in scripts/gate.sh:3")
  }, 60000)

  it("CLI TRIPWIRE form-based: the eval form WITH --max-time inside the string still exits 1 (the warning is about the FORM - a masked --max-time cannot be verified statically)", () => {
    // The CLI twin of the form-based pure test: a timeout INSIDE the eval'd
    // string does not silence the tripwire. The static check cannot verify
    // the masked content, so the form trips and demands the decision
    // (refactor to a direct invocation or document formally) - never a
    // silent pass on an unverifiable bound.
    const dir = createTempDir("curl-timeouts-eval-cli-bound-")
    writeSyntheticRoot(dir, 'CMD="curl -s --max-time 20 \"$HEALTH_URL\""; eval "$CMD"')
    const r = runCli({ CURL_TIMEOUTS_SCAN_ROOT: dir })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("EVAL CURL (sec 11.30)")
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

describe("scripts/scan-curl-timeouts.mjs - FRONTIER GUARD (the guard of frontier guards, sec 11.40)", () => {
  // The manifest FRONTIERS (exported from the scanner) is the structural
  // record of EVERY decided-accepted invocation form. The guard-of-guards
  // invariant: a decided frontier MUST be pinned by a tripwire (the
  // early-warning of the accepted form) OR a counterfactual test (the
  // detector works on both sides of the decision) - never a silent hole.
  // These three tests lock that invariant: the manifest shape (growth: a
  // new frontier must be registered HERE consciously), the protection
  // classes (an escape without tripwire/counterfactual is an undecided
  // gap), and the markers (each entry's pin is REAL in this suite, not
  // prose - read from the actual test file, the manifest-registry pattern).

  it("FRONTIER MANIFEST: every decided-accepted frontier is registered with kind + protection (14 entries - the measured surface, sec 11.31/11.36)", () => {
    // The ABSOLUTE PIN (the growth contract): the 14 decided frontiers of
    // the surface. A NEW decided form must be added here consciously with
    // its protection class - a frontier that exists only in the header
    // prose is unprotected by construction.
    expect(FRONTIERS.map((f) => f.id)).toEqual([
      "eval-built-curl",
      "quoted-token",
      "split-form-eval",
      "short-form-m",
      "case-variant",
      "alias-name",
      "curl-bin-assignment",
      "wrapper-indirection",
      "connect-timeout-alone",
      "absolute-path",
      "env-wrapper",
      "health-url-variable",
      "command-v-probe",
      "command-v-assignment",
    ])
    // Every entry must carry kind + protection + a real marker + a doc ref.
    for (const f of FRONTIERS) {
      expect(f.kind, f.id).toBeTruthy()
      expect(f.protection, f.id).toBeTruthy()
      expect(f.marker, f.id).toBeTruthy()
      expect(f.ref, f.id).toBeTruthy()
    }
  })

  it("FRONTIER INVARIANT: every ESCAPE-kind frontier has tripwire OR counterfactual protection - a decided escape without either is a silent hole", () => {
    // The core of the guard-of-guards: the ESCAPE class (the form PASSES
    // silently - the token is masked) is the dangerous one. It MUST be
    // caught by the tripwire (the eval form, sec 11.36) or pinned by a
    // counterfactual test (the detector works on the direct form - sec
    // 11.30/11.31/11.36). An escape pinned only by a matrix row (expected
    // 0) would be an UNDECIDED gap, not a decided frontier.
    for (const f of FRONTIERS.filter((x) => x.kind === "escape")) {
      expect(["tripwire", "counterfactual"], f.id).toContain(f.protection)
    }
    // The other kinds (overflag/covered/excluded/fail-decision) are the
    // SAFE direction: they never pass silently (overflag = fails high,
    // covered = the probe inverted the premise, excluded = explicit probe
    // rule, fail-decision = FAILS by decision). They are pinned by a
    // matrix row with its expected outcome, or - where the probe showed a
    // subtle premise (the $HEALTH_URL variable, covered + counterfactual)
    // - by a counterfactual test. NEVER by the tripwire: scanEvalCurl is
    // the eval form's reserved pin (the only tripwire in the surface).
    for (const f of FRONTIERS.filter((x) => x.kind !== "escape")) {
      expect(["matrix", "counterfactual"], f.id).toContain(f.protection)
      expect(f.protection, f.id).not.toBe("tripwire")
    }
  })

  it("FRONTIER MARKERS: every registered frontier's marker EXISTS in this suite source - the pin is real, never prose", () => {
    // Read the actual test file (the manifest-registry pattern: the guard
    // inspects the artifact it protects). If a refactor drops a pin (e.g.
    // the quoted-token counterfactual test, the eval tripwire test, a
    // matrix row), the marker disappears and THIS fails - the manifest
    // entry is tied to a real test, not to a comment.
    const suiteSource = fs.readFileSync(
      path.join(ROOT, "scripts", "__tests__", "scan-curl-timeouts.test.ts"),
      "utf8",
    )
    for (const f of FRONTIERS) {
      expect(suiteSource.includes(f.marker), `${f.id} -> marker '${f.marker}'`).toBe(true)
    }
  })

  it("FRONTIER EARLY-WARNINGS: the two layers of the decided-surface protection both exist - the BASELINE companion AND the tripwire", () => {
    // The 1st early-warning (BASELINE companion): the detector demonstrably
    // scans a NON-EMPTY live surface (a vacuous pass would mean a new gate
    // script is never scanned). The 2nd (the tripwire, sec 11.36): the
    // eval+curl form fails the FORMA. Both are separate it() blocks in this
    // suite - pinned here so neither can be silently dropped.
    const suiteSource = fs.readFileSync(
      path.join(ROOT, "scripts", "__tests__", "scan-curl-timeouts.test.ts"),
      "utf8",
    )
    expect(suiteSource).toContain("BASELINE: the CI gate-script surface has ZERO curls without --max-time")
    expect(suiteSource).toContain("TRIPWIRE (sec 11.36): the eval+curl FORM")
    expect(typeof scanEvalCurl).toBe("function")
  })
})
