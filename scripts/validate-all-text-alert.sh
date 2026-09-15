#!/usr/bin/env bash
# =============================================================================
# scripts/validate-all-text-alert.sh — valida o fluxo do job blob-crlf-all-text-alert
# (benchmark-weekly.yml) EM 1 COMANDO — o procedimento manual do docs/TESTING.md
# (fixture git real + REPORT --all-text + réplica do gate) automatizado para CI
# e devs.
#
# O job semanal roda o audit em modo REPORT (--all-text — exit 0 SEMPRE, CRLF
# em tipos benignos não é gate) e GREPA o output pelo sentinel 'com CRLF': se
# o mapeamento revelar CRLF em qualquer tipo `text eol=lf` do .gitattributes,
# o job falha com aviso (incidente visível no Actions em vez de mapeamento
# silencioso).
#
# Este script cria os fixtures git REAIS (mesmo procedimento do docs/TESTING.md):
#
#   Cenário 1 (CONTROLE — histórico limpo): fixture com .md LF + .gitattributes
#     → REPORT deve imprimir 'sem CRLF no histórico' e NÃO o sentinel 'com CRLF'
#     (o job passaria silenciosamente — sem falso positivo). NOTA: o assert usa
#     o discriminador ASCII 'sem CRLF' (não a frase completa com acento) — o
#     MSYS/Git Bash corrompe não-ASCII do output capturado via pipe ('ó' → '�').
#   Cenário 2 (ACHADO — blob .md CRLF): blob CRLF commitado ANTES do
#     .gitattributes (senão o git normaliza CRLF→LF no check-in e o blob sairia
#     LF — o exato cenário que o audit existe para pegar) → REPORT + réplica do
#     GATE do job: grep -Fq 'com CRLF' → found_crlf=true. Se o sentinel NÃO
#     aparecer, o grep do job estaria CEGO — falha (exit 1).
#
# Por que existe: o contrato do job CI é travado em teste unitário
# (benchmark-weekly-all-text-crlf-workflow.test.ts) e a consistência
# produtor↔job pelo guard check-sentinel-producer.mjs — mas NENHUM deles RODA
# o audit contra um blob CRLF real. Este script fecha o ciclo: prova o fluxo
# ponta-a-ponta (fixture → audit → gate) em 1 comando, sem depender do cron
# semanal — para CI (job dedicado no pr-check) e para devs que querem validar
# localmente sem montar o fixture na mão.
#
# Usage:
#   ./scripts/validate-all-text-alert.sh
#   bun run test:validate-all-text-alert
#
# Exit codes:
#   0 — ambos os cenários passaram (limpo sem sentinel; achado COM sentinel)
#   1 — guard cega (sentinel ausente no achado) OU falso positivo (sentinel
#       presente no limpo) OU falha de infra/asserção
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AUDIT="$SCRIPT_DIR/scripts/audit-blob-crlf-history.sh"
SENTINEL="com CRLF"

TMP_DIR="$(mktemp -d)"

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ── Cleanup (trap EXIT — SEMPRE remove o temp, mesmo com falha) ──────────
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# ── build_fixture: (re)cria o repo git fixture limpo ─────────────────────
# Idempotente — usado no CONTROLE e no ACHADO (que parte de um fixture
# limpo de novo, já que o CONTROLE sujou o histórico do repo).
# autocrlf=false é ESSENCIAL: preserva os bytes CRLF no blob (com autocrlf
# true o git converteria no check-in e o audit não acharia nada).
build_fixture() {
  rm -rf "$TMP_DIR"
  mkdir -p "$TMP_DIR"
  git -C "$TMP_DIR" init -q
  git -C "$TMP_DIR" config user.email "t@t"
  git -C "$TMP_DIR" config user.name "t"
  git -C "$TMP_DIR" config core.autocrlf "false"
}

# ── run_report: roda o REPORT --all-text contra o fixture e imprime ─────
# Retorna via variáveis globais REPORT_EXIT e REPORT_OUTPUT (set +e no
# caller para capturar o exit sem abortar o script com set -e).
run_report() {
  set +e
  REPORT_OUTPUT="$(CHECK_CRLF_ROOT="$TMP_DIR" bash "$AUDIT" --all-text 2>&1)"
  REPORT_EXIT=$?
  set -e
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — VALIDATE ALL-TEXT ALERT (fixture → audit → gate)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# CENÁRIO 1 — CONTROLE: histórico limpo (LF) → sentinel NÃO deve aparecer
# ═════════════════════════════════════════════════════════════════════════

info "Cenário 1 (CONTROLE): fixture com .md LF + .gitattributes..."

build_fixture

# .gitattributes ANTES do commit é seguro aqui (arquivo LF — nada a
# normalizar): o git normaliza LF→LF, blob fica LF.
printf '*.md text eol=lf\n' > "$TMP_DIR/.gitattributes"
printf '# Titulo\n\nCorpo LF\n' > "$TMP_DIR/fake.md"
git -C "$TMP_DIR" add .gitattributes fake.md
git -C "$TMP_DIR" commit -qm "fixture limpo (LF)"

pass "Fixture limpo criado (.md LF + .gitattributes)"

info "Rodando REPORT --all-text contra o fixture LIMPO..."
run_report
echo "$REPORT_OUTPUT" | tail -4

if [ "$REPORT_EXIT" -ne 0 ]; then
  fail "REPORT falhou no CONTROLE (exit $REPORT_EXIT) — esperado 0 (REPORT sempre)."
  fail "Infra quebrada — o cenário não pode ser validado."
  exit 1
fi

# O sentinel NÃO pode aparecer no estado limpo (senão o job CI acenderia em
# falso — um falso positivo que tornaria o alerta inútil).
if grep -Fq "$SENTINEL" <<< "$REPORT_OUTPUT"; then
  fail "FALSO POSITIVO: sentinel '$SENTINEL' apareceu com histórico LIMPO."
  fail "O job CI alertaria sem motivo — verifique a saída acima."
  exit 1
fi

# NOTA DE PORTABILIDADE (MSYS): o output do audit tem não-ASCII (em-dash
# '—' e 'ó' em 'histórico'). Capturado via pipe no Git Bash/Windows, esses
# bytes viram '�' — um grep na frase COMPLETA ('sem CRLF no histórico')
# quebraria localmente no Windows mesmo com o produtor correto. O assert usa
# o discriminador ASCII 'sem CRLF' (presente no caminho limpo, ausente no
# caminho de achados) — portável Linux/Windows e igualmente source-coupled.
if ! grep -Fq "sem CRLF" <<< "$REPORT_OUTPUT"; then
  fail "CONTROLE FALHOU: estado limpo não imprimiu 'sem CRLF'."
  fail "A saída do audit mudou — o assert source-coupled abaixo quebrou."
  exit 1
fi

pass "Controle OK — limpo: 'sem CRLF', sem o sentinel '$SENTINEL'"

echo ""

# ═════════════════════════════════════════════════════════════════════════
# CENÁRIO 2 — ACHADO: blob .md CRLF commitado ANTES do .gitattributes
# ═════════════════════════════════════════════════════════════════════════
# O cenário real do audit: CRLF commitado no passado (autocrlf off) e o
# .gitattributes adicionado DEPOIS — o blob histórico guarda os bytes CRLF.
# Se o .gitattributes viesse ANTES, o git normalizaria no check-in e o blob
# sairia LF (é exatamente a regressão que o audit existe para pegar).
# ═════════════════════════════════════════════════════════════════════════

info "Cenário 2 (ACHADO): blob .md CRLF commitado ANTES do .gitattributes..."

build_fixture

printf '# Titulo\r\n\r\nCorpo CRLF\r\n' > "$TMP_DIR/fake.md"
git -C "$TMP_DIR" add fake.md
git -C "$TMP_DIR" commit -qm "adiciona fake.md CRLF"

# .gitattributes SÓ depois do commit (senão o git normalizaria o blob)
printf '*.md text eol=lf\n' > "$TMP_DIR/.gitattributes"

# Fail-fast: o blob commitado REALMENTE tem CRLF? (o audit lê bytes via
# cat-file — uma verificação direta garante que a mutação aplicou).
#
# BYTE-CHECK ROBUSTO (lição documentada no header do audit_blob_crlf_history.py:
# `grep -q $'\r'` falha silenciosamente no MSYS — retorna 0 mesmo em arquivos
# LF por tradução de pipe). `od -An -c` imprime CR como a sequência ASCII
# '\r' (2 chars) — o grep -Fq casa o literal, portável Linux/Windows.
if grep -Fq '\r' <<< "$(git -C "$TMP_DIR" show HEAD:fake.md | od -An -c)"; then
  pass "Mutação aplicada: blob fake.md commitado com bytes CRLF"
else
  fail "Mutação NÃO aplicou (blob fake.md sem CRLF) — autocrlf interferiu?"
  exit 1
fi

info "Rodando REPORT --all-text + réplica do GATE do job CI..."
run_report
echo "$REPORT_OUTPUT" | tail -4

# ── Réplica do gate do job blob-crlf-all-text-alert (benchmark-weekly.yml):
#    report_exit=${PIPESTATUS[0]}   (REPORT → 0; != 0 = falha de infra)
#    if grep -Fq 'com CRLF' report; then found_crlf=true
# O REPORT é exit 0 SEMPRE (mesmo com achados) — o gatilho ATIVO é o grep.
if [ "$REPORT_EXIT" -ne 0 ]; then
  fail "REPORT falhou (exit $REPORT_EXIT) — o job ALERTARIA por infra (report_exit != '0')."
  fail "Verifique o log acima (ex.: stream do cat-file truncado)."
  exit 1
fi

if grep -Fq "$SENTINEL" <<< "$REPORT_OUTPUT"; then
  pass "Sentinel '$SENTINEL' PRESENTE — o job ALERTARIA (found_crlf=true)"
else
  fail "GUARD CEGA: sentinel '$SENTINEL' AUSENTE com blob CRLF commitado."
  fail "O grep do job nunca acenderia — 'não achou' viraria falso positivo de 'limpo'."
  fail "O produtor (audit_blob_crlf_history.py) parou de emitir o sentinel?"
  exit 1
fi

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   📊 RESUMO — validate all-text alert"
echo "  ═════════════════════════════════════════════════════════════════"
printf "   %-10s %-6s %s\n" "Cenário" "Result" "Status"
printf "   %-10s ${GREEN}%-6s${NC} ✅  %s\n" "limpo" "PASS" "sem sentinel"
printf "   %-10s ${GREEN}%-6s${NC} ✅  %s\n" "achado" "PASS" "sentinel presente"
echo ""
pass "VALIDATE ALL-TEXT ALERT PASSED — o gate do job pega o achado e ignora o limpo."
exit 0
