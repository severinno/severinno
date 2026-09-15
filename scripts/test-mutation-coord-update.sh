#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-coord-update.sh — Mutation test do contrato de
# atualização COORDENADA dos counts de seed (workflows ↔ anchor do teste)
#
# Usage:
#   ./scripts/test-mutation-coord-update.sh
#
# Exit codes:
#   0 — mutação DETECTADA (controle passou + teste E guard estático falharam
#       pelo piso no cenário A + teste falhou pela âncora no cenário B + teste
#       E guard falharam pela derivação no cenário C + teste CONTINUOU falhando
#       no cenário D com o piso do guard neutralizado — independência provada
#       + teste E guard falharam pelo piso de DEV no cenário E) ✅
#   1 — guard CEGO (teste OU guard passou com doc/âncora/derivação/piso
#       mutado) OU falha de infra/asserção ❌
#
# Prova que o seed-e2e-count.test.ts pega o cenário exato do bug
# histórico: atualizar SÓ os comentários dos workflows (128→N) sem tocar a
# âncora do teste. A mutação generaliza os literais documentados dos
# SCAN_FILES (check-e2e-counts.mjs): "127 checks" → "N checks" e o ternary
# da matrix ('128' → 'N') — simulando um dev que "limpa a doc" por conta
# própria — e exige que o seed-e2e-count.test.ts FALHE pela asserção certa.
#
# Por que falha (cenário A): o teste de integração "deriveExpectedChecks
# reproduz os counts documentados" lê os SCAN_FILES via extractDocumentedCounts
# e o "piso de sites documentados por alvo" (prod ≥ 8, dev ≥ 6) falha quando
# os sites de prod somem da extração. A âncora de valor (sanidade prod=128)
# NÃO muda (a derivação é do código, não da doc) — o que quebra é o
# vínculo doc↔derivação, exatamente o contrato que o incidente 123/128
# expôs.
#
# DIREÇÃO INVERSA (cenário B): mutar SÓ a âncora do teste
# (`.toBe(128)` → `.toBe(129)` no seed-e2e-count.test.ts) sem tocar a doc
# dos workflows. A sanidade ("anchor prod desatualizado") falha porque a
# derivação real continua 128 mas o literal esperado virou 129 — provando
# que o contrato também trava quando só o anchor é editado, sem atualizar
# os comentários dos workflows. O script verifica que a doc ficou INTACTA
# ("127 checks" ainda presente) — a falha vem SÓ da âncora, isolando a causa.
#
# Se o teste PASSAR com a mutação em qualquer direção (exit 0), o guard está
# CEGO — a atualização unilateral passaria no CI — e o script falha (1).
#
# OS 2 ELOS DA CADEIA no mesmo mutation test: além do vitest, o script roda o
# guard ESTÁTICO scripts/check-e2e-counts.mjs contra a mutação — o guard tem
# piso de sites (MIN_DOCUMENTED_SITES prod≥8 dev≥6) e FALHA com exit 1 quando
# a extração perde todos os sites de prod (a doc generalizada 128→N). Os 2
# elos (guard estático + teste de integração) têm que falhar JUNTOS no
# cenário A; no cenário B (âncora mutada, doc íntegra) o guard deve PASSAR,
# provando que a falha do guard em A veio SÓ da doc mutada.
#
# TERCEIRO VÉRTICE (cenário C): mutar a DERIVAÇÃO de verdade — comenta a 1ª
# asserção REAL do source (scripts/test-seed-prod-e2e.ts) → prod cai 128→127.
# Doc e âncora ficam INTACTAS; o teste "cada count documentado bate" falha
# (doc diz 128, derivação calcula 127) E o guard estático falha por
# DIVERGÊNCIA de count. O triângulo doc↔anchor↔código fica fechado nas 3
# direções: qualquer lado mutado sozinho trava o PR.
#
# PROVA DE INDEPENDÊNCIA (cenário D): além da doc 128→N (como em A),
# NEUTRALIZA o piso do guard estático (MIN_DOCUMENTED_SITES prod:8→0 via sed
# no check-e2e-counts.mjs). Sem piso e sem sites de prod documentados para
# divergir, o guard fica CEGO (exit 0). O vitest CONTINUA falhando ('piso prod
# violado') porque o piso do TESTE é próprio (hardcoded ≥ 8 no
# seed-e2e-count.test.ts), não herdado do guard — o teste de integração NÃO
# depende do guard para pegar a regressão da doc: os 2 elos são redundantes,
# não acoplados.
#
# ESPELHO DEV (cenário E): o contrato vale para AMBOS os counts — não só prod
# (128, cenário A) mas também DEV (162). A mutação ataca SÓ os sites de dev
# ("161 checks" → "N checks" + ternary '162' → 'N'), deixando a doc de prod
# INTACTA ("127 checks" presente) e a âncora dev (.toBe(162)) INTOCADA — a
# falha tem que vir SÓ da doc de dev. Vitest falha pelo piso dev ('piso dev
# violado', hardcoded ≥ 6 no teste) E o guard pelo piso de sites (dev
# encontrados 0 < 6 → 'piso por alvo violado'), fechando os 2 elos no par.
#
# Pipeline (in-place + trap, padrão do test-mutation-seed-dev-e2e.sh):
#   1. CONTROLE — vitest no seed-e2e-count.test.ts E guard estático no repo
#      REAL → ambos devem PASSAR (exit 0), provando que o fixture/comando
#      base é válido;
#   2. CENÁRIO A — backup dos SCAN_FILES + mutação da doc (sed) +
#      verificação de que aplicou → vitest → deve FALHAR com a mensagem
#      do piso (prodSites < 8) E guard estático → deve FALHAR com o piso
#      do guard (exit 1) → restaura a doc do backup;
#   3. CENÁRIO B — backup do TEST_FILE + mutação da âncora (sed) +
#      verificação de que a doc segue intacta → vitest → deve FALHAR com a
#      mensagem da sanidade (anchor prod desatualizado) → guard estático →
#      deve PASSAR (doc íntegra, falha isolada na âncora) → restaura;
#   4. CENÁRIO C — backup do DERIVATION_FILE + mutação do source (sed
#      comenta a 1ª asserção real → prod 128→127) + verificação de que a
#      doc E a âncora seguem intactas → vitest → deve FALHAR com a mensagem
#      "cada count documentado bate" → guard estático → deve FALHAR com a
#      divergência de count → restaura;
#   5. CENÁRIO D — backup dos SCAN_FILES E do GUARD_FILE + mutação da doc
#      (128→N, como em A) + NEUTRALIZAÇÃO do piso do guard
#      (MIN_DOCUMENTED_SITES prod:8→0) → vitest → deve CONTINUAR FALHANDO
#      ('piso prod violado' — o piso do TESTE é próprio, não herdado do
#      guard) → guard estático → deve PASSAR (exit 0, cego por design: sem
#      piso e sem sites de prod, não há o que acusar) → restaura;
#   6. CENÁRIO E — backup dos SCAN_FILES + mutação da doc DE DEV (162→N:
#      "161 checks" → "N checks" + ternary '162' → 'N') + verificação de
#      que a doc de prod ("127 checks") E a âncora dev (.toBe(162)) seguem
#      INTACTAS → vitest → deve FALHAR com 'piso dev violado' (≥ 6 sites
#      hardcoded no teste) → guard estático → deve FALHAR com o piso de
#      sites (dev 0 < 6) → restaura;
#   7. Restaurar tudo do backup (trap EXIT — cp, NUNCA git checkout).
#
# O script roda vitest REAL (precisa de node_modules — job dedicado com
# bun install no CI, NÃO vai na matriz node-pura do master mutation-guards).
# O guard estático roda via `node` (sem deps) e valida o mesmo contrato por
# outra via — os 2 elos juntos no mesmo run fecham o triângulo de ponta a
# ponta (doc ↔ anchor ↔ código).
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

# Os MESMOS arquivos que o check-e2e-counts.mjs escaneia (SCAN_FILES) — a
# mutação ataca exatamente onde a doc vive. Fonte única da lista: o guard.
SCAN_FILES=(
  ".github/workflows/pr-check.yml"
  ".github/workflows/seed-guards.yml"
  "scripts/validate-seed-guards-matrix-local.sh"
)

TEST_FILE="src/lib/__tests__/seed-e2e-count.test.ts"
# --reporter=basic é OBRIGATÓRIO: com GITHUB_ACTIONS=true (CI/act/container), o
# reporter padrão do vitest vira o github-actions, que URL-encodea o TITLE do
# ::error (espaços → %20) — e o EXPECTED_FAILURE_DERIVATION é o NOME do teste
# ('cada count documentado bate', no title), não uma asserção no body. O
# reporter basic imprime o nome literalmente em qualquer ambiente, tornando o
# expect_failure determinístico (bug real pego pelo run do act no cenário C).
VITEST_CMD=(bun x vitest run --config vitest.config.unit.ts --reporter=basic "$TEST_FILE")

# O GUARD ESTÁTICO da cadeia — o 2º elo além do vitest. Ele valida os counts
# DOCUMENTADOS nos SCAN_FILES contra a derivação (fonte da verdade). Com o
# piso de sites (MIN_DOCUMENTED_SITES prod≥8 dev≥6), ele também FALHA quando
# um site some da extração — o cenário exato da doc 128→N. Este mutation
# test exige que os DOIS elos falhem juntos (e que o guard passe quando a
# doc está íntegra, isolando a causa da falha em cada direção).
GUARD_CMD=(node scripts/check-e2e-counts.mjs)

# Asserção que o guard DEVE emitir quando a doc é generalizada (piso violado).
EXPECTED_GUARD_FAILURE="piso por alvo violado"

BACKUP_DIR="$(mktemp -d)"

# ── Cenário A — mutação da DOC: 128→N nos literais documentados ───────────
# 1. "127 checks" → "N checks"  (comentários/echos: prod E2E, test-seed-*-e2e.ts)
# 2. ternary '128' → 'N'        (matrix summary do seed-guards.yml — o site
#    do ternary prod morre; o dev ('162') fica, isolando a falha em prod)
MUTATION_SED=(
  "s/127 checks/N checks/g"
  "s/'127'/'N'/g"
)

# Asserção que o teste DEVE emitir quando a mutação da doc é detectada
# (piso prod). Fonte: src/lib/__tests__/seed-e2e-count.test.ts — describe
# "deriveExpectedChecks reproduz os counts documentados": o teste do piso
# falha com "piso prod violado: esperado ≥ 8 sites documentados..."
EXPECTED_FAILURE_DOC="piso prod violado"

# ── Cenário B — mutação da ÂNCORA: .toBe(128) → .toBe(129) ────────────────
# O `.toBe(128)` do seed-e2e-count.test.ts é a âncora de sanidade de prod
# ("sanidade: prod=128 e dev=162 no estado atual"). Mutá-lo para 129 faz a
# asserção falhar: a derivação real continua 128. (Dev é 162 — intocado,
# isolando a falha em prod, como no cenário A.)
ANCHOR_PATTERN=').toBe(127)'
ANCHOR_REPLACEMENT=').toBe(128)'

# Asserção que o teste DEVE emitir quando a âncora é mutada (sanidade prod).
EXPECTED_FAILURE_ANCHOR="anchor prod desatualizado"

# ── Cenário C — mutação da DERIVAÇÃO: neutraliza 1 asserção REAL no source ─
# O 3º vértice do triângulo: o CÓDIGO que deriva os counts
# (scripts/test-seed-prod-e2e.ts). O sed comenta a 1ª linha `  expect(` real
# do source — a derivação (scripts/seed-e2e-count.ts) lê o source e conta os
# sites de asserção; comentado = site some → prod cai de 128 para 127. A doc
# dos workflows e a âncora do teste ficam INTACTAS (verificado abaixo) — a
# falha tem que vir SÓ do código mutado. O teste "cada count documentado
# bate com deriveExpectedChecks do alvo" falha porque a doc documenta 128 e
# a derivação agora calcula 127; o guard estático falha por DIVERGÊNCIA de
# count (não piso — os sites continuam documentados, só divergem do valor).
DERIVATION_FILE="scripts/test-seed-prod-e2e.ts"

# Mutação: comenta a 1ª linha que casa `^[[:space:]]*expect(` (a 1ª asserção
# real do source — NUNCA um comentário existente, que já é ignorado pela
# derivação). Fail-fast se o padrão não existir (source refatorado).
DERIVATION_SED="0,/^[[:space:]]*expect(/s//\/\/ MUTATION-C: expect(/"

# Asserções que o teste/guard DEVE emitir quando a derivação é mutada.
EXPECTED_FAILURE_DERIVATION="cada count documentado bate"
EXPECTED_GUARD_FAILURE_DERIVATION="divergente(s) entre workflows e derivação"

# ── Cenário D — doc MUTADA + piso do GUARD neutralizado (independência) ──
# O 4º cenário prova que o teste de integração NÃO depende do guard estático:
# além da doc 128→N (como no cenário A), NEUTRALIZA o piso do guard
# (MIN_DOCUMENTED_SITES prod:8→0 via sed no check-e2e-counts.mjs). Com o piso
# zero e sem sites de prod para divergir, o guard fica CEGO (exit 0) — mas o
# vitest CONTINUA falhando ('piso prod violado') porque o piso do TESTE é
# próprio (hardcoded ≥ 8 no seed-e2e-count.test.ts), não herdado do guard.
GUARD_FILE="scripts/check-e2e-counts.mjs"
GUARD_PISO_PATTERN="{ prod: 8, dev: 6 }"
GUARD_PISO_REPLACEMENT="{ prod: 0, dev: 6 }"

# Asserção que o teste DEVE emitir com a doc mutada mesmo com o guard cego
# (o MESMO piso do cenário A — mas aqui provando que ele é do teste, não do guard).
EXPECTED_FAILURE_INDEPENDENCE="piso prod violado"

# ── Cenário E — mutação da DOC DE DEV: 162→N nos literais documentados ──
# O contrato vale para AMBOS os counts: além de prod (128, cenário A), o dev
# (162) também é auditado. Esta mutação ataca SÓ os sites de dev: "162
# checks" → "N checks" (5 sites: pr-check 1, seed-guards 3, validate 1) e o
# ternary '162' → 'N' (o site do ternary dev morre; o prod ('128') fica,
# isolando a falha em dev). A doc de prod ("127 checks") E a âncora dev
# (.toBe(162)) ficam INTACTAS — a falha vem SÓ da doc de dev.
MUTATION_SED_DEV=(
  "s/161 checks/N checks/g"
  "s/'161'/'N'/g"
)

# Asserção que o teste DEVE emitir quando a doc de dev é mutada (piso dev).
# Fonte: src/lib/__tests__/seed-e2e-count.test.ts — o teste do piso falha
# com "piso dev violado: esperado ≥ 6 sites documentados..." (dev ≥ 6).
EXPECTED_FAILURE_DEV="piso dev violado"

# Âncora de DEV no TEST_FILE — usada para provar que a âncora NÃO foi tocada
# (a falha do cenário E vem SÓ da doc de dev, não de um anchor leak).
DEV_ANCHOR_PATTERN=').toBe(161)'

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ── Restore handlers (trap EXIT — SEMPRE restaura, mesmo com falha) ──────
# cp do backup (nunca `git checkout --`) para não descartar edições locais
# não-commitadas do dev que rodar o script na própria máquina. Guard `-f`:
# só restaura backups que o cp realmente criou (falha ANTES do backup não
# sobrescreve nada).
restore_scan() {
  for i in "${!SCAN_FILES[@]}"; do
    local backup="$BACKUP_DIR/scan-$i"
    local target="${SCAN_FILES[$i]}"
    if [ -f "$backup" ] && [ -f "$target" ]; then
      cp "$backup" "$target"
      echo "  ↻ $target restaurado do backup"
    fi
  done
}

restore_anchor() {
  if [ -f "$BACKUP_DIR/anchor" ] && [ -f "$TEST_FILE" ]; then
    cp "$BACKUP_DIR/anchor" "$TEST_FILE"
    echo "  ↻ $TEST_FILE restaurado do backup"
  fi
}

restore_derivation() {
  if [ -f "$BACKUP_DIR/derivation" ] && [ -f "$DERIVATION_FILE" ]; then
    cp "$BACKUP_DIR/derivation" "$DERIVATION_FILE"
    echo "  ↻ $DERIVATION_FILE restaurado do backup"
  fi
}

restore_guard() {
  if [ -f "$BACKUP_DIR/guard" ] && [ -f "$GUARD_FILE" ]; then
    cp "$BACKUP_DIR/guard" "$GUARD_FILE"
    echo "  ↻ $GUARD_FILE restaurado do backup"
  fi
}

restore_all() {
  restore_scan
  restore_anchor
  restore_derivation
  restore_guard
  rm -rf "$BACKUP_DIR"
}
trap restore_all EXIT

# ── run_vitest: roda o teste e captura output/exit ───────────────────────
run_vitest() {
  set +e
  VITEST_OUTPUT="$("${VITEST_CMD[@]}" 2>&1)"
  VITEST_EXIT=$?
  set -e
}

# ── run_guard: roda o guard estático e captura output/exit ───────────────
run_guard() {
  set +e
  GUARD_OUTPUT="$("${GUARD_CMD[@]}" 2>&1)"
  GUARD_EXIT=$?
  set -e
}

# ── Verdict de uma direção: cego / falhou-mas-asserção-errada / detectado ─
# Caso 1 — guard CEGO: o teste PASSOU com a mutação aplicada (regressão
# não detectada — exatamente o que este cenário existe para bloquear).
# Caso 2 — falhou, mas NÃO pela asserção esperada (infra/schema/quebra
# diferente da mutação) → não dá para confirmar que o guard pega ESTA
# regressão → falha com diagnóstico claro.
# Caso 3 — ✅ mutação detectada pela asserção certa.
# Uso: expect_failure <descrição do cenário> <asserção esperada> <output> <exit>
expect_failure() {
  local label="$1" expected="$2" output="$3" exitcode="$4"

  if [ "$exitcode" -eq 0 ]; then
    fail "GUARD CEGO: a validação passou (exit 0) com $label."
    fail "Uma atualização unilateral ($label) passaria no CI — o contrato"
    fail "de atualização coordenada não está enforced."
    exit 1
  fi

  # HERESTRING, não pipe: com `set -o pipefail`, `echo | grep -q` é FLAKY —
  # o `grep -q` fecha o stdin ao achar o 1º casamento, o `echo` leva SIGPIPE
  # e o pipeline termina 141 (falha) mesmo com o casamento ENCONTRADO. O
  # tamanho do output decide se o escritor ainda estava escrevendo quando o
  # leitor saiu — daí a intermitência (passa com output curto, falha com
  # longo). A herestring não cria pipeline, então não há SIGPIPE.
  if ! grep -Fq "$expected" <<<"$output"; then
    fail "Teste falhou (exit $exitcode) mas NÃO pela asserção esperada:"
    fail "  esperava:  $expected"
    fail "Falha pode ser infra/outra asserção — veja o output acima."
    exit 1
  fi

  pass "Mutação DETECTADA ($label): teste falhou com '$expected' (exit $exitcode)"
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (contrato de atualização coordenada)"
echo "   A: doc dos workflows 128→N (anchor do teste INTOCADO)"
echo "   B: anchor do teste 128→129 (doc dos workflows INTOCADA)"
echo "   C: derivação do código 128→127 (doc E anchor INTOCADOS)"
echo "   D: doc 128→N + piso do guard NEUTRALIZADO (independência)"
echo "   E: doc de DEV 162→N (doc de prod E anchor dev INTOCADOS)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1 — CONTROLE: repo real → o teste DEVE passar
# ═════════════════════════════════════════════════════════════════════════

info "CONTROLE — seed-e2e-count.test.ts no repo REAL (exit 0 esperado)..."
run_vitest
echo "$VITEST_OUTPUT" | tail -4

if [ "$VITEST_EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: seed-e2e-count.test.ts saiu com exit $VITEST_EXIT no repo real."
  fail "O fixture/comando base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — teste passa no repo real (exit 0)"

info "CONTROLE do GUARD — check-e2e-counts.mjs no repo REAL (exit 0 esperado)..."
run_guard
echo "$GUARD_OUTPUT" | tail -2

if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "CONTROLE do GUARD FALHOU: check-e2e-counts.mjs saiu com exit $GUARD_EXIT no repo real."
  fail "O guard estático não valida o repo intacto — o fixture base é inválido."
  exit 1
fi
pass "Controle do guard OK — guard estático passa no repo real (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 2 — CENÁRIO A: backup + mutação da DOC (128→N) nos SCAN_FILES
# ═════════════════════════════════════════════════════════════════════════

info "CENÁRIO A: backup + mutação 128→N nos SCAN_FILES..."

for i in "${!SCAN_FILES[@]}"; do
  cp "${SCAN_FILES[$i]}" "$BACKUP_DIR/scan-$i"
done

# Fail-fast: se o padrão não existir (doc refatorada), o sed vira no-op
# silencioso → o teste passaria e o script acusaria "guard cego" sendo que
# o problema é o padrão do mutation test. Pare com mensagem clara.
if ! grep -Fq "127 checks" "${SCAN_FILES[@]}"; then
  fail "Padrão '127 checks' não encontrado nos SCAN_FILES."
  fail "A doc dos workflows mudou? Atualize MUTATION_SED neste script."
  exit 1
fi

for file in "${SCAN_FILES[@]}"; do
  for pat in "${MUTATION_SED[@]}"; do
    sed -i "$pat" "$file"
  done
done

# Verifica que a mutação realmente aplicou (novo presente + antigo ausente).
if grep -Fq "N checks" "${SCAN_FILES[@]}" && ! grep -Fq "127 checks" "${SCAN_FILES[@]}"; then
  pass "Mutação A aplicada: '127 checks' → 'N checks' (anchor do teste intocado)"
else
  fail "Mutação A não aplicou corretamente (sed falhou?)."
  exit 1
fi

info "CENÁRIO A: seed-e2e-count.test.ts com a doc MUTADA (falha esperada)..."
run_vitest
echo "$VITEST_OUTPUT" | tail -12
expect_failure "doc dos workflows 128→N" "$EXPECTED_FAILURE_DOC" "$VITEST_OUTPUT" "$VITEST_EXIT"

# ── 2º ELO: o guard estático TAMBÉM deve falhar contra a doc mutada. Com o
# piso de sites (prod≥8), a extração que perde TODOS os sites de prod vira
# violação do guard (exit 1) — fechando os 2 elos da cadeia no mesmo run.
info "CENÁRIO A: check-e2e-counts.mjs contra a doc MUTADA (exit 1 esperado)..."
run_guard
echo "$GUARD_OUTPUT" | tail -5
expect_failure "guard estático contra a doc 128→N" "$EXPECTED_GUARD_FAILURE" "$GUARD_OUTPUT" "$GUARD_EXIT"

# Restaura a doc ANTES do cenário B (o cenário B precisa da doc íntegra
# para provar que a falha vem só da âncora).
restore_scan
pass "Doc dos workflows restaurada do backup — base íntegra para o cenário B"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3 — CENÁRIO B: backup + mutação da ÂNCORA (.toBe(128) → .toBe(129))
# ═════════════════════════════════════════════════════════════════════════

info "CENÁRIO B: backup + mutação da âncora no TEST_FILE..."

cp "$TEST_FILE" "$BACKUP_DIR/anchor"

# Fail-fast: se o padrão da âncora não existir (teste refatorado), o sed vira
# no-op silencioso → pare com mensagem clara em vez de acusar "guard cego".
if ! grep -Fq "$ANCHOR_PATTERN" "$TEST_FILE"; then
  fail "Padrão da âncora '$ANCHOR_PATTERN' não encontrado em $TEST_FILE."
  fail "O seed-e2e-count.test.ts mudou? Atualize ANCHOR_PATTERN neste script."
  exit 1
fi

sed -i "s/${ANCHOR_PATTERN}/${ANCHOR_REPLACEMENT}/" "$TEST_FILE"

# Verifica que a mutação realmente aplicou (novo presente + antigo ausente).
if grep -Fq "$ANCHOR_REPLACEMENT" "$TEST_FILE" && ! grep -Fq "$ANCHOR_PATTERN" "$TEST_FILE"; then
  pass "Mutação B aplicada: '.toBe(128)' → '.toBe(129)' (dev=162 intocado)"
else
  fail "Mutação B não aplicou corretamente (sed falhou?)."
  exit 1
fi

# Prova o isolamento: a doc dos workflows DEVE estar intacta — a falha do
# teste neste cenário tem que vir SÓ da âncora, não de uma doc mutada
# sobrando do cenário A (ou de um leak do sed).
if ! grep -Fq "127 checks" "${SCAN_FILES[@]}"; then
  fail "Doc dos workflows NÃO está íntegra ('127 checks' ausente)."
  fail "O cenário A não foi restaurado? Verifique antes de prosseguir."
  exit 1
fi
pass "Doc dos workflows INTACTA ('127 checks' presente) — falha isolada na âncora"

info "CENÁRIO B: seed-e2e-count.test.ts com a âncora MUTADA (falha esperada)..."
run_vitest
echo "$VITEST_OUTPUT" | tail -12
expect_failure "anchor do teste 128→129" "$EXPECTED_FAILURE_ANCHOR" "$VITEST_OUTPUT" "$VITEST_EXIT"

# ── GUARD no cenário B: a doc está INTACTA (verificado acima) → o guard
# estático DEVE PASSAR (exit 0). Isso isola a causa da falha de B na âncora
# (que o guard nem lê) e prova que a falha do guard em A veio SÓ da doc
# mutada — não de um guard quebrado que falharia em qualquer estado.
info "CENÁRIO B: check-e2e-counts.mjs contra a doc INTACTA (exit 0 esperado)..."
run_guard
echo "$GUARD_OUTPUT" | tail -2

if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "Guard estático falhou no cenário B com a doc íntegra (exit $GUARD_EXIT)."
  fail "Isso indica que o guard falha em QUALQUER estado (infra) ou que a doc"
  fail "não foi restaurada do cenário A — veja o output acima."
  exit 1
fi
pass "Guard estático passa no cenário B (exit 0) — doc íntegra, falha isolada na âncora"

# Restaura a âncora EXPLICITAMENTE antes do cenário C (o cenário C precisa
# da âncora íntegra para provar que a falha vem SÓ do código mutado; o trap
# EXIT também restaura no fim — redundante e seguro).
restore_anchor
pass "Âncora do teste restaurada do backup — base íntegra para o cenário C"

# ═════════════════════════════════════════════════════════════════════════
# STEP 4 — CENÁRIO C: backup + mutação da DERIVAÇÃO (1 asserção real)
# ═════════════════════════════════════════════════════════════════════════

info "CENÁRIO C: backup + mutação da derivação no source do E2E prod..."

cp "$DERIVATION_FILE" "$BACKUP_DIR/derivation"

# Fail-fast: se o padrão não existir (source refatorado), o sed vira no-op
# silencioso → o teste passaria e o script acusaria "guard cego" sendo que
# o problema é o padrão do mutation test. Pare com mensagem clara.
if ! grep -qE '^[[:space:]]*expect\(' "$DERIVATION_FILE"; then
  fail "Nenhuma linha '  expect(' real encontrada em $DERIVATION_FILE."
  fail "O source do E2E prod mudou? Atualize DERIVATION_SED neste script."
  exit 1
fi

sed -i "$DERIVATION_SED" "$DERIVATION_FILE"

# Verifica que a mutação realmente aplicou (marcador presente).
if grep -Fq "MUTATION-C: expect(" "$DERIVATION_FILE"; then
  pass "Mutação C aplicada: 1ª asserção real comentada no source (marcador MUTATION-C)"
else
  fail "Mutação C não aplicou corretamente (sed falhou?)."
  exit 1
fi

# Prova o isolamento: a doc dos workflows E a âncora do teste DEVM estar
# intactas — a falha deste cenário tem que vir SÓ do código mutado.
if ! grep -Fq "127 checks" "${SCAN_FILES[@]}"; then
  fail "Doc dos workflows NÃO está íntegra ('127 checks' ausente)."
  fail "Os cenários A/B não foram restaurados? Verifique antes de prosseguir."
  exit 1
fi
if ! grep -Fq "$ANCHOR_PATTERN" "$TEST_FILE"; then
  fail "Âncora do teste NÃO está íntegra ('.toBe(128)' ausente)."
  fail "O cenário B não foi restaurado? Verifique antes de prosseguir."
  exit 1
fi
pass "Doc INTACTA ('127 checks') E âncora INTACTA ('.toBe(128)') — falha isolada na derivação"

info "CENÁRIO C: seed-e2e-count.test.ts com a derivação MUTADA (falha esperada)..."
run_vitest
echo "$VITEST_OUTPUT" | tail -12
expect_failure "derivação do código 128→127" "$EXPECTED_FAILURE_DERIVATION" "$VITEST_OUTPUT" "$VITEST_EXIT"

# ── 2º ELO no cenário C: o guard estático TAMBÉM deve falhar — a doc
# documenta 128, a derivação calcula 127 → DIVERGÊNCIA de count (não piso:
# os sites continuam todos documentados, só o VALOR diverge).
info "CENÁRIO C: check-e2e-counts.mjs contra a derivação MUTADA (exit 1 esperado)..."
run_guard
echo "$GUARD_OUTPUT" | tail -5
expect_failure "guard estático contra a derivação 128→127" "$EXPECTED_GUARD_FAILURE_DERIVATION" "$GUARD_OUTPUT" "$GUARD_EXIT"

# Restaura a derivação EXPLICITAMENTE antes das mensagens finais (o trap
# EXIT também restaura no fim — redundante e seguro — mas o claim abaixo
# fica verdadeiro no momento em que é impresso).
restore_derivation
pass "Derivação do source restaurada do backup — repo real de volta"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5 — CENÁRIO D: doc MUTADA (128→N) + piso do GUARD neutralizado
# ═════════════════════════════════════════════════════════════════════════

info "CENÁRIO D: backup + mutação da doc (128→N) E neutralização do piso do guard..."

# Backup FRESCO dos SCAN_FILES (o cenário A já restaurou — o D re-muta) + guard
for i in "${!SCAN_FILES[@]}"; do
  cp "${SCAN_FILES[$i]}" "$BACKUP_DIR/scan-$i"
done
cp "$GUARD_FILE" "$BACKUP_DIR/guard"

# Fail-fast: padrões dos seds presentes (doc refatorada / guard reestruturado)
if ! grep -Fq "127 checks" "${SCAN_FILES[@]}"; then
  fail "Padrão '127 checks' não encontrado nos SCAN_FILES."
  fail "A doc dos workflows mudou? Atualize MUTATION_SED neste script."
  exit 1
fi
if ! grep -Fq "$GUARD_PISO_PATTERN" "$GUARD_FILE"; then
  fail "Padrão do piso '$GUARD_PISO_PATTERN' não encontrado em $GUARD_FILE."
  fail "O guard foi reestruturado? Atualize GUARD_PISO_PATTERN neste script."
  exit 1
fi

# Aplica as DUAS mutações: doc 128→N (como no cenário A) + piso do guard
for file in "${SCAN_FILES[@]}"; do
  for pat in "${MUTATION_SED[@]}"; do
    sed -i "$pat" "$file"
  done
done
sed -i "s/${GUARD_PISO_PATTERN}/${GUARD_PISO_REPLACEMENT}/" "$GUARD_FILE"

# Verifica que AMBAS as mutações aplicaram + âncora intacta
if grep -Fq "N checks" "${SCAN_FILES[@]}" && ! grep -Fq "127 checks" "${SCAN_FILES[@]}"; then
  pass "Mutação da doc aplicada: '127 checks' → 'N checks'"
else
  fail "Mutação da doc não aplicou corretamente (sed falhou?)."
  exit 1
fi
if grep -Fq "$GUARD_PISO_REPLACEMENT" "$GUARD_FILE" && ! grep -Fq "$GUARD_PISO_PATTERN" "$GUARD_FILE"; then
  pass "Piso do guard NEUTRALIZADO: '$GUARD_PISO_PATTERN' → '$GUARD_PISO_REPLACEMENT'"
else
  fail "Neutralização do piso não aplicou (sed falhou?)."
  exit 1
fi
if ! grep -Fq "$ANCHOR_PATTERN" "$TEST_FILE"; then
  fail "Âncora do teste NÃO está íntegra ('.toBe(128)' ausente)."
  fail "O cenário B não foi restaurado? Verifique antes de prosseguir."
  exit 1
fi
pass "Âncora INTACTA ('.toBe(128)') — a falha do vitest não pode vir da âncora"

# ── O PONTO DO CENÁRIO: com o piso do guard neutralizado, o guard fica CEGO
# (exit 0 — sem piso e sem sites de prod para divergir, ele não tem o que
# acusar). O vitest CONTINUA falhando porque o piso do TESTE é próprio
# (hardcoded ≥ 8 no seed-e2e-count.test.ts) — o teste de integração NÃO
# depende do guard para pegar a regressão da doc. Este exit 0 do guard só é
# significativo porque o CONTROLE (STEP 1) provou que o guard passa no repo
# INTACTO — aqui ele passa por design, não por guard quebrado.
info "CENÁRIO D: seed-e2e-count.test.ts com doc mutada E piso do guard NEUTRALIZADO (falha esperada)..."
run_vitest
echo "$VITEST_OUTPUT" | tail -12
expect_failure "doc 128→N com piso do guard neutralizado" "$EXPECTED_FAILURE_INDEPENDENCE" "$VITEST_OUTPUT" "$VITEST_EXIT"

info "CENÁRIO D: check-e2e-counts.mjs com piso NEUTRALIZADO (exit 0 esperado — cego por design)..."
run_guard
echo "$GUARD_OUTPUT" | tail -2

if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "Guard estático falhou no cenário D (exit $GUARD_EXIT)."
  fail "Esperado exit 0: com o piso neutralizado (prod:8→0) e sem sites de prod"
  fail "documentados, o guard não tem o que acusar — o cenário D prova a"
  fail "INDEPENDÊNCIA do teste: só o vitest pega a regressão da doc."
  exit 1
fi
pass "Guard estático passa no cenário D (exit 0) — cego por design; o vitest é o detector independente"

# Restaura doc E guard ANTES do banner final (o trap EXIT também restaura)
restore_scan
restore_guard
pass "Doc dos workflows E guard restaurados do backup — repo real de volta"

# ═════════════════════════════════════════════════════════════════════════
# STEP 6 — CENÁRIO E: doc de DEV MUTADA (162→N), prod E âncora dev intactos
# ═════════════════════════════════════════════════════════════════════════

info "CENÁRIO E: backup + mutação da doc de DEV (162→N) nos SCAN_FILES..."

# Backup FRESCO dos SCAN_FILES (o cenário D já restaurou — o E re-muta)
for i in "${!SCAN_FILES[@]}"; do
  cp "${SCAN_FILES[$i]}" "$BACKUP_DIR/scan-$i"
done

# Fail-fast: se o padrão não existir (doc refatorada), o sed vira no-op
# silencioso → o teste passaria e o script acusaria "guard cego" sendo que
# o problema é o padrão do mutation test. Pare com mensagem clara.
if ! grep -Fq "161 checks" "${SCAN_FILES[@]}"; then
  fail "Padrão '161 checks' não encontrado nos SCAN_FILES."
  fail "A doc dos workflows mudou? Atualize MUTATION_SED_DEV neste script."
  exit 1
fi

for file in "${SCAN_FILES[@]}"; do
  for pat in "${MUTATION_SED_DEV[@]}"; do
    sed -i "$pat" "$file"
  done
done

# Verifica que a mutação realmente aplicou (novo presente + antigo ausente).
if grep -Fq "N checks" "${SCAN_FILES[@]}" && ! grep -Fq "161 checks" "${SCAN_FILES[@]}"; then
  pass "Mutação E aplicada: '161 checks' → 'N checks' (anchor dev intocado)"
else
  fail "Mutação E não aplicou corretamente (sed falhou?)."
  exit 1
fi

# Prova o isolamento: a doc de PROD ("127 checks") E a âncora de DEV
# ('.toBe(162)') DEVM estar intactas — a falha deste cenário tem que vir SÓ
# da doc de dev, não de um leak do sed (que atingisse prod) nem do anchor.
if ! grep -Fq "127 checks" "${SCAN_FILES[@]}"; then
  fail "Doc de PROD NÃO está íntegra ('127 checks' ausente)."
  fail "O sed do cenário E atingiu prod? Verifique MUTATION_SED_DEV."
  exit 1
fi
if ! grep -Fq "$DEV_ANCHOR_PATTERN" "$TEST_FILE"; then
  fail "Âncora de DEV NÃO está íntegra ('.toBe(162)' ausente)."
  fail "O cenário B/C não foi restaurado? Verifique antes de prosseguir."
  exit 1
fi
pass "Doc de prod INTACTA ('127 checks') E âncora dev INTACTA ('.toBe(162)') — falha isolada na doc de dev"

info "CENÁRIO E: seed-e2e-count.test.ts com a doc de DEV MUTADA (falha esperada)..."
run_vitest
echo "$VITEST_OUTPUT" | tail -12
expect_failure "doc de dev dos workflows 162→N" "$EXPECTED_FAILURE_DEV" "$VITEST_OUTPUT" "$VITEST_EXIT"

# ── 2º ELO no cenário E: o guard estático TAMBÉM deve falhar contra a doc de
# dev mutada. Com o piso de sites (dev ≥ 6), a extração que perde TODOS os
# sites de dev vira violação do guard (exit 1, piso por alvo violado — dev
# encontrados 0 < 6).
info "CENÁRIO E: check-e2e-counts.mjs contra a doc de DEV MUTADA (exit 1 esperado)..."
run_guard
echo "$GUARD_OUTPUT" | tail -5
expect_failure "guard estático contra a doc de dev 162→N" "$EXPECTED_GUARD_FAILURE" "$GUARD_OUTPUT" "$GUARD_EXIT"

# Restaura a doc ANTES do banner final (o trap EXIT também restaura)
restore_scan
pass "Doc dos workflows restaurada do backup — repo real de volta"

# ═════════════════════════════════════════════════════════════════════════
# Result (restore roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — os DOIS elos da cadeia pegam o contrato no TRIÂNGULO completo:"
pass "  • controle: teste passa (exit 0) E guard estático passa (exit 0) no repo real"
pass "  • A: doc 128→N → vitest FALHA com '$EXPECTED_FAILURE_DOC' E guard estático"
pass "      FALHA com '$EXPECTED_GUARD_FAILURE' (2 elos juntos)"
pass "  • B: anchor 128→129 → vitest FALHA com '$EXPECTED_FAILURE_ANCHOR' E guard"
pass "      estático PASSA (doc íntegra — falha isolada na âncora)"
pass "  • C: derivação 128→127 → vitest FALHA com '$EXPECTED_FAILURE_DERIVATION' E"
pass "      guard estático FALHA com '$EXPECTED_GUARD_FAILURE_DERIVATION' (doc E"
pass "      âncora íntegras — falha isolada no código)"
pass "  • D: doc 128→N + piso do guard NEUTRALIZADO → vitest FALHA com"
pass "      '$EXPECTED_FAILURE_INDEPENDENCE' E guard PASSA (exit 0, cego por"
pass "      design — o teste de integração NÃO depende do guard)"
pass "  • E: doc de dev 162→N → vitest FALHA com '$EXPECTED_FAILURE_DEV' E guard"
pass "      estático FALHA com '$EXPECTED_GUARD_FAILURE' (2 elos juntos — o"
pass "      contrato vale para prod E dev)"
pass "  • doc, anchor E código precisam andar juntos — qualquer lado sozinho trava o PR"
pass "Todos os arquivos foram restaurados do backup (repo real intocado)."
exit 0
