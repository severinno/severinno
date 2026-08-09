/**
 * verify-encoding.test.ts — behavior tests for scripts/verify-encoding.sh,
 * the SINGLE entry point of the encoding gate that consolidates
 * check-utf8.sh (UTF-8 validity + always-on VPS ASCII) and
 * verify-ascii-proof.sh (strict repo-wide ASCII + frozen baseline) into ONE
 * CI step / ONE hook line. The wrapper's contract:
 *
 *   - exits with the WORST of the two layers (0/1/2)
 *   - forwards args to check-utf8.sh unchanged
 *   - routes --sync to the proof ONLY (no UTF-8 scan work, no arg leak)
 *   - env overrides (VPS_SH_FILES/OPS_SH_FILES/ASCII_BASELINE_FILE) pass
 *     through untouched so fixture-driven suites keep working
 *
 * The layer internals are tested by their own suites (check-utf8.test.ts,
 * verify-ascii-proof.test.ts); here we pin the WIRING: aggregation,
 * forwarding, and mutation propagation through the wrapper.
 *
 * WRAPPER vs CLI DIVISION OF RESPONSIBILITY (decision 2026-08 - the rule
 * for every FUTURE mutation test, so the two suites never re-duplicate):
 *
 *   WRAPPER suite (THIS file) asserts ONLY the wiring through
 *   scripts/verify-encoding.sh:
 *     - aggregation (worst exit code of the 3 layers wins)
 *     - isolation (layers 1+2 keep scanning the REAL repo and stay clean)
 *     - propagation (the layer-3 violation surfaces through the wrapper,
 *       "fragile-range:" on stderr)
 *     - the UNCONDITIONAL count-pin (expectSoleFailureCount(..., 1)):
 *       BOTH env overrides set -> layer 3 scans zero real surface, so the
 *       synthetic fixture is the sole failure source by construction
 *     - env-passthrough (FRAGILE_SCAN_ROOT untouched / FRAGILE_SCAN_DIRS
 *       translated to --dir)
 *   NEVER asserts the offender's label/path or pattern-level behavior
 *   (that detail lives in the CLI suite). The real-repo CLEAN state is
 *   split: PROOF/CONTRACT in THIS suite (real-repo baseline via the
 *   actual gate run + the derived --dir target count) vs repo-wide /
 *   REAL-REPO CONTRACT / BASELINE in the CLI suite.
 *
 *   CLI/module suite (fragile-range-guard.test.ts) asserts the detail:
 *     - offender label + path verbatim ('--dir dirty target', 'dirty gate
 *       file in the synthetic root', scanDirectory mutations)
 *     - pattern-level mutation proofs (stripComments + FRAGILE_PATTERNS)
 *     - real-repo surface: repo-wide scan, REAL-REPO CONTRACT
 *       (--dir e2e/ src/), BASELINE (count == 0), module shape
 *
 * RULE: a new wrapper mutation test asserts aggregation + isolation +
 * propagation + count-pin ONLY; any label/path/detail assert goes to the
 * CLI suite. Both suites share the count-pin helper (expectSoleFailureCount
 * in golden-copy-utils.ts).
 *
 * RULE OF THREE (extraction gate - do NOT extract before a 3rd use): the
 * two fragile-layer mutation tests below share an IDENTICAL 5-assertion
 * block - aggregation (status 1) + layer-1 isolation (check-utf8 clean) +
 * layer-2 isolation (proof clean) + propagation (stderr "fragile-range:")
 * + the count-pin (expectSoleFailureCount(..., 1)) - with BOTH env
 * overrides (FRAGILE_SCAN_ROOT + FRAGILE_SCAN_DIRS) set, one dirty one
 * clean. That is 2 uses, below the rule-of-three threshold: extracting
 * from two samples guesses the shape instead of proving it. WHEN a 3rd
 * wrapper mutation test needs the same block, extract it into
 * golden-copy-utils.ts as expectLayer3FailsThroughWrapper(env) - running
 * runGate(["--ci", "src/"], env) and asserting those 5 lines - and
 * refactor all 3 callers onto it. Until then, COPY the block (the
 * documented pattern) rather than abstracting early.
 *
 * REAL-REPO CLEAN CONTRACT (decision 2026-08 - no separate baseline test):
 * the mutation count-pins below (expectSoleFailureCount(..., 1)) are
 * HERMETIC, not real-repo-dependent: each sets BOTH layer-3 overrides
 * (FRAGILE_SCAN_ROOT + FRAGILE_SCAN_DIRS), so layer 3 scans ZERO
 * real-repo surface and a real-repo fragile range cannot flip the pin
 * (verified live - the pins stayed green with a real src/ injection;
 * contrast the guard suite's REAL-SURFACE tests - repo-wide, BASELINE,
 * REAL-REPO CONTRACT and the plain clean-verdict CLI runs - which scan
 * real gate files and carry their own BASELINE test; the guard's CLI
 * --dir dirty/clean pair is hermetic too, via FRAGILE_SCAN_ROOT). The
 * real-repo-clean prerequisite that
 * DOES exist in this suite - for the layer-1/2 isolation assertions and
 * the PROOF/CONTRACT clean-verdict assertions - is already asserted
 * end-to-end by the PROOF test below (all four gates green on the real
 * repo), so a scanExecutableCode(ROOT) == [] baseline here would be a
 * third redundant full-repo scan. CONTRACT: BOTH env overrides must stay
 * in each mutation test - dropping one silently makes the count-pin
 * real-repo-dependent again, and the guard suite's BASELINE + repo-wide
 * tests become the clearest safety net (the pin flip itself would also
 * fire, but with a confusing count-2 message).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  cleanupTempDirs,
  createTempDir,
  expectSoleFailureCount,
  runSubprocess,
} from "./golden-copy-utils"
import { TARGET_DIRS, filesInDir } from "../fragile-range-patterns.mjs"

const ROOT = process.cwd()
const SCRIPT = path.join(ROOT, "scripts", "verify-encoding.sh")

function runGate(args: string[], env: Record<string, string> = {}) {
  const r = runSubprocess({ command: "bash", args: [SCRIPT, ...args], env })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

function writeSh(dir: string, name: string, content: Buffer | string): string {
  const p = path.join(dir, name)
  fs.writeFileSync(p, content)
  return p
}

afterEach(() => {
  cleanupTempDirs()
})

describe("verify-encoding.sh (single encoding gate entry)", () => {
  it("script is syntactically valid bash (bash -n)", () => {
    const r = runSubprocess({ command: "bash", args: ["-n", SCRIPT] })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe("")
  })

  it(
    "PROOF: the real repo run exits 0 - BOTH layers clean (UTF-8 + ASCII + baseline)",
    () => {
      // Exercises the full real-repo path: check-utf8.sh --ci src/ then the
      // proof against the frozen docs/ascii-safe.md baseline, then the
      // fragile character-class RANGE scan (layer 3).
      const r = runGate(["--ci", "src/"])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("check-utf8: done (all clean)")
      expect(r.stdout).toContain("verify-ascii-proof: done (all clean)")
      expect(r.stdout).toContain("Baseline OK")
      expect(r.stdout).toContain("fragile-range: clean")
    },
    120000,
  )

  it(
    "CONTRACT: layer-3 default --dir targets are DERIVED from the module's TARGET_DIRS (no hardcoded list)",
    () => {
      // The wrapper must not hardcode a second "e2e/ src/" list: its
      // DEFAULT --dir args come from fragile-range-patterns.mjs
      // --print-target-dirs (the module is the single source of truth).
      // Proof: the real-repo run's layer-3 verdict must count exactly the
      // code files under the module's TARGET_DIRS trees (computed here from
      // the module's own filesInDir). If the wrapper drifted from
      // TARGET_DIRS - or derivation silently failed and degraded to
      // gate-files-only - the count would differ and this breaks.
      const expected = TARGET_DIRS.reduce(
        (n, d) => n + filesInDir(path.join(ROOT, d)).length,
        0,
      )
      expect(expected).toBeGreaterThan(0)
      const r = runGate(["--ci", "src/"])
      expect(r.status).toBe(0)
      // Verdict shape: "fragile-range: clean (109 gate files + N target files, ...)".
      // `files?` future-proofs the singular "target file" if a tree ever
      // shrinks to exactly one code file.
      expect(r.stdout).toMatch(new RegExp(`\\+ ${expected} target files?`))
    },
    120000,
  )

  it("MUTATION (proof layer): a dirty OPS fixture fails the gate through the wrapper", () => {
    const dir = createTempDir("verify-encoding-mut-")
    const vps = writeSh(dir, "vps.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const dirty = writeSh(dir, "ops.sh", Buffer.from([0x23, 0x21, 0x0a, 0x97, 0x0a]))

    // Fixture mode: proof audits the injected lists; check-utf8 still scans
    // the real repo (clean); fragile-range scans the real gate files (clean).
    // The aggregate exit must be 1 with the violation surfaced - proving
    // layer-2 failures propagate through the wrapper.
    const r = runGate(["--ci", "src/"], { VPS_SH_FILES: vps, OPS_SH_FILES: dirty })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("check-utf8: done (all clean)")
    expect(r.stdout).toContain(`[VIOLATION]  ${dirty}`)
    expect(r.stdout).toContain("fragile-range: clean")
  })

  it("MUTATION (utf8 layer): a dirty .sh dir fails via check-utf8.sh, proof still clean", () => {
    // check-utf8.sh treats a positional dir as the scan root. A byte-0x97
    // .sh there must fail the FIRST layer; the proof (real repo) stays clean.
    const dir = createTempDir("verify-encoding-utf8mut-")
    writeSh(dir, "bad.sh", Buffer.from([0x23, 0x20, 0x97, 0x0a]))

    const r = runGate(["--ci", dir])
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("0x97") // check_utf8.py byte-0x97 warning
    expect(r.stdout).toContain("verify-ascii-proof: done (all clean)")
  })

  it("MUTATION (fragile layer): a [^ -~] range in a SYNTHETIC repo gate file fails layer 3 through the wrapper", () => {
    // Wrapper-level proof of the layer-3 wiring without depending on the
    // real repo: a synthetic repo tree with one gate file (scripts/foo.sh)
    // carrying the fragile space-tilde range, reached via the
    // FRAGILE_SCAN_ROOT env override (passes through the wrapper untouched,
    // same pattern as the proof's VPS_SH_FILES/OPS_SH_FILES fixtures).
    // The wrapper contract pinned HERE is aggregation + isolation +
    // propagation: layers 1+2 keep scanning the real repo (clean), layer 3
    // surfaces the violation, and the aggregate exit is 1. The module
    // detail (exact offender label/path) is the CLI suite's job - see
    // fragile-range-guard.test.ts 'dirty gate file in the synthetic root',
    // which asserts the offender line verbatim.
    const dir = createTempDir("verify-encoding-fragile-")
    const scriptsDir = path.join(dir, "scripts")
    fs.mkdirSync(scriptsDir, { recursive: true })
    writeSh(scriptsDir, "foo.sh", "#!/usr/bin/env bash\nif grep -n '[^ -~]' file; then exit 1; fi\n")

    // FRAGILE_SCAN_DIRS REPLACES the derived --dir targets with a CLEAN
    // synthetic tree, so layer 3 is FULLY synthetic (gate file + targets,
    // zero real-repo surface). The count pin is therefore UNCONDITIONAL:
    // no real-repo regression can flip it - the synthetic gate file is the
    // sole failure source by construction. (The derived --dir path itself
    // is pinned separately by the CONTRACT test above.)
    const cleanTarget = createTempDir("verify-encoding-fragile-clean-")
    fs.mkdirSync(path.join(cleanTarget, "e2e"), { recursive: true })
    writeSh(
      cleanTarget,
      "e2e/ok.spec.ts",
      "import { test } from '@playwright/test'\ntest('ok', () => {})\n",
    )

    const r = runGate(["--ci", "src/"], { FRAGILE_SCAN_ROOT: dir, FRAGILE_SCAN_DIRS: cleanTarget })
    expect(r.status).toBe(1) // worst-exit aggregation
    expect(r.stdout).toContain("check-utf8: done (all clean)") // layer 1 isolation
    expect(r.stdout).toContain("verify-ascii-proof: done (all clean)") // layer 2 isolation
    expect(r.stderr).toContain("fragile-range:") // layer 3 propagated through the wrapper
    // Count pinned to 1 - UNCONDITIONAL: layer 3 scans only synthetic trees
    // (dirty gate file + clean target), so the sole failure source is the
    // fixture itself and no real-repo regression can masquerade as it.
    expectSoleFailureCount(r.stderr, 1)
  })

  it("MUTATION (fragile layer, --dir target): a [^ -~] range in a SYNTHETIC e2e spec fails layer 3 via FRAGILE_SCAN_DIRS", () => {
    // Wrapper-level proof of the layer-3 --dir wiring without depending on
    // the real repo: FRAGILE_SCAN_DIRS (env) REPLACES the module-DERIVED
    // default targets (TARGET_DIRS via --print-target-dirs) with a
    // synthetic tree whose spec.ts carries the space-tilde range in LIVE
    // code. The wrapper translates the env into --dir args - the ONLY
    // place FRAGILE_SCAN_DIRS is honored (the CLI reads --dir flags, not
    // this env), so the env-passthrough + translation wiring is UNIQUELY
    // observable through the wrapper, like the FRAGILE_SCAN_ROOT case. The
    // wrapper contract pinned HERE is aggregation + isolation +
    // propagation: layers 1+2 keep scanning the real repo (clean), layer 3
    // surfaces the violation, and the aggregate exit is 1. The module
    // detail (exact offender label/path) is the CLI suite's job - see
    // fragile-range-guard.test.ts '--dir dirty target', which asserts the
    // offender line verbatim.
    const dir = createTempDir("verify-encoding-fragile-dir-")
    const specDir = path.join(dir, "e2e")
    fs.mkdirSync(specDir, { recursive: true })
    writeSh(
      specDir,
      "dirty.spec.ts",
      "import { test } from '@playwright/test'\ntest('x', () => { console.log(/[^ -~]/) })\n",
    )

    // FRAGILE_SCAN_ROOT redirects the GATE-FILE scan to a CLEAN synthetic
    // root, so layer 3 is FULLY synthetic here too (clean gate files +
    // dirty spec target, zero real-repo surface) - the count pin is
    // UNCONDITIONAL: the synthetic spec is the sole failure source by
    // construction, no real-repo regression can flip it.
    const cleanRoot = createTempDir("verify-encoding-fragile-root-")
    fs.mkdirSync(path.join(cleanRoot, "scripts"), { recursive: true })
    writeSh(cleanRoot, "scripts/ok.sh", "#!/usr/bin/env bash\necho ok\n")

    const r = runGate(["--ci", "src/"], { FRAGILE_SCAN_DIRS: dir, FRAGILE_SCAN_ROOT: cleanRoot })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("check-utf8: done (all clean)")
    expect(r.stdout).toContain("verify-ascii-proof: done (all clean)")
    expect(r.stderr).toContain("fragile-range:")
    // Count pinned to 1 - UNCONDITIONAL: layer 3 scans only synthetic trees
    // (clean gate files + dirty spec), so the sole failure source is the
    // fixture itself and no real-repo regression can masquerade as it.
    expectSoleFailureCount(r.stderr, 1)
  })

  it("SYNC: --sync routes to the proof ONLY (baseline regeneration, no UTF-8 scan)", () => {
    const dir = createTempDir("verify-encoding-sync-")
    const vps = writeSh(dir, "vps.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const ops = writeSh(dir, "ops.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const baseline = path.join(dir, "ascii-safe.md")
    fs.writeFileSync(
      baseline,
      "# auto baseline\n\n<!-- ASCII-BASELINE:VPS -->\n<!-- ASCII-BASELINE:OPS -->\n<!-- ASCII-BASELINE:END -->\n",
    )

    const r = runGate(["--sync"], {
      VPS_SH_FILES: vps,
      OPS_SH_FILES: ops,
      ASCII_BASELINE_FILE: baseline,
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("baseline synced")
    // --sync must NOT run check-utf8.sh (no UTF-8 scan work) and must NOT
    // leak the flag into its args.
    expect(r.stdout).not.toContain("check-utf8:")
    expect(r.stdout).not.toContain("Usage:")
  })

  it("SYNC-MIXED: --sync combined with gate args is REJECTED (no silent ignore)", () => {
    // Mixing a maintenance op with normal gate args would silently drop the
    // gate args; the wrapper refuses loudly instead (exit 2).
    const r = runGate(["--ci", "src/", "--sync"])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("cannot be combined")
    expect(r.stdout).not.toContain("check-utf8:")
    expect(r.stdout).not.toContain("baseline synced")
  })

  it("WORST-EXIT aggregation: utf8 error (2) + clean proof = 2", () => {
    // check-utf8.sh exits 2 when its python script is missing... it validates
    // the script path itself; simulate a usage error instead via an unknown
    // directory (check_utf8.py exits 2 on missing path).
    const missing = path.join(createTempDir("verify-encoding-missing-"), "nope")
    const r = runGate(["--ci", missing])
    expect(r.status).toBe(2)
  })
})
