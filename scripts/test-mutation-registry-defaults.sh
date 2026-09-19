#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-registry-defaults.sh — Mutation test da invariante 9
# (os defaults de IMAGE_REGISTRY/IMAGE_NAMESPACE) e do resolvedor que os
# substitui (scripts/registry-source.mjs)
#
# Usage:
#   ./scripts/test-mutation-registry-defaults.sh
#
# Exit codes:
#   0 — as SEIS mutações foram DETECTADAS (pelo gate e/ou pela suíte) e os
#       controles passaram ✅
#   1 — guard INDIFERENTE a alguma mutação (não cegou / não acusou) OU controle
#       falso ❌
#
# O QUE ISTO PROVA (e por que não basta o guard passar hoje)
#
# A invariante 9 tem DUAS metades, e as duas falham em silêncio quando morrem:
#
#   - o DEFAULT divergente do declarado (o literal que sobrevive à migração de
#     registry: onde a variável não existe ele vale, e a imagem que roda não é a
#     que o repositório declara — nada fica vermelho, porque a imagem VELHA
#     continua existindo no registry VELHO);
#   - o LITERAL em script JS (o `process.env.IMAGE_REGISTRY || "ghcr.io"` que o
#     resolvedor eliminou — mesmo com o valor certo ele volta a envelhecer no
#     dia da próxima migração).
#
# Um gate que roda e sai 0 prova que ele não ACUSOU — não prova que ele MEDIU.
# Cada mecanismo tem aqui a sua mutação, e cada mutação exige que o veredito
# MUDE (o defeito que o CONTROLE reprovava passa a ser verde: CEGO) ou que o
# repositório íntegro passe a ser ACUSADO (violação falsa, que trava merge
# legítimo). Os dois sentidos são medidos, porque um guard pode errar para os
# dois lados e só um deles aparece no dia a dia:
#
#   M1 — A COMPARAÇÃO DE VALOR (`defaultValueVerdict`): devolver `proven` sempre
#        deixa o default divergente passar. É a cegueira central da invariante —
#        três das quatro fixtures (compose, shell, workflow) ficam verdes.
#   M2 — A REGRA DO SCRIPT JS (o resolvedor obrigatório): desligá-la faz o
#        literal VOLTAR a ser aceito — e o valor certo torna a morte invisível
#        (a comparação continua provando, e é isso que a regra existe para
#        impedir).
#   M3 — A RÉGUA DO COMENTÁRIO (a sintaxe declarada por linguagem): varrer JS
#        com a régua do `#` não cega o guard, ele passa a ACUSAR a própria prosa
#        que ENSINA o resolvedor (violação falsa no repositório real).
#   M4 — O VALOR VAZIO (o que NÃO é default): contar `|| ""` como default
#        também é violação FALSA no repositório real (`(values.X || "").trim()`
#        é o idioma de ler um valor que pode faltar, não uma afirmação de valor).
#   M5 — O LITERAL DE RESERVA do RESOLVEDOR: reintroduzir o `|| "ghcr.io"` no
#        `resolveImageSource` não muda o veredito do gate (o gate não o usa) —
#        quem mede é a suíte do resolvedor. É a mutação que prova por que a
#        segunda testemunha existe.
#   M6 — O FALLBACK LITERAL DO WORKFLOW: tratá-lo como dinâmico (não comparação)
#        deixa o literal do YAML passar — a quarta família de arquivo cai.
#
# A SEGUNDA TESTEMUNHA (a suíte). Cada mutação é aplicada NO LUGAR, no arquivo do
# repositório, e além do veredito do CLI exige a suíte unitária VERMELHA — em
# recorte DECLARADO (o describe que mede o mecanismo mutado), porque é a suíte
# que roda em todo PR. O recorte vem com piso: se nenhum teste rodar, o script
# FALHA (um filtro que não casa nada daria "verde" para qualquer mutação). Onde
# o vitest não está instalado o motivo é DITO, nunca silencioso.
#
# COMO: o gate REAL é executado com `cwd` no fixture (ele resolve tudo a partir
# de `process.cwd()`, e é assim que a suíte o exercita) e a evidência é o EXIT
# CODE — não a leitura do código do guard. As mutações são cirúrgicas (exatamente
# 1 ocorrência), marcadas com `MUTACAO M` (prova que a ESCRITA aplicou) e
# restauradas por checksum no trap EXIT: um `exit` no meio não pode deixar a
# árvore mutada.
#
# Pipeline:
#   1. CONTROLE A — o gate REAL passa no repositório de verdade
#   2. CONTROLE B (SENSIBILIDADE) — o gate REAL reprova as QUATRO fixtures
#      (compose sem par, script JS, shell, workflow) — sem esta metade, "ficou
#      cego" não significaria nada
#   3. M1 (comparação de valor) — compose/shell/workflow CEGOS; o script JS
#      segue reprovado (cirúrgica)
#   4. M2 (a regra do script JS) — o literal PASSA; o compose segue reprovado
#   5. M3 (a régua do comentário) — o repositório REAL passa a ser ACUSADO
#   6. M4 (o valor vazio) — o repositório REAL passa a ser ACUSADO
#   7. M5 (o literal de reserva) — a suíte do resolvedor fica VERMELHA e o gate
#      segue verde (a segunda testemunha é quem mede)
#   8. M6 (o fallback literal do workflow) — o YAML PASSA (CEGO)
#   9. Restauração VERIFICADA (checksum dos DOIS arquivos) + CONTROLE FINAL
#  10. Cleanup (trap EXIT — restaura e remove o temp, mesmo com falha)
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-registry-source.mjs"
RESOLVER="$SCRIPT_DIR/scripts/registry-source.mjs"
SUITE_RESOLVER="src/lib/__tests__/registry-source.test.ts"
SUITE_VARREDURA="src/lib/__tests__/check-registry-source.test.ts"
FILTRO_VARREDURA="VARREDURA"

TMP_DIR="$(mktemp -d)"
FX_COMPOSE="$TMP_DIR/fx-compose"
FX_MJS="$TMP_DIR/fx-mjs"
FX_SHELL="$TMP_DIR/fx-shell"
FX_WF="$TMP_DIR/fx-workflow"
FX_COMENTARIO="$TMP_DIR/fx-comentario"
FX_VAZIO="$TMP_DIR/fx-vazio"

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

# ── Backup das FONTES + restauração VERIFICADA (trap EXIT) ────────────────
# Duas fontes: o guard (a varredura) e o resolvedor (a régua de valor). As
# mutações são aplicadas NO LUGAR, no arquivo do repositório (é ele que a suíte
# unitária importa). Um `exit` no meio do caminho não pode deixar a árvore
# mutada — por isso o backup e a restauração entram no MESMO trap.
backup_de() { cp "$1" "$TMP_DIR/$(basename "$1").original"; }
backup_de "$GUARD"
backup_de "$RESOLVER"
soma_de() { cksum "$1" | cut -d' ' -f1; }

cleanup() {
  cp -f "$TMP_DIR/check-registry-source.mjs.original" "$GUARD" 2>/dev/null || true
  cp -f "$TMP_DIR/registry-source.mjs.original" "$RESOLVER" 2>/dev/null || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

restaurar_original() {
  cp -f "$TMP_DIR/check-registry-source.mjs.original" "$GUARD"
  cp -f "$TMP_DIR/registry-source.mjs.original" "$RESOLVER"
  local esperado atual
  for par in "$GUARD:check-registry-source.mjs" "$RESOLVER:registry-source.mjs"; do
    atual="${par%%:*}"
    esperado="$TMP_DIR/${par##*:}.original"
    if [ "$(soma_de "$atual")" != "$(soma_de "$esperado")" ]; then
      fail "RESTAURAÇÃO FALHOU em $atual (checksum diverge) — restaure a partir de $esperado"
      exit 1
    fi
  done
}

# ── mutar: substituição CIRÚRGICA (exatamente 1 ocorrência no arquivo) ────
# Uma mutação que casa 0 ou 2+ vezes não é cirúrgica: o script para em vez de
# medir outra coisa. O marcador `MUTACAO M` no texto novo é o que prova que a
# mutação APLICOU (o alvo pode existir e a escrita falhar).
mutar() {
  local arquivo="$1" alvo="$2" novo="$3"
  ARQUIVO="$arquivo" ALVO="$alvo" NOVO="$novo" python3 - <<'PY'
import os
p = os.environ["ARQUIVO"]
old, new = os.environ["ALVO"], os.environ["NOVO"]
s = open(p).read()
n = s.count(old)
if n != 1:
    raise SystemExit(f"mutacao nao-cirurgica em {p}: {n} ocorrencia(s) do alvo (esperado 1)")
open(p, "w").write(s.replace(old, new))
PY
  if ! grep -qF 'MUTACAO M' "$arquivo"; then
    fail "a mutação não aplicou em $arquivo (nada a medir)"
    exit 1
  fi
  local antes="$TMP_DIR/$(basename "$arquivo").original"
  if [ "$(soma_de "$arquivo")" = "$(soma_de "$antes")" ]; then
    fail "a mutação não alterou $arquivo (checksum idêntico) — o alvo casou mas a escrita não"
    exit 1
  fi
}

# ── mkfixture: um mini-repo com o VALOR DECLARADO e UM defeito ────────────
# O valor declarado entra no template da aplicação (o espelho que o
# `registry-source.mjs` lê): o fixture mede o DEFEITO, não a ausência de
# declaração (essa situação é o `indeterminate`, e tem teste próprio).
mkfixture() {
  local raiz="$1"
  mkdir -p "$raiz/scripts" "$raiz/deploy" "$raiz/.gitea/workflows"
  printf 'IMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\n' > "$raiz/.env.production.example"
}

declare -a FX_NOMES=(
  "CONTROLE B1 (compose sem par, default divergente)|$FX_COMPOSE"
  "CONTROLE B2 (script JS com default literal)|$FX_MJS"
  "CONTROLE B3 (shell com default divergente)|$FX_SHELL"
  "CONTROLE B4 (workflow com fallback literal divergente)|$FX_WF"
)

# ── rodar_guard: o gate REAL (ou mutado) contra um fixture ────────────────
# `--no-compose-render` e `--no-registry-probe`: o fixture não tem docker nem
# registry, e a prova aqui é da varredura por VALOR (medir a indisponibilidade
# do ambiente junto faria o script medir a máquina, não a mutação).
rodar_guard() {
  set +e
  GUARD_OUT="$(cd "$1" && node "$GUARD" --no-compose-render --no-registry-probe 2>&1)"
  GUARD_EXIT=$?
  set -e
}

rodar_guard_real() { rodar_guard "$SCRIPT_DIR"; }

# ── rodar_suite: a segunda testemunha, em recorte DECLARADO ───────────────
# O recorte é o describe que mede o mecanismo mutado (o arquivo inteiro inclui
# testes de CLI que levam ~15s e não julgam este mecanismo). O PISO é a metade
# que impede o verde falso: um filtro que não casa nada também sai 0 — e aí a
# mutação pareceria detectada por uma suíte que não rodou.
suite_disponivel() { [ -d "$SCRIPT_DIR/node_modules/vitest" ]; }

rodar_suite() {
  local arquivo="$1" filtro="${2:-}"
  local args=(run --config vitest.config.unit.ts)
  if [ -n "$filtro" ]; then args+=(-t "$filtro"); fi
  args+=("$arquivo")
  set +e
  SUITE_OUT="$(cd "$SCRIPT_DIR" && bun x vitest "${args[@]}" 2>&1 | tail -12)"
  SUITE_EXIT=$?
  set -e
  SUITE_RODADOS="$(echo "$SUITE_OUT" | grep -oE '[0-9]+ passed' | head -1 | grep -oE '[0-9]+' || true)"
  if [ -z "$SUITE_RODADOS" ] || [ "$SUITE_RODADOS" -eq 0 ]; then
    fail "a suíte NÃO rodou nenhum teste ($arquivo${filtro:+ -t $filtro}) — um recorte vazio daria verde para qualquer mutação"
    echo "$SUITE_OUT" | sed 's/^/      /'
    exit 1
  fi
}

# ── Asserções do veredito (medem o CLI, não a intenção) ───────────────────
mostrar() { echo "$GUARD_OUT" | grep -E '^  - |❌' | head -4 | sed 's/^/      /'; }

exigir_reprovado() {
  local cenario="$1" raiz="$2"
  rodar_guard "$raiz"
  if [ "$GUARD_EXIT" -ne 1 ]; then
    fail "$cenario: esperava exit 1 (violação) e veio $GUARD_EXIT — o gate NÃO julga este defeito"
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
exigir_cego() {
  local cenario="$1" raiz="$2"
  rodar_guard "$raiz"
  if [ "$GUARD_EXIT" -ne 0 ]; then
    fail "$cenario: a mutação NÃO cegou o gate (exit $GUARD_EXIT, esperado 0) — o mecanismo mutado não sustenta nada"
    mostrar
    exit 1
  fi
}

# ── exigir_acusado: um fixture que era VERDE passa a ser acusado ──────────
# A medição da violação FALSA: a mutação tira a régua que protegia o fixture, e
# o gate passa a acusar prosa. Sem o CONTROLE que exige este fixture verde na
# árvore íntegra, "ficou vermelho" poderia ser vermelho desde o começo.
exigir_acusado() {
  local cenario="$1" raiz="$2"
  rodar_guard "$raiz"
  if [ "$GUARD_EXIT" -eq 0 ]; then
    fail "$cenario: o gate seguiu VERDE no fixture — a regra mutada não sustentava nada"
    mostrar
    exit 1
  fi
}

# ── exigir_suite_vermelha: a suíte tem de notar a mutação ─────────────────
exigir_suite_vermelha() {
  local cenario="$1" arquivo="$2" filtro="${3:-}"
  if ! suite_disponivel; then
    info "$cenario (suíte): NÃO julgada — node_modules/vitest ausente neste job (declarado, nunca silencioso)"
    return 0
  fi
  rodar_suite "$arquivo" "$filtro"
  if [ "$SUITE_EXIT" -eq 0 ]; then
    fail "$cenario: a suíte ficou VERDE com a mutação aplicada — a regressão passaria no PR em silêncio"
    echo "$SUITE_OUT" | sed 's/^/      /'
    exit 1
  fi
  pass "$cenario: suíte VERMELHA ($SUITE_RODADOS teste(s) no recorte, exit $SUITE_EXIT) — a regressão não passa no PR"
}

# ── Fixtures (as quatro famílias de arquivo da invariante) ────────────────

mkfixture "$FX_COMPOSE"
printf 'services:\n  x:\n    image: ${IMAGE_REGISTRY:-registry.velho}/x/y:latest\n' \
  > "$FX_COMPOSE/docker-compose.hostinger.yml"

mkfixture "$FX_MJS"
printf 'const r = process.env.IMAGE_REGISTRY || "ghcr.io"\n' > "$FX_MJS/scripts/x.mjs"

mkfixture "$FX_SHELL"
printf 'docker pull ${IMAGE_REGISTRY:-registry.velho}/x/y:1\n' > "$FX_SHELL/deploy/pull.sh"

mkfixture "$FX_WF"
printf 'jobs:\n  x:\n    steps:\n      - run: echo ${{ vars.IMAGE_REGISTRY || '"'"'registry.velho'"'"' }}\n' \
  > "$FX_WF/.gitea/workflows/ci.yml"

# Os dois fixtures da direção CONTRÁRIA (violação falsa): eles têm de ser VERDES
# no guard íntegro, e as mutações M3/M4 os fazem vermelhos.
# A NOTA vai num bloco de doc (`/** ... */`), e não num `//` de linha inteira: o
# `stripSlashComment` já zera a linha toda de `//`, então é a linha do MEIO do
# bloco (que começa com `*` e não tem `//` para cortar) que a régua do comentário
# precisa pegar — é exatamente a forma que o repositório real tem (o JSDoc que
# cita o default antigo) e o caso que a mutação revelou não estar coberto.
mkfixture "$FX_COMENTARIO"
printf '/**\n * a migracao removeu isto: process.env.IMAGE_REGISTRY || "registry.velho"\n */\nconst ok = 1\n' \
  > "$FX_COMENTARIO/scripts/nota.mjs"

mkfixture "$FX_VAZIO"
printf 'const r = (process.env.IMAGE_REGISTRY || "").trim()\n' > "$FX_VAZIO/scripts/y.mjs"

echo -e "${CYAN}═══ Mutation test: defaults do registry/namespace (invariante 9) ═══${NC}"
echo "  guard:     $GUARD"
echo "  resolvedor: $RESOLVER"

# ── 1. CONTROLE A: o repositório real é verde ─────────────────────────────
header "CONTROLE A: o repositório real é verde"
rodar_guard_real
if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "CONTROLE A: o gate REPROVA o repositório real (exit $GUARD_EXIT) — conserte a árvore antes de medir mutação"
  mostrar
  exit 1
fi
pass "CONTROLE A: zero default divergente no repositório (exit 0) — é este verde que a mutação tem de morder"

# ── 2. CONTROLE B: o gate reprova as QUATRO famílias ──────────────────────
header "CONTROLE B (SENSIBILIDADE): o gate reprova as quatro famílias de defeito"
exigir_reprovado "CONTROLE B1 (compose sem par)" "$FX_COMPOSE"
pass "CONTROLE B1: o compose divergente é VIOLAÇÃO (a stack nova não fica invisível)"
exigir_reprovado "CONTROLE B2 (script JS)" "$FX_MJS"
pass "CONTROLE B2: o literal em script JS é VIOLAÇÃO (há resolvedor)"
exigir_reprovado "CONTROLE B3 (shell)" "$FX_SHELL"
pass "CONTROLE B3: o shell divergente é VIOLAÇÃO"
exigir_reprovado "CONTROLE B4 (workflow)" "$FX_WF"
pass "CONTROLE B4: o fallback literal do workflow é VIOLAÇÃO (comparado por valor)"
# A outra direção (o que NÃO pode ser acusado): a prosa que cita o default antigo
# e o `|| ""` de ler um valor que pode faltar. São os dois lados que só uma
# mutação mede — um guard que acusa demais trava merge legítimo.
exigir_aprovado "CONTROLE B5 (nota de migração em bloco de doc)" "$FX_COMENTARIO"
pass "CONTROLE B5: a nota de migração (bloco de doc de JS) NÃO é violação"
exigir_aprovado "CONTROLE B6 (literal vazio)" "$FX_VAZIO"
pass "CONTROLE B6: o \`|| \"\"\` NÃO é default (não há valor para envelhecer)"

if suite_disponivel; then
  rodar_suite "$SUITE_RESOLVER"
  if [ "$SUITE_EXIT" -ne 0 ]; then
    fail "CONTROLE B (suíte do resolvedor): VERMELHA na árvore íntegra — conserte antes de medir mutação"
    echo "$SUITE_OUT" | sed 's/^/      /'
    exit 1
  fi
  rodar_suite "$SUITE_VARREDURA" "$FILTRO_VARREDURA"
  if [ "$SUITE_EXIT" -ne 0 ]; then
    fail "CONTROLE B (suíte da varredura): VERMELHA na árvore íntegra — conserte antes de medir mutação"
    echo "$SUITE_OUT" | sed 's/^/      /'
    exit 1
  fi
  pass "CONTROLE B (suítes): as duas testemunhas passam na árvore íntegra"
else
  info "CONTROLE B (suítes): NÃO julgadas — node_modules/vitest ausente neste job (declarado, nunca silencioso)"
fi

# ── 3. MUTAÇÃO M1: a COMPARAÇÃO de valor ──────────────────────────────────
header "MUTAÇÃO M1: a comparação de valor deixa de julgar (proven sempre)"
mutar "$RESOLVER" \
  '  if (value !== declared.value) {' \
  '  if (false /* MUTACAO M1 */) {'
exigir_cego "M1" "$FX_COMPOSE"
pass "M1: o compose divergente PASSA (CEGO) — a comparação de valor é load-bearing"
exigir_cego "M1" "$FX_WF"
pass "M1: o fallback literal do workflow PASSA (CEGO) — a mesma régua julga o YAML"
exigir_reprovado "M1 cirúrgica (script JS)" "$FX_MJS"
pass "M1 CIRÚRGICA: o literal em script JS segue reprovado — a regra do resolvedor não depende da comparação"
exigir_suite_vermelha "M1" "$SUITE_RESOLVER"
restaurar_original

# ── 4. MUTAÇÃO M2: a REGRA DO SCRIPT JS (o resolvedor obrigatório) ────────
header "MUTAÇÃO M2: o literal em script JS volta a ser aceito"
mutar "$GUARD" \
  '          if (isScript && isJs) {' \
  '          if (false /* MUTACAO M2 */) {'
exigir_cego "M2" "$FX_MJS"
pass "M2: o literal em script JS PASSA (CEGO) — a regra do resolvedor é load-bearing"
exigir_reprovado "M2 cirúrgica (compose)" "$FX_COMPOSE"
pass "M2 CIRÚRGICA: o compose divergente segue reprovado — morreu só a regra do script JS"
exigir_suite_vermelha "M2" "$SUITE_VARREDURA" "$FILTRO_VARREDURA"
restaurar_original

# ── 5. MUTAÇÃO M3: a RÉGUA DO COMENTÁRIO (violação FALSA) ────
# A direção aqui é a oposta: a régua do comentário não deixa passar defeito, ela
# impede o guard de ACUSAR prosa. O fixture é uma NOTA de migração (o texto que
# o repositório real tem: "o que foi removido era `X || 'registry.velho'`").
header "MUTAÇÃO M3: a régua do \`#\` aplicada a script JS"
mutar "$GUARD" \
  '      if (isJs ? isCommentLineOf(line, { slash: true }) : isCommentLine(line)) return' \
  '      if (isCommentLine(line)) return // MUTACAO M3: a regua do # em JS'
exigir_acusado "M3" "$FX_COMENTARIO"
pass "M3: a NOTA de migração passa a ser ACUSADA — a régua por linguagem é o que sustenta o verde"
exigir_suite_vermelha "M3" "$SUITE_VARREDURA" "$FILTRO_VARREDURA"
restaurar_original

# ── 6. MUTAÇÃO M4: o VALOR VAZIO (o que NÃO é default) ────────────────────
header "MUTAÇÃO M4: contar \`|| \"\"\` como default"
mutar "$RESOLVER" \
  'if (value !== "") out.push({ value, form: "js" })' \
  'if (true /* MUTACAO M4 */) out.push({ value, form: "js" })'
exigir_acusado "M4" "$FX_VAZIO"
pass "M4: o \`|| \"\"\` (o idioma de ler um valor que pode faltar) passa a ser ACUSADO como default"
exigir_suite_vermelha "M4" "$SUITE_VARREDURA" "$FILTRO_VARREDURA"
restaurar_original

# ── 7. MUTAÇÃO M5: o LITERAL DE RESERVA do resolvedor ─────────────────────
header "MUTAÇÃO M5: reintroduzir o literal de reserva no \`resolveImageSource\`"
mutar "$RESOLVER" \
  '    return null
  }' \
  '    return {
      value: name === "IMAGE_REGISTRY" ? "ghcr.io" : "severinno",
      source: `o literal de reserva /* MUTACAO M5 */`,
    }
  }'
exigir_suite_vermelha "M5" "$SUITE_RESOLVER"
pass "M5: a suíte do resolvedor fica VERMELHA — o literal de reserva é medido pela segunda testemunha"
rodar_guard_real
if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "M5 cirúrgica: o gate mudou de veredito no repositório real (exit $GUARD_EXIT) — o resolvedor não é o que o gate usa"
  mostrar
  exit 1
fi
pass "M5 CIRÚRGICA: o veredito do gate no repositório real segue verde — quem mede o resolvedor é a suíte"
restaurar_original

# ── 8. MUTAÇÃO M6: o FALLBACK LITERAL do workflow ─────────────────────────
header "MUTAÇÃO M6: tratar todo fallback de workflow como dinâmico"
mutar "$GUARD" \
  '    if (ref.fallback === null) {' \
  '    if (true /* MUTACAO M6 */) {'
exigir_cego "M6" "$FX_WF"
pass "M6: o fallback LITERAL do YAML PASSA (CEGO) — a comparação do workflow é load-bearing"
exigir_reprovado "M6 cirúrgica (compose)" "$FX_COMPOSE"
pass "M6 CIRÚRGICA: o compose divergente segue reprovado — morreu só a régua do workflow"
exigir_suite_vermelha "M6" "$SUITE_VARREDURA" "$FILTRO_VARREDURA"
restaurar_original

# ── 9. CONTROLE FINAL: a árvore ficou como estava ─────────────────────────
header "CONTROLE FINAL: restauração verificada por checksum"
exigir_reprovado "CONTROLE FINAL (compose divergente)" "$FX_COMPOSE"
pass "CONTROLE FINAL: o gate restaurado volta a reprovar o compose divergente"
rodar_guard_real
if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "CONTROLE FINAL: o repositório real NÃO voltou a ser verde (exit $GUARD_EXIT)"
  mostrar
  exit 1
fi
pass "CONTROLE FINAL: o repositório real volta a passar (árvore idêntica à de antes)"

echo
echo -e "${GREEN}═══ MUTATION TEST PASSED — as 6 mutações foram detectadas (gate e/ou suíte) ═══${NC}"
