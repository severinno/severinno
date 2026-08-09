/**
 * golden-copy-utils.test.ts — direct coverage for the SHARED helpers the
 * golden-copy suites rely on but never exercise in isolation.
 *
 * The core property under test (MUTATION): canonicalProgram must be SENSITIVE
 * to real token changes — a program with `exit 1` and the same program with
 * `exit 2` MUST canonicalize differently. canonicalProgram is the single
 * point of trust behind every divergence guard in the repo (workflow vs
 * golden copy); if a bug there collapsed real differences, every guard would
 * pass silently while the workflows and their copies diverged.
 *
 * The counter-property (TOLERANCE): canonicalProgram must be INSENSITIVE to
 * layout noise — YAML block indent (the workflow extraction carries it per
 * line), CRLF line endings (a Windows checkout via `* text=auto`), blank
 * lines and `#` comment lines all collapse away, exactly as the guards
 * expect (the extraction carries indent; the golden copy is written clean).
 *
 * Both properties must hold TOGETHER for the guards to be simultaneously
 * non-flaky (noise tolerated) and protective (mutations caught).
 */
import { describe, it, expect } from "vitest"
import { canonicalProgram } from "./golden-copy-utils"

/** A representative shell program (the shape the prove-gate suite guards). */
const SHELL = [
  "set -e",
  "out=$(node scripts/check-js-budget.mjs 2>&1)",
  "code=$?",
  'if [ "$code" -eq 0 ]; then',
  "  exit 1",
  "fi",
].join("\n")

/** A representative awk program (the shape the route-gate suite guards). */
const AWK = [
  "/^## Rotas/ { in_routes = 1 }",
  "in_routes && index($0, tag) == 1 { in_block = 1; next }",
  "in_block && /^### / { in_block = 0 }",
  "in_block && /^\\| \\/busca \\|/ { found = 1 }",
  "END { exit (found ? 0 : 1) }",
].join("\n")

describe("golden-copy-utils — canonicalProgram (shared canonicalizer)", () => {
  it("MUTATION: a changed exit-code token (exit 1 → exit 2) changes the canonical form", () => {
    const mutated = SHELL.replace("exit 1", "exit 2")
    // Sanity: the mutation IS a real text difference (otherwise the assertion
    // below would be vacuous).
    expect(mutated).not.toBe(SHELL)
    expect(canonicalProgram(mutated)).not.toBe(canonicalProgram(SHELL))
  })

  it("MUTATION: a changed awk rule token inside a statement line is caught", () => {
    const mutated = AWK.replace("found = 1", "found = 0")
    expect(mutated).not.toBe(AWK)
    expect(canonicalProgram(mutated)).not.toBe(canonicalProgram(AWK))
  })

  it("ABSOLUTE: the canonical form is the exact pinned output (guards against silent transformation drift)", () => {
    // The relative tests (noise collapses, mutations differ) hold even if
    // canonicalProgram silently changed its transformation in a relationship-
    // preserving way (e.g. lowercasing, stripping a different char class) —
    // which would silently change every divergence guard's semantics. Pinning
    // the exact output catches over-collapsing, over-splitting and any such
    // drift. Note: `  exit 1` (indented in the fixture) trims to `exit 1`.
    const expectedShell = [
      "set -e",
      "out=$(node scripts/check-js-budget.mjs 2>&1)",
      "code=$?",
      'if [ "$code" -eq 0 ]; then',
      "exit 1",
      "fi",
    ].join("\n")
    expect(canonicalProgram(SHELL)).toBe(expectedShell)
    // Same pin for the awk fixture — the awk RULES must survive verbatim.
    // IMPORTANT: if a fixture is legitimately edited, this pin must be updated
    // in the same change — a pin failure means "update the pin", not
    // "canonicalProgram broke" (the mutation tests above cover the inverse).
    const expectedAwk = [
      "/^## Rotas/ { in_routes = 1 }",
      "in_routes && index($0, tag) == 1 { in_block = 1; next }",
      "in_block && /^### / { in_block = 0 }",
      "in_block && /^\\| \\/busca \\|/ { found = 1 }",
      "END { exit (found ? 0 : 1) }",
    ].join("\n")
    expect(canonicalProgram(AWK)).toBe(expectedAwk)
  })

  it("TOLERANCE: identical content canonicalizes to the same form (stability)", () => {
    expect(canonicalProgram(SHELL)).toBe(canonicalProgram(SHELL))
    expect(canonicalProgram(AWK)).toBe(canonicalProgram(AWK))
  })

  it("TOLERANCE: YAML block indent + CRLF + blank lines collapse away", () => {
    // The workflow extraction carries per-line YAML indent; a Windows
    // checkout delivers CRLF; trailing blank lines are layout, not content.
    const noisy = SHELL.split("\n")
      .map((l) => "      " + l)
      .join("\r\n") + "\r\n\r\n"
    expect(canonicalProgram(noisy)).toBe(canonicalProgram(SHELL))
  })

  it("TOLERANCE: `#` comment lines are dropped (golden-copy headers must not matter)", () => {
    const withHeader = "# Golden copy — generated reference\n" + AWK + "\n"
    expect(canonicalProgram(withHeader)).toBe(canonicalProgram(AWK))
  })

  it("MUTATION vs TOLERANCE: noise → same form, token change → different form (the guard's discriminator)", () => {
    // The whole point of the canonicalizer: layout noise collapses, real
    // changes survive. Both must hold for the divergence guards to be both
    // non-flaky (noise tolerated) and protective (mutations caught).
    const noisy = AWK.split("\n").map((l) => "  " + l).join("\r\n")
    const mutated = AWK.replace("in_block = 0", "in_block = 9")
    expect(canonicalProgram(noisy)).toBe(canonicalProgram(AWK)) // noise tolerated
    expect(canonicalProgram(mutated)).not.toBe(canonicalProgram(AWK)) // mutation caught
  })
})
