#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-forge-parity.sh — Mutation test do check-forge-parity
#
# Prova que o scripts/check-forge-parity.mjs REALMENTE falha nas regras que ele
# existe para fazer cumprir (a classificação dos gates, a régua ANCORADA do
# comando canônico, o CORE no dono do merge e o CANAL do remédio):
#
#   A) gate NOVO na forja DONA DO MERGE sem classificação  → NAO CLASSIFICADO
#      (a regressão que motivou o guard: um gate novo pulando a forja em
#      silêncio — o PR passa verde por onde rodou e a invariante some da outra)
#   B) gate NOVO no espelho GitHub sem classificação       → NAO CLASSIFICADO
#   C) gate classificado como GITHUB_ONLY que RODA na forja → classificação
#      stale (o gate roda lá ou a classificação mente)
#   D) invariante do CORE AUSENTE numa pipeline (o comando canônico removido) →
#      "invariante do CORE 'X' NAO roda aqui" — o buraco silencioso clássico: a
#      invariante desaparece de uma forja e o PR passa verde por onde ela ficou
#   E) o invariante PRESENTE por outra FORMA (chamada indireta `bun run
#      check:X`, ou o mesmo comando SEM o argumento canônico) → a régua é
#      ANCORADA: presença não é "casou a substring", é executar o comando
#      canônico. Sem estas duas, um gate enfraquecido (ou invocado por um
#      atalho que roda outra coisa) passaria como paridade
#   F) a MATRIZ de mutation tests (a prova que mede se um guard MORDE) removida
#      do dono do merge → o invariante `mutation-matrix` sai NOMEADO, com a
#      linha esperada e a pipeline. Esta é a regra que reverteu a isenção
#      `GITHUB_ONLY` da classe ("os jobs de mutation test existem só no
#      GitHub"): sem a mutação F, um passo que sumisse do ci.yml deixaria a
#      isenção antiga valendo de novo — e o PR da forja voltaria a mergear com
#      um guard cego, em silêncio
#   G) o CANAL DO REMÉDIO (a régua que não é gate: ele PUBLICA o patch do remédio
#      no PR) — três mutações, uma por regra:
#      G1) o passo REMOVIDO do dono do merge → nenhum passo invoca o canal
#          naquela forja, e quem abre o PR por lá reescreve à mão o que o fixer
#          remenda;
#      G2) o `--all` (cobertura do REGISTRO) trocado por `--fixer <um>` → o
#          fixer que ficou de fora sai NOMEADO. O nome do fixer é LIDO DO
#          REGISTRO pelo harness, nunca cravado aqui: a prova de que a cobertura
#          vem do registro não pode depender de quem escreve a mutação;
#      G3) o `--backend` trocado para o da OUTRA forja → o passo publicaria no
#          canal errado, com o token errado, e nenhum outro guard veria isso
#
# COMO (e por que assim): o guard roda com `--root` contra um FIXTURE que é uma
# CÓPIA dos dois pipelines REAIS (`.gitea/workflows/ci.yml`, o dono do merge, e
# `.github/workflows/pr-check.yml`), com a mutação injetada no arquivo copiado.
# O worktree nunca é tocado e o CONTROLE (cópia sem mutação → exit 0) prova que
# o fixture é fiel: sem ele, um guard que falhasse "de qualquer jeito" passaria
# como detecção. A versão anterior rodava com `--root`, que o guard IGNORAVA
# (lia o cwd) — a mutação nunca era lida e o harness se declarava CEGO.
#
# Pipeline:
#   1. Fixture = cópia dos 2 pipelines reais
#   2. CONTROLE: guard --root fixture → exit 0
#   3. MUTAÇÃO A: gate não classificado na forja (dona do merge) → DEVE FALHAR
#   4. MUTAÇÃO B: gate não classificado no espelho GitHub → DEVE FALHAR
#   5. MUTAÇÃO C: gate GITHUB_ONLY rodando na forja → DEVE FALHAR (stale)
#   6. MUTAÇÃO D: invariante do CORE com o comando canônico REMOVIDO → DEVE
#      FALHAR nomeando o invariante, a pipeline e a linha esperada
#   7. MUTAÇÃO E: invariante PRESENTE por outra forma (indireta, e sem o
#      argumento canônico) → DEVE FALHAR com a MESMA mensagem, e NÃO como gate
#      não classificado (a classificação casou: o que falhou foi a RÉGUA)
#   8. MUTAÇÃO F: a matriz de mutation removida da forja → DEVE FALHAR nomeando
#      `mutation-matrix`, a linha esperada e a pipeline
#   9. MUTAÇÃO G1: o canal do remédio removido da forja → DEVE FALHAR nomeando o
#      passo e a pipeline
#  10. MUTAÇÃO G2: a cobertura do canal trocada por `--all` → `--fixer <um>` →
#      DEVE FALHAR nomeando o fixer que ficou de FORA (lido do REGISTRO)
#  11. MUTAÇÃO G3: o canal com o `--backend` da OUTRA forja → DEVE FALHAR
#      nomeando o backend esperado
#  12. Cleanup (trap EXIT)
#
# Usage:
#   ./scripts/test-mutation-forge-parity.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard + controle passa ✅
#   1 — guard CEGO (alguma mutação passou) OU controle falso-positivo ❌
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-forge-parity.mjs"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
header() { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }

GITEA_WF=".gitea/workflows/ci.yml"
GITHUB_WF=".github/workflows/pr-check.yml"
FIXTURE="$TMP_DIR/fixture"

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-forge-parity deve GATEAR)"
echo "  ═════════════════════════════════════════════════════════════════"

# ── Fixture: cópia FIEL dos dois pipelines ────────────────────────────────

make_fixture() {
  rm -rf "${FIXTURE:?}"
  mkdir -p "$FIXTURE/.gitea/workflows" "$FIXTURE/.github/workflows"
  cp "$SCRIPT_DIR/$GITEA_WF" "$FIXTURE/$GITEA_WF"
  cp "$SCRIPT_DIR/$GITHUB_WF" "$FIXTURE/$GITHUB_WF"
}

# Injeta um job novo (gate) no fim de um pipeline do fixture.
# $1 = caminho relativo do workflow | $2 = comando `run:` do gate
inject_gate() {
  local wf="$1" cmd="$2"
  {
    echo ""
    echo "  mutacao-gate-injetado:"
    echo "    name: Mutacao (gate injetado)"
    echo "    runs-on: self-hosted"
    echo "    steps:"
    echo "      - run: $cmd"
  } >> "$FIXTURE/$wf"
}

run_guard() {
  set +e
  node "$GUARD" --root "$FIXTURE" > "$TMP_DIR/out.txt" 2>&1
  GUARD_EXIT=$?
  set -e
}

# `remover_comando <workflow> <comando>` — remove a LINHA EXATA
# `        run: <comando>` do fixture, recusando alvo ausente ou AMBÍGUO: uma
# mutação que aplica em dois lugares (ou em nenhum) não mede a regra que ela diz
# medir — ela mede outra coisa (ou nada) e o harness se declara detetor.
remover_comando() {
  WF="$1" CMD="$2" FIXTURE="$FIXTURE" python3 - <<'PY'
import os
p = os.path.join(os.environ["FIXTURE"], os.environ["WF"])
s = open(p).read()
old = "        run: " + os.environ["CMD"] + "\n"
n = s.count(old)
if n != 1:
    raise SystemExit(f"mutacao nao-cirurgica em {os.environ['WF']}: {n} ocorrencia(s) de {old.strip()!r}")
open(p, "w").write(s.replace(old, ""))
PY
  if grep -qF "        run: $2" "$FIXTURE/$1"; then
    fail "a remoção não aplicou em $1 (nada a medir)"
    exit 1
  fi
}

# `trocar_comando <workflow> <comando> <forma-divergente>` — troca a linha exata
# de `run:` por OUTRA forma de invocar o mesmo gate. É a mutação que mede a
# RÉGUA (ancorada no comando), não a classificação: a forma divergente continua
# casando o `matches` do invariante, e o que tem de reprovar é o `command`.
trocar_comando() {
  WF="$1" CMD="$2" NOVO="$3" FIXTURE="$FIXTURE" python3 - <<'PY'
import os
p = os.path.join(os.environ["FIXTURE"], os.environ["WF"])
s = open(p).read()
old = "        run: " + os.environ["CMD"] + "\n"
new = "        run: " + os.environ["NOVO"] + "\n"
n = s.count(old)
if n != 1:
    raise SystemExit(f"mutacao nao-cirurgica em {os.environ['WF']}: {n} ocorrencia(s) de {old.strip()!r}")
open(p, "w").write(s.replace(old, new))
PY
  if ! grep -qF "        run: $3" "$FIXTURE/$1"; then
    fail "a troca não aplicou em $1 (nada a medir)"
    exit 1
  fi
}

# ── CONTROLE ──────────────────────────────────────────────────────────────

header "CONTROLE: fixture (cópia fiel dos 2 pipelines) passa"
make_fixture
run_guard
if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU (exit $GUARD_EXIT): a cópia fiel dos pipelines foi rejeitada"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
pass "cópia fiel passa (exit 0) — o guard não falha 'de qualquer jeito'"

# ── MUTAÇÃO A: gate não classificado na forja (dona do merge) ─────────────

header "MUTAÇÃO A: gate não classificado na FORJA (dona do merge)"
make_fixture
inject_gate "$GITEA_WF" "node scripts/check-gate-nao-classificado-fake.mjs"
run_guard

if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "guard CEGO: passou com gate não classificado na forja (exit 0)"
  exit 1
fi
if ! grep -qF "NAO CLASSIFICADO" "$TMP_DIR/out.txt"; then
  fail "guard falhou (exit $GUARD_EXIT) mas NÃO citou gate não classificado"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
if ! grep -qF "check-gate-nao-classificado-fake.mjs" "$TMP_DIR/out.txt"; then
  fail "guard falhou mas NÃO nomeou o gate injetado"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
pass "mutação A DETECTADA: a forja não tem gate sem classificação (exit $GUARD_EXIT)"

# ── MUTAÇÃO B: gate não classificado no espelho GitHub ────────────────────

header "MUTAÇÃO B: gate não classificado no ESPELHO GitHub"
make_fixture
inject_gate "$GITHUB_WF" "node scripts/check-gate-nao-classificado-fake.mjs"
run_guard

if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "guard CEGO: passou com gate não classificado no GitHub (exit 0)"
  exit 1
fi
if ! grep -qF "NAO CLASSIFICADO" "$TMP_DIR/out.txt"; then
  fail "guard falhou (exit $GUARD_EXIT) mas NÃO citou gate não classificado"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
pass "mutação B DETECTADA: o espelho GitHub também exige classificação (exit $GUARD_EXIT)"

# ── MUTAÇÃO C: classificação stale (github-only rodando na forja) ─────────

header "MUTAÇÃO C: gate github-only RODANDO na forja (classificação stale)"
make_fixture
inject_gate "$GITEA_WF" "node scripts/check-dependency-review.mjs"
run_guard

if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "guard CEGO: passou com classificação stale na forja (exit 0)"
  exit 1
fi
if ! grep -qF "classificado como GITHUB_ONLY mas RODA aqui" "$TMP_DIR/out.txt"; then
  fail "guard falhou (exit $GUARD_EXIT) mas NÃO citou a classificação stale"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
pass "mutação C DETECTADA: a isenção não pode mentir sobre onde o gate roda (exit $GUARD_EXIT)"

# ── MUTAÇÃO D: invariante do CORE ausente numa pipeline ───────────────────
#
# A TERCEIRA regra: além de nenhum gate ficar sem classificação e nenhuma isenção
# mentir sobre onde roda, todo invariante do CORE tem de RODAR nas DUAS pipelines
# com o COMANDO CANÔNICO. A mutação remove a linha do comando de uma forja — o
# buraco silencioso clássico: a invariante desaparece de uma pipeline e o PR
# passa verde pela outra, sem que nada no diff diga isso.
#
# A asserção inclui o COMANDO ESPERADO no diagnóstico: "não roda aqui" sem dizer
# o que falta faz quem lê procurar um gate que ESTÁ lá (invocado de outra forma).

header "MUTAÇÃO D: invariante do CORE AUSENTE na forja (comando canônico removido)"
make_fixture
remover_comando "$GITEA_WF" "node scripts/check-registry-source.mjs"
run_guard

if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "guard CEGO: passou com o invariante 'registry-source' AUSENTE na forja (exit 0)"
  exit 1
fi
if ! grep -qF "invariante do CORE 'registry-source' NAO roda aqui" "$TMP_DIR/out.txt"; then
  fail "guard falhou (exit $GUARD_EXIT) mas NÃO nomeou o invariante ausente"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
if ! grep -qF "node scripts/check-registry-source.mjs" "$TMP_DIR/out.txt"; then
  fail "o diagnóstico não imprimiu a LINHA ESPERADA (quem lê procuraria um gate que existe)"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
if ! grep -qF "$GITEA_WF" "$TMP_DIR/out.txt"; then
  fail "o diagnóstico não nomeou a PIPELINE onde o invariante falta"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
pass "mutação D DETECTADA: invariante ausente falha nomeando o invariante, a pipeline e a linha esperada (exit $GUARD_EXIT)"

# ── MUTAÇÃO E: a régua é ANCORADA (o invariante PRESENTE por outra forma) ──
#
# As três divergências que a régua frouxa anterior (`/check[:-]registry[:-]source/`)
# aceitava: a invocação INDIRETA, a invocação com outros ARGUMENTOS, e o comando
# trocado por outro que ainda casasse a substring. As duas mutações abaixo são as
# duas primeiras — e as duas exigem, além da mensagem, que o gate NÃO saia como
# "NAO CLASSIFICADO": a classificação casou (o `matches` do invariante reconhece
# as três formas), então o que reprovou foi a RÉGUA. Se saísse como classificação,
# o guard estaria pegando o defeito por outro motivo — e a prova mediria a
# regra errada.

header "MUTAÇÃO E1: invariante invocado de forma INDIRETA (bun run check:...)"
make_fixture
trocar_comando "$GITHUB_WF" "node scripts/check-workflow-refs.mjs --pkg-internal" "bun run check:workflow-refs"
run_guard

if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "guard CEGO: aceitou o invariante pela forma indireta (exit 0) — a régua não é ancorada no comando canônico"
  exit 1
fi
if grep -qF "NAO CLASSIFICADO" "$TMP_DIR/out.txt"; then
  fail "a mutação E1 saiu como gate NÃO CLASSIFICADO: ela mediria a classificação, não a RÉGUA do comando"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
if ! grep -qF "invariante do CORE 'workflow-refs' NAO roda aqui" "$TMP_DIR/out.txt"; then
  fail "guard falhou (exit $GUARD_EXIT) mas NÃO nomeou o invariante fora da forma canônica"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
pass "mutação E1 DETECTADA: a invocação indireta conta como divergência, e o defeito é da RÉGUA (não da classificação)"

header "MUTAÇÃO E2: invariante presente SEM o argumento canônico (mesma substring)"
make_fixture
trocar_comando "$GITHUB_WF" "node scripts/check-workflow-refs.mjs --pkg-internal" "node scripts/check-workflow-refs.mjs"
run_guard

if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "guard CEGO: aceitou o comando canônico ENFRAQUECIDO (sem --pkg-internal) — invocação com outros argumentos passaria como paridade"
  exit 1
fi
if grep -qF "NAO CLASSIFICADO" "$TMP_DIR/out.txt"; then
  fail "a mutação E2 saiu como gate NÃO CLASSIFICADO: ela mediria a classificação, não a RÉGUA do comando"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
if ! grep -qF 'node scripts/check-workflow-refs.mjs --pkg-internal' "$TMP_DIR/out.txt"; then
  fail "o diagnóstico não imprimiu o comando canônico COMPLETO (a linha esperada é o valor do remédio)"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
pass "mutação E2 DETECTADA: o mesmo comando com argumentos diferentes é divergência, e o diagnóstico imprime a linha canônica completa"

# ── MUTAÇÃO F: a prova por MUTAÇÃO removida do DONO DO MERGE ──────────────
#
# A regra que esta mudança introduziu: a matriz de mutation tests (e a prova das
# três regras de classificação) deixaram de ser isentas do dono do merge — quem
# mergeia aqui não pode ficar verde com um guard CEGO. A mutação remove o passo
# da forja e exige o veredito: o invariante 'mutation-matrix' sai NOMEADO, com a
# linha esperada e a pipeline onde ele falta. Sem esta, um passo que sumisse do
# ci.yml deixaria a isenção antiga valendo outra vez — em silêncio, que é a
# classe que o guard inteiro persegue.

header "MUTAÇÃO F: a MATRIZ de mutation removida da FORJA (dona do merge)"
make_fixture
remover_comando "$GITEA_WF" "bash scripts/test-mutation-guards.sh"
run_guard

if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "guard CEGO: passou com a matriz de mutation test AUSENTE na forja (exit 0) — o PR da forja voltaria a mergear com um guard cego"
  exit 1
fi
if ! grep -qF "invariante do CORE 'mutation-matrix' NAO roda aqui" "$TMP_DIR/out.txt"; then
  fail "guard falhou (exit $GUARD_EXIT) mas NÃO nomeou o invariante 'mutation-matrix'"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
if ! grep -qF "bash scripts/test-mutation-guards.sh" "$TMP_DIR/out.txt"; then
  fail "o diagnóstico não imprimiu a LINHA ESPERADA do passo"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
if ! grep -qF "$GITEA_WF" "$TMP_DIR/out.txt"; then
  fail "o diagnóstico não nomeou a PIPELINE onde o passo falta"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
pass "mutação F DETECTADA: a prova por mutação ausente no dono do merge falha nomeando o invariante, a pipeline e a linha esperada (exit $GUARD_EXIT)"

# ── MUTAÇÃO G: o CANAL DO REMÉDIO (não é gate, e é régua) ─────────────────
#
# O canal não verifica nada — ele PUBLICA o patch do remédio no PR —, então as
# regras 1-4 deste guard (gates descobertos, invariantes do CORE, isenções) não o
# alcançam. A cobertura dele vinha de uma lista escrita nos DOIS workflows (um
# passo por fixer); agora o passo invoca o REGISTRO (`--all`) e estas três
# mutações provam que a regra nova MORDE nas três pontas: o canal ausente numa
# forja, a cobertura reduzida a uma lista à mão, e o backend da outra forja.

header "MUTAÇÃO G1: o canal do remédio REMOVIDO do dono do merge"
make_fixture
remover_comando "$GITEA_WF" "node scripts/pr-remedy-comment.mjs --backend gitea --all"
run_guard

if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "guard CEGO: passou com o CANAL DO REMÉDIO ausente na forja (exit 0)"
  exit 1
fi
if ! grep -qF "o CANAL DO REMEDIO nao roda aqui" "$TMP_DIR/out.txt"; then
  fail "guard falhou (exit $GUARD_EXIT) mas NÃO citou o canal do remédio ausente"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
if ! grep -qF "$GITEA_WF" "$TMP_DIR/out.txt"; then
  fail "o diagnóstico não nomeou a PIPELINE sem o canal"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
pass "mutação G1 DETECTADA: canal ausente numa forja falha nomeando o passo e a pipeline (exit $GUARD_EXIT)"

header "MUTAÇÃO G2: a cobertura do canal trocada por uma LISTA à mão (--all → --fixer <um>)"
# O fixer que deve sair NOMEADO é lido do CANAL (não é cravado aqui): o que a
# mutação mede é a cobertura derivada, e um nome escrito à mão no harness
# envelheceria junto com o canal — passando a medir outra coisa.
#
# A CONTAGEM também é derivada, e isso foi um defeito medido: a metade cravava
# "1 fixer(s)" de quando o canal tinha DOIS ids; quando o terceiro entrou o
# veredito passou a nomear 2 e a asserção mediu uma cobertura que já não existia
# (o guard estava certo, o harness era velho). Aqui o conjunto esperado é o canal
# INTEIRO menos o id que a mutação deixou na linha, na ordem do canal.
FORA="$(node -e 'import(process.argv[1]).then((m) => { const ids = m.idsDoCanal(); console.log(ids[ids.length - 1]) })' "file://$SCRIPT_DIR/scripts/remedy-canal.mjs")"
PENDENTE="$(node -e 'import(process.argv[1]).then((m) => { const ids = m.idsDoCanal(); console.log(ids[0]) })' "file://$SCRIPT_DIR/scripts/remedy-canal.mjs")"
FALTAM="$(node -e 'import(process.argv[1]).then((m) => console.log(m.idsDoCanal().length - 1))' "file://$SCRIPT_DIR/scripts/remedy-canal.mjs")"
ESPERADOS="$(node -e 'import(process.argv[1]).then((m) => console.log(m.idsDoCanal().filter((i) => i !== process.argv[2]).join(", ")))' "file://$SCRIPT_DIR/scripts/remedy-canal.mjs" "$FORA")"
if [ -z "$FORA" ] || [ -z "$ESPERADOS" ]; then
  fail "não consegui ler o CANAL de fixers (harness sem os nomes derivados)"
  exit 1
fi

make_fixture
trocar_comando "$GITEA_WF" "node scripts/pr-remedy-comment.mjs --backend gitea --all" "node scripts/pr-remedy-comment.mjs --backend gitea --fixer $FORA"
run_guard

if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "guard CEGO: passou com a cobertura do canal reduzida a uma lista à mão (exit 0)"
  exit 1
fi
if ! grep -qF "NAO publica $FALTAM fixer(s) do registro" "$TMP_DIR/out.txt"; then
  fail "guard falhou (exit $GUARD_EXIT) mas NÃO citou a cobertura faltante"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
if grep -qF "NAO publica $FALTAM fixer(s) do registro: $FORA" "$TMP_DIR/out.txt"; then
  fail "o diagnóstico nomeia '$FORA' como NÃO publicado, mas foi ELE que a mutação deixou na linha — a regra está invertida"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
if ! grep -qF "NAO publica $FALTAM fixer(s) do registro: $ESPERADOS" "$TMP_DIR/out.txt"; then
  fail "o diagnóstico não nomeou o conjunto EXATO que ficou fora do canal ('$ESPERADOS' esperado, com o id '$PENDENTE' entre eles) — a cobertura tem de vir do canal, na ordem dele"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
pass "mutação G2 DETECTADA: a cobertura reduzida falha nomeando o fixer que ficou de fora do canal (exit $GUARD_EXIT)"

header "MUTAÇÃO G3: o canal com o --backend da OUTRA forja"
make_fixture
trocar_comando "$GITEA_WF" "node scripts/pr-remedy-comment.mjs --backend gitea --all" "node scripts/pr-remedy-comment.mjs --backend github --all"
run_guard

if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "guard CEGO: passou com o backend da OUTRA forja no canal (exit 0)"
  exit 1
fi
if ! grep -qF "backend de OUTRA forja" "$TMP_DIR/out.txt"; then
  fail "guard falhou (exit $GUARD_EXIT) mas NÃO citou o backend da outra forja"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
pass "mutação G3 DETECTADA: o passo copiado da outra forja falha nomeando o backend esperado (exit $GUARD_EXIT)"

header "VEREDITO"
pass "MUTATION TEST PASSED — check-forge-parity pega gate novo sem classificação"
pass "(forja E espelho), isenção stale, invariante do CORE AUSENTE de uma"
pass "pipeline, o invariante PRESENTE por outra forma (indireta ou com outros"
pass "argumentos — a régua é ancorada no comando canônico), a MATRIZ de"
pass "mutation test ausente do dono do merge (a prova por execução que impede o"
pass "PR da forja de mergear com um guard cego) e as TRÊS pontas do CANAL DO"
pass "REMÉDIO: o passo ausente numa forja, a cobertura reduzida a uma lista à"
pass "mão (o fixer que ficou de fora sai NOMEADO, lido do REGISTRO) e o"
pass "--backend da outra forja."
exit 0
