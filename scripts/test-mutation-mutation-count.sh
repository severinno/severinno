#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-mutation-count.sh — Mutation test do COUNT GUARD
# (check-mutation-count.mjs — nº de sub-tests do master)
#
# Prova que o guard de drift de counts REALMENTE falha nas regressões que ele
# existe para bloquear. Duas classes, e a PRIMEIRA é a que acopla o contrato de
# merge:
#
#   Cenário F (A CLASSE):  o `check-required-checks` recusa um required check
#                           cujo `name:` carrega uma CONTAGEM — no job DIRETO e
#                           no job de um REUSABLE workflow (que é como o
#                           segundo caso real apareceu: ", 5 cenários").
#   CONTROLE F:             os mesmos jobs com `name:` COUNT-FREE → exit 0.
#   Cenário A (JOB NAME CARREGA O COUNT): o `name:` do job mutation-guards volta
#                           a dizer "Mutation guards master (13 node-pure
#                           mutation tests)". O nome de um job é o CONTEXTO do
#                           status check, e o branch protection exige esse
#                           contexto — então um número ali faz CADA bump de
#                           matriz reescrever o contrato de merge e a proteção
#                           da forja passar a exigir um check que não existe.
#                           O guard DEVE FALHAR (exit 1) citando o name.
#   CONTROLE E (BUMP LEGÍTIMO): matriz 14 com name COUNT-FREE + summary/README
#                           em 14 → o guard DEVE PASSAR (exit 0). É o defeito
#                           original virado do avesso: subir a matriz deixou de
#                           mexer no contexto protegido.
#   Cenário B (SUMMARY):    o summary fica "All 13..." com matriz 14 → DEVE
#                           FALHAR citando o summary.
#   Cenário C (README):     o README fica com "13 sub-tests" e a matriz vira
#                           14 → DEVE FALHAR citando README.md:linha.
#   Cenário D (HISTÓRICA):  ref histórica "era de 5 sub-tests" no README NÃO
#                           pode falhar o guard (a matriz segue 13) → CONTROLE.
#   CONTROLE:               fixture consistente (matriz 13 + refs 13) → exit 0.
#
# A SEGUNDA METADE DESTA SUÍTE (o recorte que roda no pre-commit):
#
#   Cenário K (O ESCOPO):   o veredito do `--staged` é o CONTEÚDO DO ÍNDICE, não
#                           o working tree. A fixture é um repositório git de
#                           verdade com a ÁRVORE coerente (matriz 2 + refs 2) e o
#                           ÍNDICE partido (matriz 3, refs 2): o recorte DEVE
#                           reprovar e o modo árvore DEVE passar — e com a
#                           mutação que lê a árvore (`run(dir)` → `run(root)`)
#                           o commit partido PASSA (o escopo é load-bearing).
#   Cenário L (O QUE O COMMIT NÃO CARREGA): a suíte nova está na ÁRVORE e não no
#                           ÍNDICE (o caso real: escrita e ainda não estagiada).
#                           O veredito DEVE nomear o índice como a causa (o
#                           remédio é o `git add`); sem o registro, sobra a
#                           acusação ao arquivo "que não existe" — ele existe, o
#                           commit é que não o carrega.
#   Cenário M (O FAIL-CLOSED): o master fora do índice (e inteiro na árvore) é
#                           exit 2 (INFRA), nunca verde; mutado para devolver
#                           "nada a julgar", o recorte fica CEGO (exit 0).
#
# K/L/M mutam o GUARD (no lugar, com backup + restauração verificada por
# checksum no trap EXIT) e exigem a suíte unitária VERMELHA — a testemunha de que
# a regressão não passaria no PR em silêncio. Sem `git`, as três são declaradas
# como NÃO julgadas (nunca silenciosas).
#
# DIFERENÇA vs os demais mutation tests: aqui o guard é executado com --root
# contra um FIXTURE MINIMAL (não o repo real) — o guard lê só 3 arquivos
# (scripts/test-mutation-guards.sh, .github/workflows/pr-check.yml,
# README.md), então o fixture replica esses 3 com a matriz e as refs. O recorte
# `--staged` é a exceção: ele lê o ÍNDICE, então K/L/M rodam contra um
# repositório git (o mesmo fixture + commit base).
#
# Pipeline:
#   1. Cria fixture consistente (matriz 13 + refs 13 em pr-check/README)
#   2. CONTROLE: guard --root fixture → exit 0
#   3. MUTAÇÃO A: o name do job volta a carregar o count → DEVE FALHAR
#   4. CONTROLE E: matriz 14 com name COUNT-FREE + refs 14 → exit 0 (bump legítimo)
#   5. MUTAÇÃO B: matriz 14 (summary 13, resto 14) → guard DEVE FALHAR
#   6. MUTAÇÃO C: matriz 14 (README 13, resto 14) → guard DEVE FALHAR
#   7. CONTROLE D: ref histórica "era de 5" com matriz 13 → exit 0 (não-falso-positivo)
#   8. MUTAÇÃO F: required check com CONTAGEM no name (job direto + reusable) →
#      DEVE FALHAR citando CONTAGEM; CONTROLE F com os mesmos jobs count-free →
#      exit 0
#   9. MUTAÇÕES G/H/I/J: a derivação das metades (bloco ausente, ilegível, a doc
#      com o total errado, a entrada em aspas duplas) → DEVE FALHAR cada uma
#  10. CONTROLE K + MUTAÇÃO K: o ESCOPO do --staged (o índice × a árvore)
#  11. CONTROLE L + MUTAÇÃO L: o arquivo que o commit não carrega
#  12. CONTROLE M + MUTAÇÃO M: o fail-closed do master ilegível
#  13. CONTROLE FINAL do recorte (a restauração por checksum devolve o guard)
#  14. CONTROLE N + MUTAÇÃO N: a MATRIZ × O ATO (o sub-test novo que o registro
#      do ato não versionou) → DEVE FALHAR; com a ligação desligada, PASSA
#  15. CONTROLE P (o registro ausente, dito) + MUTAÇÃO O (o registro ilegível:
#      mutado, o exit 2 vira "nada a julgar" VERDE)
#  16. CONTROLE Q + MUTAÇÃO Q: a COLUNA de metades do registro é DERIVADA da
#      matriz — a unidade que entrou na suíte DEPOIS da medição → DEVE FALHAR
#      nomeando a forma e o delta; sem a derivação passada à régua, PASSA
#  17. MUTAÇÃO R: o TOTAL da família que não soma a própria coluna → DEVE FALHAR
#  18. Cleanup (trap EXIT — restaura o guard e rm -rf dos temps)
#
# Usage:
#   ./scripts/test-mutation-mutation-count.sh
#
# Exit codes:
#   0 — mutações DETECTADAS + controles passam ✅
#   A TERCEIRA METADE DESTA SUÍTE (a matriz × o ATO que a versiona):
#
#   CONTROLE N:             o registro versionado versiona a matriz INTEIRA (13
#                           formas para 13 sub-tests) → exit 0, e o veredito
#                           VERDE diz o que o ato versionou (não é silencioso).
#   Cenário N (A DEFASAGEM): a matriz ganha o sub-14 e o registro do ato segue
#                           com as 13 formas do ato anterior → DEVE FALHAR
#                           nomeando o sub-test que ninguém versionou e o comando
#                           do ato (é a defasagem real de 22/09/2026: o número
#                           declarado do job passou a descrever uma matriz que já
#                           não existia, e nada no repositório olhava isso).
#   CONTROLE N (a AUSÊNCIA): o registro FORA da árvore NÃO é violação — e a
#                           ligação não julgada fica DITA (present: false).
#   Cenário O (O FAIL-CLOSED): o registro presente e ILEGÍVEL é exit 2 (INFRA),
#                           nunca "nenhuma ligação a julgar"; mutado para devolver
#                           a ausência, a defasagem volta a passar (CEGO).
#
# A QUARTA METADE DESTA SUÍTE (a COLUNA de metades × a MATRIZ):
#
#   CONTROLE Q:             o registro com a coluna que a MATRIZ declara hoje (a
#                           sub-1 com as 2 metades da suíte) → exit 0.
#   Cenário Q (A COLUNA
#   HERDADA DO ATO):        a suíte ganha uma metade DEPOIS de a medição ter
#                           gravado a coluna: a `sub-1` grava 1, a suíte declara 2,
#                           e nada mais diverge (as 13 formas estão versionadas,
#                           o count bate, o total fecha com a coluna) → DEVE
#                           FALHAR nomeando a forma, o delta e o ato como
#                           remédio. É a defasagem de 23/09/2026 — a coluna
#                           herdada dizia 8 metades para uma suíte que já
#                           declarava 10, e nada a confrontava com a matriz.
#   Cenário R (O TOTAL):    o total da família que não soma a própria coluna (as
#                           duas leituras da MESMA medição) → DEVE FALHAR com os
#                           dois números.
#
# N/O/Q/R mutam o GUARD (no lugar, com backup + restauração verificada por
# checksum no trap EXIT) e exigem a suíte unitária VERMELHA.
#
#   1 — guard CEGO (alguma mutação passou) OU controle falso-positivo ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# O SCRATCH DAS FIXTURES É ESTÁVEL E FORA DO `/tmp`: o `/tmp` é limpo por FORA e a
# rodada LONGA perdia fixture no meio da medição (o motivo inteiro, com as duas
# medições, está no cabeçalho do master). A raiz é a MESMA em toda rodada e NÃO
# fica DENTRO do repositório: uma fixture dentro de um repo muda de semântica —
# `node_modules`, o prettier e o git do projeto passam a alcançá-la (medido).
MUT_SCRATCH="${MUT_SCRATCH:-${XDG_CACHE_HOME:-$HOME/.cache}/severinno-mutacao}"
mkdir -p "$MUT_SCRATCH" 2>/dev/null || {
  echo "❌ o scratch das fixtures não pôde ser criado: $MUT_SCRATCH (infra declarada)" >&2
  exit 2
}

# A PROVA-DE-APLICAÇÃO — a régua ÚNICA de "a mutação APLICOU" (o gabarito dela é
# `scripts/test-mutation-mutacao-prova.sh`).
# shellcheck source=scripts/mutacao-prova.sh
. "$SCRIPT_DIR/scripts/mutacao-prova.sh"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'A|o name do job volta a carregar o count → DEVE FALHAR'
  'B|a matriz cresce e o summary fica para trás → DEVE FALHAR'
  'C|a matriz cresce e o README fica para trás → DEVE FALHAR'
  'D|a ref HISTÓRICA no README NÃO é falso positivo'
  'E|o bump legítimo (name count-free + refs atualizadas) PASSA'
  'F|o required check com CONTAGEM no name → DEVE FALHAR'
  'G|a suíte que NÃO declara o bloco METADES → o guard FALHA (fail-closed)'
  'H|o bloco com uma linha fora do formato: o guard FALHA e não lê nenhuma metade'
  'I|a doc que declara um total que não bate com o bloco → o guard FALHA'
  'J|a entrada do bloco em ASPAS DUPLAS (o shell expandiria) → o guard FALHA'
  'K|o ESCOPO do --staged: com o recorte lendo a ÁRVORE, o commit partido PASSA'
  'L|o arquivo que o ÍNDICE não carrega perde a violação NOMEADA (a causa sai do veredito)'
  'M|o FAIL-CLOSED do master ilegível: mutado devolve "nada a julgar" VERDE'
  'N|a matriz ganha um sub-test e o ATO não o versiona: o guard FALHA nomeando-o (e, com a ligação desligada, PASSA)'
  'O|o registro do ATO ILEGÍVEL: mutado deixa de ser exit 2 e vira "nada a julgar" VERDE'
  'P|o registro do ATO AUSENTE não é violação — e a ligação NÃO julgada fica DITA no veredito'
  'Q|a COLUNA de metades herdada do ato: a unidade entrou na suíte depois da medição e o guard FALHA nomeando a forma (e, sem a derivação passada, PASSA)'
  'R|o TOTAL da família que não fecha com a coluna do MESMO registro → o guard FALHA'
)
GUARD="node $SCRIPT_DIR/scripts/check-mutation-count.mjs --root"
REQUIRED_GUARD="node $SCRIPT_DIR/scripts/check-required-checks.mjs --root"
GUARD_SCRIPT="$SCRIPT_DIR/scripts/check-mutation-count.mjs"
SUITE_ARQUIVO="src/lib/__tests__/check-mutation-count.test.ts"

TMP_DIR="$(mktemp -d "$MUT_SCRATCH/mut-XXXXXX")"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ── Backup da FONTE do guard + restauração VERIFICADA (trap EXIT) ─────────
# As mutações K/L/M são aplicadas NO LUGAR, no arquivo do repositório (é ele que
# o CLI executa e que a suíte unitária importa). O backup mora em OUTRO temp: o
# `repo_git_fixture` recria o `$TMP_DIR` a cada fixture, e um backup lá dentro
# seria apagado no meio da suíte.
GUARD_BKP="$(mktemp -d "$MUT_SCRATCH/mut-XXXXXX")"
guard_backup="$GUARD_BKP/check-mutation-count.original.mjs"
cp "$GUARD_SCRIPT" "$guard_backup"
guard_sum="$(cksum "$GUARD_SCRIPT" | cut -d' ' -f1)"

cleanup() {
  cp -f "$guard_backup" "$GUARD_SCRIPT" 2>/dev/null || true
  rm -rf "$TMP_DIR" "$GUARD_BKP"
}
trap cleanup EXIT

restaurar_guard() {
  cp -f "$guard_backup" "$GUARD_SCRIPT"
  if [ "$(cksum "$GUARD_SCRIPT" | cut -d' ' -f1)" != "$guard_sum" ]; then
    fail "RESTAURAÇÃO FALHOU (checksum diverge) — restaure a partir de $guard_backup"
    exit 1
  fi
}

# ── mutar_guard: substituição CIRÚRGICA (exatamente 1 ocorrência) ─────────
# Uma mutação que casa 0 ou 2+ vezes não é cirúrgica: o script para em vez de
# medir outra coisa. O marcador "MUTACAO M" no texto novo é o que prova que a
# mutação APLICOU (o alvo pode existir e a escrita falhar).
mutar_guard() { # <alvo> <troca>: a cirurgia, o marcador e o checksum são da régua
  # COMPARTILHADA (`mutacao_aplicar`).
  mutacao_aplicar "$GUARD_SCRIPT" "$1" "$2" "$guard_sum"
}

# ── A SEGUNDA TESTEMUNHA: a suíte unitária tem de notar a mutação ─────────
# Onde a regra muda o veredito do CLI, a prova é o EXIT CODE (comportamento). A
# suíte é a testemunha de que a regressão não passaria no PR em silêncio — e o
# motivo é DITO quando ela não está instalada (o exit 0 de uma suíte que não
# rodou não é veredito).
suite_disponivel() { [ -d "$SCRIPT_DIR/node_modules/vitest" ]; }

exigir_suite_vermelha() {
  local cenario="$1"
  if ! suite_disponivel; then
    info "$cenario (suíte): NÃO julgada — node_modules/vitest ausente neste job (declarado, nunca silencioso)"
    return 0
  fi
  set +e
  SUITE_OUT="$(cd "$SCRIPT_DIR" && bun x vitest run --config vitest.config.unit.ts "$SUITE_ARQUIVO" 2>&1 | tail -8)"
  SUITE_EXIT=$?
  set -e
  if [ "$SUITE_EXIT" -eq 0 ]; then
    fail "$cenario: a suíte unitária ficou VERDE com o guard mutado — a regressão passaria no PR em silêncio"
    echo "$SUITE_OUT" | sed 's/^/      /'
    exit 1
  fi
  pass "$cenario: suíte unitária VERMELHA (exit $SUITE_EXIT) — a regressão não passa no PR"
}

# ── make_fixture: cria os arquivos que o guard lê ─────────────────────────
# $1 = count da matriz | $2 = SUFIXO do name do job (default: "" — count-free)
# $3 = count do summary | $4 = count do README
# $5 = (opcional) ref histórica extra no README
# $6 = (opcional) MUTAÇÃO da fixture da DERIVAÇÃO: `sem_bloco` (a suíte 1 some
#      com o bloco METADES), `ilegivel` (linha fora do formato) ou `doc_stale`
#      (a doc declara um total que não bate com o bloco)
make_fixture() {
  local matrix_count="$1" job_suffix="${2:-}" summary="$3" readme_count="$4"
  local historical="${5:-}"

  rm -rf "$TMP_DIR/scripts" "$TMP_DIR/.github" "$TMP_DIR/README.md" "$TMP_DIR/docs"
  mkdir -p "$TMP_DIR/scripts" "$TMP_DIR/.github/workflows" "$TMP_DIR/docs"

  # master com a matriz — `id|script`, SEM descrição: ela é derivada do bloco
  # METADES de cada suíte (e a curadoria da suíte mutada é um índice à parte).
  {
    echo '#!/usr/bin/env bash'
    echo "# Roda os $matrix_count mutation tests node-puro dos guards de CI num ÚNICO script"
    echo 'SUBTESTS=('
    for i in $(seq 1 "$matrix_count"); do
      echo "  \"sub-$i|scripts/test-mutation-sub-$i.sh\""
    done
    echo ')'
  } > "$TMP_DIR/scripts/test-mutation-guards.sh"

  # uma suíte por entrada, cada uma DECLARANDO as suas metades (o bloco é a
  # fonte única da descrição do sub-test e da prosa da doc). A SUÍTE_* abaixo
  # muta UMA delas: `sem_bloco` remove o bloco inteiro (fail-closed) e
  # `ilegivel` deixa uma linha fora do formato.
  for i in $(seq 1 "$matrix_count"); do
    {
      echo '#!/usr/bin/env bash'
      echo 'set -euo pipefail'
      if [ "${6:-}" = "sem_bloco" ] && [ "$i" = "1" ]; then
        echo '# (a suíte mutada NÃO declara metades)'
      else
        echo 'METADES=('
        # A declaração é em ASPAS SIMPLES: em aspas duplas o shell expandiria a
        # descrição antes de guardá-la (a mutação J escreve essa forma).
        if [ "${6:-}" = "aspas_duplas" ] && [ "$i" = "1" ]; then
          echo '  "M1|o caso com echo $OUT | grep -Fq que o shell expandiria"'
          echo "  'M2|a metade dois da suíte sub-$i'"
        else
          echo "  'M1|a metade um da suíte sub-$i'"
          echo "  'M2|a metade dois da suíte sub-$i'"
        fi
        if [ "${6:-}" = "ilegivel" ] && [ "$i" = "1" ]; then
          echo '  linha sem o formato do bloco'
        fi
        echo ')'
      fi
    } > "$TMP_DIR/scripts/test-mutation-sub-$i.sh"
  done

  # docs/GUARDS.md: a doc cita a suíte sub-1 e declara o total dela. A MUTAÇÃO
  # `doc_stale` escreve um total que NÃO bate com o bloco (a contagem à mão) e
  # `doc_stale_bold` escreve o MESMO total em NEGRITO — a forma que saía do
  # alcance do parser e deixava a prosa velha em silêncio (o caso MEDIDO no
  # repositório). `doc_bold` é o CONTROLE: o total CERTO em negrito passa.
  {
    echo '# Guards (fixture)'
    echo ''
    if [ "${6:-}" = "doc_stale" ]; then
      echo 'A suíte `scripts/test-mutation-sub-1.sh` declara 5 metades no bloco.'
    elif [ "${6:-}" = "doc_stale_bold" ]; then
      echo 'A suíte `scripts/test-mutation-sub-1.sh` declara **5 metades** no bloco.'
    elif [ "${6:-}" = "doc_bold" ]; then
      echo 'A suíte `scripts/test-mutation-sub-1.sh` declara **2 metades** no bloco.'
    else
      echo 'A suíte `scripts/test-mutation-sub-1.sh` declara 2 metades no bloco.'
    fi
    # A DECLARAÇÃO da COBERTURA da régua do ordinal: a doc do fixture carrega a
    # MESMA linha do repositório, com o número do próprio fixture — nenhuma
    # referência posicional aqui, então 0 julgadas e 0 puladas. Sem ela o
    # CONTROLE sai vermelho por uma regra que o fixture não exercita.
    echo ''
    echo '**A régua do ordinal: 0 referência(s) JULGADA(S) e 0 PULADA(S)**'
  } > "$TMP_DIR/docs/GUARDS.md"

  # pr-check.yml com o job mutation-guards (name COUNT-FREE por default — é o
  # CONTEXTO do required check, e não pode carregar o tamanho da matriz)
  {
    echo "# Roda os $matrix_count mutation tests node-puro dos guards de CI num JOB SÓ via"
    echo 'jobs:'
    echo '  mutation-guards:'
    echo "    name: Mutation guards master$job_suffix"
    echo '    steps:'
    echo '      - run: bash scripts/test-mutation-guards.sh'
    echo '      - name: Summary'
    echo "        run: echo \"✅ All $summary node-pure mutation tests passed (...).\""
  } > "$TMP_DIR/.github/workflows/pr-check.yml"

  # README.md
  {
    echo "# Repo"
    echo "**$readme_count sub-tests node-puro** via \`scripts/test-mutation-guards.sh\`"
    echo "| master \`mutation-guards\` ($readme_count sub-tests) | x |"
    if [ -n "$historical" ]; then
      echo "era de $historical sub-tests e o timing-budget foi adicionado após a medição de $historical."
    fi
  } > "$TMP_DIR/README.md"
}

# ═════════════════════════════════════════════════════════════════════════
# AS FERRAMENTAS DO RECORTE `--staged` (o ÍNDICE é o commit)
# ═════════════════════════════════════════════════════════════════════════
# O modo `--staged` lê o ÍNDICE do repositório em que roda (`git show :path`),
# então medir o julgamento dele exige um REPOSITÓRIO de verdade: o fixture vira
# um commit e as metades manipulam o índice (e só ele) para produzir cada
# defeito. O `git` é declarado como requisito — sem ele as três metades dizem
# que NÃO foram julgadas, em vez de sumirem em silêncio.
git_disponivel() { command -v git >/dev/null 2>&1; }

# ── repo_git_fixture: o fixture do make_fixture + commit BASE coerente ────
repo_git_fixture() { # $1..$4 = os mesmos do make_fixture
  rm -rf "$TMP_DIR"
  mkdir -p "$TMP_DIR"
  make_fixture "$@"
  git -C "$TMP_DIR" init -q .
  git -C "$TMP_DIR" config user.email "mutation-count@test"
  git -C "$TMP_DIR" config user.name "mutation count"
  git -C "$TMP_DIR" add -A
  git -C "$TMP_DIR" commit -qm base
}

# ── suite_extra: a suíte de um sub-test NOVO (a que o commit novo cita) ────
suite_extra() { # $1 = número do sub-test
  {
    echo '#!/usr/bin/env bash'
    echo 'set -euo pipefail'
    echo 'METADES=('
    echo "  'M1|a metade um da suite sub-$1'"
    echo "  'M2|a metade dois da suite sub-$1'"
    echo ')'
  } > "$TMP_DIR/scripts/test-mutation-sub-$1.sh"
}

# ── master_com: um master com N entradas, FORA da árvore (o blob do commit) ─
master_com() { # $1 = arquivo de destino | $2 = N
  {
    echo '#!/usr/bin/env bash'
    echo "# Roda os $2 mutation tests node-puro dos guards de CI num ÚNICO script"
    echo 'SUBTESTS=('
    for i in $(seq 1 "$2"); do echo "  \"sub-$i|scripts/test-mutation-sub-$i.sh\""; done
    echo ')'
  } > "$1"
}

# ── rodar_staged / rodar_arvore: o MESMO repositório nos DOIS escopos ─────
rodar_staged() {
  set +e
  OUTPUT="$(cd "$TMP_DIR" && node "$GUARD_SCRIPT" --staged 2>&1)"
  EXIT=$?
  set -e
}

rodar_arvore() {
  set +e
  OUTPUT="$(cd "$TMP_DIR" && node "$GUARD_SCRIPT" 2>&1)"
  EXIT=$?
  set -e
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-mutation-count deve GATEAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Fixture consistente (matriz 13 + refs 13) → CONTROLE exit 0
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando fixture consistente (matriz 13 + name count-free + refs 13)..."
make_fixture 13 "" 13 13

info "STEP 2: Controle — guard contra fixture consistente deve PASS (exit 0)..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU (exit $EXIT): fixture consistente foi rejeitado."
  echo "$OUTPUT" | tail -5
  exit 1
fi
pass "Controle OK — fixture consistente passa (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3+4 — MUTAÇÃO A (count no NAME): o contexto do required check volta a
# depender do tamanho da matriz → DEVE FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: MUTAÇÃO A — o name do job volta a carregar o count (13)..."
make_fixture 13 " (13 node-pure mutation tests)" 13 13

info "STEP 4: Rodando o guard contra a mutação A..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
echo "$OUTPUT" | grep -E '^   - ' | head -3

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (name): o count de volta no name do job passou (exit 0) — o"
  fail "CONTEXTO do required check voltaria a mudar a cada bump de matriz."
  exit 1
fi
if ! grep -Fq "name do job" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO citou o name do job."
  exit 1
fi
if ! grep -Fq "required check" <<<"$OUTPUT"; then
  fail "O guard citou o name mas NÃO nomeou o acoplamento ao required check."
  exit 1
fi
pass "Mutação A DETECTADA: guard falhou citando o name e o required check (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — CONTROLE E (bump legítimo): matriz 14 com name count-free e refs
# 14 → exit 0. Subir a matriz deixou de mexer no contrato de merge.
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: CONTROLE E — matriz 14, name COUNT-FREE, summary/README 14..."
make_fixture 14 "" 14 14

info "STEP 6: Guard contra o bump legítimo de matriz..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e

if [ "$EXIT" -ne 0 ]; then
  fail "FALSO POSITIVO: um bump de matriz que NÃO toca o name do job fez o guard"
  fail "falhar (exit $EXIT) — o contrato de merge não pode depender da matriz."
  echo "$OUTPUT" | tail -4
  exit 1
fi
pass "Controle E OK — bump de matriz passa sem tocar o contexto do required check"

# ═════════════════════════════════════════════════════════════════════════
# STEP 7+8 — MUTAÇÃO B (summary stale): matriz 14, summary 13 (resto 14) →
# DEVE FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 7: MUTAÇÃO B — matriz 14 com summary 13 (name count-free, README 14)..."
make_fixture 14 "" 13 14

info "STEP 8: Rodando o guard contra a mutação B..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
echo "$OUTPUT" | grep -E '^   - ' | head -3

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (summary): matriz 14 com summary 13 passou (exit 0)."
  exit 1
fi
if ! grep -Fq "summary" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO citou o summary."
  exit 1
fi
pass "Mutação B DETECTADA: guard falhou citando o summary (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 9+10 — MUTAÇÃO C (README stale): matriz 14, README 13 (resto 14) →
# DEVE FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 9: MUTAÇÃO C — matriz 14 com README 13 (name count-free, summary 14)..."
make_fixture 14 "" 14 13

info "STEP 10: Rodando o guard contra a mutação C..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
echo "$OUTPUT" | grep -E '^   - ' | head -3

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (README): matriz 14 com README 13 passou (exit 0)."
  exit 1
fi
if ! grep -Fq "README.md:" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO citou o README.md com linha."
  exit 1
fi
pass "Mutação C DETECTADA: guard falhou citando README.md:linha (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 11+12 — CONTROLE D (ref histórica): "era de 5" com matriz 13 → exit 0
# ═════════════════════════════════════════════════════════════════════════

info "STEP 11: CONTROLE D — ref HISTÓRICA 'era de 5 sub-tests' com matriz 13..."
make_fixture 13 "" 13 13 "5"

info "STEP 12: Guard contra o fixture com ref histórica..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e

if [ "$EXIT" -ne 0 ]; then
  fail "FALSO POSITIVO: ref histórica 'era de 5 sub-tests' fez o guard falhar"
  fail "(exit $EXIT) com matriz 13 consistente."
  echo "$OUTPUT" | tail -4
  exit 1
fi
pass "Controle D OK — ref histórica é ignorada (exit 0, sem falso positivo)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

# ═════════════════════════════════════════════════════════════════════════
# STEP 13+14+15 — MUTAÇÃO F (a CLASSE): o `check-required-checks` recusa um
# required check cujo `name:` carrega CONTAGEM — no job direto E no job de um
# REUSABLE workflow (o caminho pelo qual o segundo caso real apareceu).
# ═════════════════════════════════════════════════════════════════════════

# ── Fixture do manifesto: jobs/direct + reusable, com name parametrizável ──
# $1 = name do job direto | $2 = name do job do reusable
make_required_fixture() {
  local direct_name="$1" reusable_name="$2"
  rm -rf "$TMP_DIR/rc"
  mkdir -p "$TMP_DIR/rc/ci" "$TMP_DIR/rc/.github/workflows"

  {
    echo '{'
    echo '  "version": 1,'
    echo '  "branches": ["main"],'
    echo '  "forges": {'
    echo '    "github": {'
    echo '      "workflow": ".github/workflows/pr.yml",'
    echo '      "jobs": ["master", "seed"]'
    echo '    }'
    echo '  }'
    echo '}'
  } > "$TMP_DIR/rc/ci/required-checks.json"

  # A DECLARAÇÃO da reaplicação EM SINCRONIA com os nomes deste fixture: o
  # guard compara os contextos DERIVADOS com a proteção APLICADA, e sem esta
  # metade ele falha por falha-closed — os dois cenários desta mutação medem o
  # COUNT, e uma segunda causa de vermelho tornaria a leitura ambígua.
  {
    echo '{'
    echo '  "version": 1,'
    echo '  "appliedAt": "2026-01-01",'
    echo '  "forges": {'
    echo '    "github": {'
    echo '      "workflow": ".github/workflows/pr.yml",'
    echo '      "branches": ["main"],'
    echo "      \"contexts\": [\"$direct_name\", \"$reusable_name\"]"
    echo '    }'
    echo '  }'
    echo '}'
  } > "$TMP_DIR/rc/ci/required-checks-applied.json"

  {
    echo 'name: Fixture'
    echo 'jobs:'
    echo '  master:'
    echo "    name: $direct_name"
    echo '    runs-on: self-hosted'
    echo '    steps:'
    echo '      - run: echo ok'
    echo '  seed:'
    echo '    uses: ./.github/workflows/reusable.yml'
  } > "$TMP_DIR/rc/.github/workflows/pr.yml"

  {
    echo 'name: Reusable'
    echo 'on:'
    echo '  workflow_call:'
    echo 'jobs:'
    echo '  coord:'
    echo "    name: $reusable_name"
    echo '    runs-on: self-hosted'
    echo '    steps:'
    echo '      - run: echo ok'
  } > "$TMP_DIR/rc/.github/workflows/reusable.yml"
}

info "STEP 13: CONTROLE F — os mesmos required checks com name COUNT-FREE..."
make_required_fixture "Mutation guards master" "Mutation Test (contrato coordenado — doc↔anchor↔código)"
set +e
OUTPUT=$($REQUIRED_GUARD "$TMP_DIR/rc" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -ne 0 ]; then
  fail "FALSO POSITIVO: required checks count-free foram rejeitados (exit $EXIT)."
  echo "$OUTPUT" | tail -4
  exit 1
fi
pass "Controle F OK — contextos count-free passam (exit 0)"

info "STEP 14: MUTAÇÃO F — CONTAGEM no name do job DIRETO e do REUSABLE..."
make_required_fixture "Mutation guards master (27 node-pure mutation tests)" \
  "Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)"
set +e
OUTPUT=$($REQUIRED_GUARD "$TMP_DIR/rc" 2>&1)
EXIT=$?
set -e
echo "$OUTPUT" | grep -E '^   - ' | head -3

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (classe): um required check com CONTAGEM no name passou (exit 0)."
  fail "O contexto protegido voltaria a mudar quando o número mudasse."
  exit 1
fi
for alvo in "Mutation guards master (27 node-pure mutation tests)" \
  "Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)"; do
  if ! grep -Fq "$alvo" <<<"$OUTPUT"; then
    fail "O guard falhou (exit $EXIT) mas NÃO acusou o contexto '$alvo'"
    fail "(o caminho do reusable tem de ser coberto como o do job direto)."
    exit 1
  fi
done
if ! grep -Fq "CONTAGEM" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO nomeou a CONTAGEM como o defeito."
  exit 1
fi
pass "Mutação F DETECTADA: os DOIS contextos com contagem falham, nomeando CONTAGEM (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 16+17 — MUTAÇÃO G: a suíte SEM o bloco METADES (a descrição derivada)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 16: MUTAÇÃO G — a suíte sub-1 sem o bloco METADES..."
make_fixture 13 "" 13 13 "" "sem_bloco"

info "STEP 17: Rodando o guard contra a mutação G..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (metades): uma suíte SEM o bloco METADES passou (exit 0)."
  fail "Sem o bloco, 'não li' viraria 'não há metade' e a descrição do sub-test"
  fail "ficaria sem fonte (a prosa à mão é justamente o que veio abaixo)."
  exit 1
fi
if ! grep -Fq "não DECLARA as metades" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO nomeou a falta do bloco METADES."
  echo "$OUTPUT" | tail -4
  exit 1
fi
pass "Mutação G DETECTADA: a suíte sem bloco METADES falha nomeando a falta (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 18+19 — MUTAÇÃO H: o bloco com uma linha fora do formato (fail-closed)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 18: MUTAÇÃO H — o bloco METADES com uma linha fora do formato..."
make_fixture 13 "" 13 13 "" "ilegivel"

info "STEP 19: Rodando o guard contra a mutação H..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (bloco ilegível): uma linha fora do formato passou (exit 0)."
  fail "Um bloco que o parser não entende NÃO pode virar 'nenhuma metade'."
  exit 1
fi
if ! grep -Fq "fora do formato" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO nomeou a linha fora do formato."
  echo "$OUTPUT" | tail -4
  exit 1
fi
pass "Mutação H DETECTADA: o bloco ilegível falha nomeando a linha (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 20+21 — MUTAÇÃO I: a doc declara um total que não bate com o bloco
# (é a classe que o guard veio fechar: a contagem à mão da doc envelhecendo)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 20: MUTAÇÃO I — a doc declara 5 metades para uma suíte que declara 2..."
make_fixture 13 "" 13 13 "" "doc_stale"

info "STEP 21: Rodando o guard contra a mutação I..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (doc): a doc declarando 5 metades contra um bloco de 2 passou (exit 0)."
  fail "É exatamente o silêncio que a derivação existe para fechar."
  exit 1
fi
if ! grep -Fq "≠ 2" <<<"$OUTPUT" || ! grep -Fq "test-mutation-sub-1.sh" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO acusou o delta nem nomeou a suíte."
  echo "$OUTPUT" | tail -4
  exit 1
fi
pass "Mutação I DETECTADA: a contagem da doc divergindo do bloco falha com o delta (exit $EXIT)"

# ── STEP 21b/21c — a MESMA contagem em NEGRITO (a forma invisível) ─────────
# A ênfase do markdown não é cosmética aqui: com o `**` entre o verbo e o número,
# a contagem escrita na doc saía do alcance do parser e a prosa envelhecia em
# SILÊNCIO — o laço MEDIDO no repositório: a doc dizia "a suíte declara
# **8 metades**" com a suíte declarando dez, e o guard passava verde. O par
# abaixo prova as DUAS direções: a errada em negrito FALHA, a certa em negrito
# PASSA (a régua não recusa o negrito em bloco).
info "STEP 21b: a contagem ERRADA em NEGRITO (a forma que o parser não lia)..."
make_fixture 13 "" 13 13 "" "doc_stale_bold"
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (negrito): a doc declarando **5 metades** contra um bloco de 2 passou (exit 0)."
  fail "É o silêncio exato que a ênfase reintroduz: a contagem existe no documento e a régua não a lê."
  exit 1
fi
if ! grep -Fq "≠ 2" <<<"$OUTPUT" || ! grep -Fq "declara 5 metades" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO leu a contagem em negrito (nem o delta)."
  echo "$OUTPUT" | tail -4
  exit 1
fi
pass "Mutação I (negrito) DETECTADA: **5 metades** contra um bloco de 2 falha com o delta (exit $EXIT)"

info "STEP 21c: CONTROLE — a contagem CERTA em negrito passa..."
make_fixture 13 "" 13 13 "" "doc_bold"
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU (negrito, exit $EXIT): a doc com **2 metades** (o total CERTO) foi rejeitada."
  echo "$OUTPUT" | tail -4
  exit 1
fi
pass "CONTROLE OK: **2 metades** em negrito, com o bloco de 2, passa (a régua lê a forma, não a recusa)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 22+23 — MUTAÇÃO J: a entrada do bloco em ASPAS DUPLAS (a suíte MORRE)
# ═════════════════════════════════════════════════════════════════════════
# A classe é MEDIDA, não teórica: com o bloco em aspas duplas o shell EXPANDE a
# descrição antes de guardá-la, e uma descrição que cita o código da mutação
# (`echo $OUT | grep -Fq`) estoura a suíte com 'variável não associada' sob
# `set -u` — quatro suítes do repositório morreram exatamente assim, com a
# descrição virando o defeito. O guard tem de recusar a FORMA e dizer por quê,
# para o defeito não voltar disfarçado de "formato errado" genérico.

info "STEP 22: MUTAÇÃO J — o bloco com uma entrada em ASPAS DUPLAS..."
make_fixture 13 "" 13 13 "" "aspas_duplas"

info "STEP 23: Rodando o guard contra a mutação J..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (aspas duplas): o bloco que o shell expandiria passou (exit 0)."
  fail "A declaração em aspas duplas mata a suíte em tempo de execução: aceitá-la"
  fail "é deixar o gate verde sobre um script que não roda."
  exit 1
fi
if ! grep -Fq "ASPAS DUPLAS" <<<"$OUTPUT" || ! grep -Fq "aspas SIMPLES" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO nomeou a expansão nem o remédio."
  echo "$OUTPUT" | tail -4
  exit 1
fi
pass "Mutação J DETECTADA: a entrada em aspas duplas falha nomeando a expansão (exit $EXIT)"

# CONTROLE da derivação: a MESMA fixture com a doc certa passa (a mutação I não
# pode ser confundida com um guard que simplesmente reclama de qualquer doc).
info "STEP 24: CONTROLE da derivação — a mesma fixture com a doc coerente..."
make_fixture 13 "" 13 13
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU (exit $EXIT): a fixture com o bloco e a doc coerentes foi rejeitada."
  echo "$OUTPUT" | tail -4
  exit 1
fi
pass "Controle OK — bloco declarado + doc coerente passa (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 25..30 — O RECORTE `--staged`: o veredito é o CONTEÚDO DO ÍNDICE
# ═════════════════════════════════════════════════════════════════════════
# As três metades abaixo são as que só existem no modo `--staged` (o que roda no
# pre-commit): o ESCOPO (o índice, não a árvore), o arquivo que o veredito lê e o
# COMMIT não carrega, e o fail-closed do master ilegível. As três rodam contra um
# repositório git de verdade — o fixture do `make_fixture` + commit base — e as
# mutações vão no GUARD (arquivo do repositório), com restauração verificada por
# checksum e a suíte unitária como segunda testemunha.
if ! git_disponivel; then
  info "MUTAÇÕES K/L/M: NÃO julgadas — git ausente neste host (o recorte --staged vive do índice)"
else
  # ── K: O ESCOPO — o recorte julga o ÍNDICE, não a árvore ─────────────────
  info "STEP 25: MUTAÇÃO K — a matriz 3 no ÍNDICE e as refs em 2 (o commit partido)..."
  repo_git_fixture 2 "" 2 2
  suite_extra 3
  git -C "$TMP_DIR" add scripts/test-mutation-sub-3.sh
  master_com "$TMP_DIR/.master-do-commit" 3
  BLOB="$(git -C "$TMP_DIR" hash-object -w "$TMP_DIR/.master-do-commit")"
  git -C "$TMP_DIR" update-index --cacheinfo "100755,$BLOB,scripts/test-mutation-guards.sh"
  info "  (a ÁRVORE segue COERENTE — matriz 2 + refs 2: é essa a diferença de escopo)"

  info "STEP 26: o recorte contra o commit partido, e a árvore coerente do MESMO repo..."
  rodar_staged
  if [ "$EXIT" -eq 0 ]; then
    fail "GUARD CEGO (escopo): o commit PARTIDO passou no recorte (exit 0)."
    fail "É a janela que o pre-commit existe para fechar."
    exit 1
  fi
  if ! grep -Fq "no ÍNDICE" <<<"$OUTPUT"; then
    fail "O recorte reprovou (exit $EXIT) mas não disse que julgou o ÍNDICE."
    exit 1
  fi
  K_STAGED_EXIT=$EXIT
  rodar_arvore
  if [ "$EXIT" -ne 0 ]; then
    fail "CONTROLE FALHOU: a ÁRVORE coerente do MESMO repositório reprovou (exit $EXIT)."
    fail "Sem esta metade, 'o recorte lê o índice' poderia ser só um fixture quebrado."
    echo "$OUTPUT" | tail -4
    exit 1
  fi
  pass "K (CONTROLE): o ÍNDICE partido reprova (exit $K_STAGED_EXIT) e a ÁRVORE coerente passa (exit 0)"

  mutar_guard \
    '    const result = run(dir)' \
    '    const result = run(root) /* MUTACAO M-K: o recorte julga a ARVORE */'
  rodar_staged
  if [ "$EXIT" -ne 0 ]; then
    fail "K: com o recorte lendo a ÁRVORE o commit partido AINDA reprovou (exit $EXIT)."
    fail "Se a árvore já bastasse, o escopo não sustentava o vermelho."
    echo "$OUTPUT" | tail -4
    exit 1
  fi
  pass "K: com o recorte lendo a ÁRVORE, o commit partido PASSA (exit 0) — o escopo é load-bearing"
  exigir_suite_vermelha "K"
  restaurar_guard

  # ── L: O ARQUIVO QUE O VEREDITO LÊ E O ÍNDICE NÃO CARREGA ────────────────
  # O caso real: a suíte do sub-test novo escrita na árvore e ainda não
  # estagiada. O veredito tem de NOMEAR o índice como a causa (o remédio é o
  # `git add`), em vez de dizer que o arquivo "não existe" — ele existe, quem não
  # o carrega é o commit.
  info "STEP 27: MUTAÇÃO L — a suíte citada existe na ÁRVORE e NÃO no ÍNDICE..."
  # O commit BASE sai com tudo (a árvore coerente com 3) e a suíte nova é TIRADA
  # do índice: é o caso real — ela está escrita na árvore e ainda não estagiada —
  # e o COMMIT passa a citar um arquivo que não carrega.
  repo_git_fixture 3 "" 3 3
  git -C "$TMP_DIR" rm -q --cached scripts/test-mutation-sub-3.sh
  info "  (o ÍNDICE cita a suíte 3 e não a carrega; a ÁRVORE está inteira)"

  rodar_staged
  if [ "$EXIT" -eq 0 ]; then
    fail "GUARD CEGO (ausente do índice): o commit que cita um arquivo que não carrega passou."
    exit 1
  fi
  if ! grep -Fq "e o ÍNDICE não o tem" <<<"$OUTPUT"; then
    fail "O recorte reprovou (exit $EXIT) mas NÃO nomeou o índice como a causa."
    echo "$OUTPUT" | grep -E '^   - ' | head -4
    exit 1
  fi
  pass "L (CONTROLE): o commit reprova NOMEANDO o índice como a causa (exit $EXIT)"
  rodar_arvore
  if [ "$EXIT" -ne 0 ]; then
    fail "CONTROLE FALHOU: a ÁRVORE do MESMO repositório reprovou (exit $EXIT)."
    echo "$OUTPUT" | tail -4
    exit 1
  fi

  mutar_guard \
    '        ausentes.push(`${rel}: ${r.motivo}`)' \
    '        /* MUTACAO M-L: o ausente do indice nao e registrado */'
  rodar_staged
  if grep -Fq "e o ÍNDICE não o tem" <<<"$OUTPUT"; then
    fail "L: a violação NOMEADA sobreviveu à mutação — ela não é o que o veredito diz."
    exit 1
  fi
  if [ "$EXIT" -eq 0 ]; then
    fail "L: com o registro desligado o commit PASSOU (exit 0) — o guard ficou CEGO"
    fail "(a outra violação, a do arquivo 'que não existe', também depende do registro)."
    exit 1
  fi
  pass "L: sem o registro, o veredito PERDE a causa (sobra a acusação ao arquivo que está na árvore) — exit $EXIT"
  exigir_suite_vermelha "L"
  restaurar_guard

  # ── M: O FAIL-CLOSED DO MASTER ILEGÍVEL ──────────────────────────────────
  info "STEP 28: MUTAÇÃO M — o master fora do ÍNDICE (e inteiro na árvore)..."
  repo_git_fixture 2 "" 2 2
  git -C "$TMP_DIR" rm -q --cached scripts/test-mutation-guards.sh

  info "STEP 29: o recorte contra o master que ele não consegue ler..."
  rodar_staged
  if [ "$EXIT" -ne 2 ]; then
    fail "INFRA: o master ausente do índice devia sair 2 (não julgável) e saiu $EXIT."
    echo "$OUTPUT" | tail -3
    exit 1
  fi
  if ! grep -Fq "não consegui ler o master" <<<"$OUTPUT"; then
    fail "O recorte saiu 2 mas NÃO nomeou o master que não conseguiu ler."
    exit 1
  fi
  pass "M (CONTROLE): 'não consegui ler' é exit 2 — nunca um verde por não saber"
  rodar_arvore
  if [ "$EXIT" -ne 0 ]; then
    fail "CONTROLE FALHOU: a ÁRVORE (com o master inteiro) reprovou (exit $EXIT)."
    echo "$OUTPUT" | tail -4
    exit 1
  fi

  mutar_guard \
    '    const err = new Error(`não consegui ler o master ${MASTER} do índice — ${master.motivo}`)
    err.code = "INFRA"
    throw err' \
    '    /* MUTACAO M-M: "nao consegui ler" virou "nada a julgar" */
    return { ...run(root), ok: true, violations: [], indice: root, ausentesNoIndice: [] }'
  rodar_staged
  if [ "$EXIT" -ne 0 ]; then
    fail "M: com o fail-closed desligado o `--staged` ainda saiu $EXIT (esperado 0 = cego)."
    echo "$OUTPUT" | tail -4
    exit 1
  fi
  pass "M: mutado, 'não consegui ler' vira 'nada a julgar' VERDE (exit 0) — o fail-closed é load-bearing"
  exigir_suite_vermelha "M"
  restaurar_guard

  # ── CONTROLE FINAL do recorte: a árvore restaurada volta a julgar ────────
  info "STEP 30: CONTROLE FINAL — o recorte restaurado contra o commit partido..."
  repo_git_fixture 2 "" 2 2
  suite_extra 3
  git -C "$TMP_DIR" add scripts/test-mutation-sub-3.sh
  master_com "$TMP_DIR/.master-do-commit" 3
  BLOB="$(git -C "$TMP_DIR" hash-object -w "$TMP_DIR/.master-do-commit")"
  git -C "$TMP_DIR" update-index --cacheinfo "100755,$BLOB,scripts/test-mutation-guards.sh"
  rodar_staged
  if [ "$EXIT" -eq 0 ]; then
    fail "CONTROLE FINAL: o recorte RESTAURADO deixou o commit partido passar"
    fail "(a restauração por checksum não devolveu o guard)."
    exit 1
  fi
  pass "CONTROLE FINAL: o recorte restaurado volta a reprovar o commit partido (exit $EXIT)"
fi

# ═════════════════════════════════════════════════════════════════════
# STEP 31..34 — A MATRIZ × O ATO QUE A VERSIONA
# ═════════════════════════════════════════════════════════════════════
# A ligação que o count sozinho não vê: o registro versionado do bench
# (docs/benchmarks/guard-timing-baseline.json, família `mutations`) tem de
# versionar TODOS os sub-tests da matriz. A defasagem é real e medida (22/09/2026):
# a matriz ganhou o `doc-hashes` e o `stack-per-commit` e o registro seguiu com as
# 37 formas do ato anterior — o número declarado do job (e o PISO do job
# `guards`, que dele se soma) passou a descrever uma matriz que já não existia, e
# nada no repositório olhava isso.

# ── bench_ato: o REGISTRO versionado do ato, com as formas pedidas ────────
# $1 = quantas formas a família `mutations` versiona (os ids sub-1..sub-N, que é
#      a forma do `make_fixture`) | $2 = (opcional) "ilegivel" (o arquivo lá,
#      sem ser JSON)
bench_ato() {
  local destino="$TMP_DIR/docs/benchmarks/guard-timing-baseline.json"
  mkdir -p "$TMP_DIR/docs/benchmarks"
  if [ "${2:-}" = "ilegivel" ]; then
    echo '{ isto nao e JSON' > "$destino"
    return
  fi
  # $3 = "coluna" — a COLUNA que a rodada de MEDIÇÃO gravou, e não a que a matriz
  # declara hoje: a `sub-1` sai com 1 metade (a suíte declara 2) e o total fecha
  # com as formas. É a defasagem real de 23/09/2026 (a unidade entrou na suíte
  # depois de a medição ter gravado a coluna), e nada aqui é inconsistente por
  # dentro — o único defeito é a coluna contra a matriz.
  local metade1=2
  local total=$(( $1 * 2 ))
  if [ "${3:-}" = "coluna" ]; then
    metade1=1
    total=$(( $1 * 2 - 1 ))
  fi
  {
    echo '{'
    echo '  "meta": {"tool": "bench-guard-timing", "version": 6},'
    echo '  "mutations": {'
    echo '    "measured": true,'
    echo "    \"subtests\": $1,"
    echo "    \"metades\": $total,"
    echo '    "forms": ['
    local i
    for i in $(seq 1 "$1"); do
      local m=2
      if [ "$i" = "1" ]; then m="$metade1"; fi
      if [ "$i" = "$1" ]; then
        printf '      {"role": "sub-%s", "ms": %s, "metades": %s, "exit": 0}\n' "$i" "$(( 99 + i ))" "$m"
      else
        printf '      {"role": "sub-%s", "ms": %s, "metades": %s, "exit": 0},\n' "$i" "$(( 99 + i ))" "$m"
      fi
    done
    echo '    ]'
    echo '  }'
    echo '}'
  } > "$destino"

  # O ato NÃO termina no registro: ele REESCREVE as duas prosas (é o
  # `escreverDocs` do `--baseline`). Um fixture que só carregasse o registro
  # mediaria uma árvore que o ato nunca produz — e a regra 6 acusaria as duas
  # prosas em TODA metade desta seção, mascarando o defeito sob teste (medido:
  # o CONTROLE N saía "FALSO POSITIVO" com a doc sintética sem os blocos).
  bench_blocos
}

# ── bench_blocos: o ato reescreve as DUAS prosas a partir do registro ────────
# A FOLHA é a do REPOSITÓRIO (`scripts/bench-table.mjs`, pelo mesmo caminho do
# ato): um renderizador reescrito aqui mediria o fixture em vez do guard. O
# marcador é o da folha — a doc do fixture nasce sem ele (o operador o posiciona
# uma vez) e a inserção usa a MESMA constante que o guard lê.
bench_blocos() {
  node --input-type=module -e '
    import { existsSync, readFileSync, writeFileSync } from "node:fs"
    import { join } from "node:path"
    const [tmp, repo] = process.argv.slice(1)
    const folha = await import(`file://${repo}/scripts/bench-table.mjs`)
    const registro = JSON.parse(
      readFileSync(join(tmp, "docs/benchmarks/guard-timing-baseline.json"), "utf8"),
    )
    for (const { arquivo, bloco } of folha.DOCS) {
      const p = join(tmp, arquivo)
      if (!existsSync(p)) {
        console.error(`fixture sem ${arquivo}`)
        process.exit(1)
      }
      const texto = readFileSync(p, "utf8")
      if (folha.blocoDoTexto(texto, bloco) === null) {
        writeFileSync(p, `${texto}\n${bloco.abre}\n\n${bloco.fecha}\n`)
      }
    }
    const notas = folha.escreverDocs({ cwd: tmp, registro })
    const ruins = notas.filter((n) => n.status !== "reescrito" && n.status !== "jaEstava")
    if (ruins.length) {
      console.error(`fixture: ${JSON.stringify(ruins)}`)
      process.exit(1)
    }
  ' "$TMP_DIR" "$SCRIPT_DIR"
}

# ── CONTROLE N: o ato versionou a MATRIZ INTEIRA ─────────────────────────
info "STEP 31: CONTROLE N — matriz 13 e o registro do ato com as 13 formas..."
make_fixture 13 "" 13 13
bench_ato 13
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -ne 0 ]; then
  fail "FALSO POSITIVO: a matriz versionada INTEIRA pelo ato foi rejeitada (exit $EXIT)."
  echo "$OUTPUT" | tail -4
  exit 1
fi
# O veredito VERDE também DIZ o ato: "as refs batem" não diz que a matriz está
# versionada — é a diferença entre os dois que esta metade veio fechar.
if ! grep -Fq "O ATO versionou a matriz: 13 forma(s)" <<<"$OUTPUT"; then
  fail "O guard passou (exit 0) mas NÃO publicou o que o ato versionou —"
  fail "um verde mudo deixaria a ligação sem leitura no relatório."
  echo "$OUTPUT" | tail -3
  exit 1
fi
pass "Controle N OK — matriz inteira versionada passa E o veredito diz o ato (exit 0)"

# ── MUTAÇÃO N (A DEFASAGEM): a matriz ganha um sub-test e o ato fica atrás ─
info "STEP 32: MUTAÇÃO N — matriz 14 com o registro do ato ainda em 13 formas..."
make_fixture 14 "" 14 14
bench_ato 13
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
echo "$OUTPUT" | grep -E '^   - ' | head -3

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (ato): a matriz ganhou o sub-14 e o registro do ato seguiu com 13"
  fail "formas — a defasagem que o count na prosa não vê passou (exit 0)."
  exit 1
fi
if ! grep -Fq "não versionou" <<<"$OUTPUT" || ! grep -Fq "sub-14" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO nomeou o sub-test que o ato não versionou."
  exit 1
fi
if ! grep -Fq "bench-guard-timing.mjs --only mutations" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO deu o comando do ato como remédio."
  exit 1
fi
pass "Mutação N DETECTADA: a defasagem falha nomeando 'sub-14' e o ato (exit $EXIT)"

# ── MUTAÇÃO N (A LIGAÇÃO): o run deixa de julgar o ato ──────────────────
# Sem esta metade, "o guard acusa a defasagem" poderia ser só o fixture — a
# ligação (o `run()` chamando a régua com os ids do master) tem de ser o que
# sustenta o vermelho.
mutar_guard \
  '  const bench = julgaOAto(root, N, idsDoMaster(masterSrc), metades.metades)' \
  '  const bench = { present: false, ok: true, versionados: [], faltando: [], sobrando: [], gravado: null, motivo: "MUTACAO M-N: a ligacao matriz <-> ato nao e julgada", violations: [] }'
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -ne 0 ]; then
  fail "N: com a ligação DESLIGADA a defasagem ainda reprovou (exit $EXIT)."
  fail "Se outra coisa já bastasse, a régua do ato não sustentava o vermelho."
  echo "$OUTPUT" | tail -4
  exit 1
fi
pass "N: com a ligação desligada a defasagem PASSA (exit 0) — a ligação é load-bearing"
exigir_suite_vermelha "N"
restaurar_guard

# ── CONTROLE P: o registro AUSENTE não é violação (e não é silêncio) ─────
info "STEP 33: CONTROLE P — o registro do ato FORA da árvore..."
make_fixture 13 "" 13 13
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -ne 0 ]; then
  fail "FALSO POSITIVO: sem o registro do ato na árvore o guard reprovou (exit $EXIT)."
  echo "$OUTPUT" | tail -4
  exit 1
fi
if ! grep -Fq "NÃO foi julgada" <<<"$OUTPUT" || ! grep -Fq "guard-timing-baseline.json" <<<"$OUTPUT"; then
  fail "O guard passou (exit 0) mas NÃO declarou que a ligação matriz ↔ ato não foi"
  fail "julgada: o silêncio de uma metade que não rodou é indistinguível de um verde."
  echo "$OUTPUT" | tail -3
  exit 1
fi
pass "Controle P OK — a ausência do registro passa E é DITA no veredito (exit 0)"

# ── MUTAÇÃO O (O FAIL-CLOSED): o registro ILEGÍVEL ──────────────────────
# Um registro PRESENTE e corrompido não pode virar "nenhuma ligação a julgar": a
# ausência é declarada, a corrupção é INFRA (exit 2) — a mesma distinção do
# `readOrDie`.
info "STEP 34: MUTAÇÃO O — o registro do ato presente e ILEGÍVEL..."
make_fixture 14 "" 14 14
bench_ato 13 "ilegivel"
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -ne 2 ]; then
  fail "INFRA: o registro do ato ilegível devia sair 2 (não julgável) e saiu $EXIT."
  echo "$OUTPUT" | tail -3
  exit 1
fi
if ! grep -Fq "guard-timing-baseline.json ilegível" <<<"$OUTPUT"; then
  fail "O guard saiu 2 mas NÃO nomeou o registro que não conseguiu ler."
  exit 1
fi
pass "O (CONTROLE): o registro ilegível é exit 2 — nunca um verde por não saber"

mutar_guard \
  '    const err = new Error(`${BENCH_PATH} ilegível: ${e.message}`)' \
  '    /* MUTACAO M-O: o registro corrompido virou "nada a julgar" */
    return comparaComOAto(null, ids)
    // eslint-disable-next-line no-unreachable
    void e'
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -eq 2 ]; then
  fail "O: a mutação não desligou o fail-closed (ainda exit 2)."
  exit 1
fi
if [ "$EXIT" -ne 0 ]; then
  fail "O: com o fail-closed trocado pela ausência o guard saiu $EXIT (esperado 0 = CEGO),"
  fail "mas o fixture era uma defasagem REAL (matriz 14 × ato 13) — ele tinha de passar."
  echo "$OUTPUT" | tail -4
  exit 1
fi
pass "O: mutado, o registro corrompido vira 'nada a julgar' VERDE (exit 0) — o fail-closed é load-bearing"
exigir_suite_vermelha "O"
restaurar_guard

# ── CONTROLE Q (a coluna da MATRIZ) e MUTAÇÃO Q (a coluna herdada) ──────
# A COLUNA de metades do registro é DERIVADA da matriz. O caso real é o que esta
# metade mede: a suíte GANHA uma metade depois de a medição ter gravado a coluna,
# e o registro segue descrevendo a unidade anterior. Aqui a `sub-1` grava 1 onde
# a suíte declara 2 — nada mais diverge (as 13 formas estão versionadas, o count
# bate, o total fecha com as formas).
info "STEP 35: CONTROLE Q — o registro com a coluna que a MATRIZ declara..."
make_fixture 13 "" 13 13
bench_ato 13
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -ne 0 ]; then
  fail "FALSO POSITIVO: a coluna derivada da matriz foi rejeitada (exit $EXIT)."
  echo "$OUTPUT" | tail -4
  exit 1
fi
pass "Controle Q OK — a coluna que a matriz declara passa (exit 0)"

info "STEP 36: MUTAÇÃO Q — a sub-1 GRAVOU 1 metade e a suíte declara 2..."
bench_ato 13 "" coluna
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
echo "$OUTPUT" | grep -E '^   - ' | head -2

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (coluna): a sub-1 herdou a unidade de antes da medição e o"
  fail "registro passou (exit 0) — a unidade que entrou depois não é julgada."
  exit 1
fi
if ! grep -Fq "'sub-1' GRAVOU 1 metade(s)" <<<"$OUTPUT" || ! grep -Fq "declara 2" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO nomeou a forma e o delta da coluna."
  exit 1
fi
if ! grep -Fq "bench-guard-timing.mjs --only mutations" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO deu o ato como remédio da coluna."
  exit 1
fi
if grep -Fq "não versionou" <<<"$OUTPUT"; then
  fail "O vermelho veio das FORMAS que faltam, não da coluna: as 13 estão lá —"
  fail "senão esta metade estaria medindo a defasagem da N, não a coluna."
  exit 1
fi
pass "Mutação Q DETECTADA: a coluna herdada falha nomeando 'sub-1' e o delta (exit $EXIT)"

# ── MUTAÇÃO Q (A DERIVAÇÃO): o run deixa de entregar a matriz à régua ────
# Sem esta metade, "o guard acusa a coluna" poderia ser só o fixture: é a
# DERIVAÇÃO (o `run()` passando as metades da matriz) que sustenta o vermelho.
mutar_guard \
  '  const bench = julgaOAto(root, N, idsDoMaster(masterSrc), metades.metades)' \
  '  const bench = julgaOAto(root, N, idsDoMaster(masterSrc)) /* MUTACAO M-Q: sem a derivacao da matriz */'
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -ne 0 ]; then
  fail "Q: sem a derivação passada à régua a coluna herdada ainda reprovou (exit $EXIT)."
  fail "Se outra coisa já bastasse, a derivação não sustentava o vermelho."
  echo "$OUTPUT" | tail -4
  exit 1
fi
pass "Q: sem a derivação a coluna herdada PASSA (exit 0) — a matriz é load-bearing"
exigir_suite_vermelha "Q"
restaurar_guard

# ── MUTAÇÃO R (O TOTAL): a família não fecha com a coluna do MESMO registro ──
# O total e as formas são as DUAS leituras da mesma medição: um total que não soma
# a coluna é o registro dizendo duas coisas diferentes sobre si próprio.
info "STEP 37: MUTAÇÃO R — o total da família não soma a coluna..."
make_fixture 13 "" 13 13
bench_ato 13
python3 - "$TMP_DIR/docs/benchmarks/guard-timing-baseline.json" <<'PY'
import json, sys
p = sys.argv[1]
b = json.load(open(p))
b["mutations"]["metades"] -= 1
json.dump(b, open(p, "w"), indent=2)
PY
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (total): a família GRAVOU um total que não soma a própria coluna"
  fail "e o guard passou (exit 0)."
  exit 1
fi
if ! grep -Fq "GRAVOU 25 metade(s)" <<<"$OUTPUT" || ! grep -Fq "somam 26" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO nomeou o total e a soma da coluna."
  exit 1
fi
pass "Mutação R DETECTADA: o total que não fecha com a coluna falha com os dois números (exit $EXIT)"

# ── MUTAÇÃO R (A RÉGUA): o guard deixa de conferir o total ──────────────
# O mesmo fixture com o MESMO defeito: se o total não sustentasse o vermelho, a
# acusação acima seria do fixture e não da régua.
mutar_guard \
  '    if (totalFamilia !== null && totalFamilia !== totalFormas) {' \
  '    if (false /* MUTACAO M-R: o total nao e conferido contra a coluna */) {'
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -ne 0 ]; then
  fail "R: com o total fora da régua o fixture ainda reprovou (exit $EXIT) — outra"
  fail "coisa estava sustentando o vermelho, não a conferência do total."
  echo "$OUTPUT" | tail -4
  exit 1
fi
pass "R: sem a régua do total o MESMO fixture PASSA (exit 0) — a conferência é load-bearing"
exigir_suite_vermelha "R"
restaurar_guard

echo ""
pass "do job (o contexto do required check não pode depender da matriz), no"
pass "summary e no README; check-required-checks recusa a CONTAGEM no name de"
pass "um required check (job direto E reusable); a suíte que não DECLARA as"
pass "metades falha fail-closed, o bloco ilegível também, a entrada em ASPAS"
pass "DUPLAS (que o shell expandiria, matando a suíte) é recusada com a razão, e a"
pass "contagem da doc que envelheceu contra o bloco acende com o delta — sem"
pass "falso-positivo numa fixture coerente. O RECORTE --staged tem as suas três:"
pass "o ESCOPO é o ÍNDICE (mutado para ler a árvore, o commit partido passa), o"
pass "arquivo que o commit não carrega perde a causa nomeada, e o master"
pass "ilegível deixa de ser exit 2 quando o fail-closed é desligado. E A MATRIZ ×"
pass "O ATO que a versiona: a defasagem (o sub-test que o registro do ato não"
pass "versionou) FALHA nomeando-o e o comando do ato, a ligação DESLIGADA deixa a"
pass "mesma defasagem PASSAR, o registro ausente não é violação mas é DITO, e o"
pass "corrompido é exit 2 — mutado para 'nada a julgar', ele volta a passar."
pass "E A COLUNA de metades, que é DERIVADA da matriz e não herdada do ato: a"
pass "unidade que entrou na suíte DEPOIS da medição FALHA nomeando a forma e o"
pass "delta (e o ato como remédio), sem a derivação passada à régua ela PASSA, e o"
pass "TOTAL que não soma a própria coluna FALHA com os dois números — fora da"
pass "régua, o mesmo fixture passa."
exit 0
