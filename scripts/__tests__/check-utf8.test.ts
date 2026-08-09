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
import { TARGET_DIRS, filesInDir } from "../fragile-range-patterns.mjs"

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
  }, 60000)

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
  }, 60000)

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
  }, 60000)

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
  }, 60000)

  it("CONTRACT: standalone delegation derives the fragile scan's --dir targets from the module's TARGET_DIRS (no hardcoded list)", () => {
    // A standalone check-utf8.sh must scan the SAME executable-code surface
    // as verify-encoding.sh layer 3: the fragile scan's --dir targets come
    // from fragile-range-patterns.mjs TARGET_DIRS (--print-target-dirs),
    // not from a second hardcoded "e2e/ src/" list here. Proof: the
    // delegated verdict must count exactly the code files under the
    // module's TARGET_DIRS trees (computed from the module's own exports).
    const expected = TARGET_DIRS.reduce(
      (n, d) => n + filesInDir(path.join(process.cwd(), d)).length,
      0,
    )
    expect(expected).toBeGreaterThan(0)
    const r = runShDelegated()
    expect(r.status).toBe(0)
    // Verdict shape: "fragile-range: clean (109 gate files + N target files, ...)".
    // `files?` future-proofs the singular "target file" if a tree ever
    // shrinks to exactly one code file.
    expect(r.stdout).toMatch(new RegExp(`\\+ ${expected} target files?`))
  }, 60000)

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
  }, 60000)

  it("check-utf8.sh --ascii is accepted as a no-op (repo-wide ASCII is always-on via the proof)", () => {
    // The flag no longer triggers a local scan: pure-ASCII lives in the
    // delegated proof. It must neither error nor skip the UTF-8 layer.
    const dir = createTempDir("check-utf8-ascii-noop-")
    writeFile(dir, "clean.sh", "#!/usr/bin/env bash\necho 'ok'\n")

    const r = runSubprocess({ command: "bash", args: [SH_SCRIPT, "--ascii", "--ci", dir] })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("check-utf8: done (all clean)")
  }, 60000)

  it("check_utf8.py REJECTS --ascii with exit 2 (flag removed, delegated to Node)", () => {
    const dir = createTempDir("check-utf8-ascii-dead-")
    writeFile(dir, "clean.sh", "#!/usr/bin/env bash\necho 'ok'\n")

    const r = scan(dir, "--ascii", "--ci")
    expect(r.status).toBe(2)
    expect(r.stdout).toContain("--ascii was removed")
  }, 60000)

  it("--fix replaces byte 0x97 with a UTF-8 em dash", () => {
    const dir = createTempDir("check-utf8-fix-")
    const p = writeFile(dir, "emdash.sh", Buffer.from([0x23, 0x20, 0x97, 0x0a]))

    const r = scan(dir, "--fix")
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("FIXED")

    const fixed = fs.readFileSync(p)
    expect(fixed.equals(Buffer.from("# \u2014\n", "utf8"))).toBe(true)
  }, 60000)

  it("accepts individual FILES as args (UTF-8 validity side)", () => {
    const dir = createTempDir("check-utf8-file-")
    const clean = writeFile(dir, "vps.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const dirty = writeFile(dir, "vps-emdash.sh", Buffer.from([0x23, 0x20, 0x97, 0x0a]))

    const ok = scan(clean, "--ci")
    expect(ok.status).toBe(0)

    const bad = scan(dirty, "--ci")
    expect(bad.status).toBe(1)
    expect(bad.stdout).toContain("vps-emdash.sh")
  }, 60000)

  it("reports a truncated multi-byte sequence at EOF cleanly (no IndexError)", () => {
    const dir = createTempDir("check-utf8-trunc-")
    // Ends with a partial 3-byte UTF-8 sequence (start of an em dash, then EOF).
    // Regression: the manual byte walker used to crash with IndexError here.
    writeFile(dir, "trunc.sh", Buffer.from([0x23, 0x20, 0xe2, 0x80]))

    const r = scan(dir, "--ci")
    expect(r.status).toBe(1)
    expect(r.stdout).not.toContain("IndexError")
    expect(r.stdout).toContain("trunc.sh")
  }, 60000)

  it("exits 2 when a directory does not exist", () => {
    const missing = path.join(os.tmpdir(), `check-utf8-missing-${Date.now()}`)
    const r = scan(missing, "--ci")
    expect(r.status).toBe(2)
  }, 60000)
})

describe("check_utf8.py --ext (on-demand doc audit)", () => {
  it("OPT-IN: a dirty .md is NOT scanned without --ext (default contract unchanged)", () => {
    const dir = createTempDir("check-utf8-ext-optin-")
    writeFile(dir, "dirty.md", Buffer.from([0x23, 0x20, 0x97, 0x0a]))

    const r = scan(dir, "--ci")
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("Scanned: 0")
  }, 60000)

  it("--ext md scans .md: accented doc is clean, byte-0x97 doc fails under --ci", () => {
    const dir = createTempDir("check-utf8-ext-md-")
    writeFile(dir, "legit.md", "## Olá — título\n")
    writeFile(dir, "corrupt.md", Buffer.from([0x23, 0x20, 0x97, 0x0a]))

    const r = scan(dir, "--ext", "md", "--ci")
    expect(r.status).toBe(1)
    // Label reflects the opt-in extension (no .sh here): .ts/.tsx/.md
    expect(r.stdout).toContain("Scanned: 2 .ts/.tsx/.md files")
    expect(r.stdout).toContain("corrupt.md")
    expect(r.stdout).not.toContain("legit.md") // accented doc IS valid UTF-8
  }, 60000)

  it("--ext accepts comma-separated AND repeated values (md,css + --ext html)", () => {
    const dir = createTempDir("check-utf8-ext-multi-")
    writeFile(dir, "a.md", Buffer.from([0x23, 0x20, 0x97, 0x0a]))
    writeFile(dir, "b.css", Buffer.from([0x23, 0x20, 0x97, 0x0a]))
    writeFile(dir, "c.html", Buffer.from([0x23, 0x20, 0x97, 0x0a]))

    const r = scan(dir, "--ext", "md,css", "--ext", "html", "--ci")
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("a.md")
    expect(r.stdout).toContain("b.css")
    expect(r.stdout).toContain("c.html")
  }, 60000)

  it("--ext with a leading dot is normalized (--ext .md == --ext md)", () => {
    const dir = createTempDir("check-utf8-ext-dot-")
    writeFile(dir, "doc.md", Buffer.from([0x23, 0x20, 0x97, 0x0a]))

    const r = scan(dir, "--ext", ".md", "--ci")
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("doc.md")
  }, 60000)

  it("--ext without a value exits 2 with a clear error", () => {
    const dir = createTempDir("check-utf8-ext-noval-")
    writeFile(dir, "doc.md", "clean\n")

    const r = scan(dir, "--ext")
    expect(r.status).toBe(2)
    expect(r.stdout).toContain("--ext requires")
  }, 60000)

  it("--ext keeps .sh semantics: a dirty .sh still fails alongside a doc audit", () => {
    const dir = createTempDir("check-utf8-ext-sh-")
    writeFile(dir, "bad.sh", Buffer.from([0x23, 0x20, 0x97, 0x0a]))
    writeFile(dir, "doc.md", "## fine\n")

    const r = scan(dir, "--ext", "md", "--ci")
    expect(r.status).toBe(1)
    // Both kinds scanned: .sh label appears alongside the opt-in .md
    expect(r.stdout).toContain("Scanned: 2 .ts/.tsx/.sh/.md files")
    expect(r.stdout).toContain("bad.sh")
  }, 60000)
})

describe("check-utf8.sh -- .zscripts fixed dir (workspace-agent ops scripts, 2026-08)", () => {
  // .zscripts/*.sh are workspace-agent operational scripts whose banners are
  // legit CJK (Chinese comments + emoji) - deliberately OUT of the strict
  // ASCII proof (an ASCII gate would false-fail them; see docs/ascii-safe.md
  // 'Who protects .zscripts and the YAML gate files?'). Their encoding
  // contract is VALID UTF-8, enforced HERE by the wrapper's always-scanned
  // fixed dirs (scripts/, .github/workflows/, .zscripts/ - not overridable
  // by a positional dir). These tests are hermetic: they run from a temp CWD
  // mirroring the fixed-dir structure, so the wiring is proven without
  // touching the real repo. VERIFY_ENCODING_LAYER1=1 skips the proof/fragile
  // delegation (the LAYER-1 pattern) so the python layer alone decides.

  function runFromTempCwd(zscriptContent: Buffer | string): { status: number | null; stdout: string } {
    const cwd = createTempDir("check-utf8-zscripts-cwd-")
    // Mirror the wrapper's always-scanned fixed dirs (they must EXIST when
    // the python layer resolves them relative to CWD).
    fs.mkdirSync(path.join(cwd, "scripts"), { recursive: true })
    fs.mkdirSync(path.join(cwd, ".github", "workflows"), { recursive: true })
    const zs = path.join(cwd, ".zscripts")
    fs.mkdirSync(zs, { recursive: true })
    writeFile(zs, "build.sh", zscriptContent)

    // A clean positional fixture replaces the default src/ dir.
    const fixture = createTempDir("check-utf8-zscripts-fixture-")
    writeFile(fixture, "ok.ts", "export const ok = 1;\n")

    return runSubprocess({
      command: "bash",
      args: [SH_SCRIPT, "--ci", fixture],
      cwd,
      env: { VERIFY_ENCODING_LAYER1: "1" },
    })
  }

  it("CONTRACT: .zscripts is always scanned - a corrupt .sh there fails the gate", () => {
    // Byte 0x97 in .zscripts/build.sh (raw Windows-1252 em dash). Because
    // .zscripts is in the fixed dirs, the python layer must find it and fail
    // under --ci - even though the positional fixture is clean.
    const r = runFromTempCwd(Buffer.from([0x23, 0x20, 0x97, 0x0a]))
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("0x97")
    expect(r.stdout).toContain("build.sh")
    expect(r.stdout).toContain(".zscripts")
  }, 60000)

  it("CONTRACT: a legit CJK banner in .zscripts passes (valid UTF-8 is the contract, not ASCII)", () => {
    // The banner mirrors the real .zscripts style: Chinese comment + emoji,
    // all valid UTF-8. The gate must NOT flag it (ASCII strictness is
    // deliberately NOT applied to .zscripts - only corruption is).
    const cjk = Buffer.from("#!/bin/bash\n# 将 stderr 重定向到 stdout\necho '🚀 开始批量构建...'\n", "utf8")
    const r = runFromTempCwd(cjk)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("check-utf8: done (all clean)")
  }, 60000)
})
