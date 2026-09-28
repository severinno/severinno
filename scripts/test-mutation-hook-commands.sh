#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-hook-commands.sh — Mutation test do guard dos comandos
# que os HOOKS executam (scripts/check-hook-commands.mjs)
#
# Usage:
#   ./scripts/test-mutation-hook-commands.sh
#
# Exit codes:
#   0 — as VINTE E SETE mutações foram DETECTADAS (pelo gate, pelo ARQUIVO e/ou pela
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
# A CLASSE DE UM ALVO É UMA SÓ (`classeDoAlvo`), e ela tem DUAS mutações próprias
# (M26–M27) — é a régua que faz o alvo LITERAL e o valor PROVADO por variável
# responderem igual, em vez de o segundo ser julgado só pela EXISTÊNCIA:
#
#   M26 — o valor ABSOLUTO. `/etc/hosts` numa atribuição não promete estar no
#         repositório (`bash "$ALVO"` com `ALVO="/etc/hosts"` roda um binário de
#         FORA dele): a mesma régua do literal o resolve como "caminho absoluto
#         fora do repositório", e a mutação que o julga pela existência ACUSA O
#         SÃO (direção contrária, como M4/M11/M12/M23/M24).
#   M27 — o valor de PADRÃO. `scripts/*.sh` nomeia um CONJUNTO, não um arquivo: o
#         literal o resolve como `indeterminado` ("padrão, não um caminho") e
#         exige a decisão datada. Julgá-lo pela existência era pior que inútil —
#         a mensagem acusava "NÃO existe no repositório" e ainda SUGERIA um
#         vizinho (`a.sh`), que é a distância entre um glob e um nome. A mutação
#         aceita o padrão como caminho PROVADO e o guard fica CEGO.
#
# AS VARIÁVEIS DE CAMINHO TÊM AS SUAS TRÊS REGRAS, e cada uma tem mutação própria —
# é a metade do guard que PROVA o alvo do interpretador (`python3
# "$PYTHON_SCRIPT"`) em vez de declará-lo:
#
#   M12 — a RESOLUÇÃO. Sem ela, `$PYTHON_SCRIPT` / `$SCRIPT_DIR/x` / `$PY` voltam
#         a ser indeterminados — e as entradas de INDETERMINATE que os cobriam
#         foram REMOVIDAS quando a prova entrou. O repositório REAL fica VERMELHO
#         (direção contrária, como o M4 e o M11): é a resolução que sustenta o
#         verde.
#   M13 — a EXISTÊNCIA dos valores prováveis. A resolução é uma promessa sobre o
#         DISCO: sem a conferência, a variável que aponta para um arquivo
#         inexistente passa como resolvida (o passo que nunca roda, com a bênção
#         do gate).
#   M14 — o FAIL-CLOSED da resolução. Se UMA atribuição da variável não é
#         provável, a variável INTEIRA é irresolúvel (um valor que o guard não leu
#         pode ser o que roda). Descartar a atribuição ilegível e ficar com as que
#         sobraram é provar uma PARTE e chamar de todo.
#
# A ENTRADA DE `bun run` MONTADA EM VARIÁVEL TEM AS SUAS DUAS REGRAS, e cada uma
# tem mutação própria — é a metade do guard que prova o NOME que a variável
# carrega, em vez de declará-lo:
#
#   M15 — a EXISTÊNCIA da entrada provável. O valor que a variável pode tomar tem
#         de ser uma entrada de `scripts` (ou um binário de dependência, ou o
#         subcomando nativo na forma sem `run`): sem isso a entrada REMOVIDA no
#         mesmo commit passa com a bênção do gate. Antes desta régua a classe
#         inteira era uma decisão datada em INDETERMINATE, e a isenção cobria a
#         entrada que existe e a que sumiu com o MESMO silêncio.
#   M16 — a DESCIDA na entrada provável. Provar que o NOME existe não é provar que
#         o que ele EXECUTA resolve: sem a descida, a entrada que aponta para um
#         arquivo removido fica um nível adiante do verde.
#
# E A DESCIDA TEM UMA REGRA A MAIS, com mutação própria — a que a fez seguir o
# alvo que a RESOLUÇÃO acabou de provar:
#
#   M17 — o alvo PROVADO por variável. `bash "$SCRIPT_DIR/x.sh"` saía
#         `resolvido` (o caminho foi provado por leitura) e o interior do x.sh
#         não era julgado por ninguém: a metade mais útil do guard desligada
#         justamente onde o caminho é mais indireto. Sem a resolução do alvo, o
#         defeito DENTRO do script provado passa.
#
# E AS DUAS RECUSAS QUE EXISTEM PARA O VERDE NÃO VIR DE UM CONJUNTO QUE O GUARD
# NÃO LEU — o teto de combinações e o valor vazio — também têm mutação própria:
#
#   M18 — o valor VAZIO. `""` não é caminho nem nome, e o guard o resolveria por
#         ACIDENTE: `binInstalado(root, "")` é o DIRETÓRIO `node_modules/.bin`
#         (`join(root, "node_modules", ".bin", "")`), que existe em qualquer
#         checkout instalado — e um `bun run "$ENTRADA"` cuja entrada pode ser
#         vazia sairia VERDE. MEDIDO: sem a regra, exit 0.
#   M19 — o TETO de combinações. Acima de `MAX_VALORES` o conjunto provável não
#         foi enumerado, e prová-lo seria uma leitura que não aconteceu: o verde
#         viria do tamanho, não do disco. A fixture é gerada a partir do próprio
#         `MAX_VALORES` (TETO + 1 valores, todos existentes), para o número não
#         virar uma segunda fonte de verdade.
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
#   6i. MUTAÇÃO M12 (a RESOLUÇÃO das variáveis de caminho) — o repositório REAL
#      passa a ser acusado nos `check-*.sh` (as decisões datadas já não cobrem
#      esses comandos)
#   6j. MUTAÇÃO M13 (a existência do alvo PROVADO) — a variável que aponta para um
#      arquivo inexistente passa a sair verde
#   6k. MUTAÇÃO M14 (o fail-closed da resolução) — descartar a atribuição
#       ilegível faz o guard provar a metade que sobrou
#   6l. MUTAÇÃO M15 (a entrada provável de `bun run "$ENTRADA"`) — aceitar a
#       entrada ausente faz a que foi REMOVIDA passar
#   6m. MUTAÇÃO M16 (a descida na entrada provável) — parar no NOME faz o defeito
#       que a entrada executa ficar um nível adiante do verde
#   6n. MUTAÇÃO M17 (o alvo PROVADO por variável) — sem resolver o `$ALVO` da
#       chamada, o interior do script provado deixa de ser julgado
#   6o. MUTAÇÃO M18 (o valor VAZIO) — o vazio aceito como valor faz o comando
#       (que o runtime executaria com `""`) sair VERDE
#   6p. MUTAÇÃO M19 (o TETO de combinações) — enumerar mais do que o teto permite
#       faz o guard provar um conjunto que ele não leu
#   6q. MUTAÇÃO M20 (o CONGELAMENTO do diretório no parse) — o idioma viaja como
#       EXPRESSÃO e o filho o re-avalia com o diretório DELE: o comando que aponta
#       para um caminho impossível sai VERDE
#   6r. MUTAÇÃO M21 (a resolução do marcador na HERANÇA) — o outro elo da mesma
#       corrente: sem congelar o `@DIR@` no valor que atravessa, o filho o resolve
#       com o diretório dele e o mesmo verde falso aparece
#   6s. MUTAÇÃO M22 (o idioma do PAI) — `SCRIPT_DIR="$(cd "$(dirname "$0")/.."
#       && pwd)"` mapeado para o diretório DO ARQUIVO: o guard prova o caminho
#       errado, que existe, e o alvo que roda de verdade sai VERDE
#   6t. MUTAÇÃO M23 (a leitura do PRIMEIRO WORD) — a atribuição lida por inteiro
#       (`GUARD="$GUARD" ALVO="$1" python3 …`) cita o próprio nome e vira CICLO:
#       o alvo fica sem julgamento e o guard ACUSA o são
#   6u. MUTAÇÃO M24 (a AUTO-REFERÊNCIA não acrescenta valor) — `GUARD="$GUARD"`
#       sozinho entrando no conjunto: o mesmo CICLO falso no arquivo que só passa
#       a variável adiante (o ciclo de verdade `A="$B"`/`B="$A"` continua ciclo)
#   7. MUTAÇÃO M25 (os NÚMEROS DE PRODUÇÃO da prosa) — a única mutação na DOC, e
#      não no guard: o número de produção é do repositório REAL (não tem
#      fixture), e a prosa que o publica tem de bater com o que o `analyze()`
#      mediu. O defeito que ela reinstala está MEDIDO: a prosa dizia 250 comandos
#      / 244 resolvidos / 105 nos hooks quando o medido era 251 / 245 / 106
#   7b. MUTAÇÃO M26 (o valor ABSOLUTO do conjunto provado) — o caso SÃO (o
#       caminho FORA do repositório) passa a ser ACUSADO
#   7c. MUTAÇÃO M27 (o valor de PADRÃO do conjunto provado) — o glob passa a ser
#       um caminho PROVADO e o guard fica CEGO para a classe
#   8. Restauração VERIFICADA (checksum, guard E doc) + CONTROLE FINAL: o guard
#      volta a reprovar o caminho tipado, provando que a árvore ficou como estava
#   9. Cleanup (trap EXIT — restaura o guard e a doc, e remove o temp)
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
  'M1|A EXISTÊNCIA DO CAMINHO (arquivoExiste)'
  'M2|A ENTRADA DE scripts DO package.json'
  'M3|A DECISÃO DECLARADA (INDETERMINATE)'
  'M4|A FUNÇÃO DO PRÓPRIO HOOK'
  'M5|A UNICIDADE do vizinho'
  'M6|O TETO de distância. A mensagem do guard SUGERE um vizinho com teto 4'
  'M7|a CONFIRMAÇÃO: sem --yes e sem terminal o remendo não pergunta nem grava'
  'M8|o ESCOPO DO TOKEN: o comando interno (de uma entrada de bun run) não é alvo'
  'M9|a DESCIDA: parar no alvo do bash deixa o interior do runner sem julgamento'
  'M10|O ESCOPO DAS FUNÇÕES de um script EXECUTADO'
  'M11|os PADRÕES de um case'
  'M12|a RESOLUÇÃO: sem ela as variáveis de caminho dos scripts chamados ficam indeterminadas'
  'M13|a EXISTÊNCIA dos valores prováveis'
  'M14|o FAIL-CLOSED da resolução'
  'M15|a EXISTÊNCIA da entrada provável'
  'M16|a DESCIDA na entrada provável'
  'M17|o alvo PROVADO por variável'
  'M18|o valor VAZIO: a string vazia resolve por ACIDENTE para o diretório node_modules/.bin'
  'M19|o TETO de combinações'
  'M20|o CONGELAMENTO do diretório no parse'
  'M21|a resolução do marcador na HERANÇA'
  'M22|o idioma do PAI: o diretório por cd/dirname vale a RAIZ do repositório'
  'M23|a leitura do PRIMEIRO WORD da atribuição'
  'M24|a AUTO-REFERÊNCIA não acrescenta valor novo'
  'M25|o total de comandos ESCRITO À MÃO na prosa da doc → o guard FALHA nomeando o delta'
  'M26|o valor ABSOLUTO do conjunto provado julgado pela existência → o caso SÃO passa a ser ACUSADO'
  'M27|o valor de PADRÃO do conjunto provado aceito como caminho → o guard fica CEGO para a classe'
)
GUARD="$SCRIPT_DIR/scripts/check-hook-commands.mjs"
SUITE_ARQUIVO="src/lib/__tests__/check-hook-commands.test.ts"
# A prosa que publica os números de produção deste guard (a M25 a muta; o backup
# e a restauração entram no MESMO trap do guard).
DOC="$SCRIPT_DIR/docs/GUARDS.md"

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

# A M25 muta a DOC (o guard mede o repositório real) — logo ela também entra no
# backup e no trap: um `exit` no meio do caminho não pode deixar a prosa mutada.
doc_backup="$TMP_DIR/GUARDS.original.md"
cp "$DOC" "$doc_backup"
doc_sum="$(cksum "$DOC" | cut -d' ' -f1)"

cleanup() {
  cp -f "$guard_backup" "$GUARD" 2>/dev/null || true
  cp -f "$doc_backup" "$DOC" 2>/dev/null || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

restaurar_original() {
  cp -f "$guard_backup" "$GUARD"
  cp -f "$doc_backup" "$DOC"
  if [ "$(cksum "$GUARD" | cut -d' ' -f1)" != "$guard_sum" ]; then
    fail "RESTAURAÇÃO FALHOU (checksum do guard diverge) — restaure a partir de $guard_backup"
    exit 1
  fi
  if [ "$(cksum "$DOC" | cut -d' ' -f1)" != "$doc_sum" ]; then
    fail "RESTAURAÇÃO FALHOU (checksum da doc diverge) — restaure a partir de $doc_backup"
    exit 1
  fi
}

# ── mutar_guard: substituição CIRÚRGICA (exatamente 1 ocorrência) ─────────
# Uma mutação que casa 0 ou 2+ vezes não é cirúrgica: o script para em vez de
# medir outra coisa. O marcador "MUTACAO M" no texto novo é o que prova que a
# mutação APLICOU (o alvo pode existir e a escrita falhar).
mutar_guard() { # <alvo> <troca>: a cirurgia, o marcador e o checksum são da régua
  # COMPARTILHADA (`mutacao_aplicar`).
  mutacao_aplicar "$GUARD" "$1" "$2" "$guard_sum"
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
  '      const alvos = alvosProvaveis(comando, contexto.vars)' \
  '      const alvos = { ok: false, motivo: "MUTACAO M9" }'
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
  '          funcoes: SOURCE_COMMANDS.has(comando.programa)
            ? new Set([...funcoes, ...definedFunctions(texto)])
            : new Set(definedFunctions(texto)),' \
  '          funcoes: new Set([...funcoes, ...definedFunctions(texto)]), /* MUTACAO M10 */'
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

# ── 6i. MUTAÇÃO M12: a RESOLUÇÃO das variáveis de caminho ────────────────
# A direção aqui é a CONTRÁRIA (como o M4 e o M11): sem a resolução, o guard não
# fica cego — ele passa a ACUSAR os `check-*.sh` do repositório real, porque as
# entradas de INDETERMINATE que cobriam `$PYTHON_SCRIPT`, `$SCRIPT_DIR/x` e `$PY`
# foram REMOVIDAS quando a prova entrou. Se a resolução não sustentasse o verde,
# o repositório teria comandos indeterminados não declarados.
header "MUTAÇÃO M12: desligar a resolução das variáveis de caminho"
mutar_guard \
  '        : caminhosProvaveis(alvo, ctx.vars)' \
  '        : { ok: false, motivo: "MUTACAO M12: resolucao desligada" }'
rodar_guard_real
if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "M12: o guard seguiu VERDE no repositório real — a resolução não sustenta o verde"
  exit 1
fi
pass "M12: o repositório REAL passa a ser ACUSADO (exit $GUARD_EXIT) nos \`check-*.sh\` — a resolução é load-bearing"
mostrar
exigir_reprovado "M12 cirúrgica (caminho NO hook)" "$FX_TYPO"
pass "M12 CIRÚRGICA: o caminho tipado NO hook segue reprovado — morreu só a resolução"
exigir_suite_vermelha "M12"
restaurar_original

# ── 6j. MUTAÇÃO M13: a EXISTÊNCIA dos valores prováveis ────────────────────
# A resolução é uma promessa sobre o DISCO: os valores deduzidos das atribuições
# têm de existir. Sem a conferência, a variável que aponta para um arquivo
# inexistente passa como resolvida — é a mesma classe do M1, agora no caminho
# PROVADO (o M1 muta a função; este muta a conferência do alvo resolvido).
header "MUTAÇÃO M13: aceitar os valores prováveis sem conferir o disco"
FX_VARIAVEL="$TMP_DIR/fx-variavel"
HOOK_VARIAVEL=$'set -eu\nbash scripts/py.sh\n'
PY_VARIAVEL=$'#!/usr/bin/env bash\nset -euo pipefail\nSCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\nPYTHON_SCRIPT="$SCRIPT_DIR/nao-existe.py"\npython3 "$PYTHON_SCRIPT"\n'
mkfix "$FX_VARIAVEL" "$HOOK_VARIAVEL" "$PKG_SIMPLES" scripts/check_utf8.py
mk_arquivo "$FX_VARIAVEL" "scripts/py.sh" "$PY_VARIAVEL"
exigir_reprovado "M13 (antes da mutação)" "$FX_VARIAVEL"
pass "CONTROLE: o alvo PROVADO que não existe é VIOLAÇÃO (a variável foi provada e o arquivo, conferido)"
mutar_guard \
  '    const faltando = doRepositorio.filter((v) => !arquivoExiste(ctx.root, v))' \
  '    const faltando = [] /* MUTACAO M13 */'
exigir_cego "M13" "$FX_VARIAVEL"
pass "M13: sem a conferência, o caminho que NUNCA existe PASSA (CEGO) — a existência do alvo provado é load-bearing"
exigir_suite_vermelha "M13"
restaurar_original

# ── 6k. MUTAÇÃO M14: o FAIL-CLOSED da resolução (provar uma PARTE) ────────
# A regra é: se UMA atribuição da variável não é provável, a variável INTEIRA é
# irresolúvel — um valor que o guard não leu pode ser justamente o que roda, e
# provar o resto seria provar uma parte e chamar de todo. A mutação descarta a
# atribuição que falhou e fica com as que sobraram.
header "MUTAÇÃO M14: descartar a atribuição não provável"
FX_MEIO="$TMP_DIR/fx-meio"
HOOK_MEIO=$'set -eu\nbash scripts/py.sh\n'
PY_MEIO=$'#!/usr/bin/env bash\nset -euo pipefail\nSCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\nPY_SCRIPT="$SCRIPT_DIR/check_utf8.py"\nif [ "$1" = x ]; then\n  PY_SCRIPT="$(date +%s).py"\nfi\npython3 "$PY_SCRIPT"\n'
mkfix "$FX_MEIO" "$HOOK_MEIO" "$PKG_SIMPLES" scripts/check_utf8.py
mk_arquivo "$FX_MEIO" "scripts/py.sh" "$PY_MEIO"
exigir_reprovado "M14 (antes da mutação)" "$FX_MEIO"
pass "CONTROLE: com uma atribuição NÃO provável, a variável inteira é irresolúvel — VIOLAÇÃO (fail-closed)"
mutar_guard \
  '    if (!r.ok) return { ok: false, motivo: `\`${nome}\` (${ondeAtribuida(entrada)}): ${r.motivo}` }' \
  '    if (!r.ok) continue /* MUTACAO M14 */'
exigir_cego "M14" "$FX_MEIO"
pass "M14: descartando a atribuição ilegível, o guard PROVA a metade que sobrou e deixa passar (CEGO) — o fail-closed é load-bearing"
exigir_suite_vermelha "M14"
restaurar_original

# ── 6l. MUTAÇÃO M15: a EXISTÊNCIA da entrada provável ─────────────────────
# A entrada montada em `$ENTRADA` nomeia um NOME de `scripts` (ou um binário de
# dependência declarada): o valor provável tem de EXISTIR. Sem a conferência, a
# entrada REMOVIDA no mesmo commit passa — e era exatamente o que a decisão
# datada escondia, porque a MESMA linha de INDETERMINATE cobria a entrada que
# existe e a que sumiu.
header "MUTAÇÃO M15: aceitar a entrada provável que não existe em \`scripts\`"
FX_ENTRADA_VAR="$TMP_DIR/fx-entrada-var"
HOOK_ENTRADA_VAR=$'set -eu\nENTRADA=tipecheck\nbun run "$ENTRADA"\n'
PKG_ENTRADA_VAR='{ "name": "fx-entrada-var", "scripts": { "typecheck": "node scripts/typecheck.mjs" } }'
mkfix "$FX_ENTRADA_VAR" "$HOOK_ENTRADA_VAR" "$PKG_ENTRADA_VAR"
mk_arquivo "$FX_ENTRADA_VAR" "scripts/typecheck.mjs" '// existe\n'
exigir_reprovado "M15 (antes da mutação)" "$FX_ENTRADA_VAR"
pass "CONTROLE: a entrada provável que NÃO existe é VIOLAÇÃO (com o vizinho mais próximo)"
mutar_guard \
  'const faltando = provavel.valores.filter((valor) => !aceita(valor))' \
  'const faltando = [] /* MUTACAO M15 */'
exigir_cego "M15" "$FX_ENTRADA_VAR"
pass "M15: aceitando a entrada provável sem conferir, a entrada REMOVIDA PASSA (CEGO) — a existência é load-bearing"
exigir_reprovado "M15 cirúrgica (entrada LITERAL ausente)" "$FX_ENTRADA"
pass "M15 CIRÚRGICA: a entrada LITERAL \`bun run tipecheck\` segue reprovada — morreu só a metade da variável"
exigir_suite_vermelha "M15"
restaurar_original

# ── 6m. MUTAÇÃO M16: a DESCIDA na entrada provável ────────────────────────
# Provar que o NOME existe não é provar que o que ele EXECUTA resolve: a entrada
# pode existir e o comando dela apontar para um arquivo que sumiu. Sem a descida,
# o defeito fica um nível ADIANTE do verde — a mesma classe do M9, agora no
# caminho montado em variável.
header "MUTAÇÃO M16: parar no NOME da entrada provável (não descer no que ela executa)"
FX_ENTRADA_DESCE="$TMP_DIR/fx-entrada-desce"
HOOK_ENTRADA_DESCE=$'set -eu\nENTRADA=typecheck\nbun run "$ENTRADA"\n'
PKG_ENTRADA_DESCE='{ "name": "fx-entrada-desce", "scripts": { "typecheck": "node scripts/sumiu.mjs" } }'
mkfix "$FX_ENTRADA_DESCE" "$HOOK_ENTRADA_DESCE" "$PKG_ENTRADA_DESCE"
mk_arquivo "$FX_ENTRADA_DESCE" "scripts/sumiuX.mjs" '// vizinho, a UMA edicao do token\n'
exigir_reprovado "M16 (antes da mutação)" "$FX_ENTRADA_DESCE"
pass "CONTROLE: a entrada existe e o que ela EXECUTA não existe — VIOLAÇÃO (com a cadeia da proveniência)"
mutar_guard \
  'if (ctx.scripts[entrada] === undefined) continue' \
  'if (true /* MUTACAO M16 */) continue'
exigir_cego "M16" "$FX_ENTRADA_DESCE"
pass "M16: sem a descida, o defeito que a entrada executa PASSA (CEGO) — a descida é load-bearing"
exigir_reprovado "M16 cirúrgica (entrada LITERAL apontando para arquivo removido)" "$FX_ENTRADA"
pass "M16 CIRÚRGICA: a entrada LITERAL que aponta para arquivo removido segue reprovada — morreu só a descida da variável"
exigir_suite_vermelha "M16"
restaurar_original

# ── 6n. MUTAÇÃO M17: a DESCIDA no alvo PROVADO por variável ───────────
# A descida seguia só o alvo LITERAL: `bash "$ALVO"` cujo valor o guard PROVOU
# saía `resolvido` — e o interior do script ficava sem ninguém. A mutação
# desliga a resolução do alvo e exige que o defeito DENTRO do script provado
# passe (CEGO), com o CONTROLE na direção oposta (a árvore íntegra o reprova).
header "MUTAÇÃO M17: parar no alvo LITERAL (não descer no alvo provado)"
FX_DESCE_VAR="$TMP_DIR/fx-desce-var"
HOOK_DESCE_VAR=$'set -eu\nALVO="scripts/inner.sh"\nbash "$ALVO"\n'
PKG_DESCE_VAR='{ "name": "fx-desce-var", "scripts": {} }'
mkfix "$FX_DESCE_VAR" "$HOOK_DESCE_VAR" "$PKG_DESCE_VAR"
mk_arquivo "$FX_DESCE_VAR" "scripts/inner.sh" $'#!/usr/bin/env bash\nnode scripts/typo.mjs\n'
exigir_reprovado "M17 (antes da mutação)" "$FX_DESCE_VAR"
pass "CONTROLE: o defeito DENTRO do script cujo alvo foi PROVADO é VIOLAÇÃO (o guard desce)"
mutar_guard \
  'const provavel = caminhosProvaveis(alvo, vars)' \
  'const provavel = { ok: false, motivo: "MUTACAO M17: resolucao desligada" }'
exigir_cego "M17" "$FX_DESCE_VAR"
pass "M17: sem a resolução do alvo, o interior do script provado PASSA (CEGO) — a descida no alvo provado é load-bearing"
exigir_reprovado "M17 cirúrgica (alvo LITERAL com defeito dentro)" "$FX_DESCIDA"
pass "M17 CIRÚRGICA: o alvo LITERAL que aponta para defeito interno segue reprovado — morreu só a descida do alvo provado"
exigir_suite_vermelha "M17"
restaurar_original

# ── 6o. MUTAÇÃO M18: o valor VAZIO da resolução ───────────────────────────
# `ENTRADA=""` é o valor que não é caminho nem nome. O `node_modules/.bin`
# PRECISA existir na fixture: é ele que faz o vazio virar verde quando a regra
# não está lá (`binInstalado(root, "")` é o DIRETÓRIO, e um diretório existe) —
# a fixture reproduz o ambiente onde o hook roda, não um ambiente mais falso.
header "MUTAÇÃO M18: aceitar o valor VAZIO como valor provável"
FX_VAZIO="$TMP_DIR/fx-vazio"
HOOK_VAZIO=$'set -eu\nENTRADA=""\nbun run "$ENTRADA"\n'
PKG_VAZIO='{ "name": "fx-vazio", "scripts": { "typecheck": "node scripts/typecheck.mjs" } }'
mkfix "$FX_VAZIO" "$HOOK_VAZIO" "$PKG_VAZIO"
mk_arquivo "$FX_VAZIO" "scripts/typecheck.mjs" '// ok\n'
mkdir -p "$FX_VAZIO/node_modules/.bin"
exigir_reprovado "M18 (antes da mutação)" "$FX_VAZIO"
pass "CONTROLE: o valor VAZIO é VIOLAÇÃO (indeterminado não declarado) — ele não vira verde"
mutar_guard \
  '  if (valores.some((v) => v === ""))' \
  '  if (false /* MUTACAO M18 */)'
exigir_cego "M18" "$FX_VAZIO"
pass "M18: sem a regra, o vazio é aceito COMO valor e o comando sai VERDE (CEGO) — o fail-closed do vazio é load-bearing"
exigir_reprovado "M18 cirúrgica (entrada provável que não existe)" "$FX_ENTRADA_VAR"
pass "M18 CIRÚRGICA: a entrada provável que NÃO existe segue reprovada — morreu só a regra do vazio"
exigir_suite_vermelha "M18"
restaurar_original

# ── 6p. MUTAÇÃO M19: o TETO de combinações da resolução ───────────────────
# Acima do teto o guard NÃO enumerou o conjunto, e "provar" o que não foi lido é
# a forma mais fácil de um verde falso. A fixture é GERADA do próprio
# `MAX_VALORES` (TETO + 1 valores, todos existentes no disco): o teto é o único
# motivo possível para o controle reprovar — e o número não vira fonte de verdade.
header "MUTAÇÃO M19: enumerar mais combinações do que o teto permite"
TETO="$(node --input-type=module -e "import('$GUARD').then((m) => console.log(m.MAX_VALORES))")"
info "o teto declarado no guard agora é $TETO — a fixture usa $((TETO + 1)) valores, todos existentes"
FX_TETO="$TMP_DIR/fx-teto"
HOOK_TETO="$(for i in $(seq 1 $((TETO + 1))); do echo "D=scripts/d$i"; done)"
HOOK_TETO="set -eu
$HOOK_TETO
node "\$D/x.mjs""
mkfix "$FX_TETO" "$HOOK_TETO" "$PKG_SIMPLES"
for i in $(seq 1 $((TETO + 1))); do mk_arquivo "$FX_TETO" "scripts/d$i/x.mjs" '// ok\n'; done
exigir_reprovado "M19 (antes da mutação)" "$FX_TETO"
pass "CONTROLE: os $((TETO + 1)) valores prováveis passam do teto — VIOLAÇÃO (o guard não prova o que não enumerou)"
mutar_guard \
  '  const combinacoes = produto(partes, MAX_VALORES)' \
  '  const combinacoes = produto(partes, Infinity /* MUTACAO M19 */)'
exigir_cego "M19" "$FX_TETO"
pass "M19: sem o teto, o guard PROVA um conjunto de $((TETO + 1)) valores e o comando sai VERDE (CEGO) — o teto é load-bearing"
exigir_reprovado "M19 cirúrgica (caminho NO hook)" "$FX_TYPO"
pass "M19 CIRÚRGICA: o caminho tipado NO hook segue reprovado — morreu só o teto"
exigir_suite_vermelha "M19"
restaurar_original

# ── 6q. MUTAÇÃO M20: o CONGELAMENTO do diretório no parse ─────────────────
# O idioma `$(cd $(dirname ${BASH_SOURCE[0]}) && pwd)` vale o diretório de QUEM O
# ESCREVEU: o bash exporta o VALOR, e o filho não re-avalia a expressão. A
# fixture é o caso que separa as duas leituras — o alvo verdadeiro
# (`scripts/ok.mjs`, o diretório do `lib.sh` que exportou) NÃO existe e o
# caminho que o filho veria se re-avaliasse com o diretório dele
# (`scripts/sub/ok.mjs`) existe. Sem o congelamento o guard fica VERDE apontando
# para um caminho que o processo novo nunca pode ver.
header "MUTAÇÃO M20: deixar o idioma do diretório viajar como EXPRESSÃO"
FX_IDIOMA="$TMP_DIR/fx-idioma"
HOOK_IDIOMA=$'set -eu\nbash scripts/lib.sh\n'
mkfix "$FX_IDIOMA" "$HOOK_IDIOMA" "$PKG_SIMPLES"
mk_arquivo "$FX_IDIOMA" "scripts/lib.sh" \
  $'#!/usr/bin/env bash\nSCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\nexport SCRIPT_DIR\nbash scripts/sub/child.sh\n'
mk_arquivo "$FX_IDIOMA" "scripts/sub/child.sh" \
  $'#!/usr/bin/env bash\nnode "$SCRIPT_DIR/ok.mjs"\n'
mk_arquivo "$FX_IDIOMA" "scripts/sub/ok.mjs" '// o caminho que o filho RE-AVALIARIA — nao e o que o processo novo ve\n'
exigir_reprovado "M20 (antes da mutação)" "$FX_IDIOMA"
pass "CONTROLE: o alvo é o do EXPORTADOR (\`scripts/ok.mjs\`) e ele NÃO existe — VIOLAÇÃO"
mutar_guard \
  '  return marcaDoIdioma(valor) ?? valor' \
  '  return valor /* MUTACAO M20 */'
exigir_cego "M20" "$FX_IDIOMA"
pass "M20: sem o congelamento, o filho re-avalia a EXPRESSÃO no diretório dele e o comando sai VERDE apontando para um alvo impossível (CEGO) — o congelamento é load-bearing"
exigir_reprovado "M20 cirúrgica (entrada provável que não existe)" "$FX_ENTRADA_VAR"
pass "M20 CIRÚRGICA: a entrada provável que NÃO existe segue reprovada — morreu só o congelamento do diretório"
exigir_suite_vermelha "M20"
restaurar_original

# ── 6r. MUTAÇÃO M21: a resolução do marcador na HERANÇA ───────────────────
# O outro elo da MESMA corrente: depois do congelamento o valor é `@DIR@`, e é a
# herança que o resolve com o diretório de quem EXPORTOU. Sem essa resolução o
# marcador chega cru ao filho, e a substituição do uso (que só é a última ponta da
# regra) o resolve com o diretório DELE — o mesmo verde falso, por outra linha.
header "MUTAÇÃO M21: deixar o marcador \`@DIR@\` atravessar a herança"
exigir_reprovado "M21 (antes da mutação)" "$FX_IDIOMA"
pass "CONTROLE: com a herança resolvendo o marcador, o veredito é VIOLAÇÃO (o alvo do exportador)"
mutar_guard \
  '    const resolvidos = (lista) => aplicaMarcas(lista, vars)' \
  '    const resolvidos = (lista) => lista /* MUTACAO M21 */'
exigir_cego "M21" "$FX_IDIOMA"
pass "M21: sem a resolução na herança, o marcador atravessa e o filho o resolve no diretório dele — VERDE (CEGO) — a resolução na herança é load-bearing"
exigir_reprovado "M21 cirúrgica (entrada provável que não existe)" "$FX_ENTRADA_VAR"
pass "M21 CIRÚRGICA: a entrada provável que NÃO existe segue reprovada — morreu só a resolução do marcador"
exigir_suite_vermelha "M21"
restaurar_original

# ── 6s. MUTAÇÃO M22: o idioma do PAI (`SCRIPT_DIR` na RAIZ) ────────────────
# O idioma com que os scripts da casa chegam na RAIZ do repositório
# (`SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"`). O fixture tem o alvo
# EXISTINDO só no caminho que o idioma ERRADO provaria (`scripts/scripts/…`, o
# diretório do arquivo em vez do PAI): com o idioma certo o veredito é VIOLAÇÃO
# (o runner executa um arquivo que não existe) e, mapeado para o diretório do
# arquivo, o guard o resolve para um caminho que existe e sai VERDE.
header "MUTAÇÃO M22: mapear o idioma do PAI para o diretório DO ARQUIVO"
FX_DIRPAI="$TMP_DIR/fx-dirpai"
mkfix "$FX_DIRPAI" $'set -eu\nbash scripts/runner.sh\n' "$PKG_SIMPLES"
mk_arquivo "$FX_DIRPAI" "scripts/runner.sh" \
  $'#!/usr/bin/env bash\nSCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"\nGUARD="$SCRIPT_DIR/scripts/guarda.mjs"\nnode "$GUARD"\n'
mk_arquivo "$FX_DIRPAI" "scripts/scripts/guarda.mjs" \
  '// o caminho que o idioma ERRADO provaria (o diretório do arquivo, não o PAI)\n'
exigir_reprovado "M22 (antes da mutação)" "$FX_DIRPAI"
pass "CONTROLE: o alvo do PAI (\`scripts/guarda.mjs\`) NÃO existe — VIOLAÇÃO (o idioma provou o caminho CERTO)"
mutar_guard '    re: /^\$\(cd "\$\(dirname "\$0"\)\/\.\." && pwd\)$/,
    nome: "`$(cd $(dirname $0)/.. && pwd)`",
    marca: MARCA_DIR_PAI,' '    re: /^\$\(cd "\$\(dirname "\$0"\)\/\.\." && pwd\)$/,
    nome: "`$(cd $(dirname $0)/.. && pwd)`",
    marca: MARCA_DIR, /* MUTACAO M22 */'
exigir_cego "M22" "$FX_DIRPAI"
pass "M22: com o idioma do PAI mapeado para o diretório DO ARQUIVO, o guard prova \`scripts/scripts/guarda.mjs\` (que existe) e o alvo que NUNCA roda sai VERDE (CEGO) — o mapeamento do PAI é load-bearing"
exigir_suite_vermelha "M22"
restaurar_original

# ── 6t. MUTAÇÃO M23: a leitura do PRIMEIRO WORD da atribuição ─────────────
# `GUARD="$GUARD" ALVO="$1" python3 scripts/checa.py` é a forma que a casa usa
# para passar o caminho ao script de mutação: o shell atribui `"$GUARD"` e o
# resto é o COMANDO. Lida por inteiro, a atribuição cita o próprio nome e a régua
# acusa CICLO — o alvo do `node "$GUARD"` fica sem julgamento por um defeito de
# LEITURA, e o guard passa a ACUSAR o são (violação falsa num gate bloqueante).
header "MUTAÇÃO M23: ler a atribuição por INTEIRO (o prefixo de ambiente vira ciclo)"
FX_PREFIXO="$TMP_DIR/fx-prefixo"
mkfix "$FX_PREFIXO" $'set -eu\nbash scripts/runner.sh\n' "$PKG_SIMPLES"
mk_arquivo "$FX_PREFIXO" "scripts/runner.sh" \
  $'#!/usr/bin/env bash\nSCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"\nGUARD="$SCRIPT_DIR/scripts/guarda.mjs"\nGUARD="$GUARD" ALVO="$1" python3 scripts/checa.py\nnode "$GUARD"\n'
mk_arquivo "$FX_PREFIXO" "scripts/guarda.mjs" '// guard\n'
mk_arquivo "$FX_PREFIXO" "scripts/checa.py" 'print(1)\n'
exigir_aprovado "M23 (antes da mutação)" "$FX_PREFIXO"
pass "CONTROLE: o alvo provado EXISTE e o prefixo de ambiente não atrapalha — VERDE"
mutar_guard '    const valor = primeiroWord(m[2]).trim()' \
  '    const valor = m[2].trim() /* MUTACAO M23 */'
exigir_reprovado "M23" "$FX_PREFIXO"
pass "M23: lida por inteiro, a atribuição cita o próprio nome e o guard ACUSA o são (ciclo) — a leitura do primeiro word é load-bearing"
exigir_suite_vermelha "M23"
restaurar_original

# ── 6u. MUTAÇÃO M24: a AUTO-REFERÊNCIA não acrescenta valor ───────────────
# `GUARD="$GUARD"` sozinho não muda o valor da variável: deixa-lo entrar no
# conjunto faz a régua acusar CICLO num arquivo que só passa a variável adiante.
# O ciclo de VERDADE (`A="$B"` / `B="$A"`) continua ciclo — ali o elo acrescenta
# um NOME novo à resolução.
header "MUTAÇÃO M24: deixar a auto-referência entrar no conjunto de valores"
FX_AUTOREF="$TMP_DIR/fx-autoref"
mkfix "$FX_AUTOREF" $'set -eu\nbash scripts/runner.sh\n' "$PKG_SIMPLES"
mk_arquivo "$FX_AUTOREF" "scripts/runner.sh" \
  $'#!/usr/bin/env bash\nSCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"\nGUARD="$SCRIPT_DIR/scripts/guarda.mjs"\nGUARD="$GUARD"\nnode "$GUARD"\n'
mk_arquivo "$FX_AUTOREF" "scripts/guarda.mjs" '// guard\n'
exigir_aprovado "M24 (antes da mutação)" "$FX_AUTOREF"
pass "CONTROLE: a auto-referência não acrescenta valor e o alvo segue provado — VERDE"
mutar_guard '    if (ehAutoReferencia(valor, nome)) continue' \
  '    if (false) continue /* MUTACAO M24 */'
exigir_reprovado "M24" "$FX_AUTOREF"
pass "M24: com a auto-referência no conjunto o guard vê CICLO no arquivo que só passa adiante e ACUSA o são — a regra é load-bearing"
exigir_suite_vermelha "M24"
restaurar_original

# ── 7. M25: os números de PRODUÇÃO da prosa são DERIVADOS do analyze() ────
#
# A mutação não é no guard: é na DOC. Diferente das M1–M24, ela não tem fixture
# — o número de produção é do repositório REAL, e é ele que o guard mede quando
# julga a árvore. O defeito que ela reinstala está MEDIDO: a prosa deste guard
# dizia 250 comandos / 244 resolvidos / 105 nos hooks quando o medido era
# 251 / 245 / 106, e ninguém tinha como ver (um número de doc que não é derivado
# envelhece sozinho, e é por ele que o leitor confere a ESCALA do guard).
header "MUTAÇÃO M25: o total de comandos da prosa volta a ser escrito à mão"
exigir_aprovado "M25 (antes da mutação)" "$SCRIPT_DIR"
pass "CONTROLE: com a prosa batendo com o medido o guard no repositório REAL sai VERDE"

TOTAL_ATUAL="$(node "$GUARD" --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["numeros"]["comandos"][0])')"
# A troca NA DOC (não num guard) — a régua COMPARTILHADA prova a cirurgia, o
# marcador e o conteúdo, e o "antes" é lido agora.
mutacao_aplicar "$DOC" "**${TOTAL_ATUAL} comandos**" \
  "**$((TOTAL_ATUAL - 1)) comandos**<!-- MUTACAO M25 -->" \
  "$(cksum "$DOC" | cut -d' ' -f1)"

rodar_guard "$SCRIPT_DIR"
if [ "$GUARD_EXIT" -ne 1 ]; then
  fail "M25: a prosa com o total ERRADO passou (exit $GUARD_EXIT, esperado 1) — o número da doc não é conferido"
  mostrar
  exit 1
fi
if ! grep -Fq "a prosa declara o total de comandos julgados como $((TOTAL_ATUAL - 1)) e o medido e ${TOTAL_ATUAL}" <<<"$GUARD_OUT"; then
  fail "M25: o guard reprovou, mas NÃO nomeou o delta (declarado x medido) do total"
  mostrar
  exit 1
fi
if ! grep -Fq "docs/GUARDS.md:" <<<"$GUARD_OUT"; then
  fail "M25: o guard reprovou, mas não apontou o arquivo e a linha da prosa"
  mostrar
  exit 1
fi
pass "M25: o número escrito à mão reprova nomeando a linha da prosa e o delta (${TOTAL_ATUAL} medido vs $((TOTAL_ATUAL - 1)) declarado)"
restaurar_original

# ── 7b. MUTAÇÃO M26: o valor ABSOLUTO do conjunto provado ────────────────
# A direção é a CONTRÁRIA (como M4/M11/M12/M23/M24): o valor absoluto de uma
# atribuição não promete estar no repositório — `ALVO="/etc/hosts"` roda um
# binário de FORA dele —, e a régua do alvo LITERAL já não o confere no disco.
# Julgá-lo pela existência ACUSA O SÃO: é o defeito que o veredito do valor
# provado tinha, e a classe é o que o desfaz.
header "MUTAÇÃO M26: julgar o valor ABSOLUTO do conjunto pela existência"
FX_ABSOLUTO="$TMP_DIR/fx-absoluto"
mkfixture "$FX_ABSOLUTO" $'set -eu\nALVO="/etc/hosts"\nbash "$ALVO"\n'
exigir_aprovado "M26 (antes da mutação)" "$FX_ABSOLUTO"
pass "CONTROLE: o valor absoluto provado é 'caminho absoluto fora do repositório' — VERDE"
mutar_guard '    const doRepositorio = provavel.valores.filter(ehCaminhoDoRepositorio)' \
  '    const doRepositorio = provavel.valores /* MUTACAO M26 */'
exigir_reprovado "M26" "$FX_ABSOLUTO"
pass "M26: julgado pela existência, o caminho FORA do repositório passa a ser ACUSADO — a classe é load-bearing"
mostrar
exigir_suite_vermelha "M26"
restaurar_original

# ── 7c. MUTAÇÃO M27: o valor de PADRÃO do conjunto provado ────────────────
# `scripts/*.sh` nomeia um CONJUNTO, não um arquivo: o alvo LITERAL o resolve
# como `indeterminado` ("padrão, não um caminho") e exige a decisão datada — a
# falsa acusação que o veredito do valor provado cometia era "NÃO existe no
# repositório" MAIS a sugestão de um vizinho, que é a distância entre um glob e
# um nome. A metade aceita o padrão como caminho PROVADO (o `resolvido` de uma
# parte) e mede a cegueira.
header "MUTAÇÃO M27: aceitar o PADRÃO do conjunto como caminho provado"
FX_PADRAO="$TMP_DIR/fx-padrao"
mkfixture "$FX_PADRAO" $'set -eu\nALVO="scripts/*.sh"\nbash "$ALVO"\n'
mk_arquivo "$FX_PADRAO" "scripts/a.sh" '#!/usr/bin/env bash\n'
exigir_reprovado "M27 (antes da mutação)" "$FX_PADRAO"
if ! grep -qF 'padrão, não um caminho' <<<"$GUARD_OUT"; then
  fail "M27: o guard reprova o padrão mas NÃO nomeia a classe ('padrão, não um caminho') — a acusação falsa ficou de pé"
  mostrar
  exit 1
fi
if grep -qF 'o mais próximo' <<<"$GUARD_OUT"; then
  fail "M27: o guard SUGERIU o vizinho de um padrão — um glob não tem vizinho a sugerir"
  mostrar
  exit 1
fi
pass "CONTROLE: o padrão é 'padrão, não um caminho' (a classe do literal), sem sugestão de vizinho, e a decisão datada segue exigida"
mutar_guard '      const padrao = provavel.valores.find((v) => classeDoAlvo(v) === "padrao")' \
  '      const padrao = undefined /* MUTACAO M27 */'
exigir_cego "M27" "$FX_PADRAO"
pass "M27: sem a classe do padrão, o guard ACEITA o glob como caminho provado (CEGO) — a régua do padrão é load-bearing"
exigir_suite_vermelha "M27"
restaurar_original

# ── 8. CONTROLE FINAL: a árvore ficou como estava ─────────────────────────
header "CONTROLE FINAL: restauração verificada por checksum"
exigir_reprovado "CONTROLE FINAL (caminho tipado)" "$FX_TYPO"
pass "CONTROLE FINAL: o guard restaurado volta a reprovar o caminho tipado"

echo
echo -e "${GREEN}═══ MUTATION TEST PASSED — as 27 mutações foram detectadas (gate, arquivo, suíte e/ou prosa) ═══${NC}"
