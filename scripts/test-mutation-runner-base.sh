#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-runner-base.sh — Mutation test do guard check-runner-base
#
# Prova que o scripts/check-runner-base.mjs REALMENTE pega as 4 mutações do
# pin descritas em docs/GUARDS.md (linha 385):
#
#   1. sem-digest        — FROM sem @sha256:<64 hex> (tag volta flutuante)
#   2. digest-malformado — 40 hex em vez de 64 (passa a olho mas não é digest)
#   3. digest-trocado    — forma válida mas aponta para OUTRA imagem
#   4. contrato-afrouxado — exit 1 → true (asserção decorativa)
#
# Usage:
#   bash scripts/test-mutation-runner-base.sh
#
# Pipeline:
#   1. Cria Dockerfile fixture temporário com FROM pinado
#   2. CONTROLE: Dockerfile íntegro → guard deve PASS (exit 0)
#   3. Para cada mutação: aplica, roda guard, exige VIOLAÇÃO (exit 1)
#   4. Cleanup
#
# Exit codes:
#   0 — todas as 4 mutações DETECTADAS ✅
#   1 — guard CEGO para alguma OU falha de infra ❌
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-runner-base.mjs"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Extrai o digest real do Dockerfile.ubuntu-bun
REAL_DIGEST_LINE=$(grep '^FROM.*@sha256:' "$SCRIPT_DIR/Dockerfile.ubuntu-bun" 2>/dev/null | head -1)
REAL_DIGEST=$(echo "$REAL_DIGEST_LINE" | grep -oP 'sha256:[a-f0-9]{64}' | head -1 | sed 's/sha256://')
REAL_TAG=$(echo "$REAL_DIGEST_LINE" | grep -oP ':([^@]+)@' | head -1 | sed 's/://;s/@//')
REAL_NAME="catthehacker/ubuntu"

if [ -z "$REAL_DIGEST" ] || [ ${#REAL_DIGEST} -ne 64 ]; then
  REAL_DIGEST="$(printf 'a%.0s' {1..64})"
  REAL_TAG="act-latest"
  echo "  ⚠  Não conseguiu extrair digest real — usando placeholder"
fi

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
header() { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }

# ── Fixture: reproduz a estrutura do Dockerfile.ubuntu-bun real ───────────

FIXTURE="$TMP_DIR/Dockerfile.runner-base"
cat > "$FIXTURE" <<FIXTURE_EOF
FROM ${REAL_NAME}:${REAL_TAG}@${REAL_DIGEST}

# Contrato: plugin compose (invariante 7)
RUN set -euo pipefail; \\
    if ! docker compose version; then \\
        echo "::error::plugin compose ausente"; \\
        exit 1; \\
    fi; \\
    if ! command -v bun | grep -q /usr/local/bin/bun; then \\
        echo "::error::bun nao resolve de /usr/local/bin/bun"; \\
        exit 1; \\
    fi

ARG BUN_VERSION=1.3.14
RUN curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v\${BUN_VERSION}/bun-linux-x64.zip" \\
    | unzip -qo - -d /usr/local/bin && chmod +x /usr/local/bin/bun

ENTRYPOINT ["bash"]
FIXTURE_EOF

# ── Função para rodar mutação ─────────────────────────────────────────────

run_mutation() {
  local id="$1" desc="$2" pattern="$3" mutated="$4"
  header "MUTAÇÃO: $id — $desc"

  local sandbox="$TMP_DIR/sandbox-$id"
  mkdir -p "$sandbox"
  cp "$mutated" "$sandbox/Dockerfile.ubuntu-bun"

  local out="$TMP_DIR/mut-$id.txt" code=0
  (cd "$sandbox" && node "$GUARD" --no-registry-probe) > "$out" 2>&1 || code=$?

  if [ "$code" -eq 0 ]; then
    fail "guard CEGO: passou com '$id' (exit 0)"
    cat "$out"; return 1
  fi
  if grep -qiE "$pattern" "$out"; then
    pass "mutação '$id' DETECTADA (exit $code)"
    return 0
  else
    fail "mutação '$id' falhou o guard (exit $code) mas pela RAZÃO ERRADA"
    echo "  Esperado: $pattern"; cat "$out" | sed 's/^/    /'
    return 1
  fi
}

# ── CONTROLE ──────────────────────────────────────────────────────────────

header "CONTROLE: Dockerfile íntegro"
SANDBOX="$TMP_DIR/sandbox-ctrl"; mkdir -p "$SANDBOX"
cp "$FIXTURE" "$SANDBOX/Dockerfile.ubuntu-bun"
CTRL_OUT="$TMP_DIR/ctrl-out.txt"
if (cd "$SANDBOX" && node "$GUARD" --no-registry-probe) > "$CTRL_OUT" 2>&1; then
  pass "guard PASS no fixture íntegro"
else
  fail "guard FALHOU no fixture íntegro (exit $?):"; cat "$CTRL_OUT"; exit 1
fi

# ── MUTAÇÕES ──────────────────────────────────────────────────────────────

FAILED=0

# 1. sem-digest — FROM sem @sha256:<digest>
M1="$TMP_DIR/mut-sem-digest.Dockerfile"
sed "s|@${REAL_DIGEST}||" "$FIXTURE" > "$M1"
run_mutation "sem-digest" "FROM sem digest (tag flutuante)" "não está pinado\|sem digest\|FLUTUANTE" "$M1" || FAILED=$((FAILED+1))

# 2. digest-malformado — 40 hex em vez de 64
MALFORMED="sha256:$(printf 'a%.0s' {1..40})"
M2="$TMP_DIR/mut-digest-malformado.Dockerfile"
sed "s|@${REAL_DIGEST}|@${MALFORMED}|" "$FIXTURE" > "$M2"
run_mutation "digest-malformado" "digest com 40 hex (não canônico)" "não é um digest canônico\|malformado\|truncado" "$M2" || FAILED=$((FAILED+1))

# 3. digest-trocado — forma válida mas de outra imagem
FAKE="sha256:$(printf 'f%.0s' {1..64})"
M3="$TMP_DIR/mut-digest-trocado.Dockerfile"
sed "s|@${REAL_DIGEST}|@${FAKE}|" "$FIXTURE" > "$M3"
run_mutation "digest-trocado" "digest válido mas de outra imagem" "NÃO é o que a tag serve\|diferente\|errado" "$M3" || FAILED=$((FAILED+1))

# 4. contrato-afrouxado — exit 1 → true
M4="$TMP_DIR/mut-contrato-afrouxado.Dockerfile"
sed 's|exit 1; \\|true; \\|' "$FIXTURE" > "$M4"
run_mutation "contrato-afrouxado" "exit 1 → true (asserção decorativa)" "exit 1\|fail-closed\|contrato" "$M4" || FAILED=$((FAILED+1))

# ── Veredito ──────────────────────────────────────────────────────────────

header "VEREDITO"
if [ "$FAILED" -eq 0 ]; then
  pass "TODAS as 4 mutações DETECTADAS pelo guard"; exit 0
else
  fail "$FAILED mutações PASSARAM (guard cego)"; exit 1
fi
