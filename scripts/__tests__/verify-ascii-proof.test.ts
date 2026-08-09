/**
 * verify-ascii-proof.test.ts - behavior tests for scripts/verify-ascii-proof.sh
 * (the versioned audit that turns the manual PCRE proof into a CI step).
 *
 * The gate is STRICT and repo-wide: every .sh (VPS-bound + ops) and the
 * .husky hooks must be PURE ASCII - no VPS/locale mojibake, no exceptions.
 * The ops scripts' accented banners were transliterated to ASCII in 2026-08,
 * so the old ACCENTED tolerance tier is gone.
 *
 * Fixtures are injected via the VPS_SH_FILES / OPS_SH_FILES env overrides
 * (space-separated absolute paths), so the suite never touches real repo
 * files and the defaults (real repo lists) are only exercised by the
 * integration test below.
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"

const ROOT = process.cwd()
const SCRIPT = path.join(ROOT, "scripts", "verify-ascii-proof.sh")

function runProof(opts: {
  vps?: string[]
  ops?: string[]
  baseline?: string
  sync?: boolean
}): { status: number | null; stdout: string; stderr: string } {
  const r = runSubprocess({
    command: "bash",
    args: [SCRIPT, ...(opts.sync ? ["--sync"] : [])],
    env: {
      ...(opts.vps ? { VPS_SH_FILES: opts.vps.join(" ") } : {}),
      ...(opts.ops ? { OPS_SH_FILES: opts.ops.join(" ") } : {}),
      ...(opts.baseline ? { ASCII_BASELINE_FILE: opts.baseline } : {}),
    },
  })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

/** Build a minimal baseline manifest (VPS + OPS sections) for fixtures. */
function writeBaseline(dir: string, vps: string[], ops: string[]): string {
  const p = path.join(dir, "ascii-safe.md")
  const block = [
    "<!-- ASCII-BASELINE:VPS -->",
    ...vps,
    "<!-- ASCII-BASELINE:OPS -->",
    ...ops,
    "<!-- ASCII-BASELINE:END -->",
  ].join("\n")
  fs.writeFileSync(p, `# fixture baseline\n\n${block}\n`)
  return p
}

function writeSh(dir: string, name: string, content: Buffer | string): string {
  const p = path.join(dir, name)
  fs.writeFileSync(p, content)
  return p
}

afterEach(() => {
  cleanupTempDirs()
})

describe("verify-ascii-proof.sh", () => {
  it("script is syntactically valid bash (bash -n)", () => {
    const r = runSubprocess({ command: "bash", args: ["-n", SCRIPT] })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe("")
  }, 60000)

  it(
    "PROOF: the real repo run exits 0 - all .sh AND the .husky hooks are pure ASCII",
    () => {
      // No env overrides -> the script scans the repo defaults: health-check.sh
      // + root *.sh (VPS-bound), all ops .sh + .husky hooks. Exercises the full
      // real-repo path, so allow a generous timeout.
      const r = runProof({})
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("verify-ascii-proof: done (all clean)")
      expect(r.stdout).toContain("[ASCII-OK]   scripts/health-check.sh")
      expect(r.stdout).toContain("[ASCII-OK]   keep-alive.sh")
      // The hooks are part of the strict repo-wide audit now.
      expect(r.stdout).toContain("[ASCII-OK]   .husky/pre-commit")
      expect(r.stdout).toContain("[ASCII-OK]   .husky/pre-push")
      expect(r.stdout).toContain("Verdict: ASCII-safe state PROVEN")
    },
    60000,
  )

  it("clean fixtures: both categories listed as pure ASCII", () => {
    const dir = createTempDir("verify-ascii-proof-clean-")
    const vps = writeSh(dir, "vps.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const ops = writeSh(dir, "ops.sh", "#!/usr/bin/env bash\necho 'ok'\n")

    const r = runProof({ vps: [vps], ops: [ops] })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain(`[ASCII-OK]   ${vps}`)
    expect(r.stdout).toContain(`[ASCII-OK]   ${ops}`)
  }, 60000)

  it("MUTATION: a VPS-bound .sh with a raw 0x97 byte fails the proof and is listed", () => {
    // Exactly the byte the broken `[^ -~]` grep let through in 2026-08.
    const dir = createTempDir("verify-ascii-proof-mut-")
    const dirty = writeSh(dir, "dirty.sh", Buffer.from([0x23, 0x21, 0x0a, 0x97, 0x0a]))
    const ops = writeSh(dir, "ops.sh", "#!/usr/bin/env bash\necho 'ok'\n")

    const r = runProof({ vps: [dirty], ops: [ops] })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`[VIOLATION]  ${dirty}`)
    expect(r.stdout).toContain("VPS-bound violations:")
  }, 60000)

  it("STRICT: an ops .sh with valid UTF-8 accents now FAILS (no more ACCENTED tolerance)", () => {
    const dir = createTempDir("verify-ascii-proof-accent-")
    const vps = writeSh(dir, "vps.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const ops = writeSh(dir, "ops.sh", "#!/usr/bin/env bash\necho 'olá - banner'\n")

    const r = runProof({ vps: [vps], ops: [ops] })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`[VIOLATION]  ${ops}`)
    expect(r.stdout).toContain("Ops/hook violations:")
  }, 60000)

  it("ops .sh with invalid UTF-8 (raw 0x97) fails the proof", () => {
    const dir = createTempDir("verify-ascii-proof-badutf-")
    const vps = writeSh(dir, "vps.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const ops = writeSh(dir, "ops.sh", Buffer.from([0x23, 0x21, 0x0a, 0x97, 0x0a]))

    const r = runProof({ vps: [vps], ops: [ops] })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`[VIOLATION]  ${ops}`)
    expect(r.stdout).toContain("Ops/hook violations:")
  }, 60000)

  it("a missing listed file fails the proof (no silent skip)", () => {
    const dir = createTempDir("verify-ascii-proof-missing-")
    const vps = writeSh(dir, "vps.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const ops = path.join(dir, "does-not-exist.sh")

    const r = runProof({ vps: [vps], ops: [ops] })
    expect(r.status).toBe(1)
  }, 60000)

  it("BASELINE: a matching manifest passes and reports the registered count", () => {
    const dir = createTempDir("verify-ascii-proof-base-ok-")
    const vps = writeSh(dir, "vps.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const ops = writeSh(dir, "ops.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const baseline = writeBaseline(dir, [vps], [ops])

    const r = runProof({ vps: [vps], ops: [ops], baseline })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("Baseline OK")
    expect(r.stdout).toContain("2 files registered")
  }, 60000)

  it("BASELINE-DRIFT: a NEW audited file not in the manifest FAILS (the contract bites)", () => {
    const dir = createTempDir("verify-ascii-proof-drift-")
    const vps = writeSh(dir, "vps.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const ops1 = writeSh(dir, "ops1.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const ops2 = writeSh(dir, "ops2.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const baseline = writeBaseline(dir, [vps], [ops1]) // ops2 NOT registered

    const r = runProof({ vps: [vps], ops: [ops1, ops2], baseline })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("[BASELINE-DRIFT]")
    expect(r.stdout).toContain(ops2)
  }, 60000)

  it("BASELINE-DRIFT: a manifest entry no longer audited FAILS", () => {
    const dir = createTempDir("verify-ascii-proof-stale-")
    const vps = writeSh(dir, "vps.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const ops = writeSh(dir, "ops.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const baseline = writeBaseline(dir, [vps], [ops, path.join(dir, "removed.sh")])

    const r = runProof({ vps: [vps], ops: [ops], baseline })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("[BASELINE-DRIFT]")
  }, 60000)

  it("SYNC: --sync regenerates the manifest from the fixture lists, then the proof passes", () => {
    const dir = createTempDir("verify-ascii-proof-sync-")
    const vps = writeSh(dir, "vps.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const ops = writeSh(dir, "ops.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const baseline = path.join(dir, "ascii-safe.md")
    fs.writeFileSync(baseline, "# auto baseline\n\n<!-- ASCII-BASELINE:VPS -->\n<!-- ASCII-BASELINE:OPS -->\n<!-- ASCII-BASELINE:END -->\n")

    const sync = runProof({ vps: [vps], ops: [ops], baseline, sync: true })
    expect(sync.status).toBe(0)
    expect(sync.stdout).toContain("2 files registered")

    // The manifest now registers both fixtures -> the check passes.
    const r = runProof({ vps: [vps], ops: [ops], baseline })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("Baseline OK")
    expect(r.stdout).toContain("2 files registered")
  }, 60000)

  it("CRLF-TOLERANT: a baseline saved with CRLF line endings does NOT false-fail a clean repo", () => {
    // docs/ascii-safe.md is a COMMITTED file parsed by the script. A CRLF-
    // converted copy (editor save, autocrlf=true checkout) must not break the
    // comparison - this is the same committed-file-parsing class hardened in
    // bundle-report / golden-copy-utils (normalizeCrlf).
    const dir = createTempDir("verify-ascii-proof-crlf-")
    const vps = writeSh(dir, "vps.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const ops = writeSh(dir, "ops.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const baseline = writeBaseline(dir, [vps], [ops]).replace(/\//g, "/")
    // Rewrite the manifest with CRLF endings (\r\n between entries).
    const block = [
      "<!-- ASCII-BASELINE:VPS -->",
      vps,
      "<!-- ASCII-BASELINE:OPS -->",
      ops,
      "<!-- ASCII-BASELINE:END -->",
    ].join("\r\n")
    fs.writeFileSync(baseline, `# fixture baseline\r\n\r\n${block}\r\n`)

    const r = runProof({ vps: [vps], ops: [ops], baseline })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("Baseline OK")
  }, 60000)

  it("SYNC-GUARD: --sync refuses a baseline with no manifest markers (no silent no-op)", () => {
    const dir = createTempDir("verify-ascii-proof-nomark-")
    const vps = writeSh(dir, "vps.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const ops = writeSh(dir, "ops.sh", "#!/usr/bin/env bash\necho 'ok'\n")
    const baseline = path.join(dir, "ascii-safe.md")
    fs.writeFileSync(baseline, "# hand-written baseline WITHOUT markers\n")

    const sync = runProof({ vps: [vps], ops: [ops], baseline, sync: true })
    expect(sync.status).toBe(2)
    // The guard error goes to stderr (the audit failure paths use stdout;
    // a --sync usage/refusal error is diagnostics, not an audit verdict).
    expect(sync.stderr).toContain("no manifest markers found")
  }, 60000)
})
