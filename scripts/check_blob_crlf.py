#!/usr/bin/env python3
"""check_blob_crlf.py — fail if any tracked .sh/.bash BLOB has CRLF/mixed EOL.

Usage:
  python3 scripts/check_blob_crlf.py [--fix]

WHY: the working-tree guard (check_crlf.py) catches CRLF on disk, but a file
COMMITTED with CRLF in its blob (e.g. committed with autocrlf disabled or
before .gitattributes) reproduces CRLF on every fresh checkout — including
Linux CI containers, where `set -euo pipefail` then fails with
'pipefail: invalid option name'. This guard inspects the git INDEX (the
blob's EOL as recorded), which in CI equals the committed state.

Detection: `git ls-files --eol -z` prints
    i/<eol> w/<eol> attr/<attr>\t<path>\0
per file. The `i/` column is the index/blob EOL: `lf` is clean; anything
else (`crlf`, `mixed`, `none`) is flagged fail-closed.

--fix: runs `git add --renormalize` on the offenders (with the repo's
.gitattributes eol rules), staging the EOL-only index rewrite for review.

Exit codes: 0 = clean, 1 = offenders found (printed), 2 = git error.
"""

import subprocess
import sys


def _force_lf_stdout() -> None:
    # Windows: piped stdout would translate \n -> \r\n, breaking mapfile -t
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(newline="\n")


def _scan() -> tuple[int, list[str]]:
    proc = subprocess.run(
        ["git", "ls-files", "--eol", "-z", "--", "*.sh", "*.bash"],
        capture_output=True,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr.decode("utf-8", "replace"))
        return 2, []

    offenders: list[str] = []
    for record in proc.stdout.split(b"\0"):
        if not record:
            continue
        meta, sep, path = record.partition(b"\t")
        if not sep:
            continue  # malformed record — skip defensively
        i_field = meta.split(b" ", 1)[0] if meta else b""
        eol = i_field.split(b"/", 1)[1] if b"/" in i_field else b""
        if eol != b"lf":
            offenders.append(path.decode("utf-8", "replace"))

    return 0, offenders


def main(argv: list[str]) -> int:
    _force_lf_stdout()
    fix = "--fix" in argv

    code, offenders = _scan()
    if code != 0:
        return code

    if fix and offenders:
        subprocess.run(
            ["git", "add", "--renormalize", "--", *offenders],
            check=True,
        )

    for p in offenders:
        print(p)
    # --fix leaves the index EOL-normalized for review: exit 0 (done), not 1.
    return 0 if fix else (1 if offenders else 0)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
