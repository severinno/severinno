/**
 * encoding-surface.test.ts - the versioned ENCODING-SURFACE MANIFEST suite.
 *
 * Pins the single source of truth for "who scans what" across the encoding
 * gates (scripts/encoding-surface.mjs), in the same pattern as the
 * fragile-range TARGET_DIRS contract: the exported arrays ARE the contract,
 * the --print-* CLI must reflect them exactly, and every shell wrapper that
 * consumes a surface must DERIVE it from the manifest - never hardcode a
 * second copy (that was the drift class this module exists to kill).
 *
 * The ABSOLUTE PINS below are the drift guard: if anyone edits a surface in
 * the manifest, the pin fails and forces a deliberate review of every
 * consumer (the same "update the pin when legitimately edited" rule as the
 * golden-copy absolute pins).
 */
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { runSubprocess } from "./golden-copy-utils"
import {
  ALWAYS_SCAN_DIRS,
  DOCS_PATTERNS,
  OPS_SH_PATTERNS,
  VPS_SH_PATTERNS,
  YAML_GATE_PATTERNS,
} from "../encoding-surface.mjs"

const ROOT = process.cwd()
const MODULE = path.join(ROOT, "scripts", "encoding-surface.mjs")

/** Run the manifest CLI with the given args. */
function runCli(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = runSubprocess({ command: "node", args: [MODULE, ...args] })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

describe("encoding-surface.mjs - versioned encoding-surface manifest", () => {
  it("module is syntactically valid (node --check)", () => {
    const r = runSubprocess({ command: "node", args: ["--check", MODULE] })
    expect(r.status).toBe(0)
  })

  it("ABSOLUTE PIN: ALWAYS_SCAN_DIRS (check-utf8.sh fixed dirs)", () => {
    // The always-scanned dirs (not overridable by a positional arg).
    expect(ALWAYS_SCAN_DIRS).toEqual(["scripts", ".github/workflows", ".zscripts"])
  })

  it("ABSOLUTE PIN: VPS_SH_PATTERNS (verify-ascii-proof.sh VPS globs)", () => {
    expect(VPS_SH_PATTERNS).toEqual(["scripts/health-check.sh", "*.sh"])
  })

  it("ABSOLUTE PIN: OPS_SH_PATTERNS (verify-ascii-proof.sh OPS globs + hooks)", () => {
    expect(OPS_SH_PATTERNS).toEqual(["scripts/*.sh", ".husky/pre-commit", ".husky/pre-push"])
  })

  it("ABSOLUTE PIN: YAML_GATE_PATTERNS (verify-encoding.sh layer 4, blocking)", () => {
    expect(YAML_GATE_PATTERNS).toEqual([
      ".github/workflows/*.yml",
      ".github/actions/*/action.yml",
    ])
  })

  it("ABSOLUTE PIN: DOCS_PATTERNS (docs-encoding informational surface)", () => {
    expect(DOCS_PATTERNS).toEqual(["*.md", "*.css", "*.html"])
  })

  it("CLI: --print-always-dirs prints the space-joined ALWAYS_SCAN_DIRS", () => {
    const r = runCli("--print-always-dirs")
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe("scripts .github/workflows .zscripts")
  })

  it("CLI: --print-vps-sh / --print-ops-sh match the exported arrays", () => {
    const vps = runCli("--print-vps-sh")
    expect(vps.status).toBe(0)
    expect(vps.stdout.trim()).toBe(VPS_SH_PATTERNS.join(" "))
    const ops = runCli("--print-ops-sh")
    expect(ops.status).toBe(0)
    expect(ops.stdout.trim()).toBe(OPS_SH_PATTERNS.join(" "))
  })

  it("CLI: --print-yaml-gate / --print-docs match the exported arrays", () => {
    const yaml = runCli("--print-yaml-gate")
    expect(yaml.status).toBe(0)
    expect(yaml.stdout.trim()).toBe(YAML_GATE_PATTERNS.join(" "))
    const docs = runCli("--print-docs")
    expect(docs.status).toBe(0)
    expect(docs.stdout.trim()).toBe(DOCS_PATTERNS.join(" "))
  })

  it("CLI: zero flags is a usage error (exit 2, no silent default)", () => {
    const r = runCli()
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("usage:")
  })

  it("CLI: two print flags is a usage error (exit 2, no-silent-ignore)", () => {
    const r = runCli("--print-docs", "--print-vps-sh")
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("usage:")
  })

  it("CONTRACT: check-utf8.sh DERIVES its fixed dirs from the manifest (no second hardcoded list)", () => {
    // The drift class this module kills: check-utf8.sh used to hardcode
    // "scripts .github/workflows .zscripts" inline. It must now call the
    // manifest query - and the python invocation must take the dirs from
    // the derived FIXED_DIR_ARR, never from literal dir names.
    const src = fs.readFileSync(path.join(ROOT, "scripts", "check-utf8.sh"), "utf8")
    expect(src).toContain('encoding-surface.mjs" --print-always-dirs')
    expect(src).toContain('"${FIXED_DIR_ARR[@]}"')
    // The old inline arg list is gone (note: the header comment still
    // documents the dirs - the negative pin is on the INVOCATION only).
    expect(src).not.toContain('scripts .github/workflows .zscripts || EXIT_CODE=$?')
  })

  it("CONTRACT: verify-ascii-proof.sh DERIVES VPS/OPS patterns from the manifest", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts", "verify-ascii-proof.sh"), "utf8")
    expect(src).toContain('--print-vps-sh')
    expect(src).toContain('--print-ops-sh')
    // The old inline glob lists must be gone (the manifest owns the patterns).
    expect(src).not.toMatch(/VPS_LIST=\(scripts\/health-check\.sh \*\.sh\)/)
    expect(src).not.toMatch(/for f in scripts\/\*\.sh; do/)
  })

  it("CONTRACT: verify-encoding.sh layer 4 DERIVES the YAML globs from the manifest", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts", "verify-encoding.sh"), "utf8")
    expect(src).toContain('--print-yaml-gate')
    // The invocation must derive from YAML_PAT_ARR, not literal globs
    // (the header comment may still quote the surface - pin the CODE).
    expect(src).toContain('git ls-files "${YAML_PAT_ARR[@]}"')
    expect(src).not.toContain("mapfile -t YAML_LIST < <(git ls-files '.github/workflows/*.yml'")
  })

  it("CONTRACT: check-docs-encoding.sh DERIVES the docs globs from the manifest", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts", "check-docs-encoding.sh"), "utf8")
    expect(src).toContain('--print-docs')
    // The invocation must derive from DOCS_PAT_ARR, not literal globs
    // (the header comment may still quote the surface - pin the CODE).
    expect(src).toContain('git ls-files "${DOCS_PAT_ARR[@]}"')
    expect(src).not.toContain("mapfile -t FILES < <(git ls-files '*.md' '*.css' '*.html'")
  })

  it("CONTRACT: pr-check.yml docs-encoding job DERIVES the docs globs from the manifest", () => {
    const src = fs.readFileSync(path.join(ROOT, ".github", "workflows", "pr-check.yml"), "utf8")
    expect(src).toContain("encoding-surface.mjs --print-docs")
    expect(src).not.toContain("git ls-files '*.md' '*.css' '*.html'")
  })
})
