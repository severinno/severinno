#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# run-fuzz.sh
#
# Local fuzz runner (bash shim). Since the batching adoption (secao 11.12 do
# gates-proofs.md, medicao 2026-08-10), this file is a THIN WRAPPER over the
# canonical runner scripts/run-all-fuzz.mjs (single vitest invocation for all
# suites, discovery via fuzz-targets.mjs, vitest resolved locally - no
# per-file spawn, no `bunx` PATH dependency). Kept as a bash entry point so
# `bun run fuzz` keeps working unchanged.
#
# Flags, output format and exit codes are delegated 1:1 to run-all-fuzz.mjs:
#   bash scripts/run-fuzz.sh                 # run all + table output
#   bash scripts/run-fuzz.sh --json          # JSON output for CI
#   bash scripts/run-fuzz.sh --only radius   # filter by filename pattern
#   bash scripts/run-fuzz.sh --verbose       # show raw vitest output
#
# Exit codes (from run-all-fuzz.mjs):
#   0 - all fuzz tests passed
#   1 - one or more fuzz tests failed
#   2 - unexpected error
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# Delegate every flag verbatim; the Node runner owns parsing (incl. the
# space-separated `--only <pattern>` form), execution and exit code.
exec node scripts/run-all-fuzz.mjs "$@"
