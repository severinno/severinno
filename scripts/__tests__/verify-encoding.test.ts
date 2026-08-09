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
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"

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
    // End-to-end proof of the layer-3 wiring WITHOUT depending on the real
    // repo: a minimal synthetic repo tree with one gate file (scripts/foo.sh)
    // carrying the fragile space-tilde range in LIVE code. FRAGILE_SCAN_ROOT
    // points layer 3 at that tree (env passes through the wrapper untouched,
    // same pattern as the proof's VPS_SH_FILES/OPS_SH_FILES fixtures). Layers
    // 1+2 still scan the real repo (clean); the aggregate exit must be 1 with
    // the 'fragile-range:' violation surfaced on stderr. Layer 3 also scans
    // the real e2e/ + src/ targets (clean), proving the gate-file mutation
    // is what trips it.
    const dir = createTempDir("verify-encoding-fragile-")
    const scriptsDir = path.join(dir, "scripts")
    fs.mkdirSync(scriptsDir, { recursive: true })
    writeSh(scriptsDir, "foo.sh", "#!/usr/bin/env bash\nif grep -n '[^ -~]' file; then exit 1; fi\n")

    const r = runGate(["--ci", "src/"], { FRAGILE_SCAN_ROOT: dir })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("check-utf8: done (all clean)")
    expect(r.stdout).toContain("verify-ascii-proof: done (all clean)")
    expect(r.stderr).toContain("fragile-range:")
    expect(r.stderr).toContain("space-tilde character range")
    // Offender line uses path.relative(root, file) -> platform separator;
    // assert with path.join so it holds on Windows (\\ ) and POSIX (/).
    expect(r.stderr).toContain(path.join("scripts", "foo.sh"))
  })

  it("MUTATION (fragile layer, --dir target): a [^ -~] range in a SYNTHETIC e2e spec fails layer 3 via FRAGILE_SCAN_DIRS", () => {
    // The gap this closes: a fragile range in a playwright spec / app file
    // was invisible to the old gate-files-only scope. FRAGILE_SCAN_DIRS
    // overrides the default "e2e/ src/" targets with a synthetic tree whose
    // spec.ts carries the space-tilde range in LIVE code; the wrapper
    // forwards it to layer 3 as --dir (env passthrough, same as the proof
    // fixtures). Layers 1+2 stay clean; the aggregate exit must be 1.
    const dir = createTempDir("verify-encoding-fragile-dir-")
    const specDir = path.join(dir, "e2e")
    fs.mkdirSync(specDir, { recursive: true })
    writeSh(
      specDir,
      "dirty.spec.ts",
      "import { test } from '@playwright/test'\ntest('x', () => { console.log(/[^ -~]/) })\n",
    )

    const r = runGate(["--ci", "src/"], { FRAGILE_SCAN_DIRS: dir })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("check-utf8: done (all clean)")
    expect(r.stdout).toContain("verify-ascii-proof: done (all clean)")
    expect(r.stderr).toContain("fragile-range:")
    expect(r.stderr).toContain("space-tilde character range")
    expect(r.stderr).toContain(path.join("e2e", "dirty.spec.ts"))
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
