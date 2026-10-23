#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-caddy-validate.sh — Mutation test do guard de parse do
# Caddyfile (`scripts/check-caddy-validate.sh`)
#
# Usage:
#   bash scripts/test-mutation-caddy-validate.sh
#
# Exit codes:
#   0 — as DUAS metades foram DETECTADAS (o guard mutado muda de veredito sobre
#       um Caddyfile REAL com defeito injetado, e o modo stock desligado volta
#       a reprovar o arquivo íntegro) e o controle passou ✅
#   1 — a metade NÃO sustentou o veredito (guard cego), mutação não-cirúrgica
#       ou restauração falhou ❌
#   2 — infra: docker ausente / imagem stock indisponível (o sujeito do guard
#       é um Caddy REAL em container — sem ele não há medição, declarado)
#
# O QUE ISTO PROVA (e por que o guard passar hoje não basta)
#
# O `check-caddy-validate.sh` existe porque o Caddyfile.prod já envelheceu
# SOZINHO uma vez: o `storage file:///data/caddy` (módulo inexistente)
# crashava o boot inteiro sem ninguém ver. O valor do guard é a REGRA — e a
# regra tem DUAS metades load-bearing, cada uma com a sua mutação aqui:
#
#   M1 — A RECUSA DO VEREDITO. O julgamento acontece DUAS vezes no guard: o
#       `docker run` sai não-zero quando o Caddy reprova o arquivo, e o ramo
#       de reprovação (o `echo ❌` + o `grep` do erro + o `return 1`) é o que
#       transforma a saída do container em exit 1. A metade desliga a recusa
#       nos DOIS ramos (stock e full — o texto é idêntico) e exige que o
#       comportamento MUDE: com uma diretiva inválida DENTRO de um site-block
#       injetada no Caddyfile REAL, o guard íntegro sai 1 nomeando a diretiva
#       (`unrecognized directive`) e o cego sai 0 publicando o verde. A lição
#       da mutação mal feita está medida e escrita: NEUTRALIZAR o `grep -q
#       "Valid configuration"` não muda NADA (o docker run já reprova antes,
#       medido nesta estação), e tokens soltos APÓS o último `}` viram
#       "site-blocks vazios" VÁLIDOS para o parser — a injeção é DENTRO do
#       site principal, a classe que o guard existe para impedir.
#
#   M2 — A EXCLUSÃO DO MODO STOCK. A stock não conhece os plugins da imagem
#       custom (`rate_limit`, `format transform` — ver Dockerfile.caddy); o
#       python embutido os remove ANTES da prova e é isso que permite ao modo
#       stock sancionar o resto. A metade desliga a exclusão (as TRÊS linhas
#       contíguas do python, UMA cirurgia) e exige que o comportamento MUDE:
#       a stock volta a reprovar o Caddyfile.prod ÍNTEGRO — sem a exclusão o
#       modo stock não sanciona nada, e a lista vira o contrato que mantém o
#       modo stock útil (e sincronizado com o Dockerfile.caddy).
#
# DUAS TESTEMUNHAS INDEPENDENTES
#
#   (1) A EXECUÇÃO REAL — o guard (mutado, quando há mutação) roda `docker
#       run` na imagem stock caddy:2-alpine contra o Caddyfile REAL do repo
#       (com a mutação de CONTEÚDO aplicada pela própria suíte, restaurada
#       por checksum). É a MESMA mediação do CI: nenhum driver sintético.
#   (2) O CONTRATO DO SCRIPT (`src/lib/__tests__/check-caddy-validate.test.ts`)
#       — a testemunha que cai sob a M2 é o teste de EXECUÇÃO REAL da suíte
#       ("modo stock no repo real → exit 0"), a mesma mediação que roda em
#       todo PR; sob a mutação ele fica vermelho, e a âncora garante que o
#       vermelho é o da metade medida. O teste TEXTUAL da lista de plugins
#       permanece verde sob esta mutação (o `contains` casa nos comentários e
#       nos ramos mortos do payload) — declarado: ele NÃO é a testemunha da
#       M2. Sem `vitest` instalado, a testemunha se declara NÃO JULGÁVEL em
#       voz alta (a execução real SEGUE medindo).
#
# A CIRURGIA: cada injeção casa o número EXATO de ocorrências declarado
# (`mutacao_aplicar`, a régua única — a M1 substitui as 2 cópias da recusa,
# uma por ramo; a M2, o bloco único do python), e a restauração é conferida
# por CHECKSUM entre as metades e no trap EXIT — um `exit` no meio não deixa
# guard nem Caddyfile mutados na árvore.
#
# LIMITES DECLARADOS (o que esta prova NÃO cobre):
#   · o modo full com a imagem custom não é exercitado aqui (a detecção de
#     erro de parse é a MESMA linha nas duas imagens — a M1 desliga a recusa
#     dos dois ramos de uma vez); o full íntegro roda no CI de PR;
#   · o flake do daemon docker não é re-mediado aqui — o master (que chama
#     esta suíte) re-mede o vermelho uma vez antes de virar veredito.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

# O SCRATCH DAS FIXTURES é estável, fora do /tmp e fora do repositório (o
# motivo inteiro está no cabeçalho do master `test-mutation-guards.sh`).
MUT_SCRATCH="${MUT_SCRATCH:-${XDG_CACHE_HOME:-$HOME/.cache}/severinno-mutacao}"
mkdir -p "$MUT_SCRATCH" 2>/dev/null || {
  echo "❌ o scratch das fixtures não pôde ser criado: $MUT_SCRATCH (infra declarada)" >&2
  exit 2
}

# A PROVA-DE-APLICAÇÃO — a régua ÚNICA de "a mutação APLICOU" (o gabarito dela
# é `scripts/test-mutation-mutacao-prova.sh`).
# shellcheck source=scripts/mutacao-prova.sh
. "$SCRIPT_DIR/scripts/mutacao-prova.sh"

# ── METADES DESTA SUÍTE (fonte única do master e da doc) ──────────────────
METADES=(
  'M1|a RECUSA do veredito: o guard deixa de julgar o que o Caddy real disse e aceita um Caddyfile com diretiva inválida dentro de um site-block (a classe do storage morto volta a passar em silêncio)'
  'M2|a EXCLUSÃO do modo stock: as diretivas de plugin deixam de ser removidas e a stock volta a reprovar o Caddyfile ÍNTEGRO (sem a exclusão, o modo stock não sanciona nada)'
)

# ── INFRA DECLARADA: sem docker, não há medição ────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "❌ docker ausente — o sujeito do guard é um Caddy REAL em container (infra declarada)" >&2
  exit 2
fi
STOCK_IMAGE="${CADDY_STOCK_IMAGE:-caddy:2-alpine}"
if ! docker image inspect "$STOCK_IMAGE" >/dev/null 2>&1 && ! docker pull -q "$STOCK_IMAGE" >/dev/null 2>&1; then
  echo "❌ imagem $STOCK_IMAGE indisponível (infra declarada)" >&2
  exit 2
fi

GUARD="scripts/check-caddy-validate.sh"
CADDYFILE="Caddyfile.prod"
SUITE="src/lib/__tests__/check-caddy-validate.test.ts"
# A âncora da M2 na testemunha unitária: o teste de EXECUÇÃO REAL (o título
# como o vitest o reporta) — é ele que cai com o modo stock cego. O teste
# textual da lista segue verde sob a mutação (ver cabeçalho).
ANCORA_M2="modo stock no repo real"

TMP_DIR="$(mktemp -d "$MUT_SCRATCH/mut-caddy-XXXXXX")"

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }
header() { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }

# ── Backup das DUAS FONTES + restauração VERIFICADA (trap EXIT) ───────────
# A mutação de GUARD é aplicada no lugar (é o arquivo que roda e que a suíte
# unitária lê); a de CONTEÚDO, no Caddyfile REAL. Os checksums são a
# testemunha de que a árvore voltou inteira.
BACKUP_GUARD="$TMP_DIR/guard.original.sh"
BACKUP_CADDYFILE="$TMP_DIR/Caddyfile.original"
cp "$GUARD" "$BACKUP_GUARD"
cp "$CADDYFILE" "$BACKUP_CADDYFILE"
GUARD_SUM="$(cksum "$GUARD" | cut -d' ' -f1)"
CADDYFILE_SUM="$(cksum "$CADDYFILE" | cut -d' ' -f1)"

restore() {
  if [ -f "$BACKUP_GUARD" ]; then cp -f "$BACKUP_GUARD" "$GUARD" 2>/dev/null || true; fi
  if [ -f "$BACKUP_CADDYFILE" ]; then cp -f "$BACKUP_CADDYFILE" "$CADDYFILE" 2>/dev/null || true; fi
  rm -rf "$TMP_DIR"
}
trap restore EXIT

restaurar_guard() {
  cp -f "$BACKUP_GUARD" "$GUARD"
  if [ "$(cksum "$GUARD" | cut -d' ' -f1)" != "$GUARD_SUM" ]; then
    fail "RESTAURAÇÃO FALHOU (checksum do guard diverge) — restaure a partir de $BACKUP_GUARD"
    exit 1
  fi
  pass "guard restaurado (checksum confere)"
}

restaurar_caddyfile() {
  cp -f "$BACKUP_CADDYFILE" "$CADDYFILE"
  if [ "$(cksum "$CADDYFILE" | cut -d' ' -f1)" != "$CADDYFILE_SUM" ]; then
    fail "RESTAURAÇÃO FALHOU (checksum do Caddyfile diverge) — restaure a partir de $BACKUP_CADDYFILE"
    exit 1
  fi
  pass "Caddyfile restaurado (checksum confere)"
}

# ── A MEDIAÇÃO: o guard REAL contra o Caddyfile REAL ──────────────────────
rodar_guard() { # $1 = modo (--stock | --full)
  set +e
  bash "$GUARD" "$1" >"$TMP_DIR/guard.out" 2>&1
  GUARD_EXIT=$?
  set -e
}

exigir_exit() { # <esperado> <cenário>
  local esperado="$1" cenario="$2"
  if [ "$GUARD_EXIT" -ne "$esperado" ]; then
    fail "$cenario: o guard saiu $GUARD_EXIT e devia sair $esperado"
    sed 's/^/      /' "$TMP_DIR/guard.out" | tail -8
    exit 1
  fi
  pass "$cenario (exit $esperado)"
}

exigir_contem_saida() { # <trecho> <cenário>
  local trecho="$1" cenario="$2"
  if ! grep -qF "$trecho" "$TMP_DIR/guard.out"; then
    fail "$cenario: a saída do guard não contém '$trecho'"
    sed 's/^/      /' "$TMP_DIR/guard.out" | tail -8
    exit 1
  fi
  pass "$cenario (saída contém '$trecho')"
}

# ── mutar <alvo> <troca> <contagem>: a régua compartilhada + sintaxe bash ──
# O python mutado da M2 NÃO tem checagem de sintaxe própria: se a troca o
# quebrasse, o guard sairia 2 ("falha ao preparar a cópia stock") e o
# `exigir_exit` seguinte derrubaria a suíte com a saída na tela — o
# fail-closed já cobre o caso (uma mutação quebrada não finge o vermelho).
mutar_guard() { # <alvo-texto> <troca-texto> <contagem>
  mutacao_aplicar "$GUARD" "$1" "$2" "$GUARD_SUM" "$3"
  if ! bash -n "$GUARD" >/dev/null 2>&1; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: $GUARD mutado não é bash válido."
    exit 1
  fi
}

# ── A testemunha unitária (o contrato do script) ──────────────────────────
suite_disponivel() { [ -d "$SCRIPT_DIR/node_modules/vitest" ]; }

rodar_suite() {
  set +e
  (cd "$SCRIPT_DIR" && NO_COLOR=1 bun x vitest run --config vitest.config.unit.ts "$SUITE") \
    >"$TMP_DIR/suite.bruto" 2>&1
  SUITE_EXIT=$?
  set -e
  # ANSI FORA antes de julgar (o vitest colore mesmo com a saída redirecionada).
  sed -E $'s/\033\\[[0-9;]*[a-zA-Z]//g' "$TMP_DIR/suite.bruto" >"$TMP_DIR/suite.txt"
  FAIL_LINES="$(grep -E "^[[:space:]]*(FAIL|×)" "$TMP_DIR/suite.txt" || true)"
}

mostrar_suite() { grep -E "^[[:space:]]*(FAIL|×)|Tests " "$TMP_DIR/suite.txt" | sed 's/^/      /' | head -12; }

exigir_suite_verde() {
  local cenario="$1"
  if ! suite_disponivel; then
    info "$cenario (suíte): NÃO julgada — node_modules/vitest ausente neste job (declarado; a execução real SEGUE medindo)"
    return 0
  fi
  rodar_suite
  if [ "$SUITE_EXIT" -ne 0 ]; then
    fail "$cenario: a suíte ficou VERMELHA sem mutação — o vermelho seguinte não provaria nada (ambiente)"
    mostrar_suite
    exit 1
  fi
  pass "$cenario: suíte VERDE (exit 0) — a testemunha mede"
}

# exigir_suite_vermelha <cenário> <âncora da metade mutada>
exigir_suite_vermelha() {
  local cenario="$1" ancora="$2"
  if ! suite_disponivel; then
    info "$cenario (suíte): NÃO julgada (vitest ausente, declarado)"
    return 0
  fi
  rodar_suite
  if [ "$SUITE_EXIT" -eq 0 ]; then
    fail "$cenario: a suíte ficou VERDE com o mecanismo desligado — ele não é load-bearing"
    mostrar_suite
    exit 1
  fi
  if ! grep -qF "$ancora" <<<"$FAIL_LINES"; then
    fail "$cenario: vermelho pelo motivo ERRADO — a âncora da metade mutada não caiu:"
    echo "      · $ancora"
    mostrar_suite
    exit 1
  fi
  pass "$cenario: suíte VERMELHA pela metade mutada"
}

# ── O DEFETO INJETADO no Caddyfile (a classe do storage morto) ────────────
# Uma diretiva que NENHUM Caddy conhece, DENTRO do site principal (a mutação
# de fim-de-arquivo não morde: tokens após o último `}` viram site-blocks
# vazios VÁLIDOS — medido e documentado no GUARDS.md).
injetar_diretiva_invalida() {
  python3 - "$CADDYFILE" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
anchor = "{$DOMAIN:severinno.com.br}, www.{$DOMAIN:severinno.com.br} {\n"
assert s.count(anchor) == 1, "âncora do site principal não é única"
i = s.index(anchor) + len(anchor)
open(p, "w", encoding="utf-8").write(s[:i] + "  diretriz_inexistente_mutada on\n" + s[i:])
PY
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   MUTATION TEST — o guard de parse do Caddyfile ($GUARD)"
echo "  ═════════════════════════════════════════════════════════════════"

pass "Backup do guard e do Caddyfile; checksums $GUARD_SUM / $CADDYFILE_SUM"

# ── CONTROLE: o guard íntegro sanciona o arquivo íntegro ──────────────────
header "CONTROLE — o guard íntegro: Caddyfile íntegro sai 0 no modo stock"
rodar_guard --stock
exigir_exit 0 "o validate REAL aceita o Caddyfile íntegro"
exigir_contem_saida "válido na stock" "o veredito é o do modo stock"

# ── M1: a RECUSA do veredito ──────────────────────────────────────────────
header "M1 — a recusa do veredito é desligada (diretiva inválida dentro de um site-block PASSA)"
injetar_diretiva_invalida
# O guard íntegro REPROVA o defeito (a medição da classe, antes de mutar o guard):
rodar_guard --stock
exigir_exit 1 "com o defeito injetado, o guard ÍNTEGRO reprova (unrecognized directive)"
exigir_contem_saida "diretriz_inexistente_mutada" "e NOMEIA a diretiva"
# A metade: o ramo de reprovação (o `echo ❌` + o `grep` do erro + o `return 1`)
# vira eco+mudança de marca e NADA — nos DOIS ramos (stock e full), que
# compartilham o texto idêntico; sem o `return 1`, a função termina 0.
MUT_ALVO_M1=$(cat <<'ALVO'
  echo "[caddy-validate] ❌ o Caddy REPROVA o arquivo:" >&2
  grep -E "Error|error" "$WORK/validate.out" | head -10 >&2
  return 1
ALVO
)
MUT_TROCA_M1=$(cat <<'TROCA'
  echo "[caddy-validate] ❌ o Caddy REPROVA o arquivo: (MUTACAO M1: a recusa do veredito é desligada)" >&2
  : # MUTACAO M1: o erro real fica no validate.out e a recusa vira nada
TROCA
)
mutar_guard "$MUT_ALVO_M1" "$MUT_TROCA_M1" 2
rodar_guard --stock
exigir_exit 0 "M1: o guard CEGO aceita o Caddyfile com diretiva inválida — o CI ficaria VERDE"
if grep -qF "válido na stock" "$TMP_DIR/guard.out"; then
  fail "M1: o guard cego PUBLICOU uma sanção que o Caddy não deu — a mutação não é cirúrgica"
  exit 1
fi
pass "M1: e sem sanção falsa — o verde sai porque a RECUSA sumiu, não porque o arquivo passou"
restaurar_guard
restaurar_caddyfile
rodar_guard --stock
exigir_exit 0 "na árvore restaurada, o guard volta a sancionar o íntegro"

# ── M2: a EXCLUSÃO do modo stock ──────────────────────────────────────────
header "M2 — a exclusão de plugins do modo stock é desligada (a stock volta a reprovar o íntegro)"
rodar_guard --stock
exigir_exit 0 "sem mutação: a stock aceita o íntegro GRÂÇAS à exclusão"
# A metade: as TRÊS linhas contíguas do python (o drop_block do rate_limit, o
# findall e o re.sub das linhas format transform) viram no-op, UMA cirurgia.
MUT_ALVO_M2=$(cat <<'ALVO'
s, n_rate = drop_block(s, r'(?m)^\s*rate_limit\s*\{')
n_fmt = len(re.findall(r'(?m)^\s*format\s+transform\s+', s))
s = re.sub(r'(?m)^\s*format\s+transform\s+.*\n', '', s)
ALVO
)
MUT_TROCA_M2=$(cat <<'TROCA'
s, n_rate = (s, 0) if True else drop_block(s, r'(?m)^\s*rate_limit\s*\{')  # MUTACAO M2: a exclusão é desligada
n_fmt = 0 if True else len(re.findall(r'(?m)^\s*format\s+transform\s+', s))  # MUTACAO M2
s = re.sub(r'(?m)^\s*format\s+transform\s+.*\n', '', s) if False else s  # MUTACAO M2
TROCA
)
mutar_guard "$MUT_ALVO_M2" "$MUT_TROCA_M2" 1
rodar_guard --stock
exigir_exit 1 "M2: sem a exclusão, a stock REPROVA o Caddyfile ÍNTEGRO (rate_limit = unrecognized directive)"
exigir_contem_saida "rate_limit" "M2: e o motivo é o plugin que a exclusão removeia"
# A testemunha corre COM o guard ainda mutado (a ordem é a prova: restaurar
# antes seria medir a árvore íntegra).
exigir_suite_vermelha "M2" "$ANCORA_M2"
restaurar_guard

# ── FECHO ─────────────────────────────────────────────────────────────────
header "FECHO"
restaurar_caddyfile
rodar_guard --stock
exigir_exit 0 "o guard restaurado sanciona o Caddyfile íntegro"
exigir_suite_verde "FECHO"
pass "as metades M1 (recusa do veredito) e M2 (exclusão do stock) foram detectadas; guard e Caddyfile restaurados"
echo ""
