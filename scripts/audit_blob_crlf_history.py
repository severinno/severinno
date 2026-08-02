#!/usr/bin/env python3
"""audit_blob_crlf_history.py — audit ALL historical .sh/.bash blobs for CRLF.

Usage:
  python3 scripts/audit_blob_crlf_history.py

WHY: the working-tree guard (check_crlf.py) and the blob guard
(check_blob_crlf.py) only inspect the CURRENT index. A CRLF blob COMMITTED
in the past (e.g. autocrlf disabled, or before .gitattributes) would
reproduce CRLF on every fresh checkout of that commit — including Linux CI
containers. This audit walks the entire reachable history (`git rev-list
--all --objects`) and detects any .sh/.bash BLOB whose content contains a
CR byte (0x0D) — a permanent auditability record for the repo.

METHOD (why not grep): on Git Bash/Windows, `grep -q $'\\r'` fails silently
(returns 0 even on CRLF files — MSYS pipe translation). This script reads
blob bytes via `git cat-file --batch` and tests for 0x0D in Python, the
same robust binary check used by check_blob_crlf.py.

DETECTION: blob bytes containing \\r (0x0D) are flagged fail-closed. LF-only
blobs are clean. A CRLF file has \\r\\n; a lone \\r is also flagged (broken
EOL).

--fix is NOT offered: rewriting history (filter-repo) is a deliberate,
irreversible operation — see README 'Auditoria histórica de blobs .sh' for
the procedure (git filter-repo --blob-callback) with the tradeoffs.

Exit codes: 0 = clean, 1 = CRLF blobs found (printed), 2 = git error.
"""

import subprocess
import sys


def _force_lf_stdout() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(newline="\n")


def _scan_all() -> tuple[int, list[tuple[str, str]]]:
    """Returns (code, [(blob_hash, path)]) for every reachable .sh/.bash blob."""
    proc = subprocess.run(
        ["git", "rev-list", "--all", "--objects"],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        return 2, []

    blobs: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        parts = line.split(" ", 1)
        if len(parts) == 2 and (parts[1].endswith(".sh") or parts[1].endswith(".bash")):
            blobs.setdefault(parts[0], parts[1])

    batch_in = "".join(f"{h}\n" for h in blobs).encode()
    batch = subprocess.run(["git", "cat-file", "--batch"], input=batch_in, capture_output=True)
    data = batch.stdout

    # Protocol-correct walk of the --batch stream. Each record is:
    #   <oid> SP <type> SP <size> LF
    #   <contents (raw, embedded newlines included)> LF
    # We parse the size from the header and consume EXACTLY size bytes for the
    # body, then skip the trailing LF. A naive split(b"\n") walker would only
    # check the FIRST line of each blob (embedded \n would misalign the
    # header/body pairing), silently missing CR on later lines.
    offenders: list[tuple[str, str]] = []
    pos, n = 0, len(data)
    truncated = False
    while pos < n:
        nl = data.find(b"\n", pos)
        if nl == -1:
            truncated = True
            break
        header = data[pos:nl].decode("utf-8", "replace")
        pos = nl + 1
        parts = header.split(" ")
        # missing/corrupt record — fail-closed: never report a partial scan
        # as clean (rev-list hashes always exist, so this must not happen)
        if len(parts) != 3 or parts[1] != "blob" or not parts[2].isdigit():
            truncated = True
            break
        oid, size = parts[0], int(parts[2])
        if pos + size > n:
            truncated = True
            break
        body = data[pos : pos + size]
        pos += size
        if pos < n and data[pos : pos + 1] == b"\n":
            pos += 1
        if b"\r" in body:
            offenders.append((oid, blobs.get(oid, oid)))
    if truncated:
        sys.stderr.write("ERRO: stream do cat-file --batch truncado/corrupto — auditoria parcial ABORTADA.\n")
        return 2, []
    return 0, offenders


def main(argv: list[str]) -> int:
    _force_lf_stdout()
    code, offenders = _scan_all()
    if code != 0:
        return code

    for blob_hash, path in offenders:
        print(f"{blob_hash[:12]}  {path}")

    if offenders:
        print(f"\n{len(offenders)} bloco(s) .sh/.bash com CRLF no histórico.")
        print("Correção retroativa: ver README 'Auditoria histórica de blobs .sh'.")
        return 1
    print("OK — nenhum blob .sh/.bash com CRLF no histórico (rev-list --all).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
