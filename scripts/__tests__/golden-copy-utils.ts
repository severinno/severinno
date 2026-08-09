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
 * REVERSE-MUTATION harness - shared by the module-level reverse mutations
 * (fragile-range-guard.test.ts, via patchModuleCopy + runReverseMutation)
 * AND the wrapper-level reverse mutation (verify-encoding.test.ts, via
 * patchModuleFile + FRAGILE_MODULE). Both suites write a TEMP COPY of the
 * real fragile-range-patterns.mjs with the scan-scope contracts LIFTED
 * (docs/ injected into TARGET_DIRS, optionally .md appended to
 * TARGET_EXTS) and re-execute the real code with the lifted constants -
 * an export-level vi.mock could never change the module-scope binding
 * scanExecutableCode reads, so the mutation must happen at the
 * module-source level.
 *
 * The expected declarations are NOT hardcoded anchors anymore: they live in
 * a VERSIONED GOLDEN COPY (scripts/__tests__/fixtures/fragile-range-scope.txt
 * - the repo's golden-copy pattern). writePatchedModule EXTRACTS the live
 * declarations from the real module by structural shape, compares them to
 * the golden snapshot (canonicalProgram-normalized), and on drift throws a
 * CLEAR DIFF (expected golden lines vs actual live lines + the fixture path
 * to update) instead of a bare "anchor not found" - so a module change is
 * actionable at a glance. The divergence guard in golden-copy-utils.test.ts
 * enforces the golden == live-module sync.
 */
const REAL_FRAGILE_MODULE = path.resolve(process.cwd(), "scripts", "fragile-range-patterns.mjs")
const SCOPE_GOLDEN = path.resolve(
  process.cwd(),
  "scripts",
  "__tests__",
  "fixtures",
  "fragile-range-scope.txt",
)

// Structural locators for the two scan-scope declarations. SHAPE-based, not
// value-based: they match the declaration LINE regardless of its value, so a
// value drift is REPORTED (the golden diff) instead of silently failing to
// find an exact-string anchor. If the declaration is renamed or the shape
// changes, extraction fails loudly with the fixture path to update.
const TARGET_DIRS_DECL = /^export const TARGET_DIRS = \[[^\]]*\]$/m
const TARGET_EXTS_DECL = /^const TARGET_EXTS = \/[^\n]*$/m

/**
 * Extract the live TARGET_DIRS/TARGET_EXTS declaration lines from the real
 * module source (structural shape). Throws with the fixture path if the
 * declaration shape changed (rename/restructure) - no silent ignore.
 */
function extractScopeDeclarations(src: string): { targetDirs: string; targetExts: string } {
  const dirs = src.match(TARGET_DIRS_DECL)
  const exts = src.match(TARGET_EXTS_DECL)
  if (!dirs || !exts) {
    throw new Error(
      "REVERSE MUTATION: could not locate the TARGET_DIRS/TARGET_EXTS declarations in fragile-range-patterns.mjs (structural shape changed) — update scripts/__tests__/fixtures/fragile-range-scope.txt AND this harness",
    )
  }
  return { targetDirs: dirs[0], targetExts: exts[0] }
}

/**
 * Verify the live module's scan-scope declarations match the versioned
 * GOLDEN COPY (canonicalProgram-normalized: layout noise tolerated, real
 * token changes caught). On drift, throws a CLEAR DIFF - expected golden
 * lines vs actual live lines + the fixture path - replacing the old bare
 * "anchor not found" failure. Returns the extracted declarations so the
 * caller can patch them. Exported for the divergence-guard mutation tests.
 */
export function assertScopeMatchesGolden(src: string): { targetDirs: string; targetExts: string } {
  const live = extractScopeDeclarations(src)
  const golden = canonicalProgram(fs.readFileSync(SCOPE_GOLDEN, "utf8"))
  const liveForm = canonicalProgram(`${live.targetExts}\n${live.targetDirs}`)
  if (golden !== liveForm) {
    throw new Error(
      [
        "REVERSE MUTATION: fragile-range-patterns.mjs scan-scope declarations drifted from the golden copy",
        `  golden copy (${path.relative(process.cwd(), SCOPE_GOLDEN)}):`,
        ...golden.split("\n").map((l) => `    ${l}`),
        "  live module (scripts/fragile-range-patterns.mjs):",
        ...liveForm.split("\n").map((l) => `    ${l}`),
        "  fix: update the golden copy to the live declarations (or restore the module) — the divergence guard in golden-copy-utils.test.ts enforces the sync",
      ].join("\n"),
    )
  }
  return live
}

/**
 * Write a patched temp copy of fragile-range-patterns.mjs (contracts
 * lifted per `patch`) into `dir` and return the copy's path. First verifies
 * the live declarations match the golden copy (clear diff on drift), then
 * patches the EXTRACTED lines - so the lift is applied to whatever the
 * module actually declares today (as long as it is in sync with the
 * snapshot).
 */
function writePatchedModule(dir: string, patch: { targetDirs?: string[]; extsAddMd?: boolean }): string {
  const src = fs.readFileSync(REAL_FRAGILE_MODULE, "utf8")
  const decls = assertScopeMatchesGolden(src)
  let patched = src
  if (patch.targetDirs) {
    patched = patched.replace(decls.targetDirs, `export const TARGET_DIRS = ${JSON.stringify(patch.targetDirs)}`)
  }
  if (patch.extsAddMd) {
    // Lift the extracted regex literal: append |md to the char-class group.
    // The declaration line ends with )$/ - insert |md right before it. The
    // golden sync transitively guarantees the trailing shape today, but the
    // guard below converts a would-be silent no-op into a clear harness
    // error if that shape ever changes (belt-and-suspenders).
    const lifted = decls.targetExts.replace(/\)\$\/$/, "|md)$/")
    if (lifted === decls.targetExts) {
      throw new Error(
        "REVERSE MUTATION: could not lift TARGET_EXTS (expected trailing ')$/' not found) — the golden-copy sync or the declaration shape changed",
      )
    }
    patched = patched.replace(decls.targetExts, lifted)
  }
  const modPath = path.join(dir, "fragile-range-patterns.mjs")
  fs.writeFileSync(modPath, patched)
  return modPath
}

/**
 * Write ONLY the patched module copy (no runner) and return its path. Used
 * by the WRAPPER-level reverse mutation: verify-encoding.sh layer 3 runs
 * the module via the FRAGILE_MODULE env override, so the wrapper executes
 * the temp copy with the lifted contracts through its real wiring.
 */
export function patchModuleFile(patch: { targetDirs?: string[]; extsAddMd?: boolean }): string {
  const dir = createTempDir("frg-revmod-")
  return writePatchedModule(dir, patch)
}

/**
 * Write the patched module copy PLUS a tiny runner that imports it and
 * calls scanExecutableCode(root); returns the RUNNER path (the
 * module-level reverse-mutation shape, for runReverseMutation).
 */
export function patchModuleCopy(patch: { targetDirs?: string[]; extsAddMd?: boolean }): string {
  const dir = createTempDir("frg-revmod-")
  writePatchedModule(dir, patch)
  const runnerPath = path.join(dir, "run-scan.mjs")
  fs.writeFileSync(
    runnerPath,
    [
      `import { scanExecutableCode } from "./fragile-range-patterns.mjs"`,
      `const offs = scanExecutableCode(process.argv[2])`,
      `process.stdout.write(JSON.stringify(offs))`,
      `process.exit(offs.length > 0 ? 1 : 0)`,
      "",
    ].join("\n"),
  )
  return runnerPath
}

/**
 * Run the patched module's scanExecutableCode(root) as a real node process.
 * Delegates to the shared runSubprocess (env inherit + utf8 + 30s timeout)
 * rather than re-implementing the shape.
 */
export function runReverseMutation(runnerPath: string, root: string) {
  return runSubprocess({ command: process.execPath, args: [runnerPath, root] })
}

/**
 * RULE OF THREE (EXTRACTED 2026-08 - the 3rd wrapper mutation test arrived
 * with the wrapper-level REVERSE MUTATION): the wrapper's FULL 5-assertion
 * layer-3 mutation block (aggregation + isolation L1/L2 + propagation +
 * count-pin) now lives HERE as this helper - all 3 callers in
 * verify-encoding.test.ts run runGate(["--ci", "src/"], env) through it:
 * the FRAGILE_SCAN_ROOT dirty-gate-file test, the FRAGILE_SCAN_DIRS dirty
 * target test, and the FRAGILE_MODULE reverse-mutation test. A 4th wrapper
 * mutation test calls THIS helper - never copies the 5 lines again. (The
 * full wrapper-vs-CLI division of responsibility is documented in the
 * verify-encoding.test.ts docblock.)
 *
 * Asserts (in order): worst-exit aggregation (status 1), layer-1
 * isolation (check-utf8 clean), layer-2 isolation (proof clean), layer-3
 * propagation ("fragile-range:" on stderr), and the UNCONDITIONAL
 * count-pin (expectSoleFailureCount(..., 1) - every caller sets BOTH
 * layer-3 overrides, so layer 3 scans zero real surface and the synthetic
 * fixture is the sole failure source by construction). Returns the raw
 * result so a caller may add fixture-specific asserts on top.
 */
export function expectLayer3FailsThroughWrapper(
  env: Record<string, string>,
  script = path.resolve(process.cwd(), "scripts", "verify-encoding.sh"),
): SpawnResult {
  const r = runSubprocess({ command: "bash", args: [script, "--ci", "src/"], env })
  expect(r.status).toBe(1) // worst-exit aggregation
  expect(r.stdout).toContain("check-utf8: done (all clean)") // layer 1 isolation
  expect(r.stdout).toContain("verify-ascii-proof: done (all clean)") // layer 2 isolation
  expect(r.stderr).toContain("fragile-range:") // layer 3 propagated through the wrapper
  // Count pinned to 1 - UNCONDITIONAL: layer 3 scans only synthetic trees
  // (both overrides set), so the sole failure source is the fixture itself
  // and no real-repo regression can masquerade as it.
  expectSoleFailureCount(r.stderr, 1)
  return r
}

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
