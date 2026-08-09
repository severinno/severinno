/**
 * check-utf8.test.ts — behavior tests for scripts/check_utf8.py (the UTF-8
 * validity scanner behind check-utf8.sh).
 *
 * The .sh extension matters because those scripts are scp'd to the VPS and
 * executed over ssh, where the remote locale may not be UTF-8 — non-ASCII
 * bytes would render as mojibake. This script verifies VALID UTF-8 (catches
 * corruption like the byte-0x97 Windows-1252 em dash).
 *
 * Pure-ASCII enforcement is NOT this script's job anymore (2026-08): it lives
 * in scripts/scan-non-ascii.mjs (canonical raw-byte scanner), invoked by
 * check-utf8.sh --ascii (repo-wide) and the always-on VPS gate. check_utf8.py
 * now REJECTS --ascii with exit 2 so the dead flag can never be silently
 * ignored — those cases are covered below, plus end-to-end runs of
 * check-utf8.sh --ascii against fixture dirs to prove the Node delegation.
 *
 * Fixtures are written to an isolated temp dir (shared temp-dir registry from
 * golden-copy-utils, cleaned in afterEach) so the suite never touches real
 * repo files.
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"

const PY_SCRIPT = path.join(process.cwd(), "scripts", "check_utf8.py")
const SH_SCRIPT = path.join(process.cwd(), "scripts", "check-utf8.sh")

/** Pick the python interpreter the repo's own gates use (python3, fallback python). */
function pythonBin(): string {
  for (const bin of ["python3", "python"]) {
    const probe = runSubprocess({ command: bin, args: ["--version"] })
    if (probe.status === 0) return bin
  }
  throw new Error("neither python3 nor python found on PATH")
}

const PYTHON = pythonBin()

/** Run the scanner against a fixture dir with the given flags. */
function scan(dir: string, ...flags: string[]): { status: number | null; stdout: string } {
  const r = runSubprocess({ command: PYTHON, args: [PY_SCRIPT, dir, ...flags] })
  return { status: r.status, stdout: r.stdout }
}

/**
 * Run check-utf8.sh against the REAL repo with proof fixtures injected via
 * VPS_SH_FILES/OPS_SH_FILES env overrides (the delegation path: check-utf8.sh
 * forwards ALL .sh ASCII to verify-ascii-proof.sh, which reads those vars).
 */
function runShDelegated(
  fixtureEnv: Record<string, string> = {},
  extraArgs: string[] = [],
): { status: number | null; stdout: string } {
  const r = runSubprocess({
    command: "bash",
    args: [SH_SCRIPT, "--ci", ...extraArgs],
    env: fixtureEnv,
  })
  return { status: r.status, stdout: r.stdout }
}

function writeFile(dir: string, name: string, content: Buffer | string): string {
  const p = path.join(dir, name)
  fs.writeFileSync(p, content)
  return p
}

afterEach(() => {
  cleanupTempDirs()
})

describe("check_utf8.py", () => {
  it("passes a clean dir (ASCII .sh + accented .ts) under --ci", () => {
    const dir = createTempDir("check-utf8-clean-")
    writeFile(dir, "clean.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    writeFile(dir, "accent.ts", "export const s = 'olá';\n")

    const r = scan(dir, "--ci")
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("Scanned: 2")
    expect(r.stdout).toContain("OK")
  })

  it("flags a byte-0x97 .sh as warning: exit 0 without --ci, exit 1 with --ci", () => {
    const dir = createTempDir("check-utf8-emdash-")
    // "# \x97\n" — raw byte 0x97 is INVALID UTF-8 (Windows-1252 em dash).
    writeFile(dir, "emdash.sh", Buffer.from([0x23, 0x20, 0x97, 0x0a]))

    const warn = scan(dir)
    expect(warn.status).toBe(0)
    expect(warn.stdout).toContain("0x97")

    const ci = scan(dir, "--ci")
    expect(ci.status).toBe(1)
    expect(ci.stdout).toContain("0x97")
  })

  it("DELEGATION: check-utf8.sh forwards .sh ASCII to the proof - an accented OPS fixture fails the gate", () => {
    const dir = createTempDir("check-utf8-delegate-")
    const vps = writeFile(dir, "vps.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const accent = writeFile(dir, "accent.sh", "echo 'olá — test'\n")

    // Python layer (real repo src/ + scripts + workflows) is clean; the
    // delegated proof audits the injected fixtures and must fail.
    const r = runShDelegated({ VPS_SH_FILES: vps, OPS_SH_FILES: accent })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("verify-ascii-proof")
    expect(r.stdout).toContain("[VIOLATION]")
    expect(r.stdout).toContain(accent)
  })

  it("DELEGATION: clean fixtures pass the delegated proof + fragile scan (exit 0)", () => {
    const dir = createTempDir("check-utf8-delegate-ok-")
    const vps = writeFile(dir, "vps.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const ops = writeFile(dir, "ops.sh", "#!/usr/bin/env bash\necho 'ok'\n")

    const r = runShDelegated({ VPS_SH_FILES: vps, OPS_SH_FILES: ops })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("check-utf8: done (all clean)")
    // Standalone delegation runs the fragile scan too (same gate, no
    // exceptions) - it must report clean on the real repo.
    expect(r.stdout).toContain("fragile-range: clean")
  })

  it("LAYER-1: VERIFY_ENCODING_LAYER1=1 skips the proof delegation (verify-encoding.sh layer 1)", () => {
    // verify-encoding.sh runs check-utf8.sh as layer 1 with this env var set
    // so the .sh ASCII audit happens exactly ONCE (as its layer 2). A dirty
    // fixture must NOT fail layer 1 - the proof is deliberately skipped.
    const dir = createTempDir("check-utf8-layer1-")
    const vps = writeFile(dir, "vps.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const accent = writeFile(dir, "accent.sh", "echo 'olá — test'\n")

    const r = runShDelegated(
      { VPS_SH_FILES: vps, OPS_SH_FILES: accent, VERIFY_ENCODING_LAYER1: "1" },
      [],
    )
    expect(r.status).toBe(0)
    expect(r.stdout).not.toContain("verify-ascii-proof")
    // The fragile-range scan (verify-encoding.sh layer 3) is ALSO delegated
    // and must not run twice under layer 1 either.
    expect(r.stdout).not.toContain("fragile-range")
    // Layer 1 still ran the python UTF-8 scan (not a silent no-op).
    expect(r.stdout).toContain("check-utf8: done (all clean)")
  })

  it("check-utf8.sh --ascii is accepted as a no-op (repo-wide ASCII is always-on via the proof)", () => {
    // The flag no longer triggers a local scan: pure-ASCII lives in the
    // delegated proof. It must neither error nor skip the UTF-8 layer.
    const dir = createTempDir("check-utf8-ascii-noop-")
    writeFile(dir, "clean.sh", "#!/usr/bin/env bash\necho 'ok'\n")

    const r = runSubprocess({ command: "bash", args: [SH_SCRIPT, "--ascii", "--ci", dir] })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("check-utf8: done (all clean)")
  })

  it("check_utf8.py REJECTS --ascii with exit 2 (flag removed, delegated to Node)", () => {
    const dir = createTempDir("check-utf8-ascii-dead-")
    writeFile(dir, "clean.sh", "#!/usr/bin/env bash\necho 'ok'\n")

    const r = scan(dir, "--ascii", "--ci")
    expect(r.status).toBe(2)
    expect(r.stdout).toContain("--ascii was removed")
  })

  it("--fix replaces byte 0x97 with a UTF-8 em dash", () => {
    const dir = createTempDir("check-utf8-fix-")
    const p = writeFile(dir, "emdash.sh", Buffer.from([0x23, 0x20, 0x97, 0x0a]))

    const r = scan(dir, "--fix")
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("FIXED")

    const fixed = fs.readFileSync(p)
    expect(fixed.equals(Buffer.from("# \u2014\n", "utf8"))).toBe(true)
  })

  it("accepts individual FILES as args (UTF-8 validity side)", () => {
    const dir = createTempDir("check-utf8-file-")
    const clean = writeFile(dir, "vps.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const dirty = writeFile(dir, "vps-emdash.sh", Buffer.from([0x23, 0x20, 0x97, 0x0a]))

    const ok = scan(clean, "--ci")
    expect(ok.status).toBe(0)

    const bad = scan(dirty, "--ci")
    expect(bad.status).toBe(1)
    expect(bad.stdout).toContain("vps-emdash.sh")
  })

  it("reports a truncated multi-byte sequence at EOF cleanly (no IndexError)", () => {
    const dir = createTempDir("check-utf8-trunc-")
    // Ends with a partial 3-byte UTF-8 sequence (start of an em dash, then EOF).
    // Regression: the manual byte walker used to crash with IndexError here.
    writeFile(dir, "trunc.sh", Buffer.from([0x23, 0x20, 0xe2, 0x80]))

    const r = scan(dir, "--ci")
    expect(r.status).toBe(1)
    expect(r.stdout).not.toContain("IndexError")
    expect(r.stdout).toContain("trunc.sh")
  })

  it("exits 2 when a directory does not exist", () => {
    const missing = path.join(os.tmpdir(), `check-utf8-missing-${Date.now()}`)
    const r = scan(missing, "--ci")
    expect(r.status).toBe(2)
  })
})
