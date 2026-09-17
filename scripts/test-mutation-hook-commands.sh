#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-hook-commands.sh — Mutation test do guard dos comandos
# que os HOOKS executam (scripts/check-hook-commands.mjs)
#
# Usage:
#   ./scripts/test-mutation-hook-commands.sh
#
# Exit codes:
#   0 — as QUATRO mutações foram DETECTADAS (pelo gate e/ou pela suíte) e os
#       controles passaram ✅
#   1 — guard INDIFERENTE a alguma mutação (não cegou / não acusou) OU controle
#       falso ❌
#
# O QUE ISTO PROVA (e por que não basta o guard passar hoje)
#
# Um gate que roda e sai 0 prova que ele não ACUSOU — não prova que ele MEDIU.
# Este script muta CADA mecanismo do guard e exige que o veredito MUDE: se
# mutar um deles não muda nada, aquele mecanismo não sustenta a promessa (é
# decoração) e some do repositório no primeiro refactor sem ninguém notar.
#
# A promessa do guard é "todo comando que os hooks executam RESOLVE para um
# arquivo ou script real". Os mecanismos que ela usa são quatro, e cada um tem
# aqui a sua mutação — três na direção de CEGAR (deixar passar o comando que
# nunca rodaria) e uma na direção de ACUSAR O SÃO (violação falsa, que trava
# merge legítimo):
#
#   M1 — A EXISTÊNCIA DO CAMINHO (`arquivoExiste`). Aceitar qualquer caminho
#        como existente é a cegueira mais direta do guard: o `node
#        scripts/typo.mjs` do hook — o erro de digitação que o gate existe para
#        pegar — passa a sair VERDE, e o passo que nunca roda entra no commit.
#   M2 — A ENTRADA DE `scripts` DO package.json. `bun run <entrada>` resolve a
#        entrada E o que ela executa. Aceitar a entrada ausente CEGA o guard no
#        caminho mais usado do hook (o `bun run tipecheck` de um script que
#        ninguém criou) — e, de quebra, todo comando que a entrada real
#        carrega deixa de ser julgado.
#   M3 — A DECISÃO DECLARADA (INDETERMINATE). O guard é fail-closed: o que ele
#        não consegue provar por leitura (payload de runtime, caminho montado em
#        `$VAR`) só passa se estiver DECLARADO, com data. Devolver
#        `indeterminado` sem olhar a lista transforma "não provei, e é uma
#        decisão datada" em "não provei, e tanto faz" — que é exatamente a
#        promessa que o guard existe para negar.
#   M4 — A FUNÇÃO DO PRÓPRIO HOOK. O hook de verdade chama as suas funções
#        (`wait_all $PID_A ...`) e elas NÃO são arquivos do repositório: quem as
#        resolve é a lista derivada das definições do próprio hook. Remover essa
#        regra não deixa o guard cego — ele passa a ACUSAR o hook real (violação
#        falsa num gate bloqueante). Por isso esta mutação é medida na direção
#        contrária: o CONTROLE A (repo real verde) tem de VIRAR vermelho.
#
# A SEGUNDA TESTEMUNHA (a suíte unitária). As mutações M1–M4 são aplicadas no
# arquivo do repositório e, além do veredito do CLI, exigem a suíte
# `check-hook-commands.test.ts` VERMELHA — a suíte é o que roda em todo PR e é
# ela que tem de notar a regressão quando o guard for editado. Onde o vitest não
# está instalado o motivo é DITO (nunca silencioso): o exit code de uma suíte
# que não rodou não é veredito.
#
# COMO (e por que assim): o guard REAL é executado contra um mini-repo fixture
# em mktemp (nunca contra o worktree, exceto no M4, cuja violação falsa só
# aparece no hook real) e a evidência é o EXIT CODE dele — não a leitura do
# código do guard. Um harness que LÊ o código mede a intenção; este mede o
# comportamento. As mutações são aplicadas NO LUGAR, no arquivo do repositório,
# com backup + restauração VERIFICADA por checksum (trap EXIT): um `exit` no
# meio não pode deixar a árvore com a mutação dentro.
#
# Pipeline:
#   1. CONTROLE A — o guard REAL passa no repositório de verdade (sem dívida)
#   2. CONTROLE B (SENSIBILIDADE) — o guard REAL REPROVA as três fixtures de
#      defeito (caminho que não existe, entrada de `scripts` que não existe,
#      payload de runtime NÃO declarado). Sem esta metade, "ficou cego" não
#      significaria nada (um guard já cego passaria em tudo).
#   3. MUTAÇÃO M1 (a existência do caminho) — o caminho tipado passa (CEGO)
#   4. MUTAÇÃO M2 (a entrada do package.json) — `bun run` de entrada ausente
#      passa (CEGO)
#   5. MUTAÇÃO M3 (a decisão declarada) — o payload não declarado passa
#      (CEGO), e a decisão DECLARADA segue verde (cirúrgica)
#   6. MUTAÇÃO M4 (a função do próprio hook) — o hook REAL passa a ser ACUSADO
#      (violação falsa), e as três fixtures de defeito seguem reprovadas
#   7. Restauração VERIFICADA (checksum) + CONTROLE FINAL: o guard volta a
#      reprovar o caminho tipado, provando que a árvore ficou como estava
#   8. Cleanup (trap EXIT — restaura o guard e remove o temp, mesmo com falha)
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-hook-commands.mjs"
SUITE_ARQUIVO="src/lib/__tests__/check-hook-commands.test.ts"

TMP_DIR="$(mktemp -d)"
FX_TYPO="$TMP_DIR/fx-typo"
FX_ENTRADA="$TMP_DIR/fx-entrada"
FX_RUNTIME="$TMP_DIR/fx-runtime"

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

# ── Backup da FONTE + restauração VERIFICADA (trap EXIT) ──────────────────
# As mutações são aplicadas NO LUGAR, no arquivo do repositório (é ele que a
# suíte unitária importa). O backup e a restauração entram no MESMO trap,
# porque um `exit` no meio do caminho não pode deixar a árvore mutada.
guard_backup="$TMP_DIR/guard.original.mjs"
cp "$GUARD" "$guard_backup"
guard_sum="$(cksum "$GUARD" | cut -d' ' -f1)"

cleanup() {
  cp -f "$guard_backup" "$GUARD" 2>/dev/null || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

restaurar_original() {
  cp -f "$guard_backup" "$GUARD"
  if [ "$(cksum "$GUARD" | cut -d' ' -f1)" != "$guard_sum" ]; then
    fail "RESTAURAÇÃO FALHOU (checksum diverge) — restaure a partir de $guard_backup"
    exit 1
  fi
}

# ── mutar_guard: substituição CIRÚRGICA (exatamente 1 ocorrência) ─────────
# Uma mutação que casa 0 ou 2+ vezes não é cirúrgica: o script para em vez de
# medir outra coisa. O marcador "MUTACAO M" no texto novo é o que prova que a
# mutação APLICOU (o alvo pode existir e a escrita falhar).
mutar_guard() {
  GUARD="$GUARD" ALVO="$1" NOVO="$2" python3 - <<'PY'
import os
p = os.environ["GUARD"]
old, new = os.environ["ALVO"], os.environ["NOVO"]
s = open(p).read()
n = s.count(old)
if n != 1:
    raise SystemExit(f"mutacao nao-cirurgica no guard: {n} ocorrencia(s) do alvo (esperado 1)")
open(p, "w").write(s.replace(old, new))
PY
  if ! grep -qF 'MUTACAO M' "$GUARD"; then
    fail "a mutação não aplicou no guard (nada a medir)"
    exit 1
  fi
  if [ "$(cksum "$GUARD" | cut -d' ' -f1)" = "$guard_sum" ]; then
    fail "a mutação não alterou o guard (checksum idêntico) — o alvo casou mas a escrita não"
    exit 1
  fi
}

# ── mkfixture: um mini-repo com UM hook e um package.json mínimo ──────────
# O guard precisa das DUAS âncoras (`.husky/` e `package.json`) para julgar:
# sem qualquer delas ele sai 2 (INDETERMINADO), e o fixture mediria a ausência
# do arquivo em vez da regra.
mkfixture() {
  local raiz="$1" corpo="$2"
  mkdir -p "$raiz/.husky"
  printf 'set -eu\n%s\n' "$corpo" > "$raiz/.husky/pre-commit"
  cat > "$raiz/package.json" <<'JSON'
{
  "name": "fixture-da-prova",
  "scripts": { "outra-coisa": "node scripts/outra-coisa.mjs" }
}
JSON
}

# ── rodar_guard: roda o guard (real ou mutado) contra a fixture ───────────
# Devolve exit e saída em GUARD_EXIT / GUARD_OUT (globais).
rodar_guard() {
  set +e
  GUARD_OUT="$(node "$GUARD" --root "$1" 2>&1)"
  GUARD_EXIT=$?
  set -e
}

# ── rodar_guard_real: o guard contra o REPOSITÓRIO (sem --root) ───────────
# É o único lugar em que a medição é sobre o hook de verdade: a regra da função
# própria não tem fixture que a represente (o `wait_all` é do hook real).
rodar_guard_real() {
  set +e
  GUARD_OUT="$(cd "$SCRIPT_DIR" && node "$GUARD" 2>&1)"
  GUARD_EXIT=$?
  set -e
}

# ── rodar_suite: a segunda testemunha (a suíte unitária do guard) ──────────
# Só é CHAMADA quando o vitest está instalado: sem ele a suíte não julga nada,
# e tratar "não rodou" como "mutante morto" seria a mentira mais fácil de todas
# (uma suíte vermelha por ambiente mataria qualquer mutação no papel).
suite_disponivel() { [ -d "$SCRIPT_DIR/node_modules/vitest" ]; }

rodar_suite() {
  set +e
  SUITE_OUT="$(cd "$SCRIPT_DIR" && bun x vitest run --config vitest.config.unit.ts "$SUITE_ARQUIVO" 2>&1 | tail -8)"
  SUITE_EXIT=$?
  set -e
}

# ── Asserções do veredito (medem o CLI, não a intenção) ───────────────────
mostrar() { echo "$GUARD_OUT" | head -4 | sed 's/^/      /'; }

exigir_reprovado() {
  local cenario="$1" raiz="$2"
  rodar_guard "$raiz"
  if [ "$GUARD_EXIT" -ne 1 ]; then
    fail "$cenario: esperava exit 1 (violação) e veio $GUARD_EXIT — o guard NÃO julga este defeito"
    mostrar
    exit 1
  fi
}

exigir_aprovado() {
  local cenario="$1" raiz="$2"
  rodar_guard "$raiz"
  if [ "$GUARD_EXIT" -ne 0 ]; then
    fail "$cenario: esperava exit 0 (verde) e veio $GUARD_EXIT"
    mostrar
    exit 1
  fi
}

# ── exigir_cego: o defeito que o CONTROLE reprovava passa a ser verde ─────
# É a medição do M1–M3: o veredito MUDOU por causa da mutação (não por
# ambiente). Sem esta metade, "mutação detectada" poderia ser só um crash.
exigir_cego() {
  local cenario="$1" raiz="$2"
  rodar_guard "$raiz"
  if [ "$GUARD_EXIT" -ne 0 ]; then
    fail "$cenario: a mutação NÃO cegou o guard (exit $GUARD_EXIT, esperado 0) — o mecanismo mutado não sustenta nada"
    mostrar
    exit 1
  fi
}

# ── exigir_suite_vermelha: a suíte unitária tem de notar a mutação ────────
# Quando o vitest não está instalado, o motivo é DITO — nunca silencioso.
exigir_suite_vermelha() {
  local cenario="$1"
  if ! suite_disponivel; then
    info "$cenario (suíte): NÃO julgada — node_modules/vitest ausente neste job (declarado, nunca silencioso)"
    return 0
  fi
  rodar_suite
  if [ "$SUITE_EXIT" -eq 0 ]; then
    fail "$cenario: a suíte unitária ficou VERDE com o guard mutado — a regressão passaria no PR em silêncio"
    echo "$SUITE_OUT" | sed 's/^/      /'
    exit 1
  fi
  pass "$cenario: suíte unitária VERMELHA (exit $SUITE_EXIT) — a regressão não passa no PR"
}

# ── Fixtures dos três defeitos (o CONTROLE B) ─────────────────────────────

mkfixture "$FX_TYPO" "node scripts/roda-checks.mjs"
mkfixture "$FX_ENTRADA" "bun run tipecheck"
mkfixture "$FX_RUNTIME" 'node "$PAYLOAD"'

echo -e "${CYAN}═══ Mutation test: comandos dos hooks (check-hook-commands) ═══${NC}"
echo "  guard: $GUARD"
echo "  suíte: $SUITE_ARQUIVO"

# ── 1. CONTROLE A: o hook REAL é verde ────────────────────────────────────
header "CONTROLE A: o hook REAL é verde"
rodar_guard_real
if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "CONTROLE A: o guard REPROVA o hook real (exit $GUARD_EXIT) — conserte a árvore antes de medir mutação"
  mostrar
  exit 1
fi
pass "CONTROLE A: o hook real resolve (exit 0) — é este verde que a mutação tem de morder"

# ── 2. CONTROLE B: o guard REAL reprova os três defeitos ──────────────────
header "CONTROLE B (SENSIBILIDADE): o guard REAL reprova os três defeitos"
exigir_reprovado "CONTROLE B1 (caminho que não existe)" "$FX_TYPO"
pass "CONTROLE B1: o caminho tipado é VIOLAÇÃO (a classe do passo que nunca roda)"
exigir_reprovado "CONTROLE B2 (entrada de scripts que não existe)" "$FX_ENTRADA"
pass "CONTROLE B2: a entrada de \`scripts\` ausente é VIOLAÇÃO"
exigir_reprovado "CONTROLE B3 (payload de runtime não declarado)" "$FX_RUNTIME"
pass "CONTROLE B3: o indeterminado NÃO declarado é VIOLAÇÃO (fail-closed)"

if suite_disponivel; then
  rodar_suite
  if [ "$SUITE_EXIT" -ne 0 ]; then
    fail "CONTROLE B (suíte): a suíte está VERMELHA na árvore íntegra — conserte antes de medir mutação"
    echo "$SUITE_OUT" | sed 's/^/      /'
    exit 1
  fi
  pass "CONTROLE B (suíte): a suíte unitária passa na árvore íntegra"
else
  info "CONTROLE B (suíte): NÃO julgada — node_modules/vitest ausente neste job (declarado, nunca silencioso)"
fi

# ── 3. MUTAÇÃO M1: a EXISTÊNCIA do caminho ────────────────────────────────
header "MUTAÇÃO M1: aceitar qualquer caminho como existente"
mutar_guard \
  '  if (arquivoExiste(ctx.root, alvo))' \
  '  if (true /* MUTACAO M1 */)'
exigir_cego "M1" "$FX_TYPO"
pass "M1: o caminho tipado PASSA com o guard mutado (CEGO) — a existência do arquivo é load-bearing"
exigir_reprovado "M1 cirúrgica (caminho certo)" "$FX_ENTRADA"
pass "M1 CIRÚRGICA: a entrada de \`bun run\` segue reprovada — morreu só a regra do caminho"
exigir_suite_vermelha "M1"
restaurar_original

# ── 4. MUTAÇÃO M2: a ENTRADA de `scripts` do package.json ─────────────────
header "MUTAÇÃO M2: aceitar entrada ausente em \`scripts\`"
mutar_guard \
  '    if (ctx.scripts[possivelEntrada] === undefined) {' \
  '    if (false /* MUTACAO M2 */) {'
exigir_cego "M2" "$FX_ENTRADA"
pass "M2: \`bun run tipecheck\` PASSA com o guard mutado (CEGO) — a entrada do package.json é load-bearing"
exigir_reprovado "M2 cirúrgica (payload não declarado)" "$FX_RUNTIME"
pass "M2 CIRÚRGICA: o indeterminado não declarado segue reprovado — morreu só a regra da entrada"
exigir_suite_vermelha "M2"
restaurar_original

# ── 5. MUTAÇÃO M3: a DECISÃO declarada (INDETERMINATE) ────────────────────
header "MUTAÇÃO M3: devolver indefinido sem olhar a lista de decisões"
mutar_guard \
  '  if (declarado !== undefined)
    return { desfecho: "indeterminado", motivo: `declarado (${declarado.addedAt})` }' \
  '  if (true /* MUTACAO M3 */)
    return { desfecho: "indeterminado", motivo: `declarado (na mutacao, sem olhar a lista)` }'
exigir_cego "M3" "$FX_RUNTIME"
pass "M3: o payload NÃO declarado PASSA como indeterminado (CEGO) — a decisão datada é load-bearing"
exigir_reprovado "M3 cirúrgica (caminho que não existe)" "$FX_TYPO"
pass "M3 CIRÚRGICA: o caminho tipado segue reprovado — morreu só a regra do indeterminado"
exigir_suite_vermelha "M3"
restaurar_original

# ── 6. MUTAÇÃO M4: a FUNÇÃO do próprio hook (violação FALSA no repo real) ─
header "MUTAÇÃO M4: ignorar as funções definidas pelo próprio hook"
mutar_guard \
  '  if (ctx.funcoes.has(programa)) return { desfecho: "resolvido", motivo: "função do próprio hook" }' \
  '  if (false /* MUTACAO M4 */) return { desfecho: "resolvido", motivo: "função do próprio hook" }'
rodar_guard_real
if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "M4: o guard seguiu VERDE no hook real — a regra da função própria não sustenta o verde do repositório"
  exit 1
fi
pass "M4: o hook REAL passa a ser ACUSADO (exit $GUARD_EXIT) — a regra da função própria é o que sustenta o verde"
mostrar
exigir_reprovado "M4 cirúrgica (caminho que não existe)" "$FX_TYPO"
pass "M4 CIRÚRGICA: as fixtures de defeito seguem reprovadas — morreu só a regra da função"
exigir_reprovado "M4 cirúrgica (payload não declarado)" "$FX_RUNTIME"
pass "M4 CIRÚRGICA: o indeterminado não declarado segue reprovado — morreu só a regra da função"
exigir_suite_vermelha "M4"
restaurar_original

# ── 7. CONTROLE FINAL: a árvore ficou como estava ─────────────────────────
header "CONTROLE FINAL: restauração verificada por checksum"
exigir_reprovado "CONTROLE FINAL (caminho tipado)" "$FX_TYPO"
pass "CONTROLE FINAL: o guard restaurado volta a reprovar o caminho tipado"

echo
echo -e "${GREEN}═══ MUTATION TEST PASSED — as 4 mutações foram detectadas (gate e/ou suíte) ═══${NC}"
