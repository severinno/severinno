#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# check-utf8.sh — verify all .ts source files are valid UTF-8
#
# Delegates to scripts/check_utf8.py for safe byte-0x97 detection.
# Byte 0x97 is a valid UTF-8 continuation byte (used in 4-byte sequences
# like some emoji). The Python script DECODES the file as UTF-8 first.
# Only if the file has INVALID UTF-8 AND the invalid byte is 0x97 does it
# flag it as a Windows-1252 em dash corruption. Valid 0x97 bytes inside
# correct multi-byte sequences are never touched.
#
# Usage:
#   ./scripts/check-utf8.sh              # check all .ts in src/
#   ./scripts/check-utf8.sh --ci         # exit 1 on invalid files
#   ./scripts/check-utf8.sh --fix        # replace corrupt byte 0x97
#
# Exit codes: see check_utf8.py
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_SCRIPT="$SCRIPT_DIR/check_utf8.py"

if [ ! -f "$PYTHON_SCRIPT" ]; then
  echo "ERROR: $PYTHON_SCRIPT not found"
  exit 2
fi

echo "Scanning .ts files for UTF-8 validity..."
echo ""

python3 "$PYTHON_SCRIPT" "$@"
EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "check-utf8: done (all clean)"
elif [ $EXIT_CODE -eq 1 ]; then
  echo "check-utf8: FAILED -- invalid UTF-8 found"
else
  echo "check-utf8: ERROR"
fi

exit $EXIT_CODE
