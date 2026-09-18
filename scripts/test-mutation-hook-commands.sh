#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-hook-commands.sh — Mutation test do guard dos comandos
# que os HOOKS executam (scripts/check-hook-commands.mjs)
#
# Usage:
#   ./scripts/test-mutation-hook-commands.sh
#
# Exit codes:
#   0 — as ONZE mutações foram DETECTADAS (pelo gate, pelo ARQUIVO e/ou pela
#       suíte) e os controles passaram ✅
#   1 — guard INDIFERENTE a alguma mutação (não cegou / não acusou / não gravou)
#       OU controle falso ❌
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
# O REMENDO (`--fix`) TEM AS SUAS QUATRO REGRAS, e cada uma tem mutação própria —
# é a metade do guard que GRAVA, e um remendo que adivinha é pior que nenhum
# remendo (ele muda o que roda em todo commit):
#
#   M5 — A UNICIDADE do vizinho. Dois candidatos à mesma distância não são uma
#        escolha: são uma dúvida, e quem decide é o operador. Aceitar o primeiro
#        da lista (a mutação) faz o remendo gravar um nome que ele sorteou.
#   M6 — O TETO de distância. A mensagem do guard SUGERE um vizinho com teto 4
#        (um aviso errado custa uma leitura); o remendo GRAVA só até 2. Sem o
#        teto, o remendo troca o caminho por um parente distante.
#   M7 — A CONFIRMAÇÃO. Sem `--yes` e sem terminal de controle o remendo NÃO
#        pergunta e NÃO grava (fail-closed): o stdin do `git commit` é
#        `/dev/null` e perguntar ali penduraria o commit. Autorizar sem perguntar
#        (a mutação) grava o que ninguém autorizou.
#   M8 — O ESCOPO DO TOKEN. O token de um comando INTERNO (o que uma entrada de
#        `bun run` executa) vive no TEXTO do script do package.json, e a linha do
#        relatório é a do hook. A fixture tem a COINCIDÊNCIA (o mesmo token na
#        mesma linha, dentro de um comentário): sem a regra, o remendo reescreve o
#        comentário por causa de um defeito de outro arquivo. Aqui o exit code é o
#        MESMO nos dois casos (a violação de verdade continua lá) — a testemunha é
#        o CONTEÚDO do arquivo, e isso é declarado em vez de escondido.
#
# A DESCIDA TEM AS SUAS TRÊS REGRAS, e cada uma tem mutação própria — é a metade
# do guard que julga o que os scripts CHAMADOS pelos hooks executam por dentro
# (o hook real chama UM runner que chama os outros 17 guards):
#
#   M9  — a DESCIDA. Parar no alvo do `bash` deixa uma linha tipada DENTRO do
#         runner como o mesmo passo-que-nunca-roda — e o guard fica verde (CEGO)
#         com o defeito num arquivo que roda em todo commit.
#   M10 — O ESCOPO DAS FUNÇÕES de um script EXECUTADO. `bash x.sh` cria um
#         processo NOVO (a função do hook não existe lá dentro); herdar sempre
#         faz um `command not found` garantido passar como resolvido.
#   M11 — os PADRÕES de um `case`. Sem a régua, o `-h|--help)` de um script bem
#         escrito vira violação e o repositório REAL fica VERMELHO — direção
#         contrária (como o M4): o defeito da mutação é acusar o são.
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
#   6b. MUTAÇÃO M5 (o EMPATE) — o remendo grava um candidato SORTEADO, onde ele
#      tem de recusar
#   6c. MUTAÇÃO M6 (o TETO) — o remendo grava um vizinho distante demais
#   6d. MUTAÇÃO M7 (a CONFIRMAÇÃO) — o remendo grava sem `--yes` e sem terminal
#   6e. MUTAÇÃO M8 (o ESCOPO do token) — o remendo reescreve um COMENTÁRIO do
#      hook por causa de um defeito que vive no package.json
#   6f. MUTAÇÃO M9 (a DESCIDA) — o caminho tipado DENTRO do script chamado passa
#      a sair verde
#   6g. MUTAÇÃO M10 (o ESCOPO das funções) — o nome que o shell nunca acharia
#      passa a resolver dentro do script executado
#   6h. MUTAÇÃO M11 (a régua do `case`) — o repositório REAL passa a ser acusado
#      pelos padrões `-h|--help)` de um script bem escrito
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
FX_EMPATE="$TMP_DIR/fx-empate"
FX_LONGE="$TMP_DIR/fx-longe"
FX_CONF="$TMP_DIR/fx-conf"
FX_OUTRO="$TMP_DIR/fx-outro"

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

# ── rodar_fix: o REMENDO pelo CLI (o mesmo caminho do hook, sem tty) ───────
# Devolve exit e saída em FIX_EXIT / FIX_OUT (globais). O stdin vai em
# `/dev/null` de propósito: é o caso MEDIDO do `git commit` (o git entrega ao
# hook o fd 0 assim), e é ele que separa "pergunto no terminal de controle" de
# "pergunto a um terminal onde ninguém está".
rodar_fix() {
  local raiz="$1"
  shift
  set +e
  FIX_OUT="$(node "$GUARD" --root "$raiz" "$@" < /dev/null 2>&1)"
  FIX_EXIT=$?
  set -e
}

# ── arquivo_igual: o arquivo está EXATAMENTE como o esperado? ─────────────
# Em BYTES e sem passar por `$( ... )` (a substituição come o newline final, e o
# newline final é justamente o que mais some numa escrita acidental). `cmp` com
# o conteúdo esperado vindo de um `printf` é o que separa "recusou" de "gravou".
# Espera: $1 = caminho, $2 = conteúdo byte a byte.
arquivo_igual() {
  cmp -s <(printf '%s' "$2") "$1"
}

# ── exigir_sem_remendo: o remendo NÃO escreveu onde ele não pode ──────────
# Mede as DUAS metades: o veredito (não-zero) e o ARQUIVO (byte a byte igual).
# Só o exit code não basta: um remendo que grava e depois acusa o que sobrou sai
# não-zero igual a um que recusou — e é o ARQUIVO que diz qual dos dois houve.
exigir_sem_remendo() {
  local cenario="$1" raiz="$2" antes="$3"
  rodar_fix "$raiz" --fix --yes
  if [ "$FIX_EXIT" -eq 0 ]; then
    fail "$cenario: o remendo saiu 0 onde tinha de recusar — ele ADIVINHOU"
    echo "$FIX_OUT" | head -6 | sed 's/^/      /'
    exit 1
  fi
  if ! arquivo_igual "$raiz/.husky/pre-commit" "$antes"; then
    fail "$cenario: o remendo RECUSOU mas escreveu no arquivo assim mesmo"
    exit 1
  fi
}

# ── exigir_remendo_cego: a mutação fez o remendo GRAVAR o que ele recusa ──
# É a medição na direção do remendo: sem a regra mutada o arquivo sai do lugar
# (e, na M7, até o veredito sai 0 — sem pergunta nenhuma).
exigir_remendo_cego() {
  local cenario="$1" raiz="$2" antes="$3"
  shift 3
  rodar_fix "$raiz" "$@"
  if arquivo_igual "$raiz/.husky/pre-commit" "$antes"; then
    fail "$cenario: a mutação NÃO mudou o comportamento — a regra mutada não sustenta nada"
    echo "$FIX_OUT" | head -6 | sed 's/^/      /'
    exit 1
  fi
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

# ── mk_arquivo: escreve UM arquivo do fixture, byte a byte ────────────────
# A descida precisa de um SCRIPT chamado com conteudo proprio (o runner que
# chama outro guard), e não só do hook: sem este helper o fixture teria de
# repetir `mkdir`/`printf` em cada cenário.
mk_arquivo() {
  local raiz="$1" rel="$2" corpo="$3"
  mkdir -p "$raiz/$(dirname "$rel")"
  printf '%s' "$corpo" > "$raiz/$rel"
}

# ── mkfix: fixture do REMENDO — o typo, o VIZINHO e as âncoras do guard ────
# O remendo precisa de um vizinho REAL (é ele que o vizinho mais próximo
# encontra) e das duas âncoras do guard (`.husky/` e `package.json`). O terceiro
# argumento é o `package.json` inteiro, para o caso do token que vive em OUTRO
# arquivo (o comando interno de um `bun run`).
mkfix() {
  local raiz="$1" hook="$2" pkg="$3"
  shift 3
  mkdir -p "$raiz/.husky" "$raiz/scripts"
  printf '%s' "$hook" > "$raiz/.husky/pre-commit"
  printf '%s' "$pkg" > "$raiz/package.json"
  for vizinho in "$@"; do printf '// vizinho\n' > "$raiz/scripts/$(basename "$vizinho")"; done
}

PKG_SIMPLES='{ "name": "fx-remendo", "scripts": {} }'

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

# ── 6b. MUTAÇÃO M5: o EMPATE de vizinhos é RECUSA, não escolha ────────────
header "MUTAÇÃO M5: aceitar QUALQUER um dos empatados"
HOOK_EMPATE=$'set -eu\nnode scripts/abc.mjs\n'
mkfix "$FX_EMPATE" "$HOOK_EMPATE" "$PKG_SIMPLES" scripts/abd.mjs scripts/abe.mjs
exigir_sem_remendo "M5 (antes da mutação)" "$FX_EMPATE" "$HOOK_EMPATE"
pass "CONTROLE: o empate é RECUSADO — dois candidatos plausíveis e o arquivo intacto"
mutar_guard \
  '  if (melhores.length > 1) return { aceito: null, ambiguos: melhores }' \
  '  if (false /* MUTACAO M5 */) return { aceito: null, ambiguos: melhores }'
exigir_remendo_cego "M5" "$FX_EMPATE" "$HOOK_EMPATE" --fix --yes
pass "M5: com o empate aceito, o remendo GRAVA o candidato que ele sorteou (CEGO) — a unicidade é load-bearing"
exigir_suite_vermelha "M5"
restaurar_original

# ── 6c. MUTAÇÃO M6: o TETO de distância (o remendo não grava sugestão) ────
header "MUTAÇÃO M6: aceitar um vizinho LONGE demais"
HOOK_LONGE=$'set -eu\nnode scripts/uma-coisa-bem-diferente.mjs\n'
mkfix "$FX_LONGE" "$HOOK_LONGE" "$PKG_SIMPLES" scripts/outra.mjs
exigir_sem_remendo "M6 (antes da mutação)" "$FX_LONGE" "$HOOK_LONGE"
pass "CONTROLE: o vizinho fora do teto é RECUSADO (a mensagem sugere; o remendo não grava sugestão)"
mutar_guard \
  '  if (melhor > FIX_MAX_DISTANCE) return { aceito: null, ambiguos: [] }' \
  '  if (false /* MUTACAO M6 */) return { aceito: null, ambiguos: [] }'
exigir_remendo_cego "M6" "$FX_LONGE" "$HOOK_LONGE" --fix --yes
pass "M6: sem o teto, o remendo troca o caminho por um PARENTE distante (CEGO) — o teto é load-bearing"
exigir_suite_vermelha "M6"
restaurar_original

# ── 6d. MUTAÇÃO M7: a CONFIRMAÇÃO (fail-closed sem terminal) ──────────────
header "MUTAÇÃO M7: autorizar sem confirmar"
HOOK_CONF=$'set -eu\nnode scripts/check-bun-mirrorX.mjs --staged &\n'
mkfix "$FX_CONF" "$HOOK_CONF" "$PKG_SIMPLES" scripts/check-bun-mirror.mjs
# Sem `--yes` e sem terminal: o remendo NÃO pergunta e NÃO grava.
rodar_fix "$FX_CONF" --fix
if [ "$FIX_EXIT" -eq 0 ] || ! arquivo_igual "$FX_CONF/.husky/pre-commit" "$HOOK_CONF"; then
  fail "M7 (antes da mutação): sem terminal o remendo gravou (exit $FIX_EXIT) — fail-closed quebrado na árvore íntegra"
  echo "$FIX_OUT" | head -6 | sed 's/^/      /'
  exit 1
fi
pass "CONTROLE: sem terminal e sem --yes o remendo NÃO grava (exit 1, arquivo intacto)"
mutar_guard \
  '  if (yes) return { autorizado: true, motivo: "--yes: a confirmação já foi dada por quem chama" }' \
  '  if (true /* MUTACAO M7 */) return { autorizado: true, motivo: "--yes: a confirmação já foi dada por quem chama" }'
exigir_remendo_cego "M7" "$FX_CONF" "$HOOK_CONF" --fix
pass "M7: com a confirmação mutada, o remendo GRAVA sem perguntar a ninguém (CEGO) — o fail-closed é load-bearing"
exigir_suite_vermelha "M7"
restaurar_original

# ── 6e. MUTAÇÃO M8: o token que vive em OUTRO arquivo ────────────────────
# A linha de um comando INTERNO (o que uma entrada de `bun run` executa) é a
# linha 1 do TEXTO do script (o resolvedor NORMALIZA o texto da entrada, então
# essa linha é sempre a primeira). A coincidência aqui é REAL: o hook tem o MESMO
# token na linha 1 (dentro de um comentário). Sem a regra, o remendo acha essa
# ocorrência e reescreve o comentário por causa de um defeito que vive no
# package.json. O exit code continua 1 nos dois casos (a violação de verdade
# segue lá), então a testemunha aqui é o ARQUIVO — declarado.
header "MUTAÇÃO M8: remendar o token de OUTRO arquivo"
HOOK_OUTRO=$'# node scripts/typo.mjs\nbun run x\n'
PKG_OUTRO='{ "name": "fx-remendo", "scripts": { "x": "node scripts/typo.mjs" } }'
# O vizinho existe ao lado (`tipo.mjs`, a UMA edição de `typo.mjs`): é ele que o
# remendo encontraria se a regra do escopo não estivesse lá — a coincidência do
# comentário só morde porque há um candidato aceitável para o token.
mkfix "$FX_OUTRO" "$HOOK_OUTRO" "$PKG_OUTRO" scripts/tipo.mjs
exigir_sem_remendo "M8 (antes da mutação)" "$FX_OUTRO" "$HOOK_OUTRO"
pass "CONTROLE: a violação que vive no package.json é RECUSADA (o hook fica byte a byte)"
mutar_guard \
  '    if (origem !== "" && origem !== "substituição") {' \
  '    if (false /* MUTACAO M8 */) {'
exigir_remendo_cego "M8" "$FX_OUTRO" "$HOOK_OUTRO" --fix --yes
pass "M8: sem a regra, o remendo REESCREVE O COMENTÁRIO do hook (CEGO) — o escopo do token é load-bearing"
exigir_suite_vermelha "M8"
restaurar_original

# ── 6f. MUTAÇÃO M9: a DESCIDA nos scripts de shell que o hook chama ───────
# O hook real não lista os 17 guards: ele chama UM runner
# (`bash scripts/run-encoding-guards.sh`) que chama os outros. Parar no ALVO do
# `bash` deixa um caminho tipado DENTRO do runner como o mesmo
# passo-que-nunca-roda — invisível, num arquivo que roda em todo commit. A
# mutação desliga a descida e exige que o guard fique CEGO ao defeito interno.
header "MUTAÇÃO M9: parar no alvo do \`bash\` (não descer no script chamado)"
FX_DESCIDA="$TMP_DIR/fx-descida"
HOOK_DESCIDA=$'set -eu\nbash scripts/run-ci.sh\n'
mkfix "$FX_DESCIDA" "$HOOK_DESCIDA" "$PKG_SIMPLES"
mk_arquivo "$FX_DESCIDA" "scripts/run-ci.sh" $'#!/usr/bin/env bash\nnode scripts/check-utf8-scopez.mjs\n'
mk_arquivo "$FX_DESCIDA" "scripts/check-utf8-scope.mjs" '// vizinho, a UMA edicao do token\n'
exigir_reprovado "M9 (antes da mutação)" "$FX_DESCIDA"
pass "CONTROLE: o caminho tipado DENTRO do script chamado é VIOLAÇÃO (o guard DESCE)"
mutar_guard \
  '      const alvo = scriptAlvo(comando)' \
  '      const alvo = null /* MUTACAO M9 */'
exigir_cego "M9" "$FX_DESCIDA"
pass "M9: sem a descida, o defeito DENTRO do runner PASSA (CEGO) — a descida é load-bearing"
exigir_reprovado "M9 cirúrgica (caminho NO hook)" "$FX_TYPO"
pass "M9 CIRÚRGICA: o caminho tipado NO hook segue reprovado — morreu só a descida"
exigir_suite_vermelha "M9"
restaurar_original

# ── 6g. MUTAÇÃO M10: as FUNÇÕES VISÍVEIS de um script EXECUTADO ───────────
# `bash script.sh` cria um processo NOVO: a função do hook NÃO existe lá dentro.
# Herdar sempre (a mutação) faz um `command not found` garantido passar como
# resolvido — o defeito que este guard existe para pegar, agora dentro do script.
header "MUTAÇÃO M10: herdar as funções do hook num script EXECUTADO"
FX_ESCOPO="$TMP_DIR/fx-escopo"
HOOK_ESCOPO=$'minha_funcao() {\n  echo ok\n}\nbash scripts/x.sh\n'
mkfix "$FX_ESCOPO" "$HOOK_ESCOPO" "$PKG_SIMPLES"
mk_arquivo "$FX_ESCOPO" "scripts/x.sh" $'#!/usr/bin/env bash\nminha_funcao\n'
exigir_reprovado "M10 (antes da mutação)" "$FX_ESCOPO"
pass "CONTROLE: a função do hook NÃO existe no script executado — VIOLAÇÃO"
mutar_guard \
  '        funcoes: SOURCE_COMMANDS.has(comando.programa)
          ? new Set([...funcoes, ...definedFunctions(texto)])
          : new Set(definedFunctions(texto)),' \
  '        funcoes: new Set([...funcoes, ...definedFunctions(texto)]), /* MUTACAO M10 */'
exigir_cego "M10" "$FX_ESCOPO"
pass "M10: com a herança, o nome que o shell nunca acharia PASSA (CEGO) — o escopo é load-bearing"
exigir_reprovado "M10 cirúrgica (caminho NO hook)" "$FX_TYPO"
pass "M10 CIRÚRGICA: o caminho tipado NO hook segue reprovado — morreu só o escopo"
exigir_suite_vermelha "M10"
restaurar_original

# ── 6h. MUTAÇÃO M11: os PADRÕES de um `case` não são comandos ────────────
# A direção aqui é a CONTRÁRIA (como o M4): sem a régua do `case`, o guard não
# fica cego — ele passa a ACUSAR o `-h|--help)` de um script bem escrito, e o
# hook REAL vira vermelho. Um guard que reprova o repositório por um padrão
# correto é desligado pela equipe no primeiro dia.
header "MUTAÇÃO M11: julgar os PADRÕES de um \`case\` como comandos"
mutar_guard \
  '    if (estado === "padrao") {' \
  '    if (false /* MUTACAO M11 */) {'
rodar_guard_real
if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "M11: o guard seguiu VERDE no hook real — a régua do \`case\` não sustenta o verde do repositório"
  exit 1
fi
pass "M11: o repositório real passa a ser ACUSADO (exit $GUARD_EXIT) — a régua do \`case\` é o que sustenta o verde"
mostrar
exigir_reprovado "M11 cirúrgica (caminho que não existe)" "$FX_TYPO"
pass "M11 CIRÚRGICA: as fixtures de defeito seguem reprovadas — morreu só a régua do \`case\`"
exigir_suite_vermelha "M11"
restaurar_original

# ── 7. CONTROLE FINAL: a árvore ficou como estava ─────────────────────────
header "CONTROLE FINAL: restauração verificada por checksum"
exigir_reprovado "CONTROLE FINAL (caminho tipado)" "$FX_TYPO"
pass "CONTROLE FINAL: o guard restaurado volta a reprovar o caminho tipado"

echo
echo -e "${GREEN}═══ MUTATION TEST PASSED — as 11 mutações foram detectadas (gate, arquivo e/ou suíte) ═══${NC}"
