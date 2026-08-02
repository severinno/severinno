#!/usr/bin/env python3
"""check_crlf.py — detect/fix CR (CRLF) bytes in tracked shell scripts.

Usage:
  python3 scripts/check_crlf.py [--fix] <path>...

Reads file paths from argv. With --fix, rewrites CRLF and lone CR to LF.

WHY raw bytes: `grep -q $'\\r'` does NOT work on Git Bash/MSYS — MSYS strips
CR in text mode before grep ever sees it, so CRLF goes undetected exactly on
the Windows machines where the bug occurs. Python reads bytes raw, so
detection is identical on Windows and Linux.

Exit codes: 0 = all clean, 1 = offenders found (printed to stdout).
"""

import sys


def _force_lf_stdout() -> None:
    # On Windows, Python's text-mode stdout translates "\n" to "\r\n" when
    # piped — consumers using `mapfile -t` would receive paths with a trailing
    # CR that breaks `git add --renormalize` (pathspec 'a.sh?' did not match).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(newline="\n")


def main(argv: list[str]) -> int:
    _force_lf_stdout()
    fix = False
    paths: list[str] = []
    for arg in argv:
        if arg == "--fix":
            fix = True
        else:
            paths.append(arg)

    offenders: list[str] = []
    for p in paths:
        try:
            with open(p, "rb") as fh:
                data = fh.read()
        except OSError:
            continue  # tracked but absent from the working tree
        if b"\r" in data:
            offenders.append(p)
            if fix:
                with open(p, "wb") as fh:
                    fh.write(data.replace(b"\r\n", b"\n").replace(b"\r", b"\n"))

    for p in offenders:
        print(p)
    # --fix succeeded: exit 0 (files are clean now; offenders still printed
    # for the caller to report what was rewritten). Check mode: 1 = found.
    return 0 if fix else (1 if offenders else 0)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
