#!/usr/bin/env bash
# =============================================================================
# fix-encoding.sh - scan and fix encoding for ALL project files
#
# Checks for byte 0x97 (Windows-1252 em dash) and other non-UTF-8 bytes in:
#   .ts, .tsx, .md, .json, .yml, .yaml
#
# Usage:
#   ./scripts/fix-encoding.sh               # scan + report (src/)
#   ./scripts/fix-encoding.sh --fix          # auto-fix byte 0x97
#   ./scripts/fix-encoding.sh --dry-run      # show what would be fixed
#   ./scripts/fix-encoding.sh --ci           # exit 1 on any issue
#   ./scripts/fix-encoding.sh .              # scan current directory
#
# Exit codes:
#   0 - all files are valid UTF-8
#   1 - at least one file has invalid UTF-8 (--ci mode)
#   2 - directory not found
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEARCH_DIR="${1:-src}"
FIX_MODE=false
DRY_RUN=false
CI_MODE=false

for arg in "$@"; do
  case "$arg" in
    --fix)     FIX_MODE=true ;;
    --dry-run) DRY_RUN=true ;;
    --ci)      CI_MODE=true ;;
  esac
done

for arg in "$@"; do
  if [ "$arg" != "--fix" ] && [ "$arg" != "--dry-run" ] && [ "$arg" != "--ci" ] && [ -d "$arg" ]; then
    SEARCH_DIR="$arg"
  fi
done

if [ ! -d "$SEARCH_DIR" ]; then
  echo "ERROR: directory '$SEARCH_DIR' does not exist"
  exit 2
fi

echo "=== fix-encoding.sh ==="
echo "  Scanning: $SEARCH_DIR"
if $FIX_MODE;  then echo "  Mode:     FIX"; fi
if $DRY_RUN;   then echo "  Mode:     DRY-RUN"; fi
if $CI_MODE;   then echo "  Mode:     CI"; fi
echo ""

# Export so the Python heredoc can read them
export SEARCH_DIR FIX_MODE DRY_RUN CI_MODE

python3 << 'PYEOF'
import os, sys

search_dir = os.environ.get('SEARCH_DIR', 'src')
fix_mode = os.environ.get('FIX_MODE') == 'true'
dry_run = os.environ.get('DRY_RUN') == 'true'
ci_mode = os.environ.get('CI_MODE') == 'true'

EXTENSIONS = {'.ts', '.tsx', '.md', '.json', '.yml', '.yaml'}
BYTE_0x97 = bytes([0x97])
EM_DASH = bytes([0xe2, 0x80, 0x94])

total = 0
by_ext = {}
bad_files = []
fixed_files = []
warn_files = []

for root, _dirs, files in os.walk(search_dir):
    skip_dirs = ['/node_modules/', '/.git/', '/.next/', '/.freebuff/']
    if any(d in root for d in skip_dirs):
        continue

    for fname in files:
        ext = os.path.splitext(fname)[1].lower()
        if ext not in EXTENSIONS:
            continue

        total += 1
        by_ext[ext] = by_ext.get(ext, 0) + 1
        fp = os.path.join(root, fname)

        try:
            with open(fp, 'rb') as f:
                data = f.read()
        except (OSError, PermissionError):
            continue

        # Valid UTF-8 = clean (byte 0x97 would be a valid continuation byte)
        try:
            data.decode('utf-8')
            continue
        except UnicodeDecodeError:
            pass

        # Invalid UTF-8. Check if byte 0x97 is the cause.
        has_0x97 = BYTE_0x97 in data

        if has_0x97:
            if dry_run:
                print("  WOULD FIX: " + fp)
                warn_files.append(fp)
            elif fix_mode:
                fixed = data.replace(BYTE_0x97, EM_DASH)
                try:
                    fixed.decode('utf-8')
                    with open(fp, 'wb') as f:
                        f.write(fixed)
                    print("  FIXED:    " + fp)
                    fixed_files.append(fp)
                except UnicodeDecodeError:
                    print("  PARTIAL:  " + fp)
                    bad_files.append(fp)
            else:
                print("  WARNING:  " + fp)
                warn_files.append(fp)
        else:
            print("  INVALID:  " + fp)
            bad_files.append(fp)

print()
print("---")
print("  Scanned: %d files" % total)
for ext in sorted(by_ext.keys()):
    print("    %-6s %3d" % (ext, by_ext[ext]))
print()

has_issues = bool(bad_files) or (ci_mode and bool(warn_files)) or (dry_run and bool(warn_files))

if dry_run and warn_files:
    print("  Dry-run: %d file(s) would be fixed" % len(warn_files))
    for f in warn_files:
        print("           - " + f)

if not has_issues and not fixed_files:
    print("  Status:  OK - all valid UTF-8")
    sys.exit(0)

if ci_mode and warn_files:
    print("  Warnings: %d file(s) with byte 0x97" % len(warn_files))
    for f in warn_files:
        print("           - " + f)

if bad_files:
    print("  Failed:  %d file(s)" % len(bad_files))
    for f in bad_files:
        print("           - " + f)

if fixed_files:
    print("  Fixed:   %d file(s)" % len(fixed_files))
    for f in fixed_files:
        print("           - " + f)

if ci_mode and warn_files:
    sys.exit(1)
if bad_files:
    sys.exit(1)
sys.exit(0)
PYEOF

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "fix-encoding: done (all clean)"
else
  echo "fix-encoding: FAILED"
fi

exit $EXIT_CODE
