#!/usr/bin/env python3
"""audit_blob_crlf_history.py — audit ALL historical blobs for CRLF.

Usage:
  python3 scripts/audit_blob_crlf_history.py
  python3 scripts/audit_blob_crlf_history.py --extensions .md,.ts,.yml
  python3 scripts/audit_blob_crlf_history.py --all-text

Exit codes:
  0 = clean (or report-only scan), 1 = CRLF blobs found (printed,
  only in gate mode), 2 = git error / missing .gitattributes for --all-text.

WHY: the working-tree guard (check_crlf.py) and the blob guard
(check_blob_crlf.py) only inspect the CURRENT index. A CRLF blob COMMITTED
in the past (e.g. autocrlf disabled, or before .gitattributes) would
reproduce CRLF on every fresh checkout of that commit — including Linux CI
containers. This audit walks the entire reachable history (`git rev-list
--all --objects`) and detects any BLOB whose content contains a CR byte
(0x0D) — a permanent auditability record for the repo.

METHOD (why not grep): on Git Bash/Windows, `grep -q $'\\\\r'` fails silently
(returns 0 even on CRLF files — MSYS pipe translation). This script reads
blob bytes via `git cat-file --batch` and tests for 0x0D in Python, the
same robust binary check used by check_blob_crlf.py.

SCOPE: by default only `.sh`/`.bash` (the extensions that BREAK bash in
Linux containers when CRLF). `--extensions ext1,ext2,...` scans an explicit
suffix list. `--all-text` DERIVES its matchers at runtime from the
repository's .gitattributes — every `text eol=lf` rule becomes a matcher
(suffix `*.ext` AND exact-name/glob no-extension entries: Makefile,
Caddyfile*, Dockerfile*, .prettierrc, .husky/*, .env.*.example) plus the
`.bash` complement. Deriving (instead of a hardcoded constant) kills the
drift risk: adding a new `text eol=lf` type to .gitattributes automatically
extends the audit — no script edit needed. `--all-text` is a REPORT (never
a gate): it exits 0 even when findings exist, because CRLF in those types
does not break any toolchain — the .sh-only default remains the CI gate.
Fail-closed: without a .gitattributes to derive from, `--all-text` exits 2
(never audits "nothing" silently — "0 blobs" from a missing file would be a
false clean).

MATCHING SEMANTICS (git attributes): patterns WITHOUT `/` match the
basename (ex.: `*.md` casa `src/x.md`; `Makefile` casa `Makefile` em
qualquer diretório; `Caddyfile*` casa `Caddyfile.prod`). Patterns WITH `/`
are anchored to the repo root and `*` does NOT cross `/` (ex.: `.husky/*`
casa `.husky/pre-commit` mas não `.husky/sub/x`). Matching é case-insensitive
(baixa ambos os lados — mesma paridade do filtro de sufixo pré-existente).

WHY NOT git-side filtering: `git rev-list --objects -- <pathspec>` (passar
os padrões derivados ao próprio git) NÃO é equivalente ao filtro Python —
medido 08/2026 no repo real com `*.md`: o filtro Python (IGNORECASE, sem
history simplification) casa 410 blobs vs 48 do git-side, que ainda
contamina o output com linhas de TREE (hash nu, sem path — 104 num único
pathspec) e é case-sensitive + aplica history simplification (dropa blobs
de commits que não "tocam" o path no diff) — o gap 410→48 é a SOMA dos
dois efeitos (matches IGNORECASE que o git perde + blobs podados), não só
case. O filtro Python sobre a lista
COMPLETA do `rev-list --all --objects` é a fonte de verdade do escopo
--all-text — o pathspec do git NÃO serve como otimização equivalente.

DETECTION: blob bytes containing \\r (0x0D) are flagged fail-closed. LF-only
blobs are clean. A CRLF file has \\r\\n; a lone \\r is also flagged (broken
EOL).

--fix is NOT offered: rewriting history (filter-repo) is a deliberate,
irreversible operation — see README 'Auditoria histórica de blobs .sh' for
the procedure (git filter-repo --blob-callback) with the tradeoffs.
"""

import os
import re
import subprocess
import sys

# Complemento fixo do --all-text: o .gitattributes declara apenas `*.sh`
# (o `*.bash` nunca entrou no arquivo), mas o gate default é `.sh`/`.bash` —
# o REPORT --all-text mantém o mesmo escopo de shell. NOTA: o complemento
# é um GLOB (`*.bash`), NÃO um nome exato (`.bash`) — como padrão derivado
# ele entra no _build_matchers como sufixo, igual a `*.sh`. Se um dia
# `*.bash text eol=lf` for adicionado ao .gitattributes, o dedupe na
# derivação evita duplicata.
ALL_TEXT_EXTS_COMPLEMENT = ("*.bash",)


def _glob_to_regex(glob: str, path_anchored: bool) -> "re.Pattern[str]":
    """Converte um padrão do .gitattributes em regex com semântica git.

    - `*` casa qualquer coisa EXCETO `/` quando o padrão é ancorado a path
      (contém `/`); sem âncora casa qualquer coisa (basename não tem `/`).
    - `?` casa UM caractere (exceto `/` se ancorado).
    - `[...]` é passado como classe (raro em .gitattributes do repo).
    - Demais caracteres são escapados (`.` vira `\\.` — um `.env.*.example`
      NÃO pode casar `XenvYexample`).
    """
    out: list[str] = []
    i, n = 0, len(glob)
    while i < n:
        c = glob[i]
        if c == "*":
            out.append("[^/]*" if path_anchored else ".*")
        elif c == "?":
            out.append("[^/]" if path_anchored else ".")
        elif c == "[":
            j = glob.find("]", i + 1)
            if j == -1:
                out.append(re.escape("["))
            else:
                out.append(glob[i : j + 1])
                i = j
        else:
            out.append(re.escape(c))
        i += 1
    return re.compile("^" + "".join(out) + "$", re.IGNORECASE)


def _build_matchers(patterns: tuple[str, ...]) -> list[tuple[bool, "re.Pattern[str]"]]:
    """Converte cada padrão derivado do .gitattributes em (path_anchored, regex).

    path_anchored=True (padrão contém `/`) → o regex casa o PATH COMPLETO
    (ex.: `.husky/*`). False → casa só o basename (ex.: `Makefile`,
    `Caddyfile*`, `*.md`).
    """
    return [("/" in p, _glob_to_regex(p, "/" in p)) for p in patterns]


def _path_matches(path: str, matchers: list[tuple[bool, "re.Pattern[str]"]]) -> bool:
    """Um caminho (do rev-list --objects) casa se ALGUM matcher o pegar."""
    for anchored, rx in matchers:
        target = path if anchored else path.rsplit("/", 1)[-1]
        if rx.match(target):
            return True
    return False


def load_all_text_patterns(gitattributes_path: str = ".gitattributes") -> tuple[str, ...]:
    """Deriva os padrões do --all-text das linhas `text eol=lf` do .gitattributes.

    Parse robusto linha a linha: ignora comentários/vazias, aceita espaçamento
    variável, exige que o token `text` E o token `eol=lf` estejam presentes
    (um `*.png binary` ou `* text=auto` NÃO casa — `text=auto` é um token só,
    não o token `text`). Captura AMBOS os padrões com extensão (`*.md`) e sem
    extensão (nomes exatos `Makefile`/`.prettierrc` e globs `Caddyfile*`/
    `.husky/*`/`.env.*.example`), preservando a ordem do arquivo. O `.bash`
    do complemento entra no fim (dedupe).

    FONTE ÚNICA: este parser é a fonte de verdade do escopo --all-text —
    adicionar um tipo novo ao .gitattributes estende a auditoria sem tocar
    no script (elimina o drift da constante hardcoded).

    @param gitattributes_path  caminho do arquivo (default: cwd — o wrapper
        cd para a raiz do repo antes de chamar este script)
    @returns tupla de padrões crus do .gitattributes (ex.:
        ('.md', '.ts', ..., '.sh', '.svg', 'Makefile', '.husky/*', '.bash'))
    @raises FileNotFoundError  se o arquivo não existir (fail-closed do
        --all-text: sem fonte, nada a derivar)
    """
    patterns: list[str] = []
    with open(gitattributes_path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) < 3:
                continue
            attrs = parts[1:]
            if "text" not in attrs or "eol=lf" not in attrs:
                continue  # 'binary', 'text=auto' ou 'text' sem 'eol=lf' — fora
            pat = parts[0]
            if pat not in patterns:
                patterns.append(pat)
    for c in ALL_TEXT_EXTS_COMPLEMENT:
        if c not in patterns:
            patterns.append(c)
    return tuple(patterns)  # ex.: ('.md', ..., '*.sh', 'Makefile', '.husky/*', '*.bash')


def _force_lf_stdout() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(newline="\n")


def _scan_all(patterns: tuple[str, ...]) -> tuple[int, list[tuple[str, str]], int]:
    """Returns (code, [(blob_hash, path)], scanned_count) for every reachable blob matching patterns."""
    proc = subprocess.run(
        ["git", "rev-list", "--all", "--objects"],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        return 2, [], 0

    matchers = _build_matchers(patterns)
    blobs: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        parts = line.split(" ", 1)
        if len(parts) == 2 and _path_matches(parts[1], matchers):
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
        return 2, [], 0
    return 0, offenders, len(blobs)


def main(argv: list[str]) -> int:
    _force_lf_stdout()

    patterns: tuple[str, ...] = ("*.sh", "*.bash")
    label = ".sh,.bash"
    report_only = False
    args = list(argv)
    i = 0
    # Precedência: processado em ordem — o ÚLTIMO flag vence. Mixing
    # --all-text --extensions .md → escopo .md em modo REPORT (report_only
    # fica True); --extensions .md --all-text → escopo derivado do
    # .gitattributes. É o comportamento esperado (later-wins), documentado
    # para não surpreender.
    while i < len(args):
        a = args[i]
        if a == "--extensions" and i + 1 < len(args):
            exts = tuple(e.strip().lower() for e in args[i + 1].split(",") if e.strip())
            patterns = tuple(f"*{e}" for e in exts)
            label = ",".join(exts)
            i += 2
        elif a.startswith("--extensions="):
            exts = tuple(e.strip().lower() for e in a.split("=", 1)[1].split(",") if e.strip())
            patterns = tuple(f"*{e}" for e in exts)
            label = ",".join(exts)
            i += 1
        elif a == "--all-text":
            try:
                patterns = load_all_text_patterns()
            except FileNotFoundError:
                sys.stderr.write(
                    "audit_blob_crlf_history.py: --all-text requer o .gitattributes na raiz "
                    "(fonte única dos tipos 'text eol=lf') — arquivo ausente em "
                    f"{os.path.abspath('.gitattributes')}. Sem fonte, nada a derivar "
                    "(fail-closed: nunca auditar '0 blobs' de um arquivo que não existe).\n"
                )
                return 2
            label = ",".join(patterns)
            report_only = True
            i += 1
        elif a in ("-h", "--help"):
            print(__doc__.split("Usage:")[0].strip())
            print("Usage: audit_blob_crlf_history.py [--extensions ext1,ext2,... | --all-text]")
            return 0
        else:
            sys.stderr.write(f"audit_blob_crlf_history.py: argumento desconhecido: {a}\n")
            return 2

    if not patterns:
        sys.stderr.write("audit_blob_crlf_history.py: --extensions vazio — nada a auditar\n")
        return 2

    code, offenders, scanned = _scan_all(patterns)
    if code != 0:
        return code

    for blob_hash, path in offenders:
        print(f"{blob_hash[:12]}  {path}")

    if offenders:
        print(f"\n{len(offenders)} bloco(s) com CRLF no histórico (escopo: {label}).")
        if report_only:
            print("Modo REPORT (--all-text): CRLF em tipos benignos não quebra toolchain —")
            print("o gate de CI é o .sh/.bash (default). Correção retroativa: ver README.")
            return 0
        print("Correção retroativa: ver README 'Auditoria histórica de blobs .sh'.")
        return 1
    print(f"OK — {scanned} blobs únicos sem CRLF no histórico (rev-list --all; escopo: {label}).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
