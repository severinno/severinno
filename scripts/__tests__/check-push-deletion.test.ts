/**
 * check-push-deletion.mjs - atalho de push de delecao pura (2026-08)
 *
 * Hermetic tests (no env override needed - the checker reads ONLY stdin,
 * zero repo surface). Two layers:
 *
 * 1. analyzePushStdin() - the pure parse function (imported, no subprocess):
 *    stdin lines "<local ref> <local sha> <remote ref> <remote sha>" ->
 *    { pureDeletion, total, deletions }.
 * 2. CLI via spawnSync with piped input - the exit-code contract the
 *    .husky/pre-push hook branches on: exit 0 = pure deletion (skip gates),
 *    exit 1 = anything else (run gates). The input is piped to the child's
 *    stdin exactly like the hook pipes $PRE_PUSH_STDIN.
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
import { analyzePushStdin } from "../check-push-deletion.mjs"

const SCRIPT = path.resolve(process.cwd(), "scripts", "check-push-deletion.mjs")
const ZERO = "0".repeat(40)
const REAL = "a".repeat(40)

/**
 * One pre-push stdin line: "<local ref> <local sha> <remote ref> <remote
 * sha>". The remote sha is a parameter (default REAL) so a test can give
 * the deletion line a DISTINCT remote sha - the awk-pinning tests need the
 * two lines' field-4 values to differ, otherwise the assertion cannot
 * discriminate the correct first-non-deletion derivation from the buggy
 * `NR == 1 { print $4 }` (both would return the same value).
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

  describe("hook awk derivation pinned (PRE_PUSH_REMOTE_SHA - the Gate-3 --since base)", () => {
    // The .husky/pre-push derives the remote sha for Gate 3 with an inline
    // awk: 'NR == 1 { first = $4 } $2 !~ /^0+$/ { real = $4 } END { print
    // (real != "" ? real : first) }'. In a MIXED push whose FIRST line is the
    // deletion, 'NR == 1 { print $4 }' would take the DELETED branch's tip as
    // the --since base - wrong. This pins the first-NON-deletion derivation
    // (and the no-exit-in-body rule: awk's exit RUNS the END block, which
    // would print $4 AND first -> a two-line remote sha). Spawns the exact
    // awk against synthetic stdin (bash -c, input piped).
    const AWK =
      "awk 'NR == 1 { first = $4 } $2 !~ /^0+$/ { real = $4 } END { print (real != \"\" ? real : first) }'"

    function runAwk(stdin: string) {
      const r = spawnSync("bash", ["-c", AWK], {
        input: stdin.replace(/\r\n/g, "\n"),
        encoding: "utf8",
        timeout: 60_000,
      })
      return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
    }

    it("mixed push, deletion FIRST -> remote sha of the first NON-deletion line (not the deleted tip)", () => {
      // The deletion line carries a DISTINCT remote sha (deletedTip) - if the
      // derivation regressed to 'NR == 1 { print $4 }', the output would be
      // deletedTip, not REAL: the assertion discriminates the two behaviors.
      const deletedTip = "d".repeat(40)
      const stdin = refLine(ZERO, "refs/heads/old", deletedTip) + refLine(REAL, "refs/heads/feature")
      const r = runAwk(stdin)
      expect(r.status).toBe(0)
      expect(r.stdout.trim()).toBe(REAL) // field 4 of the 2nd (real) line
      expect(r.stdout).not.toContain(deletedTip) // NOT the deleted branch's tip
    }, 60000)

    it("single real push -> its own remote sha (field 4)", () => {
      const r = runAwk(refLine(REAL))
      expect(r.stdout.trim()).toBe(REAL)
    }, 60000)

    it("all-deletion stdin -> falls back to the FIRST line's remote sha (belt-and-suspenders; unreachable in the hook since pure deletion exits earlier)", () => {
      const r = runAwk(refLine(ZERO))
      expect(r.stdout.trim()).toBe(REAL) // first line's field 4
    }, 60000)
  })

  describe("CLI exit-code contract (what the hook branches on)", () => {
    it("pure deletion stdin -> exit 0 + PURE DELETION message", () => {
      const r = runChecker(refLine(ZERO))
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("PURE DELETION")
      expect(r.stdout).toContain("skip pre-push gates")
    }, 60000)

    it("real push stdin -> exit 1 + run gates", () => {
      const r = runChecker(refLine(REAL))
      expect(r.status).toBe(1)
      expect(r.stdout).toContain("not a pure deletion")
    }, 60000)

    it("mixed stdin -> exit 1 (carries code, gates must run)", () => {
      const stdin = refLine(ZERO, "refs/heads/old") + refLine(REAL, "refs/heads/feature")
      const r = runChecker(stdin)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain("1/2 refs are deletions")
    }, 60000)

    it("empty stdin -> exit 1 (manual run, preserve behavior)", () => {
      const r = runChecker("")
      expect(r.status).toBe(1)
      expect(r.stdout).toContain("no refs")
    }, 60000)

    it("CRLF deletion stdin -> exit 0", () => {
      const r = runChecker(refLine(ZERO).replace(/\n/g, "\r\n"))
      expect(r.status).toBe(0)
    }, 60000)
  })
})
