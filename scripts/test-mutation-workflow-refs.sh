#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-workflow-refs.sh — Mutation test do guard de refs
# (check-workflow-refs.mjs)
#
# Usage:
#   ./scripts/test-mutation-workflow-refs.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard (falhou pelas asserções esperadas) ✅
#   1 — guard CEGO (passou com alguma mutação) OU falha de infra/asserção ❌
#
# Prova que o scripts/check-workflow-refs.mjs REALMENTE pega os DOIS drifts de
# referência que ele existe para prevenir, rodando o guard REAL (node) contra
# um mini-repo git fixture:
#
#   Cenário 1 (par TRANSITIVO — workflow → entry → script): o workflow roda
#     `bun run bench:geo`, a entry EXISTE em package.json e invoca
#     `node scripts/run-benchmark.mjs` — DELETA o script alvo
#     (scripts/run-benchmark.mjs). O guard (modo default, scan de workflows)
#     deve FALHAR com exit 1 citando a ENTRY ('entry 'bench:geo' aponta para
#     scripts/run-benchmark.mjs que NÃO existe'). É o espelho do mapeamento
#     `bun run test:mutation-X` do check-mutation-jobs.mjs: uma entry que
#     aponta para um script deletado falharia no runtime do job mesmo
#     existindo a entry; o guard pega no review.
#   Cenário 2 (consistência INTERNA — modo --pkg-internal): adiciona uma
#     entry `local:tools` que invoca `bash scripts/helper.sh` SEM NENHUM
#     workflow referenciando (órfã — ex.: hook local/manual `bun run
#     local:tools`), e DELETA o script alvo. O guard DEFAULT deve PASSAR
#     (exit 0 — o scan workflow-only não enxerga entries órfãs de workflow:
#     prova que o modo --pkg-internal existe e é necessário); o guard
#     --pkg-internal deve FALHAR com exit 1 citando a entry ('entry
#     'local:tools' invoca scripts/helper.sh que NÃO existe (consistência
#     INTERNA — mesmo sem workflow referenciando)').
#
#   Cenário 3 (MUTAÇÃO DA RÉGUA COMPARTILHADA — o stripping do comentário de
#     FIM DE LINHA, em `stripTrailingComment` de scripts/forge-workflows.mjs):
#     duas mutações cirúrgicas do ARQUIVO REAL DA RÉGUA (backup + restauração
#     VERIFICADA por checksum), cada uma prendendo UM lado da mesma regra, com a
#     fixture que separa um lado do outro. A mutação mora na RÉGUA, e não no
#     guard, de propósito: o guard importa `executableLine` de lá, então o
#     veredito só muda se ele de fato a consome — uma cópia local SOBREVIVERIA à
#     mutação e o script falharia como CEGO. É essa a prova de que existe UMA
#     régua só (e não duas que hoje coincidem).
#
#     M1 (a regra REMOVIDA: `stripTrailingComment` devolve a linha INTACTA):
#       a fixture tem `run: echo ok # node scripts/ghost-comentario.mjs`. O guard
#       REAL passa (o comentário não executa: nenhuma ref); com a régua mutada o
#       guard ACUSA a ref do COMENTÁRIO. Sem a regra o veredito deixa de ser sobre o que
#       EXECUTA — o guard passa a acusar (e a "validar") CÓDIGO MORTO, que é
#       exatamente a direção do erro que a regra existe para fechar. Por isso a
#       asserção do M1 é um FALSO POSITIVO, e não o `CEGO` das outras: o guard
#       não fica verde, ele INVENTA uma violação — nomear a direção é parte da
#       prova.
#
#     M2 (a regra perde a ÂNCORA de ESPAÇO: `(^|\s)#` → `#`): a fixture tem
#       `run: echo "a#b" ; node scripts/ghost-real.mjs`. O `#` está DENTRO de
#       aspas e sem espaço antes, então NÃO é comentário: o guard REAL mede a ref
#       e a acusa; com a régua mutada ele corta no `#`, PERDE a ref que executa e
#       PASSA com a referência quebrada — CEGO na definição da casa (verde onde
#       deveria reprovar). É aqui que `(^|\s)` deixa de parecer detalhe de regex.
#
#     Os CONTROLES do guard real (antes E depois de restaurar) provam que o
#     veredito é da mutação, não da fixture.
#
# Se o guard PASSAR com qualquer mutação de FIXTURE (exit 0), ele está CEGO (a
# checagem transitiva ou interna foi removida/enfraquecida) — o script falha
# (exit 1), bloqueando o CI. É o espelho do test-mutation-mutation-jobs.sh para o
# guard de referências entre workflows/scripts/package.json.
#
# Fixture: o guard resolve scripts/, .github/workflows/ e package.json a
# partir de process.cwd() — um mini-repo mktemp com a estrutura mínima basta:
#   package.json                    — scripts: { "bench:geo": "node
#                                     scripts/run-benchmark.mjs ..." }
#   .github/workflows/pr-check.yml  — run: bun run bench:geo
#   scripts/run-benchmark.mjs       — o alvo referenciado pela entry
# O CONTROLE (fixture limpo) deve PASS (exit 0) — prova que a falha vem da
# mutação, não de um fixture quebrado. Os Cenários 1 e 2 não tocam em NENHUM
# arquivo do repositório; o Cenário 3 MUTA a régua real (é ela o objeto da prova)
# e a restaura no trap EXIT, com o checksum conferido — junto do guard, que
# também entra no backup por ser o consumidor cujo veredito a prova mede.
#
# Pipeline:
#   1. Cria o mini-repo fixture (limpo) no mktemp
#   2. CONTROLE: guard contra o fixture limpo → deve PASS (exit 0)
#   3. MUTAÇÃO 1 (transitiva): DELETA scripts/run-benchmark.mjs (alvo da
#      entry referenciada pelo workflow)
#   4. Guard contra o fixture MUTADO → deve FALHAR (exit 1) pela asserção
#      transitiva, citando a ENTRY + o alvo ausente
#   5. Re-cria fixture limpo → MUTAÇÃO 2 (interna): adiciona a entry órfã
#      `local:tools` + DELETA scripts/helper.sh (seu alvo)
#   6. Guard DEFAULT contra o fixture → deve PASS (exit 0) — prova que o
#      modo --pkg-internal é necessário (workflow-only não vê órfãs)
#   7. Guard --pkg-internal contra o fixture → deve FALHAR (exit 1) pela
#      asserção interna, citando a ENTRY + a consistência INTERNA
#   8. Fixture do comentário de fim de linha → CONTROLE A: guard REAL deve
#      PASSAR (o comentário não vira ref) → MUTAÇÃO 3 (M1: regra removida) → o
#      guard MUTADO deve ACUSAR a ref do comentário (falso positivo, pelo motivo
#      certo) → restaura (checksum) → CONTROLE B: volta a PASSAR
#   9. Fixture com `#` DENTRO de aspas → CONTROLE A: guard REAL deve FALHAR (o `#`
#      sem espaço antes não é comentário; a ref real é medida) → MUTAÇÃO 4 (M2:
#      regra sem a âncora de espaço) → o guard MUTADO deve PASSAR (CEGO na ref
#      que executa) → restaura (checksum) → CONTROLE B: volta a FALHAR
#  10. Cleanup (trap EXIT — restaura o guard e rm -rf dos temps)
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# A PROVA-DE-APLICAÇÃO — a régua ÚNICA de "a mutação APLICOU" (o gabarito dela é
# `scripts/test-mutation-mutacao-prova.sh`).
# shellcheck source=scripts/mutacao-prova.sh
. "$SCRIPT_DIR/scripts/mutacao-prova.sh"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  '1|par TRANSITIVO: alvo de uma entry referenciada DELETADO'
  '2|consistência INTERNA: entry órfã do modo --pkg-internal'
  'M1|o stripping do comentário de fim de linha REMOVIDO (o guard acusa código morto)'
  'M2|a régua perde a ÂNCORA de espaço (o guard fica CEGO na ref que EXECUTA)'
)
GUARD="$SCRIPT_DIR/scripts/check-workflow-refs.mjs"
# A RÉGUA do que EXECUTA (comentário de linha/fim de linha, expressão do runner)
# vive na FONTE ÚNICA, e é ELA que o Cenário 3 muta: o guard importa
# `executableLine` daqui, então mutar a régua só muda o veredito do guard se o
# guard de fato a consome (uma cópia local sobreviveria à mutação e o script
# falharia como "CEGO" — é essa a prova da unificação).
RULER="$SCRIPT_DIR/scripts/forge-workflows.mjs"

TMP_DIR="$(mktemp -d)"
# Os backups (régua + guard) moram FORA do TMP_DIR de propósito: o `build_fixture`
# faz `rm -rf "$TMP_DIR"` para recriar a fixture, e um backup lá dentro seria
# apagado junto — a restauração do Cenário 3 tem de sobreviver a isso.
BACKUP_DIR="$(mktemp -d)"

# ── Mutações (bugs conhecidos) ────────────────────────────────────────────
# Entry referenciada por workflow (Cenário 1) + entry órfã (Cenário 2).
TRANSITIVE_ENTRY="bench:geo"
TRANSITIVE_TARGET="run-benchmark.mjs"
ORPHAN_ENTRY="local:tools"
ORPHAN_TARGET="helper.sh"

# Asserções que o guard DEVE emitir quando detecta a mutação. Fonte:
#   transitivo — checkWorkflowFile em scripts/check-workflow-refs.mjs:
#     entry '<ref>' aponta para scripts/<target> que NÃO existe
#   interno — checkPkgInternalTargets (modo --pkg-internal):
#     entry '<e>' invoca scripts/<t> que NÃO existe (consistência INTERNA —
#     mesmo sem workflow referenciando)
#
# ⚠️ Source-coupled: estas strings reproduzem o texto EXATO do guard. Se a
# mensagem for reformulada em scripts/check-workflow-refs.mjs, o mutation
# test falha com 'não pela asserção esperada' (não é guard cego — é o
# esperado por acoplamento; atualizar as duas juntas).
EXPECTED_FAILURE_TRANSITIVE="aponta para scripts/"
EXPECTED_FAILURE_INTERNAL="consistência INTERNA"

# ── Cenário 3 — a regra de comentário de FIM DE LINHA (`stripTrailingComment`) ─
# ⚠️ Source-coupled, como as mensagens acima: M1/M2 substituem a LINHA EXATA da
# RÉGUA (`scripts/forge-workflows.mjs`; substituição cirúrgica de 1 ocorrência —
# 0 ou 2+ para o script). Se o prettier quebrar a linha em duas, ou a regra
# mudar de forma, o `mutar_regua` para com "mutacao nao-cirurgica" em vez de
# medir outra coisa. O alvo é a linha `.replace(/(^|\s)#.*$/, "$1")` — a ÚNICA
# ocorrência no arquivo, e é ela que o guard alcança via `executableLine`.
#
# O texto novo carrega o marcador 'MUTACAO M' — é ele que prova que a mutação
# APLICOU (o alvo pode casar e a escrita falhar).
SCANN_LINE='    .replace(/(^|\s)#.*$/, "$1")'
M1_NOVO='    /* MUTACAO M1: stripping de comentario de fim de linha REMOVIDO */'
M2_NOVO='    .replace(/#.*$/, "") /* MUTACAO M2: regra SEM a ancora (^|\s) */'

# As refs das fixtures: uma só MENCIONADA num comentário (não executa nada) e
# uma invocada de VERDADE na mesma linha de um `#` que está dentro de aspas.
GHOST_COMENT="ghost-comentario.mjs"
GHOST_REAL="ghost-real.mjs"
LINHA_COMENT=6
LINHA_ASPAS=6

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ── Backup das FONTES + restauração VERIFICADA (trap EXIT) ──────────────
# O Cenário 3 aplica as mutações NO LUGAR — a régua mutada é a do repositório,
# porque é ela que o veredito do guard mede. Backup e restauração entram no
# MESMO trap: um `exit` no meio do caminho não pode deixar a régua mutada na
# árvore. O GUARD entra no backup junto (ele é o consumidor cujo veredito a prova
# lê), para que a restauração cubra tudo o que a prova tocou.
RULER_BKP="$BACKUP_DIR/forge-workflows.original.mjs"
GUARD_BKP="$BACKUP_DIR/check-workflow-refs.original.mjs"
cp "$RULER" "$RULER_BKP"
cp "$GUARD" "$GUARD_BKP"
RULER_SUM="$(cksum "$RULER" | cut -d' ' -f1)"
GUARD_SUM="$(cksum "$GUARD" | cut -d' ' -f1)"

# ── Cleanup (trap EXIT — restaura as fontes E remove os temps, mesmo com falha) ─
cleanup() {
  cp -f "$RULER_BKP" "$RULER" 2>/dev/null || true
  cp -f "$GUARD_BKP" "$GUARD" 2>/dev/null || true
  rm -rf "$TMP_DIR" "$BACKUP_DIR"
}
trap cleanup EXIT

# ── restaurar_originais: devolve as fontes e CONFERE os dois checksums ────
# Sem a conferência, uma restauração que falhasse em silêncio deixaria a régua
# mutada na árvore — e o próximo CONTROLE mediria a régua errada.
restaurar_originais() {
  cp -f "$RULER_BKP" "$RULER"
  cp -f "$GUARD_BKP" "$GUARD"
  if [ "$(cksum "$RULER" | cut -d' ' -f1)" != "$RULER_SUM" ] || [ "$(cksum "$GUARD" | cut -d' ' -f1)" != "$GUARD_SUM" ]; then
    fail "RESTAURAÇÃO FALHOU (checksum diverge) — restaure a partir de $BACKUP_DIR"
    exit 1
  fi
}

# ── mutar_regua: substituição CIRÚRGICA na RÉGUA (exatamente 1 ocorrência) ──
# Uma mutação que casa 0 ou 2+ vezes não é cirúrgica: o script para em vez de
# medir outra coisa. O marcador "MUTACAO M" no texto novo prova que a mutação
# APLICOU (o alvo pode existir e a escrita falhar); o checksum diferente do
# original é o segundo testemunho.
#
# A troca é em BYTES (não em texto): a régua tem acento, e ler/gravar em modo
# texto depende do locale da máquina (e no Windows converte `\n` → `\r\n`, o que
# poria CRLF num arquivo do repositório no meio da prova).
mutar_regua() { # <alvo> <troca>: em MODO BINÁRIO (a régua é lida em bytes); a
  # cirurgia, o marcador e o checksum são da régua COMPARTILHADA.
  mutacao_aplicar "$RULER" "$1" "$2" "$RULER_SUM" 1 binario
}

# ── mkfixture_wf: fixture do Cenário 3 (um workflow, corpo por STDIN) ───
# `build_fixture` (Cenários 1/2) escreve o workflow do par transitivo; aqui o
# que importa é a LINHA do comentário/aspas, e o resto do fixture pode ser
# mínimo (package.json sem entries → nenhuma entry referenciada a validar).
# O YAML entra por STDIN (heredoc), para o teste escrever o texto LITERAL.
mkfixture_wf() {
  rm -rf "$TMP_DIR"
  mkdir -p "$TMP_DIR/.github/workflows" "$TMP_DIR/scripts"
  cat > "$TMP_DIR/package.json" <<'EOF'
{
  "scripts": {}
}
EOF
  cat > "$TMP_DIR/.github/workflows/pr-check.yml"
}

# ── rodar_guard_fixture: roda o guard (real ou mutado) na fixture (cwd) ──
# O `cd` é obrigatório: o guard resolve scripts/ e .github/workflows/ a partir
# de `process.cwd()`. GUARD e GUARD_EXIT são globais, como nos outros helpers.
rodar_guard_fixture() {
  set +e
  GUARD_OUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
  GUARD_EXIT=$?
  set -e
}

# ── exigir_falha_com: o guard tem de REPROVAR (exit 1) citando arquivo:linha ─
# Usado pelos CONTROLES do Cenário 3: sem eles, um guard que já falhasse por
# outro motivo faria o PASS do mutado parecer a cegueira que ele mede.
exigir_falha_com() {
  local cenario="$1" ref="$2" linha="$3"
  if [ "$GUARD_EXIT" -eq 0 ]; then
    fail "CONTROLE FALSO ($cenario): o guard passou onde devia reprovar (exit 0)."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if [ "$GUARD_EXIT" -ne 1 ]; then
    fail "$cenario: exit $GUARD_EXIT (esperado exit 1 EXATO de violação de referência)."
    fail "Exit diferente = falha de infra na fixture, não veredito do guard."
    exit 1
  fi
  if ! grep -Fq "$ref" <<<"$GUARD_OUT" || ! grep -Fq "pr-check.yml:$linha" <<<"$GUARD_OUT"; then
    fail "$cenario: reprovou, mas não citou '$ref' na linha pr-check.yml:$linha."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
}

# ── exigir_falso_positivo: com a mutação o guard ACUSA código que NÃO executa ─
# A assinatura é o INVERSO do `exigir_cego`: com a regra REMOVIDA o guard não
# fica verde — ele inventa uma violação para a ref que vive no COMENTÁRIO. As
# duas metades são exigidas (a violação pelo motivo certo E o código exato da
# regra), porque só a primeira deixaria passar um guard que acusasse por outro
# motivo — um mutante que "morreu" de outra causa seria lido como prova.
exigir_falso_positivo() {
  local cenario="$1" ref="$2" linha="$3"
  if [ "$GUARD_EXIT" -eq 0 ]; then
    fail "MUTAÇÃO NÃO MORDEU ($cenario): o guard mutado PASSOU — a ref do comentário"
    fail "('$ref') continua invisível. Verifique a regra de comentário de fim de linha"
    fail "em stripTrailingComment (scripts/forge-workflows.mjs): ela pode ter mudado de forma,"
    fail "ou o guard deixou de consumir a régua única (cópia local sobrevive à mutação)."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
  if [ "$GUARD_EXIT" -ne 1 ]; then
    fail "$cenario: guard mutado falhou com exit $GUARD_EXIT (esperado exit 1 EXATO)."
    fail "Exit diferente = falha de infra, não a violação que a mutação produz."
    exit 1
  fi
  if ! grep -Fq "$ref" <<<"$GUARD_OUT" || ! grep -Fq "pr-check.yml:$linha" <<<"$GUARD_OUT"; then
    fail "$cenario: o guard mutado falhou, mas não citou '$ref' em pr-check.yml:$linha."
    fail "Acusar outra linha seria outro defeito — não o que a mutação mede."
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
}

# ── exigir_cego: com a mutação aplicada o guard TEM de PASSAR (verde indevido) ─
# É a direção da casa: a mutação tirou do guard a capacidade de ver o defeito,
# e o sintoma é ele APROVAR o que devia reprovar.
exigir_cego() {
  local cenario="$1" detalhe="$2"
  if [ "$GUARD_EXIT" -ne 0 ]; then
    fail "MUTAÇÃO NÃO CEGOU ($cenario): o guard mutado ainda REPROVOU (exit $GUARD_EXIT)."
    fail "$detalhe"
    echo "$GUARD_OUT" | tail -12
    exit 1
  fi
}

# ── build_fixture: (re)cria o mini-repo limpo ─────────────────────────────
# Idempotente — usado no CONTROLE e na MUTAÇÃO 2 (que parte de um fixture
# limpo de novo, já que a MUTAÇÃO 1 deletou o script alvo).
build_fixture() {
  rm -rf "$TMP_DIR"
  mkdir -p "$TMP_DIR/.github/workflows" "$TMP_DIR/scripts"

  # package.json com a entry referenciada pelo workflow (e, na MUTAÇÃO 2, a
  # entry órfã `local:tools`). O guard lê JSON.parse(pkg.scripts).
  cat > "$TMP_DIR/package.json" <<'EOF'
{
  "scripts": {
    "bench:geo": "node scripts/run-benchmark.mjs --type geo"
  }
}
EOF

  # Workflow com run: a entry via `bun run` — o gatilho do par TRANSITIVO
  # (entry EXISTE em package.json → o guard resolve o ALVO da entry).
  cat > "$TMP_DIR/.github/workflows/pr-check.yml" <<'EOF'
jobs:
  bench:
    runs-on: ubuntu-latest
    steps:
      - name: Geo bench
        run: bun run bench:geo
EOF

  # Alvo referenciado pela entry (existe de verdade no CONTROLE).
  printf '#!/usr/bin/env node\nconsole.log("ok")\n' > "$TMP_DIR/scripts/$TRANSITIVE_TARGET"
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-workflow-refs deve FALHAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Cria o mini-repo limpo e valida o CONTROLE (deve PASS)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando mini-repo fixture em $TMP_DIR..."

build_fixture
pass "Fixture criado (package.json + pr-check.yml + scripts/$TRANSITIVE_TARGET)"

info "STEP 2: Controle — fixture limpo → guard deve PASS (exit 0)..."

set +e
CONTROL_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
CONTROL_EXIT=$?
set -e

if [ "$CONTROL_EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: guard rejeitou o fixture LIMPO (exit $CONTROL_EXIT)."
  echo "$CONTROL_OUTPUT" | tail -15
  fail "O fixture base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — fixture limpo passa no guard (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3+4 — MUTAÇÃO 1 (transitiva): alvo de entry referenciada DELETADO
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação 1 (deletando scripts/$TRANSITIVE_TARGET — alvo da entry referenciada)..."

# Deleta o script alvo da entry `bench:geo` — o workflow `bun run bench:geo`
# agora apontaria para um arquivo inexistente no runtime. O par TRANSITIVO
# do guard deve acusar 'entry ... aponta para scripts/X que NÃO existe'.
rm -f "$TMP_DIR/scripts/$TRANSITIVE_TARGET"

# Fail-fast: verifica que a mutação realmente aplicou.
if [ ! -f "$TMP_DIR/scripts/$TRANSITIVE_TARGET" ]; then
  pass "Mutação 1 aplicada: scripts/$TRANSITIVE_TARGET deletado"
else
  fail "Mutação 1 não aplicou (rm falhou?)."
  exit 1
fi

info "STEP 4: Rodando guard contra o fixture MUTADO (transitivo)..."
set +e
GUARD_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
GUARD_EXIT=$?
set -e

echo "$GUARD_OUTPUT" | tail -12

# Caso 1 — guard CEGO: PASS com o alvo deletado. A checagem transitiva foi
# removida/enfraquecida (checkWorkflowFile sem o bloco ctx.pkgTargets?.get).
if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "GUARD CEGO (transitivo): check-workflow-refs passou com o alvo"
  fail "scripts/$TRANSITIVE_TARGET deletado (exit 0). Verifique se o par"
  fail "transitivo (pkgTargets) ainda existe em scripts/check-workflow-refs.mjs."
  exit 1
fi

# Caso 2 — EXIT CODE: a falha deve ser exit 1 (violação de referência), não
# exit 2+ (infra — ex.: diretório ilegível — que o grep da asserção 3 até
# pegaria, mas por acidente; o contrato é exit 1 de violação).
if [ "$GUARD_EXIT" -ne 1 ]; then
  fail "Guard falhou com exit $GUARD_EXIT (esperado: exit 1 EXATO de violação"
  fail "de referência). Exit diferente = falha de infra no fixture."
  exit 1
fi

# Caso 3 — falhou, mas NÃO pela asserção esperada (outro invariante quebrou).
if ! grep -Fq "$EXPECTED_FAILURE_TRANSITIVE" <<< "$GUARD_OUTPUT"; then
  fail "Guard falhou (exit $GUARD_EXIT) mas NÃO pela asserção transitiva esperada:"
  fail "  esperava:  $EXPECTED_FAILURE_TRANSITIVE"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

# Caso 4 — defensivo: a violação deve citar a ENTRY pelo nome (não outra
# ref do mesmo fixture).
if ! grep -Fq "$TRANSITIVE_ENTRY" <<< "$GUARD_OUTPUT"; then
  fail "Guard falhou (exit $GUARD_EXIT) mas NÃO citou a entry mutada:"
  fail "  esperava:  linha contendo '$TRANSITIVE_ENTRY'"
  fail "A violação apontou outra ref — veja o output acima."
  exit 1
fi

# Caso 5 — defensivo (defense-in-depth, padrão do mutation-jobs: assertar a
# mensagem E o artefato mutado): a violação deve citar também o ALVO deletado
# pelo nome — prova que o guard resolveu a entry → alvo e apontou o script
# específico (não uma entry certa com o alvo errado).
if ! grep -Fq "$TRANSITIVE_TARGET" <<< "$GUARD_OUTPUT"; then
  fail "Guard falhou (exit $GUARD_EXIT) mas NÃO citou o alvo deletado:"
  fail "  esperava:  linha contendo '$TRANSITIVE_TARGET'"
  fail "A violação citou a entry mas não o alvo — veja o output acima."
  exit 1
fi

pass "Mutação 1 DETECTADA: guard falhou (exit 1) com '❌ $EXPECTED_FAILURE_TRANSITIVE' citando a entry '$TRANSITIVE_ENTRY' → alvo '$TRANSITIVE_TARGET'"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6+7 — MUTAÇÃO 2 (interna --pkg-internal): entry órfã de workflow
# com alvo DELETADO — o modo default PASSA, o --pkg-internal FALHA
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Re-criando fixture limpo e aplicando mutação 2 (entry órfã + alvo deletado)..."
build_fixture

# Adiciona a entry órfã `local:tools` (NENHUM workflow a referencia — ex.:
# hook local/manual) + o script alvo dela. Em seguida DELETA o script: só o
# modo --pkg-internal enxerga (o scan workflow-only valida apenas entries
# REFERENCIADAS por um workflow).
#
# ⚠️ Sem node aqui de propósito: $TMP_DIR do mktemp do MSYS é um path
# estilo /tmp/... que o node do Windows resolve como C:\tmp\... (ENOENT).
# Heredoc + grep (como no resto do script) evitam a conversão de path.
cat > "$TMP_DIR/package.json" <<'EOF'
{
  "scripts": {
    "bench:geo": "node scripts/run-benchmark.mjs --type geo",
    "local:tools": "bash scripts/helper.sh --ci"
  }
}
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP_DIR/scripts/$ORPHAN_TARGET"
rm -f "$TMP_DIR/scripts/$ORPHAN_TARGET"

# Fail-fast: verifica que a mutação realmente aplicou (entry órfã no
# package.json + script alvo ausente em scripts/).
if grep -Fq "$ORPHAN_ENTRY" "$TMP_DIR/package.json" && [ ! -f "$TMP_DIR/scripts/$ORPHAN_TARGET" ]; then
  pass "Mutação 2 aplicada: entry órfã '$ORPHAN_ENTRY' sem o alvo scripts/$ORPHAN_TARGET"
else
  fail "Mutação 2 não aplicou (cat/printf falhou?)."
  exit 1
fi

info "STEP 6: Rodando guard DEFAULT contra o fixture — deve PASS (exit 0)..."
set +e
DEFAULT_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
DEFAULT_EXIT=$?
set -e

echo "$DEFAULT_OUTPUT" | tail -8

# O modo DEFAULT NÃO deve ver a entry órfã (workflow-only): a falha precisa
# vir do --pkg-internal, não do scan de workflows. Se o default falhar, o
# fixture (ou o guard) não reflete o contrato — o teste para com diagnóstico.
if [ "$DEFAULT_EXIT" -ne 0 ]; then
  fail "GUARD DEFAULT FALHOU (exit $DEFAULT_EXIT) com entry órfã — mas o"
  fail "scan workflow-only NÃO deveria enxergar '$ORPHAN_ENTRY' (órfã de"
  fail "workflow). O fixture/guard não reflete o contrato — veja o output."
  echo "$DEFAULT_OUTPUT" | tail -10
  exit 1
fi
pass "Guard default OK — entry órfã invisível ao workflow-only (exit 0): o modo --pkg-internal é necessário"

info "STEP 7: Rodando guard --pkg-internal contra o fixture — deve FALHAR..."
set +e
INTERNAL_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" --pkg-internal 2>&1)"
INTERNAL_EXIT=$?
set -e

echo "$INTERNAL_OUTPUT" | tail -12

# Caso 1 — guard CEGO: PASS com a entry órfã de alvo deletado. A consistência
# interna foi removida/enfraquecida (main() sem o bloco --pkg-internal ou
# checkPkgInternalTargets sem o loop).
if [ "$INTERNAL_EXIT" -eq 0 ]; then
  fail "GUARD CEGO (interno): check-workflow-refs --pkg-internal passou com a"
  fail "entry órfã '$ORPHAN_ENTRY' invocando scripts/$ORPHAN_TARGET inexistente"
  fail "(exit 0). Verifique se o modo --pkg-internal ainda existe em"
  fail "scripts/check-workflow-refs.mjs."
  exit 1
fi

# Caso 2 — EXIT CODE EXATO: falha deve ser exit 1 (violação de referência).
if [ "$INTERNAL_EXIT" -ne 1 ]; then
  fail "Guard --pkg-internal falhou com exit $INTERNAL_EXIT (esperado: exit 1"
  fail "EXATO de violação). Exit diferente = falha de infra no fixture."
  exit 1
fi

# Caso 3 — falhou, mas NÃO pela asserção interna esperada.
if ! grep -Fq "$EXPECTED_FAILURE_INTERNAL" <<< "$INTERNAL_OUTPUT"; then
  fail "Guard --pkg-internal falhou (exit $INTERNAL_EXIT) mas NÃO pela asserção"
  fail "interna esperada:"
  fail "  esperava:  $EXPECTED_FAILURE_INTERNAL"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

# Caso 4 — defensivo: a violação deve citar a ENTRY órfã pelo nome.
if ! grep -Fq "$ORPHAN_ENTRY" <<< "$INTERNAL_OUTPUT"; then
  fail "Guard --pkg-internal falhou (exit $INTERNAL_EXIT) mas NÃO citou a entry"
  fail "órfã mutada:"
  fail "  esperava:  linha contendo '$ORPHAN_ENTRY'"
  fail "A violação apontou outra entry — veja o output acima."
  exit 1
fi

pass "Mutação 2 DETECTADA: guard --pkg-internal falhou (exit 1) com '❌ $EXPECTED_FAILURE_INTERNAL' citando a entry '$ORPHAN_ENTRY'"

# ═════════════════════════════════════════════════════════════════════════
# STEP 8 — CENÁRIO 3a: o stripping do COMENTÁRIO DE FIM DE LINHA (M1)
#
# A fixture é a do defeito que a regra fecha: a ref vive num COMENTÁRIO, que a
# pipeline nunca executa. Com a regra, o guard não vê ref nenhuma e passa; sem
# a regra, ele vê a ref morta e ACUSA. É a direção que a mutação mede — e a
# asserção é um FALSO POSITIVO (não o `CEGO` do resto do arquivo).
# ═════════════════════════════════════════════════════════════════════════

info "STEP 8: Fixture com COMENTÁRIO de fim de linha → CONTROLE A (guard REAL deve PASSAR)..."

mkfixture_wf <<'EOF'
jobs:
  refs:
    runs-on: ubuntu-latest
    steps:
      - name: passo com comentario de fim de linha
        run: echo ok # node scripts/ghost-comentario.mjs
EOF

rodar_guard_fixture

if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "CONTROLE FALSO: o guard REAL reprovou a fixture do comentário (exit $GUARD_EXIT)."
  fail "Sem o controle verde, o vermelho do mutado não prova nada."
  echo "$GUARD_OUT" | tail -12
  exit 1
fi
# A segunda metade do controle: a ref do comentário NÃO pode ter aparecido no
# veredito. Um "exit 0" sozinho não diria se o guard ignorou o comentário ou se
# simplesmente não olhou a linha.
if grep -Fq "$GHOST_COMENT" <<<"$GUARD_OUT"; then
  fail "CONTROLE FALSO: o guard REAL citou a ref do comentário ('$GHOST_COMENT') na saída"
  fail "de um exit 0 — a fixture não separa "comentário ignorado" de outra coisa."
  exit 1
fi
pass "Controle A OK — o comentário não vira ref (exit 0, e '$GHOST_COMENT' fora do veredito)"

info "STEP 8b: MUTAÇÃO 3 (M1 — regra de comentário REMOVIDA) → o guard deve ACUSAR o código morto..."

mutar_regua "$SCANN_LINE" "$M1_NOVO"
pass "Mutação 3 aplicada na RÉGUA: o stripping de comentário de fim de linha foi removido"

rodar_guard_fixture

# O veredito do mutado tem de ser EXIT 1 citando a ref do comentário NA LINHA
# do comentário — as duas metades são exigidas pelo helper (um vermelho por
# outro motivo seria um mutante morto lido como prova).
echo "$GUARD_OUT" | tail -8

exigir_falso_positivo "M1 — stripping de comentário REMOVIDO" "$GHOST_COMENT" "$LINHA_COMENT"
pass "Mutação 3 DETECTADA: sem o stripping, o guard ACUSOU a ref do comentário ('$GHOST_COMENT', pr-check.yml:$LINHA_COMENT) — o veredito deixa de ser sobre o que EXECUTA"

restaurar_originais
pass "fontes RESTAURADAS (os dois checksums conferem)"

info "STEP 8c: CONTROLE B — com a régua restaurada, o comentário volta a ser ignorado..."

rodar_guard_fixture

if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "CONTROLE B FALHOU: régua restaurada reprovou a fixture do comentário (exit $GUARD_EXIT)."
  echo "$GUARD_OUT" | tail -12
  exit 1
fi
pass "Controle B OK — régua restaurada volta a PASSAR (o comentário não é referência)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 9 — CENÁRIO 3b: a ÂNCORA de espaço da RÉGUA (`(^|\s)#`) — M2
#
# A fixture tem a ref invocada de VERDADE, com o `#` DENTRO de aspas: em shell, o
# `#` entre aspas (e sem espaço antes) não inicia comentário — a linha EXECUTA a
# invocação. A regra real preserva a ref (o guard reprova o script fantasma);
# tirando a âncora, a regra corta no `#` e o guard PERDE uma ref que executa.
# ═════════════════════════════════════════════════════════════════════════

info "STEP 9: Fixture com '#' DENTRO de aspas → CONTROLE A (guard REAL deve REPROVAR a ref real)..."

mkfixture_wf <<'EOF'
jobs:
  refs:
    runs-on: ubuntu-latest
    steps:
      - name: jogo de aspas com # sem espaco antes
        run: echo "a#b" ; node scripts/ghost-real.mjs
EOF

rodar_guard_fixture

echo "$GUARD_OUT" | tail -8

exigir_falha_com "CONTROLE A do '# dentro de aspas'" "$GHOST_REAL" "$LINHA_ASPAS"
pass "Controle A OK — o guard REAL mede a ref que EXECUTA (exit 1 citando '$GHOST_REAL')"

info "STEP 9b: MUTAÇÃO 4 (M2 — a régua perde a ÂNCORA de espaço) → o guard deve ficar CEGO..."

mutar_regua "$SCANN_LINE" "$M2_NOVO"
pass "Mutação 4 aplicada na RÉGUA: a regra corta em qualquer '#', sem a âncora (^|\\s)"

rodar_guard_fixture

exigir_cego "M2 — regra sem a âncora de espaço" "O guard mutado cortou no '#' de dentro das aspas, perdeu a ref que executa e APROVOU uma referência quebrada."
pass "Mutação 4 DETECTADA: sem a âncora, o guard ficou CEGO na ref que EXECUTA (exit 0 com '$GHOST_REAL' ausente)"

restaurar_originais
pass "fontes RESTAURADAS (os dois checksums conferem)"

info "STEP 9c: CONTROLE B — com o guard restaurado, a ref real volta a ser reprovada..."

rodar_guard_fixture

exigir_falha_com "CONTROLE B do '# dentro de aspas'" "$GHOST_REAL" "$LINHA_ASPAS"
pass "Controle B OK — régua restaurada volta a reprovar a ref real (exit 1)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT — restaura o guard e remove os temps)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard de refs pega os DOIS drifts (transitivo workflow→entry→script + consistência interna --pkg-internal) E a RÉGUA ÚNICA de linha é load-bearing nos DOIS sentidos (removida: acusa código morto; sem a âncora de espaço: fica CEGA na ref que executa)"
exit 0
