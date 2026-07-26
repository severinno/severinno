#!/usr/bin/env python3
"""
check_utf8.py -- verify .ts/.tsx source files are valid UTF-8.

Safe byte-0x97 detection:
  Byte 0x97 is a valid UTF-8 continuation byte (used in 4-byte sequences
  like some emoji). This script DECODES the file as UTF-8 first. Only if
  the file has INVALID UTF-8 AND the invalid byte is 0x97 does it flag it
  as Windows-1252 em dash corruption. Valid 0x97 bytes inside correct
  multi-byte sequences are never touched.

Usage:
  python3 scripts/check_utf8.py              check src/
  python3 scripts/check_utf8.py [directory]  check specific dir
  python3 scripts/check_utf8.py --fix        auto-fix byte 0x97
  python3 scripts/check_utf8.py --dry-run    show what would be fixed
  python3 scripts/check_utf8.py --ci         exit 1 on any issue

Flags can be combined: --dry-run --ci

Exit codes:
  0 -- all files are valid UTF-8
  1 -- at least one file has invalid UTF-8 (--ci mode)
  2 -- directory not found
"""

import os
import sys

BYTE_0x97 = bytes([0x97])

def analyze_utf8(data):
    try:
        data.decode("utf-8")
        return ("ok", [])
    except UnicodeDecodeError:
        pass

    pos_0x97_invalid = []
    has_other_invalid = False

    i = 0
    n = len(data)
    _80, _BF = 0x80, 0xBF
    _C2, _DF = 0xC2, 0xDF
    _E0, _EF = 0xE0, 0xEF
    _F0, _F4 = 0xF0, 0xF4

    while i < n:
        b = data[i]
        if b < _80:
            i += 1
        elif _C2 <= b <= _DF:
            if i + 1 < n and _80 <= data[i+1] <= _BF:
                i += 2
            else:
                if b == 0x97 or (i+1 < n and data[i+1] == 0x97):
                    pos_0x97_invalid.append(i if b == 0x97 else i+1)
                else:
                    has_other_invalid = True
                i += 1
        elif _E0 <= b <= _EF:
            if i+2 < n and _80 <= data[i+1] <= _BF and _80 <= data[i+2] <= _BF:
                i += 3
            else:
                for j in (1, 2):
                    if i+j >= n or not (_80 <= data[i+j] <= _BF):
                        if data[i+j] == 0x97:
                            pos_0x97_invalid.append(i+j)
                        else:
                            has_other_invalid = True
                i += 1
        elif _F0 <= b <= _F4:
            if i+3 < n and _80 <= data[i+1] <= _BF and _80 <= data[i+2] <= _BF and _80 <= data[i+3] <= _BF:
                i += 4
            else:
                for j in (1, 2, 3):
                    if i+j >= n or not (_80 <= data[i+j] <= _BF):
                        if data[i+j] == 0x97:
                            pos_0x97_invalid.append(i+j)
                        else:
                            has_other_invalid = True
                i += 1
        else:
            if b == 0x97:
                pos_0x97_invalid.append(i)
            else:
                has_other_invalid = True
            i += 1

    if pos_0x97_invalid and not has_other_invalid:
        return ("warn_0x97", pos_0x97_invalid)
    elif pos_0x97_invalid and has_other_invalid:
        return ("mixed", pos_0x97_invalid)
    elif has_other_invalid:
        return ("other", [])
    else:
        return ("unknown", [])


def main():
    flags = set(sys.argv[1:])
    fix_mode = "--fix" in flags
    ci_mode = "--ci" in flags
    dry_run = "--dry-run" in flags
    search_dir = "src"

    for arg in sys.argv[1:]:
        if arg not in ("--fix", "--ci", "--dry-run"):
            search_dir = arg
            break

    if not os.path.isdir(search_dir):
        print("ERROR: directory '%s' does not exist" % search_dir)
        sys.exit(2)

    total = 0
    bad_files = []
    fixed_files = []
    warn_files = []

    EM_DASH = bytes([0xe2, 0x80, 0x94])

    for root, _dirs, files in os.walk(search_dir):
        for fname in files:
            if not (fname.endswith(".ts") or fname.endswith(".tsx")):
                continue
            total += 1
            filepath = os.path.join(root, fname)

            with open(filepath, "rb") as f:
                data = f.read()

            status, _positions = analyze_utf8(data)

            if status == "ok":
                continue

            if status == "warn_0x97":
                if dry_run:
                    print("  WOULD FIX: %s (byte 0x97 -- Windows-1252 em dash)" % filepath)
                    warn_files.append(filepath)
                elif fix_mode:
                    fixed = data.replace(BYTE_0x97, EM_DASH)
                    with open(filepath, "wb") as f:
                        f.write(fixed)
                    print("  FIXED:    %s" % filepath)
                    fixed_files.append(filepath)
                else:
                    print("  WARNING:  %s (byte 0x97 -- Windows-1252 em dash)" % filepath)
                    warn_files.append(filepath)
            elif status == "mixed":
                print("  MIXED:    %s (byte 0x97 + other invalid UTF-8)" % filepath)
                bad_files.append(filepath)
            elif status == "other":
                print("  INVALID:  %s (non-0x97 UTF-8 error)" % filepath)
                bad_files.append(filepath)
            else:
                print("  UNKNOWN:  %s (could not determine encoding issue)" % filepath)
                bad_files.append(filepath)

    print()
    print("---")
    print("  Scanned: %d .ts/.tsx files" % total)

    # Print summaries (before early return so dry-run is always visible)
    if dry_run and warn_files:
        print("  Dry-run: %d file(s) would be fixed" % len(warn_files))
        for f in warn_files:
            print("           - %s" % f)

    has_issues = len(bad_files) > 0 or (ci_mode and len(warn_files) > 0) or (dry_run and len(warn_files) > 0)
    if not has_issues and not fixed_files:
        print("  Status:  OK -- all valid UTF-8")
        return 0

    if ci_mode and warn_files:
        print("  Warnings: %d file(s) with byte 0x97" % len(warn_files))
        for f in warn_files:
            print("           - %s" % f)
    if bad_files:
        print("  Failed:  %d file(s)" % len(bad_files))
        for f in bad_files:
            print("           - %s" % f)
    if fixed_files:
        print("  Fixed:   %d file(s) -- byte 0x97 replaced with UTF-8 em dash" % len(fixed_files))
        for f in fixed_files:
            print("           - %s" % f)

    if ci_mode and warn_files:
        return 1
    if bad_files:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
