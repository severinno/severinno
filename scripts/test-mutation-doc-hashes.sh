#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-doc-hashes.sh — Mutation test da régua das CITAÇÕES DE
# COMMIT na prosa (scripts/check-doc-hashes.mjs)
#
# Usage:
#   ./scripts/test-mutation-doc-hashes.sh
#
# Exit codes:
#   0 — as NOVE mutações foram DETECTADAS (o veredito mudou na direção prevista)
#       e os controles passaram ✅
#   1 — a régua ficou INDIFERENTE a alguma mutação (o defeito deixou de ser
#       acusado, ou a regra parou de proteger o são) OU um controle saiu falso ❌
#   2 — infra: guard/git/node ausentes, ou o marcador de uma mutação deixou de ser
#       único no guard (fail-closed: mutação que não muta é pior que nenhuma)
#
# O QUE ISTO PROVA
#
# O guard sai 0 no repositório — isso prova que ele não ACUSOU, não que ele MEDIU.
# Cada regra que sustenta o veredito tem aqui a sua mutação, com a DIREÇÃO medida.
# Três classes de regressão, as duas primeiras já medidas em 22/09/2026:
#
#   CEGUEIRA (deixa passar o defeito) — M1 (o commit órfão de reescrita volta a
#   valer), M4 (o não-julgável vira verde), M5 (o auditor reprova a si mesmo) e
#   M9 (a prosa da MENSAGEM sai da varredura e a origem não resolvível que ela
#   cita volta a passar em silêncio);
#   FROUXIDÃO (acusa o são) — M2 (o TTL `31536000` vira citação: 78 falsos
#   positivos no corpus), M3 (o digest `sha256:` vira "hash sem commit") e M6 (o
#   id de seed em `.ts` vira citação);
#   REMÉDIO (a promessa do `--fix` deixa de valer) — M7 (o PREVIEW grava: o
#   `--dry-run` que o comentário do PR publica passa a MENTIR sobre o patch) e M8
#   (a CONFIRMAÇÃO vira inócua: o remédio se aplica sem ninguém autorizar).
#
#   M1 — A REGRA DA HISTÓRIA (`merge-base --is-ancestor`). Cegá-la é a cegueira
#        mais direta: o commit que EXISTE como objeto (o caso de toda rewrite)
#        volta a valer como citação viva.
#   M2 — O NÚMERO PURO (`pareceCommit`). Sem a letra obrigatória, `31536000` (um
#        ano de cache) e `86400000` (ms) viram citação.
#   M3 — O DIGEST DE ARTEFATO (`sha256:`). Sem o prefixo, o digest da imagem
#        servida pelo registry vira "commit que não existe".
#   M4 — O FAIL-CLOSED SEM GIT. Árvore que não é repositório TEM de sair 2:
#        "não consegui julgar" nunca pode virar "está tudo na história".
#   M5 — O AUDITOR NÃO SE CONTA. A prosa que DESCREVE a classe cita nomes órfãos;
#        sem a exclusão, o guard reprova a si mesmo pelo próprio exemplo.
#   M6 — A EXTENSÃO FORA DO ESCOPO (`.ts`). O id de seed (12 hex em formato
#        ObjectId, MONTADO EM DUAS METADES pela própria suíte) é hex de tamanho
#        de commit e não é revisão nenhuma.
#   M9 — A PROSA DA MENSAGEM (`commitsForaDoPublicado`). O arquivo versionado
#        sempre foi julgado; a MENSAGEM do commit não era lida por gate nenhum,
#        e é onde a citação órfã viajava de graça (medido: 6 no corpo de mensagem
#        de uma série não publicada). Sem esta metade, nenhuma das outras oito
#        percebe — a metade que mede a mensagem tem de ser load-bearing por si.
#
# O FIXTURE É UM REPOSITÓRIO GIT DE VERDADE — a régua é do git (`cat-file` e
# `merge-base`) — criado num `mktemp`, com o guard COPIADO para `scripts/`. O
# script NÃO toca nenhum arquivo do repositório real, e a mutação é um `sed` na
# cópia. A ordem de cada caso: (1) o CONTROLE roda o guard íntegro e mede o
# veredito daquele fixture; (2) o guard é mutado; (3) o veredito tem de MUDAR na
# direção prevista.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que a régua das metades recusa — a descrição do master e
# a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'M1|a regra da HISTÓRIA: o commit que existe e está fora dela'
  'M2|o NÚMERO PURO (TTL/ms) não é citação'
  'M3|o DIGEST de artefato (sha256:) não é commit'
  'M4|o fail-closed sem git: árvore que não é repositório sai 2'
  'M5|o auditor não se conta (a prosa que descreve a classe cita órfãos)'
  'M6|a extensão fora do escopo (.ts de fixture)'
  'M7|o preview do --fix NÃO grava (o --dry-run que o PR publica é o mesmo remendo)'
  'M8|a confirmação explícita: sem --yes e sem terminal NADA é gravado'
  'M9|a prosa da MENSAGEM: o corpo que cita o commit que a rewrite deixou'
)

GUARD="$SCRIPT_DIR/scripts/check-doc-hashes.mjs"

# O FECHO DE IMPORTS do guard é DERIVADO do grafo (`scripts/fecho-imports.mjs`),
# nunca uma lista à mão: o remédio (`--fix`) trouxe o módulo do prompt, o do patch e
# o FORMATADOR do repositório (a doc REMENDADA é VERSIONADA e julgada pelo `lint`: a
# escrita passa por `escreverFormatado`), e o fixture roda o guard COPIADO — sem os
# vizinhos, a cópia morre com ERR_MODULE_NOT_FOUND e o exit 1 do NODE passaria por
# veredito do guard (é a mesma classe que a suíte do `pipefail` declara: o fecho
# tem de vir junto; sem formatador a escrita degrada com motivo, nunca em silêncio,
# então o fixture sem `node_modules` segue medindo o remendo).
#
# POR QUE DERIVADO: a lista à mão envelhecia sem aviso — medido em 26/09/2026, a
# aresta do formatador que o `bench-table.mjs` ganhou deixou esta cópia MORTA e o
# exit 1 do NODE passou por veredito. Aqui quem diz o que a cópia precisa é a
# aresta do próprio guard, e uma aresta que não resolva sai 2 (infra declarada).
fecho_do_guard() { # ecoa os módulos do fecho, relativos à raiz do repositório
  local saida=""
  if ! saida="$(node "$SCRIPT_DIR/scripts/fecho-imports.mjs" "$GUARD" --root "$SCRIPT_DIR" 2>&1)"; then
    echo "❌ o fecho de imports de $GUARD NÃO foi derivado — fixture incompleto não mede:" >&2
    printf '%s\n' "$saida" | sed 's/^/   /' >&2
    exit 2
  fi
  printf '%s\n' "$saida"
}

copiar_fecho() { # $1 = raiz do fixture que recebe o fecho (o caminho é preservado)
  local destino="$1" rel
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    mkdir -p "$destino/$(dirname "$rel")"
    cp "$SCRIPT_DIR/$rel" "$destino/$rel"
  done < <(fecho_do_guard)
}

command -v git >/dev/null || { echo "❌ git ausente (fail-closed)"; exit 2; }
command -v node >/dev/null || { echo "❌ node ausente (fail-closed)"; exit 2; }
[ -f "$GUARD" ] || { echo "❌ guard ausente: $GUARD"; exit 2; }

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'
pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }
header() { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── O fixture: um repo git com o guard copiado para scripts/ ───────────────

montar() { # $1 = diretório
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir/scripts" "$dir/docs" "$dir/ci" "$dir/.husky" "$dir/.github/workflows"
  cp "$GUARD" "$dir/scripts/check-doc-hashes.mjs"
  copiar_fecho "$dir"
  git -C "$dir" init -q
  git -C "$dir" config user.email "m@m.m"
  git -C "$dir" config user.name "m"
  printf 'prosa limpa\n' >"$dir/README.md"
  git -C "$dir" add -A
  git -C "$dir" commit -q -m "base"
}

# O commit que fica ÓRFÃO: nasce e o HEAD volta atrás — o objeto continua no
# repositório (é o estado exato que uma rewrite deixa para trás) e `cat-file -e`
# diz "existe", que é o que separa o órfão do hash inexistente.
#
# E O HASH TEM DE SER UMA CITAÇÃO: `pareceCommit` exige uma letra `a-f` (um número
# puro não é citação — a régua que evita os 78 falsos positivos), e um hash curto de
# 7 dígitos sai SÓ com algarismos em ~2% das vezes. Sem a repetição, o defeito do
# fixture desaparecia em ~2% das execuções: o controle de M1 sairia 0 (verde) sobre
# um README.md que "cita" `2415416`, e a metade passaria por acidente.
# Um commit cujo hash curto é GARANTIDAMENTE uma citação (tem letra `a-f`) — e que
# o chamador escolhe MANTER na história ou DESFAZER (deixando-o órfão).
#
# $1 = dir · $2 = arquivo de marca · $3 = assunto · $4 = manter|desfazer
commit_com_letra() {
  local dir="$1" arquivo="$2" assunto="$3" destino="$4" andar=0 h=""
  while :; do
    printf 'v%s\n' "$andar" >"$dir/$arquivo"
    git -C "$dir" add -A
    git -C "$dir" commit -q -m "$assunto"
    h="$(git -C "$dir" rev-parse --short HEAD)"
    # Herestring, e não `printf … | grep -q`: o `grep -q` fecha o stdin no primeiro
    # casamento e o produtor leva SIGPIPE — a classe que a seção 20 do GUARDS mede
    # (o gate desta casa reprova a forma com pipe, e ele estava certo: o produtor
    # aqui é um comando vivo).
    if grep -qE '[a-f]' <<<"$h"; then break; fi
    git -C "$dir" reset -q --hard HEAD~1
    andar=$((andar + 1))
    [ "$andar" -lt 40 ] || { fail "não consegui um commit cujo hash seja citação"; exit 2; }
  done
  [ "$destino" = "desfazer" ] && git -C "$dir" reset -q --hard HEAD~1
  printf '%s\n' "$h"
}

criar_orfao() { # ecoa o hash curto do commit que ficou fora da história
  commit_com_letra "$1" docs/tmp.md "vai ficar orfao" desfazer
}

criar_commit_vivo() { # ecoa o hash curto de um commit COM letra, na história
  commit_com_letra "$1" docs/vivo.md "um commit vivo" manter
}

# O PAR que o remédio conserta: o commit citado e o de MESMO assunto que a DROBRA
# (`--amend`) deixou na história — é dele que sai o nome vivo do remendo.
criar_orfao_fixavel() { # ecoa o hash curto do commit que ficou órfão
  local dir="$1" h=""
  h="$(commit_com_letra "$dir" docs/marca.md "feat(doc): o ato que a prosa cita" manter)"
  printf 'v2\n' >"$dir/docs/marca.md"
  git -C "$dir" add -A
  git -C "$dir" commit -q --amend -m "feat(doc): o ato que a prosa cita"
  printf '%s\n' "$h"
}

rodar() { # $1 = repo; $2.. = flags extras do guard; ecoa o exit code
  local dir="$1"
  shift
  local rc=0
  node "$dir/scripts/check-doc-hashes.mjs" --root "$dir" "$@" >/dev/null 2>"$TMP/erro" || rc=$?
  echo "$rc"
}

# O MÓDULO QUE NÃO CARREGOU NÃO É VEREDITO: se a cópia do guard morre por um
# import que faltou (uma aresta que a derivação não viu), o `node` sai 1 — e o
# exit 1 do NODE passaria por "o guard acusou". A checagem mora AQUI, e não dentro
# do `rodar`, por uma razão de shell: `rodar` é chamado em SUBSTITUIÇÃO DE COMANDO
# (`$(rodar ...)`), e um `exit` lá dentro termina o SUBSHELL — o pai seguiria com o
# fixture morto. Quem chama `recebe` passa por aqui, no processo que decide.
checar_carga() {
  if grep -q "ERR_MODULE_NOT_FOUND\|Cannot find module" "$TMP/erro" 2>/dev/null; then
    fail "o guard COPIADO não CARREGOU (o fecho do fixture está incompleto): o veredito seria do NODE, não do guard"
    sed 's/^/     /' "$TMP/erro" >&2
    exit 2
  fi
}

# A MUTAÇÃO, fail-closed: o marcador tem de existir UMA vez no guard, e o
# arquivo tem de MUDAR. Sem as duas checagens, uma mutação que não muta (o
# marcador sumiu depois de um refactor) faria a suíte "provar" a toa.
mutar_linha() { # $1 = repo, $2 = marcador (literal), $3 = a linha nova
  local arq="$1/scripts/check-doc-hashes.mjs" n antes depois alvo="$3"
  n="$(grep -nF "$2" "$arq" | wc -l)"
  if [ "$n" != "1" ]; then
    fail "marcador de mutação com $n ocorrência(s) no guard: $2"
    echo "     (a mutação precisa de UM alvo — marcador ambíguo é mutação não medida)"
    exit 2
  fi
  antes="$(cksum <"$arq")"
  sed -i "$(grep -nF "$2" "$arq" | cut -d: -f1)s|.*|${alvo}|" "$arq"
  depois="$(cksum <"$arq")"
  [ "$antes" != "$depois" ] || {
    fail "a mutação NÃO alterou o guard: $2"
    exit 2
  }
  node --check "$arq" >/dev/null 2>&1 || {
    fail "a mutação deixou o guard com sintaxe inválida: $2"
    exit 2
  }
}

recebe() { # $1 = rótulo, $2 = exit obtido, $3 = esperado, $4 = o que a medição diz
  checar_carga
  if [ "$2" = "$3" ]; then
    pass "$1 — exit $2 ($4)"
  else
    fail "$1 — exit $2, esperado $3 ($4)"
    exit 1
  fi
}

echo "test-mutation-doc-hashes — a régua das citações de commit na prosa"

# ── CONTROLES (o fixture SÃO é o que faz o vermelho significar algo) ───────

header "CONTROLE — o são passa e o defeito acusa"
F="$TMP/controle"
montar "$F"
H_OK="$(criar_commit_vivo "$F")"
printf 'o ato foi no `%s`\n' "$H_OK" >"$F/README.md"
recebe "CONTROLE sao" "$(rodar "$F")" 0 "citação de commit VIVO passa"

F="$TMP/controle-nao-citacao"
montar "$F"
printf 'TTL 31536000 · `sha256:fd027ee7…` · exemplo `abc1234`\n' >"$F/README.md"
recebe "CONTROLE nao-citacao" "$(rodar "$F")" 0 "número puro, digest e não-citação declarada passam"

# ── M1 — a regra da HISTÓRIA ───────────────────────────────────────────────

header "M1 — a regra da HISTÓRIA (o commit que existe e está fora dela)"
F="$TMP/m1"
montar "$F"
ORFAO="$(criar_orfao "$F")"
printf 'o ato anterior foi no `%s`\n' "$ORFAO" >"$F/README.md"
recebe "CONTROLE M1 (defeito presente)" "$(rodar "$F")" 1 "o commit órfão é acusado"
mutar_linha "$F" '"--is-ancestor", token, "HEAD"' '      execFileSync("git", ["merge-base", "--is-ancestor", token, token], {'
recebe "M1 (cegada)" "$(rodar "$F")" 0 "sem o --is-ancestor o órfão volta a passar"

# ── M2 — o NÚMERO PURO ─────────────────────────────────────────────────────

header "M2 — o NÚMERO PURO (TTL/ms) não é citação"
F="$TMP/m2"
montar "$F"
printf 'o TTL é 31536000 e o intervalo é 86400000\n' >"$F/README.md"
recebe "CONTROLE M2 (sono)" "$(rodar "$F")" 0 "número puro não é citação"
mutar_linha "$F" 'return /[a-f]/.test(token)' '  return true'
recebe "M2 (afrouxada)" "$(rodar "$F")" 1 "sem a letra obrigatória, o TTL vira citação"

# ── M3 — o DIGEST de artefato ──────────────────────────────────────────────

header "M3 — o DIGEST de artefato (sha256:) não é commit"
F="$TMP/m3"
montar "$F"
printf '| imagem | `sha256:fd027ee7…` |\n' >"$F/README.md"
recebe "CONTROLE M3 (sono)" "$(rodar "$F")" 0 "digest de artefato não é commit"
mutar_linha "$F" 'return DIGEST_PREFIXOS.some((p) => antes.endsWith(p))' '  return false'
recebe "M3 (afrouxada)" "$(rodar "$F")" 1 "sem o prefixo, o digest vira 'hash sem commit'"

# ── M4 — o fail-closed sem git ─────────────────────────────────────────────

header "M4 — o fail-closed sem git: árvore que não é repositório sai 2"
F="$TMP/m4"
mkdir -p "$F/scripts"
cp "$GUARD" "$F/scripts/check-doc-hashes.mjs"
copiar_fecho "$F"
recebe "CONTROLE M4 (fail-closed)" "$(rodar "$F")" 2 "árvore que não é repositório sai 2"
mutar_linha "$F" 'throw new Error(`git ${args.join(" ")} falhou' '    return ""'
recebe "M4 (removida)" "$(rodar "$F")" 0 "sem o throw, o não-julgável vira verde"

# ── M5 — o auditor não se conta ────────────────────────────────────────────

header "M5 — o auditor não se conta (a prosa que descreve a classe cita órfãos)"
F="$TMP/m5"
montar "$F"
ORFAO="$(criar_orfao "$F")"
printf '// exemplo de órfão: `%s`\n' "$ORFAO" >>"$F/scripts/check-doc-hashes.mjs"
recebe "CONTROLE M5 (exclusão declarada)" "$(rodar "$F")" 0 "a prosa do próprio auditor não é varrida"
mutar_linha "$F" 'return rel === AUDITOR' '  return false'
recebe "M5 (cegada)" "$(rodar "$F")" 1 "sem a exclusão, o guard reprova o próprio exemplo"

# ── M6 — a extensão fora do escopo ─────────────────────────────────────────

header "M6 — a extensão fora do escopo (.ts de fixture)"
F="$TMP/m6"
montar "$F"
# O id é montado em DUAS metades de 6 hex de propósito: este arquivo está no
# ESCOPO do guard (e o `--root` do fixture não muda o escopo do arquivo da
# suíte), então um literal inteiro aqui seria uma citação dele mesmo.
printf 'const id = "%s%s"\n' "c64695" "cc6952" >"$F/scripts/seed-fixture.ts"
git -C "$F" add -A
recebe "CONTROLE M6 (sono)" "$(rodar "$F")" 0 "o .ts de fixture está fora do escopo"
mutar_linha "$F" 'return FORA_POR_EXTENSAO.some((e) => e.extensoes.some((ext) => arquivo.endsWith(ext)))' '  return false'
recebe "M6 (removida)" "$(rodar "$F")" 1 "sem o .ts fora, o id de seed vira citação"

# ── M7 — o preview NÃO grava ───────────────────────────────────────────────

header "M7 — o preview do --fix NÃO grava (o patch do PR é o mesmo remendo)"
F="$TMP/m7"
montar "$F"
ORFAO="$(criar_orfao_fixavel "$F")"
printf 'o ato foi no `%s`\n' "$ORFAO" >"$F/README.md"
ANTES="$(cksum <"$F/README.md")"
recebe "CONTROLE M7 (preview)" "$(rodar "$F" --fix --dry-run)" 0 "o preview prevê sem gravar"
[ "$(cksum <"$F/README.md")" = "$ANTES" ] || {
  fail "CONTROLE M7: o preview GRAVOU (--dry-run deixou de ser previsão)"
  exit 1
}
# A âncora é a linha da ESCRITA do remendo — que hoje passa pelo formatador do
# repositório (`escreverFormatado`; a doc REMENDADA é versionada e julgada pelo
# `lint`). A mutação tira o `dry` dela: com o preview gravando, o `--dry-run`
# que o comentário do PR publica mentiria.
mutar_linha "$F" 'if (!dry) escreverFormatado(join(root, file), novoConteudo, { root })' '    escreverFormatado(join(root, file), novoConteudo, { root })'
rodar "$F" --fix --dry-run >/dev/null
checar_carga
if [ "$(cksum <"$F/README.md")" = "$ANTES" ]; then
  fail "M7 (cegada) — sem o `dry`, o preview tem de GRAVAR a árvore e não gravou"
  exit 1
fi
pass "M7 (afrouxada) — sem o campo dry o preview GRAVA: o --dry-run que o PR publica mentia"

# ── M8 — a confirmação explícita ───────────────────────────────────────────

header "M8 — a confirmação explícita (sem --yes e sem terminal NADA é gravado)"
F="$TMP/m8"
montar "$F"
ORFAO="$(criar_orfao_fixavel "$F")"
printf 'o ato foi no `%s`\n' "$ORFAO" >"$F/README.md"
ANTES="$(cksum <"$F/README.md")"
# A pergunta desligada por ambiente é o caminho medido de um processo SEM operador
# (o `git commit` entrega o fd 0 em `/dev/null`): sem a quem perguntar, o remédio
# devolve o commit BLOQUEADO com o caminho à mão.
recebe "CONTROLE M8 (sem terminal)" "$(PRE_COMMIT_REMEDY_NO_PROMPT=1 rodar "$F" --fix)" 1 \
  "sem confirmação o remédio não grava e o commit segue bloqueado"
[ "$(cksum <"$F/README.md")" = "$ANTES" ] || {
  fail "CONTROLE M8: o remédio GRAVOU sem confirmação nenhuma"
  exit 1
}
mutar_linha "$F" '  if (yes) return { autorizado: true, motivo: "--yes: a confirmação já foi dada por quem chama" }' '  if (true) return { autorizado: true, motivo: "a confirmação virou inócua" }'
recebe "M8 (cegada)" "$(PRE_COMMIT_REMEDY_NO_PROMPT=1 rodar "$F" --fix)" 0 \
  "sem a confirmação, o remédio se aplica sozinho"
[ "$(cksum <"$F/README.md")" != "$ANTES" ] || {
  fail "M8 (cegada): o remédio disse que aplicou e a árvore não mudou"
  exit 1
}
pass "M8 (cegada) — a árvore mudou sem --yes: a confirmação era o que barrava"

# ── M9 — a prosa da MENSAGEM ───────────────────────────────────────────────

header "M9 — a PROSA DA MENSAGEM (o corpo que cita o commit que a rewrite deixou)"
F="$TMP/m9"
montar "$F"
# O PAR do remédio (o commit citado e o de MESMO assunto que a dobra deixou) e,
# num commit POSTERIOR, a citação no CORPO — o estado exato que uma rewrite deixa
# para trás. O README.md fica limpo de propósito: a violação que o controle mede
# vem SÓ da mensagem, e é isso que separa esta metade das outras oito.
ORFAO="$(criar_orfao_fixavel "$F")"
# `--allow-empty`: o commit de conteúdo vazio isola o defeito da MENSAGEM (o
# README.md do fixture continua 'prosa limpa') — e é a mesma liberdade que a
# história real toma: o que descreve o ato medido não é o diff, é a prosa.
git -C "$F" commit -q --allow-empty -m "chore(bench): o ato versiona a matriz" \
  -m "o registro anterior (${ORFAO}) foi medido com a fatia no ÍNDICE"
recebe "CONTROLE M9 (defeito presente)" "$(rodar "$F")" 1 "a órfã no corpo da MENSAGEM é acusada"
mutar_linha "$F" '  const revisoes = commitsForaDoPublicado(root)' '  const revisoes = []'
recebe "M9 (cegada)" "$(rodar "$F")" 0 "sem a varredura das mensagens, o órfão da mensagem volta a passar"

# ── Veredito ───────────────────────────────────────────────────────────────

echo -e "\n${GREEN}✅ MUTATION TEST PASSOU${NC} — as NOVE metades são LOAD-BEARING:"
info "M1 a regra da história · M2 o número puro · M3 o digest"
info "M4 o fail-closed sem git · M5 a exclusão do auditor · M6 a extensão fora do escopo"
info "M7 o preview não grava · M8 a confirmação explícita"
info "M9 a prosa da MENSAGEM (a citação órfã que nenhum guard de arquivo lê)"
