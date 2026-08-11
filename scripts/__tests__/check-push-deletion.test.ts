/**
 * check-push-deletion.mjs - atalho de push de delecao pura (2026-08)
 *
 * Hermetic tests (no env override needed - the checker reads ONLY stdin,
 * zero repo surface). Three layers:
 *
 * 1. analyzePushStdin() - the pure parse function (imported, no subprocess):
 *    stdin lines "<local ref> <local sha> <remote ref> <remote sha>" ->
 *    { pureDeletion, total, deletions }.
 * 2. deriveRemoteSha() - the Gate-3 --since base derivation, MOVED from the
 *    .husky/pre-push inline awk into the checker (sec 11.21, medicao
 *    2026-08-11): the awk 'NR == 1 { first = $4 } $2 !~ /^0+$/ { real = $4 }
 *    END { print (real != "" ? real : first) }' is now a pure JS function -
 *    the hook calls the CLI ONCE (1 spawn node instead of cat + awk + node)
 *    and captures the sha from stdout. Pinned here byte-equivalent against
 *    the awk semantics (the discriminating cases).
 * 3. CLI via spawnSync with piped input - the stdout/stderr/exit contract
 *    the .husky/pre-push hook branches on: stdout = the remote sha ONLY
 *    (the hook captures it as PRE_PUSH_REMOTE_SHA for Gate 3, so messages
 *    MUST go to stderr - a message on stdout would become a multi-line
 *    remote sha and break the --since); exit 0 = pure deletion (skip
 *    gates), exit 1 = anything else (run gates).
 *
 * The contract being pinned is the 8.4 housekeeping decision: a push that
 * deletes branches ONLY (local sha all-zeros on every ref) must NOT pay the
 * ~74s gate chain - it transports zero new commits. Mixed pushes (deletion
 * + real ref) DO run gates. Empty stdin (manual TTY run) runs gates too.
 *
 * Subprocess-heavy (every CLI test spawns node) -> an EXPLICIT timeout on
 * every subprocess it() (the scan-timeouts guard requires it).
 */
import { spawnSync } from "node:child_process"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { analyzePushStdin, deriveRemoteSha } from "../check-push-deletion.mjs"

const SCRIPT = path.resolve(process.cwd(), "scripts", "check-push-deletion.mjs")
const ZERO = "0".repeat(40)
const REAL = "a".repeat(40)

/**
 * One pre-push stdin line: "<local ref> <local sha> <remote ref> <remote
 * sha>". The remote sha is a parameter (default REAL) so a test can give
 * the deletion line a DISTINCT remote sha - the derivation-pinning tests
 * need the two lines' field-4 values to differ, otherwise the assertion
 * cannot discriminate the correct first-non-deletion derivation from the
 * buggy `NR == 1 { print $4 }` (both would return the same value).
 */
function refLine(
  localSha: string,
  ref = "refs/heads/feature",
  remoteSha: string = REAL,
): string {
  return `${ref} ${localSha} ${ref} ${remoteSha}\n`
}

/**
 * Run the CLI with the given stdin piped in (the hook's exact invocation).
 * NOTE: the input is piped RAW (no CRLF normalization here) - the CRLF CLI
 * test below must genuinely exercise the checker's own /\r?\n/ handling, not
 * a harness normalization (the reviewer's masked-test nit).
 */
function runChecker(stdin: string) {
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: stdin,
    encoding: "utf8",
    timeout: 60_000,
  })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

describe("check-push-deletion.mjs - pure-deletion push shortcut (2026-08)", () => {
  describe("analyzePushStdin (pure parse)", () => {
    it("single deletion ref -> pureDeletion true", () => {
      const r = analyzePushStdin(refLine(ZERO))
      expect(r.pureDeletion).toBe(true)
      expect(r.total).toBe(1)
      expect(r.deletions).toBe(1)
    })

    it("multi-ref all deletions -> pureDeletion true", () => {
      const stdin = refLine(ZERO, "refs/heads/old-a") + refLine(ZERO, "refs/heads/old-b")
      const r = analyzePushStdin(stdin)
      expect(r.pureDeletion).toBe(true)
      expect(r.total).toBe(2)
    })

    it("single real push -> pureDeletion false", () => {
      const r = analyzePushStdin(refLine(REAL))
      expect(r.pureDeletion).toBe(false)
      expect(r.deletions).toBe(0)
    })

    it("mixed (1 deletion + 1 real) -> pureDeletion false (must run gates)", () => {
      const stdin = refLine(ZERO, "refs/heads/old") + refLine(REAL, "refs/heads/feature")
      const r = analyzePushStdin(stdin)
      expect(r.pureDeletion).toBe(false)
      expect(r.total).toBe(2)
      expect(r.deletions).toBe(1)
    })

    it("empty stdin (manual TTY run) -> pureDeletion false (run gates)", () => {
      const r = analyzePushStdin("")
      expect(r.pureDeletion).toBe(false)
      expect(r.total).toBe(0)
    })

    it("CRLF stdin -> still detected (Windows checkout)", () => {
      const r = analyzePushStdin(refLine(ZERO).replace(/\n/g, "\r\n"))
      expect(r.pureDeletion).toBe(true)
    })
  })

  describe("deriveRemoteSha - the Gate-3 --since base (the awk inline movido para o checker, sec 11.21)", () => {
    // The .husky/pre-push derives the remote sha for Gate 3; the awk
    // 'NR == 1 { first = $4 } $2 !~ /^0+$/ { real = $4 } END { print (real !=
    // "" ? real : first) }' now lives HERE as pure JS (medicao 2026-08-11:
    // o hook passou de 3 subprocessos cat+awk+node para 1 spawn node,
    // 0.31-0.38s -> 0.11-0.12s). In a MIXED push whose FIRST line is the
    // deletion, 'NR == 1 { print $4 }' would take the DELETED branch's tip as
    // the --since base - wrong. These pin the first-NON-deletion derivation
    // byte-equivalent to the awk (the same 3 discriminating cases the awk
    // test used, now pure JS - no subprocess).
    it("mixed push, deletion FIRST -> remote sha of the first NON-deletion line (not the deleted tip)", () => {
      // The deletion line carries a DISTINCT remote sha (deletedTip) - if the
      // derivation regressed to 'NR == 1 { print $4 }', the output would be
      // deletedTip, not REAL: the assertion discriminates the two behaviors.
      const deletedTip = "d".repeat(40)
      const stdin = refLine(ZERO, "refs/heads/old", deletedTip) + refLine(REAL, "refs/heads/feature")
      expect(deriveRemoteSha(stdin)).toBe(REAL) // field 4 of the 2nd (real) line
      expect(deriveRemoteSha(stdin)).not.toBe(deletedTip) // NOT the deleted branch's tip
    })

    it("single real push -> its own remote sha (field 4)", () => {
      expect(deriveRemoteSha(refLine(REAL))).toBe(REAL)
    })

    it("all-deletion stdin -> falls back to the FIRST line's remote sha (belt-and-suspenders; unreachable in the hook since pure deletion exits earlier)", () => {
      expect(deriveRemoteSha(refLine(ZERO))).toBe(REAL) // first line's field 4
    })

    it("empty stdin -> empty sha (the hook's Gate 3 falls to staged + HEAD)", () => {
      expect(deriveRemoteSha("")).toBe("")
    })

    it("leading blank line + all-deletion -> first NON-EMPTY line's field-4 (the JS filter semantics; the awk's `first` would be \"\" from the literal first line - divergence pinned, unreachable via git's 4-field stdin)", () => {
      // The deliberate divergence documented in the deriveRemoteSha
      // docblock: blank lines are FILTERED before parsing, so `first` is
      // the first non-empty line's field-4 (the awk would take the literal
      // first line's, i.e. ""). Pin the JS behavior so the equivalence
      // claim stays exact.
      expect(deriveRemoteSha("\n" + refLine(ZERO))).toBe(REAL)
    })
  })

  describe("CLI stdout/stderr/exit contract (what the hook branches on)", () => {
    it("pure deletion stdin -> exit 0 + stdout = the remote sha ONLY + PURE DELETION on stderr", () => {
      const r = runChecker(refLine(ZERO))
      expect(r.status).toBe(0)
      // stdout = o sha APENAS (o hook captura como PRE_PUSH_REMOTE_SHA para
      // o Gate 3 - mensagens no stdout virariam um remote sha multi-linha).
      expect(r.stdout.trim()).toBe(REAL)
      expect(r.stderr).toContain("PURE DELETION")
      expect(r.stderr).toContain("skip pre-push gates")
    }, 60000)

    it("real push stdin -> exit 1 + stdout = the sha + 'not a pure deletion' on stderr", () => {
      const r = runChecker(refLine(REAL))
      expect(r.status).toBe(1)
      expect(r.stdout.trim()).toBe(REAL)
      expect(r.stderr).toContain("not a pure deletion")
    }, 60000)

    it("mixed stdin -> exit 1 (carries code, gates must run) + stdout = first non-deletion sha", () => {
      const stdin = refLine(ZERO, "refs/heads/old") + refLine(REAL, "refs/heads/feature")
      const r = runChecker(stdin)
      expect(r.status).toBe(1)
      expect(r.stdout.trim()).toBe(REAL)
      expect(r.stderr).toContain("1/2 refs are deletions")
    }, 60000)

    it("empty stdin -> exit 1 + empty stdout (manual run, preserve behavior)", () => {
      const r = runChecker("")
      expect(r.status).toBe(1)
      expect(r.stdout.trim()).toBe("")
      expect(r.stderr).toContain("no refs")
    }, 60000)

    it("CRLF deletion stdin -> exit 0 + sha in stdout", () => {
      const r = runChecker(refLine(ZERO).replace(/\n/g, "\r\n"))
      expect(r.status).toBe(0)
      expect(r.stdout.trim()).toBe(REAL)
    }, 60000)
  })
})
