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
 *
 * The module-patch scaffold (ModulePatchOp + writeModuleCopy) was the 3rd
 * instance of the same shape — the fragile-range REVERSE MUTATION
 * (writePatchedModule below), the encoding-surface GROWTH CONTRACT
 * (writePatchedSurfaceModule) and the budget-routes GROWTH CONTRACT
 * (writePatchedRoutesModule) all read a manifest module, patched it at
 * structural anchors and wrote a temp copy. Extracted here so a 4th
 * manifest suite builds ops and calls writeModuleCopy instead of
 * copy-pasting the read-module / anchor / write-copy shape a 4th time.
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect } from "vitest"
import { TARGET_DIRS, filesInDir } from "../fragile-range-patterns.mjs"

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
 * RULE OF TWO USES (EXTRACTED 2026-08): expectedTargetFiles() is the
 * derived count of code files under the module's TARGET_DIRS trees — the
 * exact number the layer-3 verdict asserts ("+ N target files"). It was
 * duplicated VERBATIM in the REAL-REPO CONTRACT --dir MULTI-ARG test
 * (fragile-range-guard.test.ts) and the CONTRACT layer-3-derivation test
 * (verify-encoding.test.ts); the repo's usual rule-of-three would wait
 * for a 3rd copy, but this derivation is exactly where a suite hardcodes
 * a magic "+ 476 target files" literal, so the shared helper landed at 2
 * uses. A 3rd suite asserts that count by importing THIS instead of
 * re-deriving it.
 *
 * The count is DERIVED from the module's own exports (TARGET_DIRS +
 * filesInDir) — never a frozen literal — so it always agrees with what
 * the module's CLI itself counts (extraFiles += filesInDir(d).length),
 * and a new file (or a 5th TARGET_DIRS tree) self-adjusts instead of
 * tripping a stale pin. Root defaults to the process CWD (both original
 * call sites used ROOT = process.cwd()); a synthetic-root suite can pass
 * its own. NOTE: this import pulls fragile-range-patterns.mjs (an
 * IS_MAIN-guarded CLI entry, side-effect-free on import) into every
 * suite that imports golden-copy-utils — safe by design, but the module
 * stays the single source of truth for both symbols.
 *
 * Real-coverage note: the helper is exercised, not dead — both call
 * sites assert the real-repo count against the layer-3 verdict regex
 * ("+ N target files?"), so a refactor that weakens the derivation would
 * fail the CONTRACT tests, not pass silently.
 */
export function expectedTargetFiles(root = process.cwd()): number {
  return TARGET_DIRS.reduce((n, d) => n + filesInDir(path.join(root, d)).length, 0)
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
 * RULE OF THREE (EXTRACTED 2026-08 — the 3rd module-patch harness arrived
 * with the budget-routes GROWTH CONTRACT): writeModuleCopy is the SHARED
 * SCAFFOLD behind every suite that writes a TEMP COPY of a real manifest
 * module with contract-lifting patches — the fragile-range REVERSE
 * MUTATION (writePatchedModule below), the encoding-surface GROWTH CONTRACT
 * (writePatchedSurfaceModule in encoding-surface.test.ts) and the
 * budget-routes GROWTH CONTRACT (writePatchedRoutesModule in
 * budget-routes.test.ts). A 4th manifest suite builds ops and calls THIS
 * instead of copy-pasting the read-module / anchor / write-copy shape a 4th
 * time.
 *
 * Each op is (anchor, replace, onMissing): the anchor is a string (literal,
 * first occurrence) or a RegExp (the matched text — the whole structural
 * span the op rewrites), the replacement is a literal string or a replacer
 * receiving the matched text, and a MISSING anchor throws the onMissing
 * error — the same fail-loudly-on-shape-drift posture each harness kept
 * ("update the harness when legitimately edited"), so a module
 * rename/restructure can never degrade into a silent no-op. REGEX anchors
 * MUST be non-global (no `g` flag): the presence check matches once, so a
 * global flag would make the splice hit every occurrence while the anchor
 * semantics assume one.
 *
 * The splice goes through String.replace with a FUNCTION replacement, never
 * a string: a string replacement would interpret `$&`/`$1`-style sequences
 * in the NEW text, silently mangling patches whose content legitimately
 * contains `$`. REGEX anchors are re-matched for the splice (replace-on-
 * regex) instead of re-locating the matched text as a literal: the matched
 * TEXT could in principle appear earlier in the file, and a literal
 * first-occurrence splice would land at the wrong position.
 */
export interface ModulePatchOp {
  anchor: string | RegExp
  replace: string | ((match: string) => string)
  onMissing: string
}

export function writeModuleCopy(dir: string, modulePath: string, ops: ModulePatchOp[]): string {
  let src = fs.readFileSync(modulePath, "utf8")
  for (const op of ops) {
    if (typeof op.anchor === "string") {
      if (!src.includes(op.anchor)) {
        throw new Error(op.onMissing)
      }
      const replacement = typeof op.replace === "string" ? op.replace : op.replace(op.anchor)
      src = src.replace(op.anchor, () => replacement)
    } else {
      const matched = src.match(op.anchor)
      // length === 0 ENFORCES the non-global contract: with a `g` flag,
      // match() returns [] on no-match (truthy) — the fail-loudly throw
      // would silently pass and the replacer would receive undefined.
      if (!matched || matched.length === 0) {
        throw new Error(op.onMissing)
      }
      const replacement = typeof op.replace === "string" ? op.replace : op.replace(matched[0])
      src = src.replace(op.anchor, () => replacement)
    }
  }
  const modPath = path.join(dir, path.basename(modulePath))
  fs.writeFileSync(modPath, src)
  return modPath
}

/**
 * Write a patched temp copy of fragile-range-patterns.mjs (contracts
 * lifted per `patch`) into `dir` and return the copy's path. First verifies
 * the live declarations match the golden copy (clear diff on drift), then
 * patches the EXTRACTED lines through the shared writeModuleCopy scaffold —
 * so the lift is applied to whatever the module actually declares today (as
 * long as it is in sync with the snapshot).
 */
function writePatchedModule(dir: string, patch: { targetDirs?: string[]; extsAddMd?: boolean }): string {
  const src = fs.readFileSync(REAL_FRAGILE_MODULE, "utf8")
  const decls = assertScopeMatchesGolden(src)
  const ops: ModulePatchOp[] = []
  if (patch.targetDirs) {
    ops.push({
      anchor: decls.targetDirs,
      replace: `export const TARGET_DIRS = ${JSON.stringify(patch.targetDirs)}`,
      onMissing:
        "REVERSE MUTATION: TARGET_DIRS declaration anchor missing (golden sync passed but the extracted line vanished) — update this harness",
    })
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
    ops.push({
      anchor: decls.targetExts,
      replace: lifted,
      onMissing:
        "REVERSE MUTATION: TARGET_EXTS declaration anchor missing (golden sync passed but the extracted line vanished) — update this harness",
    })
  }
  return writeModuleCopy(dir, REAL_FRAGILE_MODULE, ops)
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
