#!/usr/bin/env node
/**
 * encoding-surface.mjs - the versioned ENCODING-SURFACE MANIFEST.
 *
 * Single source of truth for "who scans what" across the encoding gates.
 * WHY THIS EXISTS (read before you hardcode a surface list in a wrapper):
 *   the gates' scan surfaces used to be defined in THREE places that could
 *   silently drift - check-utf8.sh hardcoded its always-scanned fixed dirs
 *   inline, verify-ascii-proof.sh hardcoded its VPS/OPS glob patterns
 *   inline, and docs/ascii-safe.md documented the matrix in prose. Adding a
 *   dir/pattern meant editing script + doc, and nothing enforced they
 *   stayed in sync. This module is the canonical list, in the SAME pattern
 *   as fragile-range-patterns.mjs TARGET_DIRS: export the arrays, expose
 *   --print-* query modes, and every shell wrapper DERIVES its args from
 *   the module - there is no second copy to keep in sync. The matrix in
 *   docs/ascii-safe.md references this module as the source of truth.
 *
 * API (importable - entry-point guarded):
 *   import {
 *     ALWAYS_SCAN_DIRS, VPS_SH_PATTERNS, OPS_SH_PATTERNS,
 *     YAML_GATE_PATTERNS, MJS_GATE_PATTERNS, DOCS_PATTERNS,
 *   } from "./encoding-surface.mjs"
 *
 *   ALWAYS_SCAN_DIRS    dirs check-utf8.sh ALWAYS scans (not overridable
 *                       by a positional arg) for .ts/.tsx/.sh validity
 *   VPS_SH_PATTERNS     verify-ascii-proof.sh VPS (VPS-bound .sh) globs
 *   OPS_SH_PATTERNS     verify-ascii-proof.sh OPS (ops .sh + hooks) globs
 *                       (the scripts/*.sh exclusion of health-check.sh is a
 *                       SHELL semantic - VPS-bound, not ops - kept in the
 *                       wrapper, not here)
 *   YAML_GATE_PATTERNS  verify-encoding.sh layer 4 (YAML gate files)
 *                       git-ls-files globs - the BLOCKING --utf8 scan
 *   MJS_GATE_PATTERNS   verify-encoding.sh layer 5 (scripts/*.mjs gate
 *                       files) git-ls-files globs - the BLOCKING --report
 *                       pure-ASCII scan. The .mjs gate files carry CLI
 *                       output + docblocks: a stray accent/emoji/em-dash
 *                       in them is the same silent-failure class as a .sh
 *                       (the 2026-08 conversion that ASCII-fied the .sh
 *                       files never reached the .mjs - layer 5 closes it).
 *   DOCS_PATTERNS       check-docs-encoding.sh + pr-check.yml docs-encoding
 *                       job git-ls-files globs (informational docs surface)
 *
 * CLI (what gates call - STANDALONE ONLY, one flag per invocation):
 *   node scripts/encoding-surface.mjs --print-always-dirs
 *     prints ALWAYS_SCAN_DIRS.join(" ")  ->  e.g. "scripts .github/workflows .zscripts"
 *   node scripts/encoding-surface.mjs --print-vps-sh
 *     prints VPS_SH_PATTERNS.join(" ")
 *   node scripts/encoding-surface.mjs --print-ops-sh
 *     prints OPS_SH_PATTERNS.join(" ")
 *   node scripts/encoding-surface.mjs --print-yaml-gate
 *     prints YAML_GATE_PATTERNS.join(" ")
 *   node scripts/encoding-surface.mjs --print-mjs-gate
 *     prints MJS_GATE_PATTERNS.join(" ")
 *   node scripts/encoding-surface.mjs --print-docs
 *     prints DOCS_PATTERNS.join(" ")
 *   Combining print flags (or passing a scan flag) is a usage error
 *   (exit 2) - same no-silent-ignore posture the wrappers keep for --sync.
 *   Any wrapper that derives from this module must FAIL LOUDLY (exit 2) if
 *   the derivation comes back empty: a gate must never silently degrade to
 *   scanning fewer surfaces than the manifest declares.
 *
 * Exit codes: 0 = printed a surface - 2 = usage error (wrong/missing flag).
 */
import { pathToFileURL } from "node:url"

export const ALWAYS_SCAN_DIRS = ["scripts", ".github/workflows", ".zscripts"]
export const VPS_SH_PATTERNS = ["scripts/health-check.sh", "*.sh"]
export const OPS_SH_PATTERNS = ["scripts/*.sh", ".husky/pre-commit", ".husky/pre-push"]
export const YAML_GATE_PATTERNS = [".github/workflows/*.yml", ".github/actions/*/action.yml"]
export const MJS_GATE_PATTERNS = ["scripts/*.mjs"]
export const DOCS_PATTERNS = ["*.md", "*.css", "*.html"]

// Query mode -> exported surface array (module exports are NOT on
// globalThis, so a lookup map is required).
const QUERIES = {
  "--print-always-dirs": ALWAYS_SCAN_DIRS,
  "--print-vps-sh": VPS_SH_PATTERNS,
  "--print-ops-sh": OPS_SH_PATTERNS,
  "--print-yaml-gate": YAML_GATE_PATTERNS,
  "--print-mjs-gate": MJS_GATE_PATTERNS,
  "--print-docs": DOCS_PATTERNS,
}

function main() {
  const args = process.argv.slice(2)
  if (args.length !== 1 || !(args[0] in QUERIES)) {
    console.error(
      "usage: node scripts/encoding-surface.mjs <--print-always-dirs|--print-vps-sh|--print-ops-sh|--print-yaml-gate|--print-mjs-gate|--print-docs>",
    )
    process.exit(2)
  }
  console.log(QUERIES[args[0]].join(" "))
}

// Entry-point guard: only run the CLI when executed directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
