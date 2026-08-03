#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# audit-blob-crlf-history.sh — audit ALL historical blobs for CRLF
#
# WHY: the working-tree guard (check-crlf.sh) and the blob guard
# (check-blob-crlf.sh) only inspect the CURRENT index. A CRLF blob committed
# in the past reproduces CRLF on every fresh checkout of that commit — a
# permanent record is needed to confirm history is clean. This wrapper
# delegates to scripts/audit_blob_crlf_history.py (reads blob bytes via
# `git cat-file --batch` — the robust binary check; `grep $'\r'` fails
# silently on Git Bash/Windows MSYS pipes).
#
# Usage:
#   ./scripts/audit-blob-crlf-history.sh            # gate: .sh/.bash apenas
#   ./scripts/audit-blob-crlf-history.sh --all-text # report: tipos do .gitattributes
#   ./scripts/audit-blob-crlf-history.sh --extensions .md,.ts,.yml
#   bun run audit:blob-crlf-history                 # gate via package.json
#   bun run audit:blob-crlf-history:all-text        # report via package.json
#
# SCOPE: default .sh/.bash (gate de CI — CRLF quebra bash em containers
# Linux). --all-text audita TODOS os tipos com eol=lf no .gitattributes em
# modo REPORT (exit 0 sempre): mapeia o alcance real de CRLF em blobs
# commitados antes do .gitattributes sem virar gate (CRLF em .md/.ts/.yml
# não quebra toolchain — prettier normaliza).
#
# Env: CHECK_CRLF_ROOT — optional repo root override (used by tests).
#
# Exit codes: 0 = clean/report, 1 = CRLF blobs found (gate mode), 2 = error
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY_SCRIPT="$SCRIPT_DIR/audit_blob_crlf_history.py"

if [ ! -f "$PY_SCRIPT" ]; then
  echo "audit-blob-crlf-history: ERROR: $PY_SCRIPT not found" >&2
  exit 2
fi

PY="python3"
command -v python3 >/dev/null 2>&1 || PY="python"

ROOT="${CHECK_CRLF_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "audit-blob-crlf-history: not inside a git work tree" >&2
  exit 2
fi

"$PY" "$PY_SCRIPT" "$@"
