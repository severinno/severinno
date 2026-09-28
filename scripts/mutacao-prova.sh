#!/usr/bin/env bash
# =============================================================================
# scripts/mutacao-prova.sh — a PROVA-DE-APLICAÇÃO das suítes de mutação
#
# Usage:
#   . "$SCRIPT_DIR/scripts/mutacao-prova.sh"      # SOURCED, nunca executado
#   mutacao_aplicar <arquivo> <antes> <depois> <checksum_antes> [<contagem>] [<modo>]
#   mutacao_sintaxe_node <arquivo>
#
# Exit codes:
#   (não tem exit próprio: o módulo é SOURCED. A falha sai pelo `fail` +
#   `exit 1` de quem o chama — o veredito é o da suíte, como sempre foi.)
#
# O QUE ISTO É
#
# A régua ÚNICA de "a mutação APLICOU". Toda suíte de mutação substitui um trecho
# do alvo por outro e precisa PROVAR que a substituição entrou: o alvo pode casar
# e a escrita falhar (permissão, disco, um `open` que não trunca), e uma mutação
# que NÃO aplicou é medida contra o alvo ÍNTEGRO — a suíte passaria em VÁCUO, com
# o verde sobre uma árvore que ninguém mutou. O gabarito dessa prova é a suíte
# `scripts/test-mutation-mutacao-prova.sh`: ela tira a prova do lugar e exige o
# vermelho.
#
# POR QUE UMA RÉGUA SÓ (o defeito medido)
#
# A checagem vivia COPIADA em cada suíte — a mesma dezena de linhas de `mutar`,
# reimplementada dezenove vezes com uma variação a cada cópia (o nome da variável
# do arquivo, o da variável do checksum, o idioma do marcador, a checagem de
# sintaxe presente ou não). Medido em 27/09/2026: das 44 suítes que injetam uma
# mutação cujo payload CARREGA o marcador `MUTACAO`, apenas 18 verificavam que ele
# chegou ao arquivo; e uma suíte que simplesmente apagasse a sua cópia da
# checagem continuava VERDE — o vácuo entrava sem deixar rastro, porque uma cópia
# que some não tem como ser notada. Aqui ela é UMA, e é ela que o gabarito mede.
#
# AS TRÊS PROVAS (todas fail-closed, nesta ordem)
#
#   1. CIRURGIA — o `<antes>` casa UM (e só um) lugar no arquivo. Zero (o alvo
#      foi refatorado e a mutação é bobagem) ou dois ou mais (o alvo é ambíguo e a
#      substituição mediria outra coisa) é mutação NÃO-CIRÚRGICA: a suíte PARA em
#      vez de medir outra coisa. A contagem esperada é parâmetro (`<contagem>`,
#      default 1) porque há mutações que substituem N ocorrências de propósito.
#   2. APLICAÇÃO (o MARCADOR) — o arquivo passa a carregar o marcador `MUTACAO`.
#      É a prova de que a ESCRITA entrou, e é a que o gabarito tira do lugar. O
#      marcador é a identidade da mutação no payload: quem muta o carrega no texto
#      NOVO (`// MUTACAO M1: a lista derivada esvaziada`), e é ele que a prosa da
#      doc, a régua das metades e o `MUTACAO M` de sempre leem.
#   3. CONTEÚDO — o checksum do arquivo MUDOU. É a prova de que o conteúdo mudou
#      (o `<antes>` pode casar, a escrita entrar e o texto ser idêntico — um
#      remendo de espaços, um `<depois>` igual ao `<antes>`).
# O QUE A SUÍTE PRECISA TER DEFINIDO: só o `fail` de sempre (uma função global),
# já que o módulo é sourced no shell dela. O `<modo>` `binario` existe para os
# alvos que NÃO são utf-8 (o `workflow-refs` muta um YAML lido em bytes).
#
# CADA PROVA TEM UM SÍTIO PRÓPRIO. A prova 2 e a prova 3 são PREDICADOS com nome
# (`mutacao_carregou_marcador`, `mutacao_mudou_conteudo`) e o ponto onde cada um é
# cobrado é uma linha só — é esse sítio que o gabarito desliga para medir que a
# prova é load-bearing. Sem o sítio isolado, o gabarito teria de mutar a checagem
# no meio de outra linha, e a mutação mediria outra coisa.
# ============================================================================

# A PROVA 2, isolada: o arquivo carrega o marcador? Os dois idiomas entram porque
# a convenção do repositório usa o ASCII (`MUTACAO M`) e a régua das metades
# (`scripts/metades.mjs`) também aceita o acentuado.
mutacao_carregou_marcador() { # $1 = arquivo
  grep -qF -e 'MUTACAO' -e 'MUTAÇÃO' "$1"
}

# A PROVA 3, isolada: o conteúdo MUDOU? (o `cksum` de agora difere do de antes)
mutacao_mudou_conteudo() { # $1 = arquivo, $2 = checksum de antes
  [ "$(cksum "$1" | cut -d' ' -f1)" != "$2" ]
}

# ============================================================================

# mutacao_aplicar <arquivo> <antes> <depois> <checksum_antes> [<contagem>=1] [<modo>=texto]
#
# Aplica a mutação e prova que ela aplicou. QUALQUER falha chama `fail` e sai 1 —
# a suíte nunca segue medindo um alvo que ela não conseguiu mutar.
mutacao_aplicar() {
  local arquivo="$1" antes="$2" depois="$3" checksum="$4" contagem="${5:-1}" modo="${6:-texto}"

  if [ ! -f "$arquivo" ]; then
    fail "a mutação não tem alvo: '$arquivo' não existe (nada a medir)"
    exit 1
  fi

  # 1. CIRURGIA — a substituição literal, com a contagem conferida DENTRO do
  # python (o texto do alvo pode ter aspas, quebras e acento: montar isso na
  # linha de comando do shell seria uma segunda fonte de defeito).
  MUT_ARQ="$arquivo" MUT_ANTES="$antes" MUT_DEPOIS="$depois" \
    MUT_CONTAGEM="$contagem" MUT_MODO="$modo" python3 - <<'PY'
import os


def conta(data, velho, p, esperado):
    """A CIRURGIA: o alvo casa exatamente `esperado` lugar(es) — UM sítio só,
    compartilhado pelos dois modos, para o gabarito poder desligá-la."""
    n = data.count(velho)
    if n != esperado:
        raise SystemExit(
            f"mutacao nao-cirurgica em {p}: {n} ocorrencia(s) do alvo (esperado {esperado})"
        )
    return n


p = os.environ["MUT_ARQ"]
old = os.environ["MUT_ANTES"]
new = os.environ["MUT_DEPOIS"]
esperado = int(os.environ["MUT_CONTAGEM"])
modo = os.environ["MUT_MODO"]

if modo == "binario":
    data = open(p, "rb").read()
    velho, novo = old.encode("utf-8"), new.encode("utf-8")
    conta(data, velho, p, esperado)
    open(p, "wb").write(data.replace(velho, novo))
else:
    s = open(p, encoding="utf-8").read()
    conta(s, old, p, esperado)
    open(p, "w", encoding="utf-8").write(s.replace(old, new))
PY

  # 2. APLICAÇÃO — o marcador chegou ao arquivo? (a prova que o gabarito mede)
  if ! mutacao_carregou_marcador "$arquivo"; then
    fail "a mutação não aplicou em $arquivo (nada a medir) — a troca tem de carregar o marcador MUTACAO, a prova de que a escrita entrou"
    exit 1
  fi

  # 3. CONTEÚDO — o checksum mudou?
  if ! mutacao_mudou_conteudo "$arquivo" "$checksum"; then
    fail "a mutação não alterou $arquivo (checksum idêntico) — o alvo casou mas a escrita não mudou o conteúdo"
    exit 1
  fi
}

# mutacao_sintaxe_node <arquivo>
#
# O alvo mutado continua sendo JavaScript válido? É a checagem de sintaxe que as
# suítes de guard .mjs fazem (a mutação que quebra o parse deixaria o veredito
# vir de um `node` que morreu, não da regra que a metade tira do lugar).
mutacao_sintaxe_node() {
  if ! node --check "$1" >/dev/null 2>&1; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: $1 mutado não é válido sintaticamente."
    exit 1
  fi
}
