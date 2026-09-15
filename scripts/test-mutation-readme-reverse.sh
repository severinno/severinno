#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-readme-reverse.sh — Mutation tests do guard semanal de
# drift semântico do README (check-readme-reverse-baseline.mjs) + o FLUXO de
# issue (readme-reverse-issue.mjs) — TRÊS cenários num script
#
# Usage:
#   ./scripts/test-mutation-readme-reverse.sh
#
# Exit codes:
#   0 — mutações DETECTADAS (C1: guard exit 1 exato + C2: issue dry-run com
#       título/body corretos + C3: link quebrado → guard exit 2 de infra) ✅
#   1 — guard/pipeline CEGO (exit 0) / assinatura de falha trocada / infra
#       inesperada / asserção quebrada ❌
#
# CENÁRIO 1 — DETECÇÃO: prova que o check-readme-reverse-baseline.mjs
# REALMENTE pega um link SEMANTICAMENTE errado no README — o achado NOVO que
# o job semanal (readme-reverse-audit) transforma em GitHub Issue. Sem
# depender do cron semanal: o mutation test injeta a mutação num fixture e
# roda o guard real.
#
# CENÁRIO 2 — FLUXO COMPLETO (achado → issue): o MESMO achado mutado flui
# pelo readme-reverse-issue.mjs --dry-run (puro, sem gh) e a issue seria
# criada com o TÍTULO e o BODY corretos (link + sugestão '#crlf-guard') —
# provando o pipeline end-to-end, não só a detecção.
#
# CENÁRIO 3 — LINK QUEBRADO (slug inexistente): o baseline guard deve falhar
# por INFRA (exit 2 EXATO) com MENSAGEM CLARA quando o forward quebra —
# distinguindo a assinatura de falha do exit 1 (achados novos de drift, que
# criam issue). Um README com link morto é input INVÁLIDO para o audit de
# drift semântico: o guard falha-closed (exit 2) em vez de silenciar com
# '0 achado(s) reverse' (o falso verde que este cenário mata).
#
#   CONTROLE (todos): fixture LIMPO (README sem drift) + baseline DERIVADO
#             do guard real (--update no limpo — NÃO snapshot hardcoded) →
#             guard PASS (exit 0 — nenhum achado novo / nenhuma issue): o
#             controle reflete o ESTADO ATUAL da doc, não um baseline
#             congelado que desatualiza quando a doc muda
#   MUTAÇÃO C1/C2: injeta '- [CRLF Guard](#normalizador)' + heading
#            'Normalizador' — o link RESOLVE (o slug existe: o FORWARD passa)
#            mas o label 'CRLF Guard' pertence a OUTRO heading — exatamente o
#            drift semântico que o reverse acusa com sugestão '#crlf-guard' →
#            C1: guard deve FALHAR com exit 1 EXATO (o código fail-closed de
#                achados NOVOS, NÃO o 2 de infra);
#            C2: o issue dry-run deve imprimir 'criaria issue' com o título
#                'README drift semântico: [CRLF Guard](#normalizador) → heading
#                errado (README.md)' e o body com a sugestão '#crlf-guard'.
#   MUTAÇÃO C3: troca o slug por '#slug-inexistente' (SEM criar o heading) —
#            o link NÃO resolve: FORWARD violation → guard deve FALHAR com
#            exit 2 EXATO (infra) e mensagem clara listando o link quebrado,
#            DISTINTO do exit 1 (achados novos).
#
# Exit codes do guard sob teste:
#   0 — nenhum achado novo (controle)
#   1 — achados novos detectados (fail-closed) ← MUTAÇÃO C1 DEVE CAUSAR ISSO
#   2 — infra (baseline ausente / guard de âncoras falhou / link QUEBRADO no
#       README — input inválido) ← MUTAÇÃO C3 DEVE CAUSAR ISSO
#
# Se o guard PASSAR com a mutação (exit 0 = guard CEGO) ou falhar com a
# assinatura ERRADA (C1 deve ser 1, C3 deve ser 2 — trocar os dois é bug), o
# script falha (exit 1), bloqueando o CI. Espelho do test-mutation-readme-toc.sh:
# fixture mktemp, node-puro, SEM docker/prisma, não toca NENHUM arquivo do
# repo real.
#
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-readme-reverse-baseline.mjs"
ISSUE_SCRIPT="$SCRIPT_DIR/scripts/readme-reverse-issue.mjs"

TMP_DIR="$(mktemp -d)"

# ── Fonte da mensagem: main() em scripts/check-readme-reverse-baseline.mjs:
#   `   • ${f.file}:${f.line}  [${f.label}](#${f.slug}) → heading '${f.heading}'`
# ⚠️ Source-coupled: se a linha de output do guard for reformulada, atualize
# o EXPECTED_FAILURE junto (não é guard cego — é o acoplamento esperado).
EXPECTED_FAILURE="[CRLF Guard](#normalizador)"
# Asserção da SUGESTÃO (o artefato que o job semanal usa na issue): garante
# que a violação é a INTENCIONAL (rule 4: 'CRLF Guard' em OUTRO heading) e
# não qualquer outro achado reverse do fixture.
EXPECTED_SUGGESTION="sugestão: '#crlf-guard'"

# ── Cenário 2 — contrato do fluxo de issue (título/body do dry-run) ───────
# Fonte: main() em scripts/readme-reverse-issue.mjs:
#   `  [dry-run] criaria issue: ${title}`        (title = buildIssueTitle)
#   `            body: ${file}:${line} [label](#slug) → 'heading' (sugestão '#X')`
# buildIssueTitle é ESTÁVEL (SEM linha): 'README drift semântico: [label]
# (#slug) → heading errado (file)'. A linha NÃO participa (o README cresce).
# ⚠️ Source-coupled: se o formato do dry-run for reformulado, atualize os
# EXPECTED_ISSUE_* junto (o mesmo acoplamento esperado do EXPECTED_FAILURE).
EXPECTED_ISSUE_TITLE="criaria issue: README drift semântico: [CRLF Guard](#normalizador) → heading errado (README.md)"
EXPECTED_ISSUE_BODY="[CRLF Guard](#normalizador) → 'Normalizador' (sugestão '#crlf-guard')"
EXPECTED_ISSUE_SUMMARY="1 achado(s) novo(s) — 1 para criar"

# ── Cenário 3 — contrato do link QUEBRADO (forward → INFRA exit 2) ────────
# Fonte da mensagem: main() em scripts/check-readme-reverse-baseline.mjs
# (fail-closed no forward):
#   `❌ ... N link(s) QUEBRADO(s) no README (forward) — o audit de drift`
#   `   • ${f.file}:${f.line}  [${f.label}](#${f.slug})`
#   `   Exit 2 = INFRA (input inválido), DISTINTO do exit 1 (achados novos).`
# ⚠️ Source-coupled: se a mensagem de infra for reformulada, atualize os
# EXPECTED_BROKEN_* junto (o mesmo acoplamento esperado do EXPECTED_FAILURE).
EXPECTED_BROKEN_LINK="[CRLF Guard](#slug-inexistente)"
EXPECTED_BROKEN_MESSAGE="link(s) QUEBRADO(s) no README"
EXPECTED_BROKEN_SIGNATURE="Exit 2 = INFRA (input inválido)"

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

# ── Fixture ───────────────────────────────────────────────────────────────
# README limpo: bullet 'CRLF Guard' que resolve para o heading 'CRLF Guard'
# (rule 1 do checkLinkLabelSemantics — zero violações).
#
# Baseline DERIVADO do JSON real do guard — NÃO um snapshot hardcoded. O
# build roda o guard `--update` no fixture LIMPO e usa o baseline que o guard
# GERA: o controle reflete o estado ATUAL da doc (o que o guard realmente
# considera conhecido). Se o README base ganhar um achado reverse deliberado
# no futuro, o --update o registra e o CONTROLE continua passando (exit 0) —
# travando que o teste não dependa de um baseline congelado que desatualiza
# silenciosamente quando a doc muda.
#
# O --baseline explícito é necessário porque o default
# (docs/security/readme-reverse-baseline.json) não existe num mktemp — sem
# --baseline o guard falharia por INFRA exit 2, não pelo que testamos.
build_fixture() {
  rm -rf "$TMP_DIR"
  mkdir -p "$TMP_DIR"

  cat > "$TMP_DIR/README.md" <<'EOF'
# Severinno

## Encoding Guards

Conteúdo da seção.

- [CRLF Guard](#crlf-guard)

### CRLF Guard
EOF

  # Deriva o baseline do guard real (--update no fixture limpo). Fail-fast:
  # se o guard não gerar o baseline, o fixture base não é válido.
  set +e
  local upd_out upd_code
  upd_out="$(cd "$TMP_DIR" && node "$GUARD" --baseline baseline.json --update 2>&1)"
  upd_code=$?
  set -e
  if [ "$upd_code" -ne 0 ]; then
    fail "FIXTURE QUEBRADO: guard --update falhou no fixture limpo (exit $upd_code)."
    echo "$upd_out" | tail -6
    fail "O fixture base não é válido — o mutation test não pode prosseguir."
    exit 1
  fi
  if [ ! -s "$TMP_DIR/baseline.json" ]; then
    fail "FIXTURE QUEBRADO: --update não gerou baseline.json."
    exit 1
  fi
  pass "Baseline DERIVADO do guard real (--update no fixture limpo)"
}

# ── Mutação compartilhada (C1 + C2) ───────────────────────────────────────

# apply_mutation: injeta o drift semântico no README do fixture — o MESMO
# para os dois cenários (C1 valida a DETECÇÃO, C2 o FLUXO de issue).
# Reaproveita o truque do C2 do toc: sed na linha que COMEÇA com o bullet
# (evita parênteses no padrão BRE — portabilidade GNU/MSYS) e só troca o slug.
apply_mutation() {
  sed -i '/^- \[CRLF Guard\]/s/#crlf-guard/#normalizador/' "$TMP_DIR/README.md"
  printf '\n### Normalizador\n' >> "$TMP_DIR/README.md"
}

# assert_mutation_applied: fail-fast — bullet mutado + heading novo presentes
# + bullet original sumiu.
assert_mutation_applied() {
  if grep -Fq -- "- [CRLF Guard](#normalizador)" "$TMP_DIR/README.md" \
    && grep -Fq "### Normalizador" "$TMP_DIR/README.md" \
    && ! grep -Fq -- "- [CRLF Guard](#crlf-guard)" "$TMP_DIR/README.md"; then
    pass "Mutação aplicada: link agora resolve para '#normalizador' (heading existe)"
  else
    fail "Mutação não aplicou (sed falhou?)."
    exit 1
  fi
}

# ── Helpers ───────────────────────────────────────────────────────────────

# assert_control_pass: roda o guard no fixture ATUAL e valida exit 0.
assert_control_pass() {
  info "Controle — fixture limpo + baseline DERIVADO → guard deve PASS (exit 0)..."
  set +e
  local out exit_code
  out="$(cd "$TMP_DIR" && node "$GUARD" --baseline baseline.json 2>&1)"
  exit_code=$?
  set -e
  if [ "$exit_code" -ne 0 ]; then
    fail "CONTROLE FALHOU: guard rejeitou o fixture LIMPO (exit $exit_code — esperado 0)."
    echo "$out" | tail -8
    fail "O fixture base não é válido — o mutation test não pode prosseguir."
    exit 1
  fi
  pass "Controle OK — fixture limpo passa no guard (exit 0)"
}

# assert_mutation_fail: roda o guard no fixture MUTADO e valida que falhou
# com exit 1 EXATO (achados novos) PELA asserção esperada.
assert_mutation_fail() {
  info "Rodando guard contra o fixture MUTADO..."
  set +e
  local out exit_code
  out="$(cd "$TMP_DIR" && node "$GUARD" --baseline baseline.json 2>&1)"
  exit_code=$?
  set -e

  echo "$out" | tail -12

  # Caso 0 — guard CEGO: PASS com a mutação. A checagem de achados novos
  # (findNewFindings / o filter reverse) foi removida/enfraquecida.
  if [ "$exit_code" -eq 0 ]; then
    fail "GUARD CEGO: check-readme-reverse-baseline passou com a mutação aplicada (exit 0)."
    fail "Verifique se a comparação por assinatura ainda acusa achados novos."
    exit 1
  fi

  # Caso 2 — falhou por INFRA (baseline ausente / guard de âncoras quebrou),
  # não pelo fail-closed de achados novos. O exit 1 é PARTE do contrato: o
  # job semanal cria a issue exatamente quando o exit é 1.
  if [ "$exit_code" -ne 1 ]; then
    fail "Guard falhou com exit $exit_code (esperado EXATAMENTE 1 — achados novos)."
    fail "Exit 2 = infra (baseline ausente / guard de âncoras falhou) — o fixture"
    fail "ou o guard quebrou por outro motivo, não pela mutação."
    exit 1
  fi

  # Caso 3 — falhou com exit 1, mas NÃO pela asserção esperada (outro
  # invariante quebrou no fixture).
  if ! grep -Fq "$EXPECTED_FAILURE" <<< "$out"; then
    fail "Guard falhou (exit 1) mas NÃO pela asserção esperada:"
    fail "  esperava:  $EXPECTED_FAILURE"
    fail "Falha pode ser outro invariante do fixture — veja o output acima."
    exit 1
  fi

  # Caso 4 — a violação está lá, mas a SUGESTÃO esperada não (o drift
  # semanticamente errado acusou outro heading como candidato, ou o algoritmo
  # de sugestão perdeu o '#crlf-guard'). A sugestão é o artefato que o job
  # semanal transforma em issue — sem ela o achado não é acionável.
  if ! grep -Fq "$EXPECTED_SUGGESTION" <<< "$out"; then
    fail "Guard falhou (exit 1) mas SEM a sugestão esperada:"
    fail "  esperava:  $EXPECTED_SUGGESTION"
    fail "Verifique se a sugestão do reverse ainda aponta para o heading dono do label."
    exit 1
  fi

  pass "Mutação DETECTADA: guard falhou com exit 1 exato e '❌ $EXPECTED_FAILURE'"
  pass "Sugestão acionável presente: '$EXPECTED_SUGGESTION'"
}

# assert_issue_dry_run_control: fixture LIMPO → o issue script deve reportar
# 'nenhum achado NOVO' e NÃO criar issue (exit 0). Prova que o fluxo de issue
# não dispara sem achado (o CONTROLE do cenário 2).
assert_issue_dry_run_control() {
  info "Controle do fluxo de issue — fixture limpo → nenhuma issue (exit 0)..."
  set +e
  local out exit_code
  out="$(cd "$TMP_DIR" && node "$ISSUE_SCRIPT" --dry-run 2>&1)"
  exit_code=$?
  set -e
  if [ "$exit_code" -ne 0 ]; then
    fail "CONTROLE DO FLUXO FALHOU: issue script rejeitou o fixture LIMPO (exit $exit_code — esperado 0)."
    echo "$out" | tail -6
    exit 1
  fi
  if ! grep -Fq "nenhum achado NOVO" <<< "$out"; then
    fail "CONTROLE DO FLUXO FALHOU: esperado 'nenhum achado NOVO' com fixture limpo."
    echo "$out" | tail -6
    exit 1
  fi
  pass "Controle do fluxo OK — fixture limpo → 'nenhum achado NOVO' (exit 0)"
}

# assert_issue_dry_run: roda o readme-reverse-issue.mjs --dry-run contra o
# fixture ATUAL (mutado) e valida o contrato do FLUXO COMPLETO (achado →
# issue): exit 0, resumo '1 para criar', título/body corretos e o marcador
# de dry-run puro (nenhuma chamada gh). O --dry-run é o modo P2 do script
# (imprime o que criaria SEM chamar gh) — testável sem rede/credenciais.
assert_issue_dry_run() {
  info "Rodando readme-reverse-issue.mjs --dry-run contra o achado MUTADO..."
  set +e
  local out exit_code
  out="$(cd "$TMP_DIR" && node "$ISSUE_SCRIPT" --dry-run 2>&1)"
  exit_code=$?
  set -e

  echo "$out" | tail -8

  # Caso 0 — erro real (exit != 0): baseline guard falhou por infra ou o
  # script quebrou ANTES do dry-run — o fluxo achado→issue não roda.
  if [ "$exit_code" -ne 0 ]; then
    fail "readme-reverse-issue falhou (exit $exit_code — esperado 0 no --dry-run)."
    fail "O fluxo achado→issue quebrou: baseline guard não encontrou o fixture?"
    exit 1
  fi

  # Caso 1 — pipeline CEGO: o achado mutado não virou issue (baseline guard
  # não detectou o drift, ou o dry-run engoliu o achado).
  if ! grep -Fq "criaria issue:" <<< "$out"; then
    fail "PIPELINE CEGO: --dry-run não imprimiu 'criaria issue' com o achado mutado."
    fail "Esperado: '$EXPECTED_ISSUE_SUMMARY' + a linha 'criaria issue'."
    exit 1
  fi

  # Caso 1b — resumo com a contagem errada (achados extras/faltantes): o
  # contrato do fluxo é EXATAMENTE 1 achado novo → 1 issue (o fixture tem um
  # único link; >1 achado = duplicação do guard/parser quebraria o dedup).
  if ! grep -Fq "$EXPECTED_ISSUE_SUMMARY" <<< "$out"; then
    fail "Resumo da issue incorreto:"
    fail "  esperava:  $EXPECTED_ISSUE_SUMMARY"
    fail "A contagem 1→1 é parte do contrato (dedup por assinatura no job real)."
    exit 1
  fi

  # Caso 2 — TÍTULO incorreto (buildIssueTitle driftou do contrato
  # file+slug+label — o link errado seria identificado errado na issue).
  if ! grep -Fq "$EXPECTED_ISSUE_TITLE" <<< "$out"; then
    fail "Título da issue incorreto:"
    fail "  esperava:  $EXPECTED_ISSUE_TITLE"
    fail "Veja a linha '[dry-run] criaria issue:' acima."
    exit 1
  fi

  # Caso 3 — BODY incorreto: sem o heading atual + a sugestão '#crlf-guard'
  # (o artefato acionável que aponta o heading correto na issue).
  if ! grep -Fq "$EXPECTED_ISSUE_BODY" <<< "$out"; then
    fail "Body da issue incorreto:"
    fail "  esperava:  $EXPECTED_ISSUE_BODY"
    fail "A issue não seria acionável sem a sugestão do heading correto."
    exit 1
  fi

  # Caso 4 — dry-run chamou gh (deveria ser puro): o marcador final garante
  # que nenhuma chamada gh foi feita — sem rede, sem credenciais.
  if ! grep -Fq "nenhuma chamada gh feita" <<< "$out"; then
    fail "Dry-run não é puro: faltou o marcador final '(dry-run — nenhuma chamada gh feita)'."
    exit 1
  fi

  pass "Fluxo COMPLETO OK: achado mutado → issue dry-run com título/body corretos"
  pass "(marcador 'nenhuma chamada gh feita' — puro, sem chamar gh)."
}

# assert_broken_link_fail: roda o guard no fixture com link QUEBRADO (slug
# inexistente — FORWARD violation) e valida que falhou com exit 2 EXATO
# (infra — input inválido) pela mensagem clara que lista o link morto,
# DISTINGUINDO a assinatura de falha do exit 1 (achados novos de drift).
assert_broken_link_fail() {
  info "Rodando guard contra o fixture com link QUEBRADO (slug inexistente)..."
  set +e
  local out exit_code
  out="$(cd "$TMP_DIR" && node "$GUARD" --baseline baseline.json 2>&1)"
  exit_code=$?
  set -e

  echo "$out" | tail -12

  # Caso 0 — guard CEGO: PASS (exit 0) com link quebrado. O fail-closed do
  # forward foi removido/enfraquecido — o guard voltaria a silenciar com
  # '0 achado(s) reverse' (o falso verde que o C3 existe para matar).
  if [ "$exit_code" -eq 0 ]; then
    fail "GUARD CEGO: passou com link QUEBRADO (exit 0) — o fail-closed do forward sumiu."
    fail "Verifique se a checagem de forwardFindings ainda existe no baseline guard."
    exit 1
  fi

  # Caso 1 — falhou com exit 1 (achados novos) em vez de exit 2 (infra): a
  # ASSINATURA de falha está TROCADA. O exit é PARTE do contrato — o job
  # semanal cria issue no exit 1; no exit 2 o README precisa ser corrigido.
  if [ "$exit_code" -ne 2 ]; then
    fail "Guard falhou com exit $exit_code (esperado EXATAMENTE 2 — infra do forward)."
    fail "Exit 1 = achados novos (drift, cria issue) — assinatura ERRADA p/ link quebrado."
    fail "Exit 0 = guard cego — o fail-closed do forward foi removido."
    exit 1
  fi

  # Caso 2 — exit 2 mas NÃO pela mensagem de infra esperada (outro invariante
  # quebrou no fixture, ou a mensagem foi reformulada sem atualizar o teste).
  if ! grep -Fq "$EXPECTED_BROKEN_MESSAGE" <<< "$out"; then
    fail "Guard falhou (exit 2) mas SEM a mensagem de infra esperada:"
    fail "  esperava:  $EXPECTED_BROKEN_MESSAGE"
    fail "Falha pode ser outro invariante do fixture — veja o output acima."
    exit 1
  fi

  # Caso 3 — a mensagem não lista o link quebrado específico (o diagnóstico
  # não identifica o link morto — sem isso o dev não sabe o que corrigir).
  if ! grep -Fq "$EXPECTED_BROKEN_LINK" <<< "$out"; then
    fail "Mensagem de infra sem o link quebrado específico:"
    fail "  esperava:  $EXPECTED_BROKEN_LINK"
    fail "O diagnóstico deve listar o link morto para ação imediata."
    exit 1
  fi

  # Caso 4 — a mensagem não explica a distinção exit 2 vs exit 1 (o contrato
  # de assinatura de falha que o job semanal usa para decidir criar issue).
  if ! grep -Fq "$EXPECTED_BROKEN_SIGNATURE" <<< "$out"; then
    fail "Mensagem de infra sem a distinção de assinatura esperada:"
    fail "  esperava:  $EXPECTED_BROKEN_SIGNATURE"
    fail "A mensagem deve explicar que exit 2 ≠ exit 1 (issue só no exit 1)."
    exit 1
  fi

  pass "Link QUEBRADO DETECTADO: guard falhou com exit 2 exato (infra) e mensagem clara"
  pass "('$EXPECTED_BROKEN_LINK' + '$EXPECTED_BROKEN_SIGNATURE') — assinatura distinta do exit 1"
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TESTS (baseline reverse + fluxo de issue)"
echo "   C1: link SEMANTICAMENTE errado → guard FALHA com exit 1 exato"
echo "   C2: o MESMO achado → readme-reverse-issue --dry-run (título/body corretos)"
echo "   C3: link QUEBRADO (forward) → guard FALHA com exit 2 de infra"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# CONTROLE — fixture limpo → guard PASS (exit 0)
# ═════════════════════════════════════════════════════════════════════════

info "Criando fixture (README limpo + baseline derivado via --update)..."
build_fixture
pass "Fixture criado ($TMP_DIR/README.md + baseline.json)"

assert_control_pass

# ═════════════════════════════════════════════════════════════════════════
# MUTAÇÃO — link semanticamente errado (resolves, mas aponta para o heading
# errado) + heading 'Normalizador' para o slug existir (forward passa)
# ═════════════════════════════════════════════════════════════════════════

info "Aplicando mutação: '- [CRLF Guard](#crlf-guard)' → '#normalizador' + heading novo..."
apply_mutation
assert_mutation_applied

assert_mutation_fail

# ═════════════════════════════════════════════════════════════════════════
# CENÁRIO 2 — FLUXO COMPLETO (achado → issue): o MESMO achado mutado flui
# pelo readme-reverse-issue.mjs --dry-run (puro, sem gh) e a issue seria
# criada com título/body corretos — provando que o achado vira ticket
# acionável, não só detecção.
# ═════════════════════════════════════════════════════════════════════════

info "CENÁRIO 2: rebuild do fixture limpo + baseline no caminho DEFAULT do issue script..."
build_fixture
pass "Fixture C2 criado (README limpo + baseline.json)"

# O issue script spawna o baseline guard SEM --baseline (o runBaselineReport
# usa o default docs/security/readme-reverse-baseline.json relativo ao cwd) —
# sem este arquivo o spawn falharia por INFRA (exit 2) ANTES do dry-run. O
# baseline DERIVADO (--update) do fixture é copiado para o caminho default.
mkdir -p "$TMP_DIR/docs/security"
cp "$TMP_DIR/baseline.json" "$TMP_DIR/docs/security/readme-reverse-baseline.json"
pass "Baseline default criado a partir do derivado ($TMP_DIR/docs/security/readme-reverse-baseline.json)"

assert_issue_dry_run_control

info "Aplicando a MESMA mutação do cenário 1 (drift semântico)..."
apply_mutation
assert_mutation_applied

assert_issue_dry_run

# ═════════════════════════════════════════════════════════════════════════
# CENÁRIO 3 — LINK QUEBRADO (slug inexistente): o baseline guard deve falhar
# por INFRA (exit 2 EXATO) com MENSAGEM CLARA quando o forward quebra,
# distinguindo a assinatura de falha do exit 1 (achados novos que criam
# issue). Um README com link morto é input INVÁLIDO para o audit.
# ═════════════════════════════════════════════════════════════════════════

info "CENÁRIO 3: rebuild do fixture limpo + baseline derivado via --update..."
build_fixture
pass "Fixture C3 criado (README limpo + baseline.json)"

assert_control_pass

info "Aplicando mutação C3: slug inexistente ('#crlf-guard' → '#slug-inexistente')..."
# Reaproveita o truque do C2 do toc: sed na linha que COMEÇA com o bullet
# (evita parênteses no padrão BRE — portabilidade GNU/MSYS) e só troca o slug.
# NÃO cria o heading 'slug-inexistente': o link passa a NÃO resolver — a
# FORWARD violation que o baseline guard deve rejeitar como INFRA (exit 2).
sed -i '/^- \[CRLF Guard\]/s/#crlf-guard/#slug-inexistente/' "$TMP_DIR/README.md"

# Fail-fast: bullet mutado presente + original sumiu + heading inexistente.
if grep -Fq -- "- [CRLF Guard](#slug-inexistente)" "$TMP_DIR/README.md" \
  && ! grep -Fq -- "- [CRLF Guard](#crlf-guard)" "$TMP_DIR/README.md" \
  && ! grep -Fq "### slug-inexistente" "$TMP_DIR/README.md"; then
  pass "Mutação C3 aplicada: link agora aponta para '#slug-inexistente' (não resolve)"
else
  fail "Mutação C3 não aplicou (sed falhou?)."
  exit 1
fi

assert_broken_link_fail

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TESTS PASSED — o guard semanal de drift semântico:"
pass "  • C1: pega um link semanticamente errado no README (exit 1 exato)"
pass "  • C2: o MESMO achado vira issue acionável via --dry-run (título/body"
pass "       corretos, sem chamar gh) — fluxo completo achado→issue provado"
pass "  • C3: link QUEBRADO (forward) → exit 2 de infra com mensagem clara,"
pass "       assinatura de falha distinta do exit 1 (achados novos)"
pass "Tudo sem depender do cron semanal."
exit 0
