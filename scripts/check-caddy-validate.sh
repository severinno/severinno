#!/usr/bin/env bash
# ============================================================================
# check-caddy-validate.sh — o Caddyfile.prod NUNCA mais envelhece sozinho
# ============================================================================
# Roda `caddy validate --adapter caddyfile` no Caddyfile.prod DENTRO de um
# container (o binário que julga é um Caddy real, não um parser caseiro).
#
# Dois modos:
#
#   --stock (usado em PR): usa a imagem stock caddy:2-alpine e PULA, com
#       aviso explícito, as diretivas que exigem os plugins da imagem custom
#       (rate_limit e format transform — ver Dockerfile.caddy). O objetivo é
#       pegar regressão de parse em TUDO o que a stock consegue julgar
#       (hosts, matchers, handlers, includes, templates, sintaxe geral).
#
#   full (default, CI com a imagem custom / host de produção): valida o
#       arquivo INTEIRO — nenhuma diretiva é pula­da. É o modo que sanciona
#       também as diretivas de plugin.
#
# Exit codes:
#   0 — parse OK (no modo do container disponível)
#   1 — erro de PARSE do Caddyfile (o Caddy reprova o arquivo)
#   2 — pré-requisito ausente (docker ausente/imagem indisponível/mount falhou)
#
# Usage:
#   bash scripts/check-caddy-validate.sh            # auto: usa a custom se existir
#   bash scripts/check-caddy-validate.sh --stock    # força modo stock (PR)
#   bash scripts/check-caddy-validate.sh --full     # força modo full
#
# Environment:
#   CADDY_IMAGE      imagem usada no modo full (default: derivada do compose)
#   CADDY_STOCK_IMAGE imagem do modo stock (default: caddy:2-alpine)
#
# Contexto (2026-10-02): o Caddyfile.prod passou meses sem ser parseado por
# nenhum Caddy — o `storage file:///data/caddy` (módulo inexistente) crashava
# o boot inteiro, e ninguém viu, porque nenhum job validava o arquivo. Este
# guard existe para essa classe de defeito não voltar.
# ============================================================================

set -uo pipefail

CADDYFILE="Caddyfile.prod"
STOCK_IMAGE="${CADDY_STOCK_IMAGE:-caddy:2-alpine}"
CUSTOM_IMAGE="${CADDY_IMAGE:-}"
# WORK sob a raiz do repo (não /tmp): o daemon docker precisa VER o arquivo
# no bind-mount — em estações com namespaces de mount segregados, /tmp do
# shell não é visível ao daemon e o bind falha com "not a directory".
WORK="${CADDY_GUARD_TMP:-$(pwd)/.tmp}/caddy-validate.$$"
mkdir -p "$WORK"
TMP_OUT=""
MODE="auto"

cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --stock) MODE="stock"; shift ;;
    --full) MODE="full"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[caddy-validate] opção desconhecida: $1" >&2; exit 2 ;;
  esac
done

# ── Pré-requisitos ──────────────────────────────────────────────────────────

command -v docker >/dev/null 2>&1 || { echo "[caddy-validate] docker ausente — pré-requisito do guard" >&2; exit 2; }
[ -f "$CADDYFILE" ] || { echo "[caddy-validate] $CADDYFILE não encontrado (rodar na raiz do repo)" >&2; exit 2; }

# Descobre a imagem custom pelo compose (fonte única) quando não forcada.
if [ -z "$CUSTOM_IMAGE" ]; then
  CUSTOM_IMAGE=$(grep -A8 '^  caddy:' docker-compose.prod.yml 2>/dev/null | grep 'image:' | head -1 | sed 's/.*image: *//;s/"//g' || true)
fi

docker image inspect "$STOCK_IMAGE" >/dev/null 2>&1 || docker pull -q "$STOCK_IMAGE" >/dev/null 2>&1 || {
  echo "[caddy-validate] não consegui obter a imagem $STOCK_IMAGE" >&2
  exit 2
}

# ── Modo full: imagem custom obrigatória ────────────────────────────────────

run_full() {
  if ! docker image inspect "$CUSTOM_IMAGE" >/dev/null 2>&1; then
    if [ "$MODE" = "full" ]; then
      echo "[caddy-validate] modo --full exige a imagem custom '$CUSTOM_IMAGE' (build: docker compose -f docker-compose.prod.yml build caddy)" >&2
      exit 2
    fi
    return 3 # auto: degrada para stock com aviso
  fi
  TMP_OUT="$WORK/Caddyfile"
  cp "$CADDYFILE" "$TMP_OUT"
  echo "[caddy-validate] modo FULL — imagem $CUSTOM_IMAGE (arquivo inteiro, plugins inclusos)"
  if docker run --rm -v "$TMP_OUT":/etc/caddy/Caddyfile:ro "$CUSTOM_IMAGE" \
      caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile >"$WORK/validate.out" 2>&1; then
    grep -q "Valid configuration" "$WORK/validate.out" || { cat "$WORK/validate.out" >&2; return 1; }
    echo "[caddy-validate] ✅ Caddyfile.prod inteiro válido ($CUSTOM_IMAGE)"
    return 0
  fi
  echo "[caddy-validate] ❌ o Caddy REPROVA o arquivo:" >&2
  grep -E "Error|error" "$WORK/validate.out" | head -10 >&2
  return 1
}

# ── Modo stock: remove as diretivas de plugin, valida o RESTO ───────────────

run_stock() {
  TMP_OUT="$WORK/Caddyfile"
  # Remove EXATAMENTE o que está documentado como plugin (Dockerfile.caddy):
  #   - o bloco rate_limit { ... } (balanceado por chaves)
  #   - as linhas `format transform "..."` (encoder do transform-encoder)
  # O resto é julgado pela stock. Se um dia a lista divergir do
  # Dockerfile.caddy, o modo full do CI pega a diferença.
  python3 - "$CADDYFILE" "$TMP_OUT" "$STOCK_IMAGE" <<'PYEOF'
import re, sys
src, dst, stock_image = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(src, encoding="utf-8").read()

def drop_block(text, header_re):
    out, i, removed = [], 0, 0
    for m in re.finditer(header_re, text):
        if m.start() < i:
            continue
        out.append(text[i:m.start()])
        depth, j = 0, m.start()
        opened = False
        while j < len(text):
            ch = text[j]
            if ch == "{":
                depth += 1; opened = True
            elif ch == "}":
                depth -= 1
                if opened and depth == 0:
                    j += 1
                    break
            j += 1
        i = j
        removed += 1
    out.append(text[i:])
    return "".join(out), removed

s, n_rate = drop_block(s, r'(?m)^\s*rate_limit\s*\{')
n_fmt = len(re.findall(r'(?m)^\s*format\s+transform\s+', s))
s = re.sub(r'(?m)^\s*format\s+transform\s+.*\n', '', s)
open(dst, "w", encoding="utf-8").write(s)
print(f"[caddy-validate] modo STOCK — {stock_image}; removidos {n_rate} bloco(s) rate_limit e {n_fmt} format transform (plugins da imagem custom, ver Dockerfile.caddy)")
PYEOF
  [ $? -eq 0 ] || { echo "[caddy-validate] falha ao preparar a cópia stock" >&2; exit 2; }

  if docker run --rm -v "$TMP_OUT":/etc/caddy/Caddyfile:ro "$STOCK_IMAGE" \
      caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile >"$WORK/validate.out" 2>&1; then
    grep -q "Valid configuration" "$WORK/validate.out" || { cat "$WORK/validate.out" >&2; return 1; }
    echo "[caddy-validate] ✅ Caddyfile.prod válido na stock (diretivas de plugin excluídas desta prova — sancionadas no modo full)"
    return 0
  fi
  echo "[caddy-validate] ❌ o Caddy REPROVA o arquivo:" >&2
  grep -E "Error|error" "$WORK/validate.out" | head -10 >&2
  return 1
}

case "$MODE" in
  stock) run_stock; exit $? ;;
  full)  run_full;  exit $? ;;
  auto)  run_full; RC=$?; [ $RC -ne 3 ] && exit $RC
         echo "[caddy-validate] imagem custom ausente — degradando para stock (aviso: diretivas de plugin não sancionadas nesta execução)"
         run_stock; exit $? ;;
esac
