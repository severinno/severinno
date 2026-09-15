#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-lint-guard.sh — Mutation test do LINT GUARD (prettier
# + eslint zero) — item #8 da auditoria
#
# Usage:
#   ./scripts/test-mutation-lint-guard.sh
#
# Exit codes:
#   0 — mutações DETECTADAS (prettier/eslint falharam pelas asserções) ✅
#   1 — guard CEGO (algum comando passou com a mutação) OU infra ❌
#
# O COMANDO É UM SÓ, NAS DUAS FORJAS: o par (prettier + eslint zero) mora no
# script `lint` do package.json e os dois jobs (`lint` na Gitea, `lint-guard` no
# GitHub) rodam `bun run lint`. O STEP 0 prende esse contrato — se alguém
# esvaziar uma das metades (ex.: voltar para `eslint .`), os cenários abaixo
# continuariam verdes porque exercitam os BINS, não o comando que o CI roda.
#
# Prova que os comandos do gate de lint REALMENTE falham nas regressões que
# existem para bloquear:
#   Cenário A (PRETTIER):   arquivo TS mal formatado → `prettier --check` DEVE
#                           FALHAR (exit 1) citando o arquivo.
#   Cenário B (ESLINT):     arquivo TS com warning → `eslint --max-warnings 0`
#                           DEVE FALHAR (exit 1) citando o warning.
#   Cenário C (PRE-COMMIT): o BLOCO REAL do hook local (`.husky/pre-commit`)
#                           replicado num repo git temp com `git add` staged —
#                           `git diff --cached --name-only --diff-filter=ACMR`
#                           + `prettier --check` nos staged DEVE FALHAR (exit
#                           1) citando o arquivo mal formatado staged; e o
#                           CONTROLE com arquivo formatado staged deve PASS.
#                           Prova o hook end-to-end (não só os bins): a
#                           exclusão de binários e o `--diff-filter=ACMR` do
#                           bloco real são exercitados de verdade.
#
# CONTROLE: o mesmo fixture com arquivo formatado + sem warning passa nos
# DOIS comandos (exit 0) — a falha vem da MUTAÇÃO, não de fixture quebrado.
#
# Fixture: criado do zero num mktemp; os bins de prettier/eslint são os do
# node_modules do repo (não instala nada); NÃO toca NENHUM arquivo do repo
# real — tem a própria eslint.config.mjs mínima (flat config, regra warning).
# O fixture NÃO tem .prettierrc — o CONTROLE valida os DEFAULTS do prettier
# (semi: true etc.), não o estilo do repo; a mutação A falha sob QUALQUER
# config, então a prova é robusta a essa diferença.
#
# Pipeline:
#   0. CONTROLE DO COMANDO COMPARTILHADO: package.json > lint contém
#      `prettier --check --ignore-unknown` E `eslint . --max-warnings 0` (o par)
#   1. Cria temp dir com src/ok.ts (formatado, sem warning) + eslint.config.mjs
#   2. CONTROLE: prettier + eslint em ok.ts → exit 0
#   3. MUTAÇÃO A: src/bad-format.ts → prettier DEVE FALHAR
#   4. MUTAÇÃO B: src/bad-lint.ts (console.log) → eslint DEVE FALHAR
#   5. CENÁRIO C: fixture → repo git (init + baseline); staged formatado →
#      bloco PASS; staged mal formatado → bloco DEVE FALHAR citando o
#      arquivo; binário staged (.png) → bloco IGNORA (pass)
#   6. Cleanup (trap EXIT — rm -rf do temp)
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PRETTIER_BIN="$SCRIPT_DIR/node_modules/prettier/bin/prettier.cjs"
ESLINT_BIN="$SCRIPT_DIR/node_modules/eslint/bin/eslint.js"

TMP_DIR="$(mktemp -d)"

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

# ── setup_fixture: cria o esqueleto do fixture (eslint.config.mjs + ok.ts) ─
setup_fixture() {
  mkdir -p "$TMP_DIR/src"
  cat > "$TMP_DIR/eslint.config.mjs" <<'EOF'
export default [{ files: ["**/*.ts"], rules: { "no-console": "warn" } }]
EOF
  cat > "$TMP_DIR/src/ok.ts" <<'EOF'
const ok = 1;
export default ok;
EOF
}

# ── run_prettier: roda o MESMO bin/flags do job lint-guard no fixture ────
# Job: npx prettier --check --ignore-unknown 'src/**' ...
run_prettier() {
  set +e
  OUTPUT="$(cd "$TMP_DIR" && node "$PRETTIER_BIN" --check --ignore-unknown "src/**" 2>&1)"
  EXIT=$?
  set -e
}

# ── run_eslint: roda o MESMO bin/flags do job lint-guard no fixture ──────
# Job: npx eslint . --max-warnings 0
run_eslint() {
  set +e
  OUTPUT="$(cd "$TMP_DIR" && node "$ESLINT_BIN" . --max-warnings 0 2>&1)"
  EXIT=$?
  set -e
}

# ── STEP 0: o CONTRATO do comando COMPARTILHADO ───────────────────────────
# O gate não é mais um par de linhas no YAML de uma forja: é o script `lint` do
# package.json, que as DUAS forjas invocam. Os cenários A/B abaixo exercitam os
# BINS — e continuariam verdes com o script esvaziado de uma das metades (ex.:
# de volta a `eslint .`, o estado em que o merge da Gitea passava e o do GitHub
# rejeitava o MESMO commit). Esta asserção fecha a lacuna: os bins provados têm
# de ser os que o comando compartilhado realmente chama.
info "STEP 0: contrato do script compartilhado (package.json > lint)..."
LINT_SCRIPT="$(node -e 'process.stdout.write(String(require(process.argv[1]).scripts?.lint ?? ""))' "$SCRIPT_DIR/package.json")"
for fragmento in "prettier --check --ignore-unknown" "eslint . --max-warnings 0" "&&"; do
  if ! grep -Fq -- "$fragmento" <<<"$LINT_SCRIPT"; then
    fail "o script 'lint' do package.json NÃO contém '$fragmento'."
    fail "A régua precisa do PAR (prettier + eslint zero) num comando só — uma"
    fail "metade só é a assimetria de volta (a Gitea liberava o merge com o que o"
    fail "GitHub rejeitava)."
    echo "  lint = $LINT_SCRIPT"
    exit 1
  fi
done
pass "Contrato OK — package.json > lint é o par prettier + eslint zero (o MESMO comando nas duas forjas)"

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (lint-guard deve GATEAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Fixture + CONTROLE (formatado + sem warning → exit 0 nos 2)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando fixture em $TMP_DIR (eslint.config.mjs + src/ok.ts)..."
setup_fixture

info "STEP 2: Controle — ok.ts formatado e sem warning deve PASS (exit 0)..."

run_prettier
if [ "$EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU (prettier): arquivo FORMATADO foi rejeitado (exit $EXIT)."
  echo "$OUTPUT" | tail -6
  fail "O fixture base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — prettier --check passa no arquivo formatado (exit 0)"

run_eslint
if [ "$EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU (eslint): arquivo SEM warning foi rejeitado (exit $EXIT)."
  echo "$OUTPUT" | tail -6
  fail "O fixture base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — eslint --max-warnings 0 passa no arquivo limpo (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3+4 — MUTAÇÃO A (arquivo mal formatado): prettier DEVE FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação A — src/bad-format.ts com spacing errado..."
cat > "$TMP_DIR/src/bad-format.ts" <<'EOF'
const badly = 1;
export default badly;
  const extra = 2;
EOF

info "STEP 4: Rodando prettier --check contra a mutação A..."
run_prettier
echo "$OUTPUT" | tail -4

# Caso 1 — guard CEGO: prettier PASSOU com o arquivo mal formatado.
if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (prettier): prettier --check passou com src/bad-format.ts"
  fail "mal formatado (exit 0). O --check de formatação está quebrado."
  exit 1
fi

# Caso 2 — falhou, mas NÃO citou o arquivo da mutação.
if ! grep -Fq "bad-format.ts" <<<"$OUTPUT"; then
  fail "prettier --check falhou (exit $EXIT) mas NÃO citou bad-format.ts."
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi
pass "Mutação A DETECTADA: prettier --check falhou citando bad-format.ts (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — MUTAÇÃO B (warning de lint): eslint DEVE FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Aplicando mutação B — src/bad-lint.ts com console.log (warning)..."
cat > "$TMP_DIR/src/bad-lint.ts" <<'EOF'
console.log("lint warning")
EOF

info "STEP 6: Rodando eslint --max-warnings 0 contra a mutação B..."
run_eslint
echo "$OUTPUT" | tail -6

# Caso 1 — guard CEGO: eslint PASSOU com o warning.
if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (eslint): eslint --max-warnings 0 passou com src/bad-lint.ts"
  fail "contendo warning (exit 0). O gate de warnings está quebrado."
  exit 1
fi

# Caso 2 — falhou, mas NÃO citou o warning da mutação.
if ! grep -Fq "bad-lint.ts" <<<"$OUTPUT"; then
  fail "eslint --max-warnings 0 falhou (exit $EXIT) mas NÃO citou bad-lint.ts."
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi
pass "Mutação B DETECTADA: eslint --max-warnings 0 falhou citando bad-lint.ts (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# CENÁRIO C — BLOCO REAL do pre-commit (.husky/pre-commit) em repo git temp
# ═════════════════════════════════════════════════════════════════════════

info "STEP 7: Transformando o fixture em repo git (init + baseline commit)..."
git -C "$TMP_DIR" init -q
git -C "$TMP_DIR" config user.email "t@t"
git -C "$TMP_DIR" config user.name "t"
git -C "$TMP_DIR" add -A
git -C "$TMP_DIR" commit -qm "baseline"
pass "Repo git criado com baseline commitado (ok.ts formatado + eslint.config.mjs)"

# O bloco real do hook é:
#   STAGED_FORMAT=$(git diff --cached --name-only --diff-filter=ACMR | grep -vE ...)
#   if [ -n "$STAGED_FORMAT" ]; then npx prettier --check --ignore-unknown $STAGED_FORMAT; fi
# Aqui replicamos EXATAMENTE o bloco (mesma derivação de staged e o mesmo
# check), com `node "$PRETTIER_BIN"` no lugar de `npx prettier` — o npx no
# hook resolve o bin do node_modules do repo; no fixture não há node_modules,
# então apontamos direto para o MESMO binário. A lógica de staged
# (diff --cached, ACMR, exclusão de binários) é idêntica à do hook.
run_precommit_block() {
  set +e
  STAGED_FORMAT=$(git -C "$TMP_DIR" diff --cached --name-only --diff-filter=ACMR | grep -vE '\.(png|jpg|gif|svg|ico|webp|pdf|lock|snap)$' || true)
  if [ -n "$STAGED_FORMAT" ]; then
    OUTPUT="$(cd "$TMP_DIR" && node "$PRETTIER_BIN" --check --ignore-unknown $STAGED_FORMAT 2>&1)"
    EXIT=$?
  else
    OUTPUT="(sem arquivos staged para formatar)"
    EXIT=0
  fi
  set -e
}

info "STEP 8: Controle do bloco — staged com arquivo FORMATADO deve PASS..."
# Baseline commit deixa o diff --cached VAZIO — sem staged o bloco passa pelo
# short-circuit (else), o que NÃO provaria o caminho positivo. Por isso staged
# de um arquivo formatado NOVO: STAGED_FORMAT não-vazio + prettier roda de
# verdade contra um arquivo bom (exit 0 significativo).
cat > "$TMP_DIR/src/good-staged.ts" <<'EOF'
const good = "formatado";
export default good;
EOF
git -C "$TMP_DIR" add src/good-staged.ts

run_precommit_block
if [ "$EXIT" -ne 0 ]; then
  fail "CONTROLE do bloco FALHOU (pre-commit): arquivo formatado staged foi"
  fail "rejeitado (exit $EXIT). O bloco do hook está quebrado ou o fixture"
  fail "não é válido."
  echo "$OUTPUT" | tail -6
  exit 1
fi
pass "Controle do bloco OK — pre-commit passa com staged formatado (exit 0)"

info "STEP 9: MUTAÇÃO C — staged com arquivo MAL FORMATADO deve FALHAR..."
cat > "$TMP_DIR/src/bad-staged.ts" <<'EOF'
const  staged    =   "ruim"
export  default  staged
EOF
git -C "$TMP_DIR" add src/bad-staged.ts

run_precommit_block
echo "$OUTPUT" | tail -4

# Caso 1 — bloco CEGO: o check passou com arquivo mal formatado staged.
if [ "$EXIT" -eq 0 ]; then
  fail "BLOCO CEGO (pre-commit): prettier --check passou com src/bad-staged.ts"
  fail "mal formatado STAGED (exit 0). A derivação de staged ou o check está"
  fail "quebrado."
  exit 1
fi

# Caso 2 — falhou, mas NÃO citou o arquivo staged da mutação.
if ! grep -Fq "bad-staged.ts" <<<"$OUTPUT"; then
  fail "O bloco falhou (exit $EXIT) mas NÃO citou bad-staged.ts."
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi
pass "Mutação C DETECTADA: pre-commit falhou citando bad-staged.ts staged (exit $EXIT)"

info "STEP 10: Binário staged (.png) deve ser IGNORADO pelo bloco..."
# White-box: prettier --ignore-unknown pula .png SOZINHO (exit 0 mesmo com o
# grep quebrado), então asserção por exit code seria tautológica. Em vez disso
# assert na DERIVAÇÃO: o .png ESTÁ staged (git diff --cached o lista), mas
# DEVE estar AUSENTE do STAGED_FORMAT pós-grep — provando o filtro do bloco.
# O rm --cached tira o bad-staged.ts do índice (arquivo não está no HEAD, vira
# untracked — some do diff, sem D).
git -C "$TMP_DIR" rm -q --cached src/bad-staged.ts
printf '\x89PNG\r\n\x1a\n' > "$TMP_DIR/src/pic.png"
git -C "$TMP_DIR" add src/pic.png

STAGED_RAW=$(git -C "$TMP_DIR" diff --cached --name-only --diff-filter=ACMR)
STAGED_FORMAT=$(grep -vE '\.(png|jpg|gif|svg|ico|webp|pdf|lock|snap)$' <<<"$STAGED_RAW" || true)

if ! grep -Fq "pic.png" <<<"$STAGED_RAW"; then
  fail "O .png NÃO está staged (git diff --cached não o lista) — o fixture"
  fail "do teste do binário não está montado."
  exit 1
fi
if grep -Fq "pic.png" <<<"$STAGED_FORMAT"; then
  fail "O filtro de binários NÃO excluiu pic.png do STAGED_FORMAT — o"
  fail "grep -vE do pre-commit está quebrado (o prettier rodaria no binário)."
  exit 1
fi
pass "Binário OK — pic.png staged, mas EXCLUÍDO do STAGED_FORMAT (grep -vE ok)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — lint-guard pega arquivo mal formatado (prettier)"
pass "e warning de lint (eslint --max-warnings 0), ambos exit 1"
pass "e o BLOCO REAL do pre-commit (staged, diff --cached) falha com staged ruim"
exit 0
