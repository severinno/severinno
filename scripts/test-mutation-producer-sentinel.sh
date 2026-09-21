#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-producer-sentinel.sh — Mutation test do PRODUTOR do
# alerta all-text (audit_blob_crlf_history.py): sentinel 'com CRLF' removido
#
# Prova que o validate-all-text-alert.test.ts (e o job semanal
# blob-crlf-all-text-alert do benchmark-weekly.yml) REALMENTE pegam uma
# REGRESSÃO DO PRODUTOR — não só um fixture quebrado. A mutação remove a
# linha que imprime o sentinel 'com CRLF' no caminho de achados do
# audit_blob_crlf_history.py:
#
#       print(f"\n{len(offenders)} bloco(s) com CRLF no histórico (escopo: {label}).")
#
# Se o produtor parar de emitir o sentinel, o grep do job
# (`grep -Fq 'com CRLF'`) fica CEGO e o teste `expect(foundCrlf).toBe(true)`
# do validate-all-text-alert.test.ts FALHA — este cenário prova exatamente
# isso, end-to-end (a mesma asserção do teste, replicada em bash como o
# validate-all-text-alert.sh replica o gate do job):
#
#   CONTROLE — produtor REAL + fixture com blob .md CRLF → o REPORT
#     --all-text deve imprimir o sentinel 'com CRLF' (o gate acenderia, o
#     teste passaria) — prova que o fixture é válido e o produtor emite;
#   MUTAÇÃO — produtor com a linha do sentinel REMOVIDA (cópia em temp — o
#     arquivo real nunca é tocado) + o MESMO fixture → o REPORT deve NÃO
#     imprimir o sentinel mas AINDA listar o blob ofensor (mutação cirúrgica:
#     só a linha do sentinel morreu, a varredura segue) — o teste
#     validate-all-text-alert.test.ts FALHARIA na asserção found_crlf=true
#     (o job estaria cego).
#
# Se o produtor mutado AINDA imprimir o sentinel (exit 0 + 'com CRLF' no
# output), o teste NÃO pegaria a regressão — guard cega — e o script falha
# (exit 1), bloqueando o CI. Espelho dos demais mutation tests: fixture
# mktemp, sem docker, NÃO toca NENHUM arquivo do repo real (a mutação vive
# numa CÓPIA em temp; o wrapper resolve o python relativo a BASH_SOURCE[0],
# então copiar wrapper + python no temp basta para o wrapper mutado rodar).
#
# Usage:
#   ./scripts/test-mutation-producer-sentinel.sh
#
# Exit codes:
#   0 — regressão DETECTADA (produtor mutado NÃO emite o sentinel → o teste
#       falharia → o teste pega a regressão) ✅
#   1 — produtor mutado AINDA emite o sentinel (teste cego) OU a mutação
#       quebrou a varredura (não foi cirúrgica) OU falha de infra/asserção ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'A|o sentinel com CRLF removido do audit all-text deve FALHAR o teste do alerta'
)
WRAPPER="$SCRIPT_DIR/scripts/audit-blob-crlf-history.sh"
PY_REAL="$SCRIPT_DIR/scripts/audit_blob_crlf_history.py"

TMP_DIR="$(mktemp -d)"
FIXTURE_DIR="$TMP_DIR/fixture"
MUT_DIR="$TMP_DIR/mutated"

SENTINEL="com CRLF"

# ── Fonte da mensagem: audit_blob_crlf_history.py main():
#   `print(f"\n{len(offenders)} bloco(s) com CRLF no histórico (escopo: {label}).")`
# ⚠️ Source-coupled: se o produtor reformular a linha do sentinel, atualize o
# padrão do sed junto (não é guard cego — é o acoplamento esperado). O padrão
# do sed é SEM parênteses (convenção BRE do repo — portabilidade GNU/MSYS).
MUT_SED_PATTERN="com CRLF no histórico"

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ── Cleanup (trap EXIT — SEMPRE remove o temp, mesmo com falha) ──────────
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# ── MUTAÇÃO: cópia do produtor em temp com a linha do sentinel REMOVIDA ──
# O wrapper resolve PY_SCRIPT relativo ao próprio BASH_SOURCE[0], então uma
# cópia wrapper+python no temp é um produtor completo e isolado — o arquivo
# real do repo NUNCA é tocado.
build_mutated_producer() {
  rm -rf "$MUT_DIR"
  mkdir -p "$MUT_DIR"
  cp "$WRAPPER" "$MUT_DIR/audit-blob-crlf-history.sh"
  cp "$PY_REAL" "$MUT_DIR/audit_blob_crlf_history.py"
  # Remove a linha do sentinel do caminho de achados (mutação cirúrgica).
  sed -i "/$MUT_SED_PATTERN/d" "$MUT_DIR/audit_blob_crlf_history.py"
}

# ── Fixture git (o MESMO cenário do validate-all-text-alert.sh / do teste):
#    blob .md CRLF commitado ANTES do .gitattributes — com o atributo antes,
#    o git normalizaria CRLF→LF no check-in e o blob sairia LF. autocrlf=false
#    preserva os bytes crus (o exato cenário que o audit existe para pegar).
build_fixture() {
  rm -rf "$FIXTURE_DIR"
  mkdir -p "$FIXTURE_DIR"
  git -C "$FIXTURE_DIR" init -q
  git -C "$FIXTURE_DIR" config user.email "t@t"
  git -C "$FIXTURE_DIR" config user.name "t"
  git -C "$FIXTURE_DIR" config core.autocrlf "false"

  printf '# Titulo\r\n\r\nCorpo CRLF\r\n' > "$FIXTURE_DIR/fake.md"
  git -C "$FIXTURE_DIR" add fake.md
  git -C "$FIXTURE_DIR" commit -qm "adiciona fake.md CRLF"

  # .gitattributes SÓ depois do commit (senão o git normalizaria o blob)
  printf '*.md text eol=lf\n' > "$FIXTURE_DIR/.gitattributes"
}

# ── run_report: roda um produtor (wrapper) --all-text contra o fixture ───
# $1 = caminho do wrapper (real ou mutado). Retorna via REPORT_OUTPUT/EXIT.
run_report() {
  local wrapper="$1"
  set +e
  REPORT_OUTPUT="$(CHECK_CRLF_ROOT="$FIXTURE_DIR" bash "$wrapper" --all-text 2>&1)"
  REPORT_EXIT=$?
  set -e
}

# ── assert_control: produtor REAL → sentinel PRESENTE (gate acenderia) ───
assert_control() {
  info "Controle — produtor REAL + blob CRLF → sentinel deve APARECER (exit 0)..."
  run_report "$WRAPPER"
  echo "$REPORT_OUTPUT" | tail -4

  if [ "$REPORT_EXIT" -ne 0 ]; then
    fail "CONTROLE FALHOU: produtor real saiu com exit $REPORT_EXIT (esperado 0)."
    echo "$REPORT_OUTPUT" | tail -8
    fail "O fixture/produtor base não é válido — o mutation test não pode prosseguir."
    exit 1
  fi
  if ! grep -Fq "$SENTINEL" <<< "$REPORT_OUTPUT"; then
    fail "CONTROLE FALHOU: produtor REAL não imprimiu o sentinel '$SENTINEL' com o blob CRLF."
    fail "O fixture não acende o gate — a mutação não teria o que quebrar."
    exit 1
  fi
  pass "Controle OK — produtor real emite '$SENTINEL' com o blob CRLF (gate acenderia)"
}

# ── assert_mutation: produtor MUTADO → sentinel AUSENTE (o teste falharia) ─
assert_mutation() {
  info "Rodando produtor MUTADO (linha do sentinel removida) contra o MESMO fixture..."
  run_report "$MUT_DIR/audit-blob-crlf-history.sh"
  echo "$REPORT_OUTPUT" | tail -4

  # Caso 0 — infra: a mutação quebrou a varredura inteira (exit != 0). A
  # regressão real é CIRÚRGICA (só o sentinel morre, o scan segue rodando) —
  # um exit != 0 também faria o teste falhar, mas por motivo errado.
  if [ "$REPORT_EXIT" -ne 0 ]; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: produtor mutado saiu com exit $REPORT_EXIT (esperado 0)."
    fail "A remoção quebrou a varredura, não só o sentinel — verifique o padrão do sed."
    exit 1
  fi

  # Caso 1 — a varredura segue achando o ofensor (o blob é listado): prova
  # que a mutação removeu SÓ a linha do sentinel, não o mapeamento.
  if ! grep -Fq "fake.md" <<< "$REPORT_OUTPUT"; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: o blob ofensor 'fake.md' não foi listado."
    fail "A remoção quebrou o mapeamento — o teste falharia por motivo errado."
    exit 1
  fi

  # Caso 2 — GUARD CEGA: o produtor mutado AINDA emite o sentinel → o teste
  # validate-all-text-alert.test.ts passaria mesmo com a regressão (o grep do
  # job acharia) — exatamente a cegueira que este cenário existe para matar.
  if grep -Fq "$SENTINEL" <<< "$REPORT_OUTPUT"; then
    fail "GUARD CEGA: produtor MUTADO ainda emite '$SENTINEL'."
    fail "O validate-all-text-alert.test.ts passaria MESMO com a regressão — o teste"
    fail "não pega a remoção do sentinel. A asserção found_crlf=true não quebraria."
    exit 1
  fi

  pass "Regressão DETECTADA: produtor mutado NÃO emite '$SENTINEL' (o teste falharia)"
  pass "e ainda lista 'fake.md' (mutação cirúrgica — só o sentinel morreu)."
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (produtor do alerta all-text)"
echo "   Mutação: linha do sentinel 'com CRLF' removida do"
echo "   audit_blob_crlf_history.py (cópia em temp — real intocado)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ── Prepara a mutação e o fixture ────────────────────────────────────────

info "Copiando produtor para temp e removendo a linha do sentinel..."
build_mutated_producer

# Fail-fast da mutação: o real AINDA tem o sentinel e a cópia NÃO tem.
if grep -Fq "$SENTINEL" "$PY_REAL" && ! grep -Fq "$SENTINEL" "$MUT_DIR/audit_blob_crlf_history.py"; then
  pass "Mutação aplicada: sentinel removido da CÓPIA do produtor (real intocado)"
else
  fail "Mutação NÃO aplicou (sed falhou ou o produtor real já não emite o sentinel)."
  exit 1
fi

info "Criando fixture git (blob .md CRLF ANTES do .gitattributes)..."
build_fixture

# Byte-check do blob (o MESMO do validate-all-text-alert.sh — `od -An -c` +
# grep do literal '\r': portável Linux/MSYS, sem a tradução de pipe do grep).
if grep -Fq '\r' <<< "$(git -C "$FIXTURE_DIR" show HEAD:fake.md | od -An -c)"; then
  pass "Fixture válido: blob fake.md commitado com bytes CRLF (autocrlf=false)"
else
  fail "Fixture INVALIDO: blob fake.md sem CRLF — autocrlf interferiu?"
  exit 1
fi

# ── Controle (produtor real) → Mutação (produtor mutado) ─────────────────

assert_control

assert_mutation

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o validate-all-text-alert.test.ts pega a regressão do produtor:"
pass "  • controle: produtor real emite '$SENTINEL' com blob CRLF (teste passaria)"
pass "  • mutação: linha do sentinel removida → '$SENTINEL' AUSENTE (teste falharia)"
pass "  • mutação cirúrgica: o blob ofensor ainda é listado (só o sentinel morreu)"
pass "O arquivo real do produtor NÃO foi tocado (cópia em temp)."
exit 0
