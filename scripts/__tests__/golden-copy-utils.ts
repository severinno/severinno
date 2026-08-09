/**
 * golden-copy-utils.ts — shared helpers for the golden-copy suites in
 * scripts/__tests__/ (workflow-embedded programs vs versioned golden copies).
 *
 * The canonical-form helper was previously duplicated in every golden-copy
 * suite (canonicalShell in workflow-prove-gate-golden.test.ts, canonicalAwk in
 * release-assert-route-gate.test.ts, canonicalShell in the deleted
 * workflow-healthcheck-golden.test.ts). Extracted here so a 4th suite imports
 * instead of copy-pasting — a divergence in the canonicalizer itself would
 * silently weaken EVERY divergence guard at once.
 *
 * The subprocess runner + CRLF normalization + temp-dir registry were also
 * duplicated across the shim harnesses (runProveGateProgram / runAwkProgram /
 * runScript in the health-check suite): every harness spawned bash/awk with
 * the same shape (env merged over process.env, utf8, 30s timeout) and
 * normalized CRLF before piping programs into bash (a Windows checkout via
 * `* text=auto` → CRLF would break bash parsing on `\r`). Centralized here so
 * the 4th suite inherits the same hardening by default instead of
 * re-implementing it per-harness.
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect } from "vitest"

/** Canonical form for the divergence guards (content, not layout). */
export function canonicalProgram(program: string): string {
  return program
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim()) // BOTH sides: extraction carries the YAML block indent
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .join("\n")
}

/** CRLF → LF. Needed before piping a program/golden copy into bash -c. */
export function normalizeCrlf(input: string): string {
  return input.replace(/\r\n/g, "\n")
}

export interface SpawnResult {
  status: number | null
  stdout: string
  stderr: string
}

/**
 * Assert the layer-3 offender COUNT is pinned to exactly `count` - the
 * "sole failure source" guarantee shared by every fragile-range dirty test
 * (the guard suite's CLI --dir dirty + FRAGILE_SCAN_ROOT dirty tests, and
 * the verify-encoding.sh FRAGILE_SCAN_ROOT + FRAGILE_SCAN_DIRS mutation
 * tests). ALL of them are hermetic by construction: the CLI tests set
 * FRAGILE_SCAN_ROOT (synthetic root) so they scan ZERO real surface, and
 * the wrapper tests set BOTH layer-3 overrides. A real-repo regression can
 * therefore never flip these pins or masquerade as a synthetic proof -
 * the live-regression signal belongs to the real-surface tests (the guard
 * suite's repo-wide / BASELINE / REAL-REPO CONTRACT / clean-verdict CLI
 * runs), not to these pins.
 */
export function expectSoleFailureCount(stderr: string, count: number): void {
  expect(stderr).toContain(`${count} fragile character-class range(s) in LIVE code:`)
}

/**
 * RULE OF THREE (extraction gate) - do NOT extract before a 3rd use:
 * the wrapper's FULL 5-assertion layer-3 mutation block (aggregation +
 * isolation L1/L2 + propagation + count-pin) is intentionally NOT a
 * helper yet - only 2 callers exist (the two fragile-layer mutation
 * tests in verify-encoding.test.ts). WHEN a 3rd wrapper mutation test
 * needs the same block, extract it HERE as
 * expectLayer3FailsThroughWrapper(env) - running
 * runGate(["--ci", "src/"], env) and asserting those 5 lines - and
 * refactor all 3 callers onto it (full contract in the
 * verify-encoding.test.ts docblock RULE section). Until then, COPY the
 * block rather than abstracting early.
 */

/**
 * Run a subprocess (bash/awk/...) with the shared shape every shim harness
 * used: env merged over process.env, utf8 decoding, 30s timeout (kill on
 * hang so a broken loop fails the suite instead of stalling CI). Returns
 * status + decoded stdout/stderr ("" when the stream is absent).
 */
export function runSubprocess(opts: {
  command: string
  args: string[]
  env?: Record<string, string>
  timeoutMs?: number
  /** Working directory for the child (defaults to the parent's CWD). */
  cwd?: string
}): SpawnResult {
  const r = spawnSync(opts.command, opts.args, {
    env: { ...process.env, ...opts.env },
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 30_000,
    cwd: opts.cwd,
  })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

// Temp-dir registry: harnesses create fixture dirs (report files, shim
// counter/log files) via createTempDir and clean them up in afterEach via
// cleanupTempDirs — same lifecycle the suites used inline, centralized.
const tempDirs: string[] = []

/** Create a temp dir tracked by the shared registry (cleaned in afterEach). */
export function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/** Remove every temp dir created since the last call (call in afterEach). */
export function cleanupTempDirs(): void {
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
}
