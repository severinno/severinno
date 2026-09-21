#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-runner-base.sh — Mutation test do guard check-runner-base
#
# Prova que o scripts/check-runner-base.mjs pega as mutações do PIN contra o
# ARQUIVO REAL (Dockerfile.ubuntu-bun), por EXECUÇÃO:
#
#   1. sem-digest        — FROM sem @sha256:<64 hex> (tag volta flutuante)
#   2. digest-malformado — 40 hex em vez de 64 (passa a olho mas não é digest)
#   3. contrato-afrouxado — `exit 1` → `true` (asserção decorativa)
#
# A 4ª mutação — `digest-trocado` (forma válida, OUTRA imagem) — só é decidível
# contra o REGISTRY: offline o guard não tem como saber o que a tag serve hoje.
# Ele a prova HERMETICAMENTE pela própria prova interna de mutação (um
# resolvedor dublê faz "a tag servir o digest do arquivo", e um digest estranho
# não bate) — a linha `mutações:` do controle. Este script EXIGE aquela linha
# (com os quatro ids e o veredito ✅) para a 4ª não passar em silêncio.
#
# O FIXTURE É UMA CÓPIA FIEL do Dockerfile real (`cp`), não uma paráfrase: a
# prova tem de exercitar o arquivo que o build usa. O fixture sintético que
# existia antes reescrevia o bloco do contrato de memória e saiu do bloco real
# — usava `grep`, que NÃO existe no sandbox (o PATH do sandbox é só o diretório
# dos dublês, para o `docker` do host não vazar), e omitia o ramo do CLI
# `docker`; com isso o próprio CONTROLE passou a falhar.
#
# Usage:
#   bash scripts/test-mutation-runner-base.sh
#
# Exit codes:
#   0 — CONTROL passa e as mutações do pin são DETECTADAS ✅
#   1 — guard CEGO a alguma mutação, ou infra (Dockerfile sem digest) ❌
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'sem-digest|FROM sem @sha256 (a tag volta flutuante)'
  'digest-malformado|40 hex em vez de 64 (passa a olho, não é digest)'
  'digest-trocado|o digest de OUTRO elenco (a troca crua)'
  'contrato-afrouxado|asserção decorativa (exit 1 → true)'
)
GUARD="$SCRIPT_DIR/scripts/check-runner-base.mjs"
REAL_DOCKERFILE="$SCRIPT_DIR/Dockerfile.ubuntu-bun"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
header() { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }

# O digest REAL, com o prefixo canônico `sha256:`: as mutações trocam o REF
# inteiro (prefixo incluso), não um pedaço solto.
DIGEST_REF="$(grep -oP 'sha256:[a-f0-9]{64}' "$REAL_DOCKERFILE" | head -1 || true)"
if [ -z "$DIGEST_REF" ]; then
  fail "o Dockerfile real não tem um digest canônico para mutar: $REAL_DOCKERFILE"
  exit 1
fi

# ── Fixture: CÓPIA FIEL do Dockerfile real ────────────────────────────────
FIXTURE="$TMP_DIR/Dockerfile.ubuntu-bun"
cp "$REAL_DOCKERFILE" "$FIXTURE"

# Roda o guard REAL contra um diretório (cwd do sandbox), offline.
run_guard() { # <dir> <out> ; exit code = o do guard
  local dir="$1" out="$2" code=0
  (cd "$dir" && node "$GUARD" --no-registry-probe) > "$out" 2>&1 || code=$?
  return "$code"
}

# Aplica um sed de mutação a uma cópia nova e roda o guard.
# Uso: run_mutation <id> <desc> <sed-expr> <expect-regex>
# O sandbox é POR MUTAÇÃO, e só contém o Dockerfile mutado.
run_mutation() {
  local id="$1" desc="$2" sed_expr="$3" expect_re="$4"
  header "MUTAÇÃO: $id — $desc"

  local sandbox="$TMP_DIR/sandbox-$id"
  mkdir -p "$sandbox"
  cp "$FIXTURE" "$sandbox/Dockerfile.ubuntu-bun"
  sed -i "$sed_expr" "$sandbox/Dockerfile.ubuntu-bun"

  if cmp -s "$FIXTURE" "$sandbox/Dockerfile.ubuntu-bun"; then
    fail "mutação '$id' não mudou o arquivo (a âncora dela sumiu)"
    return 1
  fi

  local out="$TMP_DIR/mut-$id.txt" code=0
  run_guard "$sandbox" "$out" || code=$?

  if [ "$code" -eq 0 ]; then
    fail "guard CEGO: passou com '$id' (exit 0)"
    cat "$out"; return 1
  fi
  if grep -qiE "$expect_re" "$out"; then
    pass "mutação '$id' DETECTADA (exit $code)"
    return 0
  fi
  fail "mutação '$id' falhou o guard (exit $code) mas pela RAZÃO ERRADA"
  echo "  Esperado: $expect_re"; sed 's/^/    /' "$out"
  return 1
}

# ── CONTROLE ──────────────────────────────────────────────────────────────

header "CONTROLE: cópia fiel do Dockerfile.ubuntu-bun"
CTRL_DIR="$TMP_DIR/ctrl"; mkdir -p "$CTRL_DIR"
cp "$FIXTURE" "$CTRL_DIR/Dockerfile.ubuntu-bun"
CTRL_OUT="$TMP_DIR/ctrl-out.txt"
if run_guard "$CTRL_DIR" "$CTRL_OUT"; then
  pass "guard PASS na cópia fiel (exit 0) — o guard não falha 'de qualquer jeito'"
else
  fail "guard FALHOU na cópia fiel — o fixture não reproduz o arquivo real"
  cat "$CTRL_OUT"; exit 1
fi

# A prova INTERNA de mutação precisa estar viva, e ela é a única prova offline
# de `digest-trocado`. Exigir os quatro ids força isso a ser explícito.
MUT_LINE="$(grep 'mutações' "$CTRL_OUT" | head -1 || true)"
MUT_OK=1
grep -q '✅' <<< "$MUT_LINE" || MUT_OK=0
for id in sem-digest digest-malformado digest-trocado contrato-afrouxado; do
  grep -q "$id" <<< "$MUT_LINE" || MUT_OK=0
done
if [ "$MUT_OK" -eq 1 ]; then
  pass "prova interna de mutação viva (os 4 ids, incl. digest-trocado — satisfeito só contra o registry)"
else
  fail "a prova interna de mutação do guard não reportou ✅ para os 4 ids"
  echo "  linha observada: $MUT_LINE"; exit 1
fi

# ── MUTAÇÕES (por EXECUÇÃO do guard real) ─────────────────────────────────

FAILED=0

run_mutation "sem-digest" \
  "FROM sem digest (tag flutuante)" \
  "s|@${DIGEST_REF}||" \
  "não está pinado por digest" || FAILED=$((FAILED + 1))

run_mutation "digest-malformado" \
  "digest com 40 hex (não canônico)" \
  "s|@${DIGEST_REF}|@sha256:$(printf 'a%.0s' {1..40})|" \
  "não é um digest canônico" || FAILED=$((FAILED + 1))

run_mutation "contrato-afrouxado" \
  "exit 1 → true (asserção decorativa)" \
  's/exit 1; \\/true; \\/' \
  "exit 1|fail-closed|contrato" || FAILED=$((FAILED + 1))

# ── Veredito ──────────────────────────────────────────────────────────────

header "VEREDITO"
if [ "$FAILED" -eq 0 ]; then
  pass "MUTATION TEST PASSED — o guard pega sem-digest, digest-malformado e"
  pass "  contrato-afrouxado por execução, e prova digest-trocado pela mutação"
  pass "  interna (offline o registry é o único juiz da identidade da tag)."
  exit 0
else
  fail "$FAILED mutação(ões) PASSARAM (guard cego)"; exit 1
fi
