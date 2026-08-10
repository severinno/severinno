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
 *
 * The GROWTH CONTRACT is the FORWARD direction of the same contract (the
 * mirror of the fragile-range SPREAD CONTRACT): the surface lists are LIVE
 * derivation sources, not frozen snapshots. A 5th entry in ANY array must be
 * reflected by the --print-* query (parametrized over all five arrays) and -
 * for ALWAYS_SCAN_DIRS - DERIVED by the check-utf8.sh wrapper through the
 * ENCODING_SURFACE_MODULE override (the FRAGILE_MODULE pattern) scanning the
 * new tree with zero edits in any consumer. Growth is picked up by the
 * derivation itself; the ABSOLUTE PINS stay the deliberate-review tripwire.
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess, writeModuleCopy, type ModulePatchOp } from "./golden-copy-utils"
import {
  ALWAYS_SCAN_DIRS,
  DOCS_PATTERNS,
  MJS_GATE_PATTERNS,
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

const SH_SCRIPT = path.join(ROOT, "scripts", "check-utf8.sh")

/**
 * The five surface arrays keyed by their manifest name (the CLI test's
 * parametrized source of truth - never a second literal list).
 */
const SURFACES: Record<string, string[]> = {
  ALWAYS_SCAN_DIRS,
  VPS_SH_PATTERNS,
  OPS_SH_PATTERNS,
  YAML_GATE_PATTERNS,
  MJS_GATE_PATTERNS,
  DOCS_PATTERNS,
}

/** Structural declaration regex for a single-line `export const NAME = [...]`. */
function surfaceDecl(name: string): RegExp {
  return new RegExp(`^export const ${name} = \\[[^\\]]*\\]$`, "m")
}

/**
 * Write a TEMP COPY of the encoding-surface module with one surface array
 * replaced (the GROWTH CONTRACT's "5th entry" direction). Built on the SHARED
 * writeModuleCopy scaffold (golden-copy-utils.ts — the rule-of-three
 * extraction, same posture as writePatchedRoutesModule / writePatchedModule):
 * the declaration is located by STRUCTURAL SHAPE (single-line `export const
 * NAME = [...]`), so a value drift is patched onto whatever the module
 * declares today and a SHAPE drift (rename/restructure) fails LOUDLY with
 * the name instead of a silent no-op - the same fail-loudly posture as the
 * fragile-range golden copy ("update the harness when legitimately edited").
 * Returns the copy path.
 */
function writePatchedSurfaceModule(dir: string, name: string, entries: string[]): string {
  const ops: ModulePatchOp[] = [
    {
      anchor: surfaceDecl(name),
      replace: `export const ${name} = ${JSON.stringify(entries)}`,
      onMissing: `GROWTH CONTRACT: could not locate the ${name} declaration in encoding-surface.mjs (single-line shape changed) - update this harness`,
    },
  ]
  return writeModuleCopy(dir, MODULE, ops)
}

afterEach(() => {
  cleanupTempDirs()
})

describe("encoding-surface.mjs - versioned encoding-surface manifest", () => {
  it("module is syntactically valid (node --check)", () => {
    const r = runSubprocess({ command: "node", args: ["--check", MODULE] })
    expect(r.status).toBe(0)
  }, 60000)

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

  it("ABSOLUTE PIN: MJS_GATE_PATTERNS (verify-encoding.sh layer 5, blocking)", () => {
    // The scripts/*.mjs gate files - pure-ASCII scan (--report). The 1:1
    // ASCII conversion the .sh files got (f17ffdd) never reached the .mjs
    // (banners/emoji/accents survived until the 2026-08 conversion); layer
    // 5 closes the class.
    expect(MJS_GATE_PATTERNS).toEqual(["scripts/*.mjs"])
  })

  it("ABSOLUTE PIN: DOCS_PATTERNS (docs-encoding informational surface)", () => {
    expect(DOCS_PATTERNS).toEqual(["*.md", "*.css", "*.html"])
  })

  it("CLI: --print-always-dirs prints the space-joined ALWAYS_SCAN_DIRS", () => {
    const r = runCli("--print-always-dirs")
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe("scripts .github/workflows .zscripts")
  }, 60000)

  it("CLI: --print-vps-sh / --print-ops-sh match the exported arrays", () => {
    const vps = runCli("--print-vps-sh")
    expect(vps.status).toBe(0)
    expect(vps.stdout.trim()).toBe(VPS_SH_PATTERNS.join(" "))
    const ops = runCli("--print-ops-sh")
    expect(ops.status).toBe(0)
    expect(ops.stdout.trim()).toBe(OPS_SH_PATTERNS.join(" "))
  }, 60000)

  it("CLI: --print-yaml-gate / --print-mjs-gate / --print-docs match the exported arrays", () => {
    const yaml = runCli("--print-yaml-gate")
    expect(yaml.status).toBe(0)
    expect(yaml.stdout.trim()).toBe(YAML_GATE_PATTERNS.join(" "))
    const mjs = runCli("--print-mjs-gate")
    expect(mjs.status).toBe(0)
    expect(mjs.stdout.trim()).toBe(MJS_GATE_PATTERNS.join(" "))
    const docs = runCli("--print-docs")
    expect(docs.status).toBe(0)
    expect(docs.stdout.trim()).toBe(DOCS_PATTERNS.join(" "))
  }, 60000)

  it("CLI: zero flags is a usage error (exit 2, no silent default)", () => {
    const r = runCli()
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("usage:")
  }, 60000)

  it("CLI: two print flags is a usage error (exit 2, no-silent-ignore)", () => {
    const r = runCli("--print-docs", "--print-vps-sh")
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("usage:")
  }, 60000)

  it("CONTRACT: check-utf8.sh DERIVES its fixed dirs from the manifest (no second hardcoded list)", () => {
    // The drift class this module kills: check-utf8.sh used to hardcode
    // "scripts .github/workflows .zscripts" inline. It must now call the
    // manifest query - and the python invocation must take the dirs from
    // the derived FIXED_DIR_ARR, never from literal dir names.
    const src = fs.readFileSync(path.join(ROOT, "scripts", "check-utf8.sh"), "utf8")
    // The derivation must go through the ENCODING_SURFACE_MODULE override
    // (the FRAGILE_MODULE pattern - what the GROWTH CONTRACT wrapper test
    // routes through), defaulting to the manifest next to the script.
    expect(src).toContain('ENCODING_SURFACE_MODULE="${ENCODING_SURFACE_MODULE:-$SCRIPT_DIR/encoding-surface.mjs}"')
    expect(src).toContain('node "$ENCODING_SURFACE_MODULE" --print-always-dirs')
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

  it("CONTRACT: verify-encoding.sh layer 5 DERIVES the .mjs globs from the manifest", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts", "verify-encoding.sh"), "utf8")
    expect(src).toContain('--print-mjs-gate')
    // The invocation must derive from MJS_PAT_ARR, not literal globs.
    expect(src).toContain('git ls-files "${MJS_PAT_ARR[@]}"')
    expect(src).not.toContain("mapfile -t MJS_LIST < <(git ls-files 'scripts/*.mjs'")
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

  describe("GROWTH CONTRACT (the surface lists are LIVE derivation sources, not frozen snapshots)", () => {
    // The forward mirror of the fragile-range SPREAD CONTRACT: a 5th entry
    // in ANY manifest array must be picked up by the derivation with ZERO
    // edits in any consumer. Parametrized over all five arrays + their
    // --print-* query flags - if a future surface grows, the query reflects
    // it live (the CLI joins whatever the module exports; there is no second
    // literal list to forget).
    const growthCases: Array<{ name: keyof typeof SURFACES; flag: string; sentinel: string }> = [
      { name: "ALWAYS_SCAN_DIRS", flag: "--print-always-dirs", sentinel: "workers" },
      { name: "VPS_SH_PATTERNS", flag: "--print-vps-sh", sentinel: "scripts/workers-check.sh" },
      { name: "OPS_SH_PATTERNS", flag: "--print-ops-sh", sentinel: ".husky/pre-push-extra" },
      { name: "YAML_GATE_PATTERNS", flag: "--print-yaml-gate", sentinel: ".github/workflows/worker.yml" },
      { name: "MJS_GATE_PATTERNS", flag: "--print-mjs-gate", sentinel: "scripts/workers-gate.mjs" },
      { name: "DOCS_PATTERNS", flag: "--print-docs", sentinel: "*.toml" },
    ]

    it("CLI-level: a 5th entry in ANY surface array is reflected by its --print-* query on a temp module copy", () => {
      for (const { name, flag, sentinel } of growthCases) {
        const dir = createTempDir("es-growth-cli-")
        const entries = [...SURFACES[name], sentinel]
        const modPath = writePatchedSurfaceModule(dir, name, entries)
        const r = runSubprocess({ command: "node", args: [modPath, flag] })
        expect(r.status, `${name} query on the patched module`).toBe(0)
        expect(r.stdout.trim(), `${name} must include the sentinel entry`).toBe(entries.join(" "))
      }
    }, 60000)

    it("wrapper-level: a 5th ALWAYS_SCAN_DIRS entry (temp module copy via ENCODING_SURFACE_MODULE) makes check-utf8.sh DERIVE and scan the new dir", () => {
      // The end-to-end half: check-utf8.sh derives its fixed dirs via
      // --print-always-dirs. Point ENCODING_SURFACE_MODULE at a temp COPY
      // with workers/ appended and run the REAL wrapper from a temp CWD
      // mirroring the fixed-dir structure - the python layer must scan
      // workers/ and FAIL on a corrupt .sh there. Control: the real module
      // (3 dirs) does NOT scan workers/ -> clean. VERIFY_ENCODING_LAYER1=1
      // skips the proof/fragile delegation (the established LAYER-1 pattern)
      // so only the python layer decides - fully hermetic.
      const cwd = createTempDir("es-growth-wrap-cwd-")
      fs.mkdirSync(path.join(cwd, "scripts"), { recursive: true })
      fs.mkdirSync(path.join(cwd, ".github", "workflows"), { recursive: true })
      fs.mkdirSync(path.join(cwd, ".zscripts"), { recursive: true })
      const workers = path.join(cwd, "workers") // hypothetical 5th tree
      fs.mkdirSync(workers, { recursive: true })
      // Corrupt .sh (raw byte 0x97 = Windows-1252 em dash): genuinely
      // INVALID UTF-8, so a failure can only mean the new dir WAS scanned
      // (sole-failure-source fixture).
      fs.writeFileSync(path.join(workers, "build.sh"), Buffer.from([0x23, 0x20, 0x97, 0x0a]))
      const fixture = createTempDir("es-growth-wrap-fixture-")
      fs.writeFileSync(path.join(fixture, "ok.ts"), "export const ok = 1;\n")

      // Control: the REAL manifest - workers/ is not a fixed dir -> clean.
      const control = runSubprocess({
        command: "bash",
        args: [SH_SCRIPT, "--ci", fixture],
        cwd,
        env: { VERIFY_ENCODING_LAYER1: "1" },
      })
      expect(control.status).toBe(0)
      expect(control.stdout).toContain("check-utf8: done (all clean)")
      // Sole-failure-source attribution made explicit: the dirty fixture
      // lives in workers/, so its ABSENCE from the clean verdict proves the
      // real manifest never scanned the hypothetical tree (a future
      // regression that adds workers/ to the real module flips this assert).
      expect(control.stdout).not.toContain("build.sh")

      // Mutation: temp module copy with workers/ appended -> the wrapper
      // DERIVES the new dir and the corrupt .sh fails the gate with its path.
      const modDir = createTempDir("es-growth-wrap-mod-")
      const modPath = writePatchedSurfaceModule(modDir, "ALWAYS_SCAN_DIRS", [...ALWAYS_SCAN_DIRS, "workers"])
      const mut = runSubprocess({
        command: "bash",
        args: [SH_SCRIPT, "--ci", fixture],
        cwd,
        env: { VERIFY_ENCODING_LAYER1: "1", ENCODING_SURFACE_MODULE: modPath },
      })
      expect(mut.status).toBe(1)
      expect(mut.stdout).toContain("0x97")
      expect(mut.stdout).toContain(path.join("workers", "build.sh"))
      // The gate FAILED (exit 1) - never a false "all clean": the corrupt
      // .sh in the derived 5th dir is the sole failure source, and the
      // mutation message pin makes that unambiguous in the output.
      expect(mut.stdout).not.toContain("check-utf8: done (all clean)")
    }, 60000)
  })
})
