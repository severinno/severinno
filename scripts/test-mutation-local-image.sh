#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-local-image.sh — Mutation test da DECISÃO do host sem
# registry (`--local-image`) nas DUAS metades: `deploy/gitea-up.sh` (decide) e
# `scripts/ensure-runner-image.mjs` (prova).
#
# Usage:
#   bash scripts/test-mutation-local-image.sh
#
# Exit codes:
#   0 — as QUATRO metades foram DETECTADAS (a prova real e/ou a suíte unitária
#       mudam de veredito pela âncora certa) e o controle passou ✅
#   1 — uma metade NÃO sustentou o veredito (a mutação não mudou a leitura),
#       mutação não-cirúrgica, ou a restauração falhou ❌
#   2 — infra: a leitura por execução não pôde ser montada
#
# O QUE ISTO PROVA (e por que a suíte unitária sozinha não basta)
#
# O `--local-image` é uma DECISÃO: o operador AFIRMA que a imagem está na cópia
# local, e o bring-up cobra a prova (o ensure confere a MESMA referência dos
# labels no daemon DESTE host e devolve um estado próprio, exit 6). Uma suíte
# unitária verde diz que o comportamento de HOJE está certo; ela não diz que as
# REGRAS que o sustentam são load-bearing. As quatro metades abaixo desligam uma
# regra cada e exigem que o veredito MUDE — sem isto, a degradação só apareceria
# quando alguém reparasse, e o CI passaria em silêncio com o beco de volta.
#
# A decisão mora em DOIS arquivos, e é por isso que as metades são quatro:
#
#   · `deploy/gitea-up.sh` — DECIDE. Aceita a flag (e recusa a contradição com
#     `--no-runner`), REPASSA `--local-image` ao ensure e reconhece o exit 6
#     nomeando o que NÃO ficou provado (M1 e M2);
#   · `scripts/ensure-runner-image.mjs` — PROVA. O probe local é o dono do
#     estado: só com a flag, e só com a cópia presente, ele devolve o estado
#     próprio; sem a cópia, o remédio que constrói a imagem aqui é impresso
#     (M3 e M4).
#
# Mutar uma metade só deixaria a outra sem medida — e é justamente a metade não
# mutada que tornaria a mutação "verde" por acidente. Cada metade nomeia o caso
# que cai junto:
#
#   M1 — o REPASSE da flag: sem ele, o CONTROLE (`registry-offline-com-copia-local`)
#        cai — a cópia local deixa de ser pedida e o host sem registry volta ao beco;
#   M2 — a ACEITAÇÃO do INDETERMINADO: reconhecer o exit 3 cru (em vez do 6) faz
#        a recusa de sempre cair — o beco viraria permissão silenciosa;
#   M3 — o ESTADO próprio do ensure: sem ele, a cópia local vira UNKNOWN e o
#        CONTROLE cai (mesmo com a flag, o bring-up recusa);
#   M4 — o PROBE local do ensure: responder `present` sempre faz da flag um
#        cheque em branco — o caso SEM a cópia sobe sem o remédio.
#
# DUAS TESTEMUNHAS INDEPENDENTES
#
#   (1) A LEITURA POR EXECUÇÃO — o driver roda a PROVA REAL
#       (`scripts/prove-runner-image-gate.mjs --json`) contra o registry de TESTE
#       e o daemon dublê: nenhum docker de verdade, nenhuma rede externa e
#       nenhum docker/push entram na medição. O que se lê é o RESULTADO por caso
#       (o exit, se o runner subiu, os `ensureArgs` que o ensure RECEBEU e a
#       falha nomeada). A prova executa o `deploy/gitea-up.sh` E a cópia do
#       ensure DESTA raiz — é por isso que a mutação no lugar é vista.
#   (2) A SUÍTE UNITÁRIA (`prove-runner-image-gate.test.ts`) — o que roda em
#       todo PR. O recorte é o describe que mede esta decisão (`a decisão do host
#       sem registry`), e a âncora do vermelho é o TÍTULO da metade mutada, para
#       o vermelho não ser de outro caso. Sem `vitest` instalado a testemunha se
#       declara NÃO JULGÁVEL em voz alta.
#
# A CIRURGIA: cada injeção casa exatamente 1 ocorrência (0 ou 2+ = a suíte PARA
# em vez de medir outra coisa), o arquivo mutado tem de continuar com sintaxe
# válida (`bash -n` no bring-up, `node --check` no ensure), e a restauração dos
# DOIS arquivos é conferida por CHECKSUM no trap EXIT — um `exit` no meio não
# deixa a árvore mutada.
#
# LIMITES DECLARADOS (o que esta prova NÃO cobre):
#   · a contradição `--local-image` × `--no-runner` e a de `--re-register`: são
#     da suíte unitária do bring-up, e não desta régua;
#   · os estados AUSENTE (4) e falha ao publicar (5), que a flag NÃO afrouxa:
#     quem os mede é a família A da prova e os testes do ensure;
#   · o probe local com docker DUBLÊ: o que se mede é a DECISÃO do ensure sobre
#     o estado do probe, não o `docker image inspect` real;
#   · a decisão NÃO é medida contra um registry de verdade — o terceiro modo do
#     registry de teste é INALCANÇÁVEL (a porta não responde), que é o estado
#     exato sobre o qual a cópia local pode decidir.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'M1|o REPASSE da flag no bring-up: a cópia local deixa de ser pedida e o CONTROLE cai (o host sem registry volta ao beco)'
  'M2|a ACEITAÇÃO do INDETERMINADO sem a flag: o exit 6 reconhecido vira o 3 cru e a recusa de sempre cai (o beco vira permissão silenciosa)'
  'M3|o ESTADO próprio do ensure: a cópia local nunca é aceita e o CONTROLE cai (a cópia local vira UNKNOWN)'
  'M4|o PROBE local do ensure: responder present sempre faz da flag um cheque em branco (o caso SEM a cópia sobe)'
)

cd "$SCRIPT_DIR"

# As DUAS metades da decisão, e a leitura por execução.
BRING_UP="deploy/gitea-up.sh"
ENSURE="scripts/ensure-runner-image.mjs"
PROVA="scripts/prove-runner-image-gate.mjs"
SUITE="src/lib/__tests__/prove-runner-image-gate.test.ts"
# O recorte DECLARADO da testemunha unitária: o describe que mede esta decisão
# (o arquivo inteiro leva ~65s e inclui famílias que não julgam o mecanismo).
FILTRO_SUITE="a decisão do host sem registry"

TMP_DIR="$(mktemp -d)"
F_PROVA="$TMP_DIR/prova.json"
F_SUITE_BRUTO="$TMP_DIR/suite.bruto"
F_SUITE_TXT="$TMP_DIR/suite.txt"

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

# ── Backup das DUAS FONTES + restauração VERIFICADA (trap EXIT) ────────────
# As mutações são aplicadas NO LUGAR (é o arquivo que a prova executa e que a
# suíte unitária lê). O checksum de CADA arquivo é a testemunha de que a árvore
# voltou — os dois, porque as metades atacam os dois.
BACKUP_BRING_UP="$TMP_DIR/bring-up.original.sh"
BACKUP_ENSURE="$TMP_DIR/ensure.original.mjs"
cp "$BRING_UP" "$BACKUP_BRING_UP"
cp "$ENSURE" "$BACKUP_ENSURE"
SUM_BRING_UP="$(cksum "$BRING_UP" | cut -d' ' -f1)"
SUM_ENSURE="$(cksum "$ENSURE" | cut -d' ' -f1)"

restore() {
  if [ -f "$BACKUP_BRING_UP" ]; then cp -f "$BACKUP_BRING_UP" "$BRING_UP" 2>/dev/null || true; fi
  if [ -f "$BACKUP_ENSURE" ]; then cp -f "$BACKUP_ENSURE" "$ENSURE" 2>/dev/null || true; fi
  rm -rf "$TMP_DIR"
}
trap restore EXIT

restaurar_original() {
  cp -f "$BACKUP_BRING_UP" "$BRING_UP"
  cp -f "$BACKUP_ENSURE" "$ENSURE"
  if [ "$(cksum "$BRING_UP" | cut -d' ' -f1)" != "$SUM_BRING_UP" ]; then
    fail "RESTAURAÇÃO FALHOU (checksum do bring-up diverge) — restaure de $BACKUP_BRING_UP"
    exit 1
  fi
  if [ "$(cksum "$ENSURE" | cut -d' ' -f1)" != "$SUM_ENSURE" ]; then
    fail "RESTAURAÇÃO FALHOU (checksum do ensure diverge) — restaure de $BACKUP_ENSURE"
    exit 1
  fi
  pass "as DUAS fontes restauradas (checksums conferem)"
}

# ── O DRIVER: a leitura por execução (a PROVA REAL contra o registry de teste) ──
# `--json` no stdout; a saída humana das famílias vai para o stderr e não polui
# o dado. A prova executa o bring-up DESTA raiz e o ensure DESTA raiz: a mutação
# no lugar entra na medição por construção.
rodar_prova() {
  set +e
  node "$PROVA" --json >"$F_PROVA" 2>"$TMP_DIR/prova.err"
  PROVA_EXIT=$?
  set -e
}

rodar_prova_e_checar() { # <cenário>
  local cenario="$1"
  rodar_prova
  if ! python3 -c 'import json,sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$F_PROVA" \
    >/dev/null 2>&1; then
    fail "$cenario: a LEITURA QUEBROU (prova exit $PROVA_EXIT, JSON ilegível) — o instrumento não mediu a decisão"
    sed 's/^/      /' "$TMP_DIR/prova.err" | tail -8
    exit 2
  fi
}

# ler_caso <id> <campo> — o valor MEDIDO de um caso da prova. Listas saem com os
# itens separados por espaço (para o `grep -qF` de um `--local-image` no argv),
# booleanos como `true`/`false` e ausentes como `null`.
ler_caso() {
  python3 - "$F_PROVA" "$1" "$2" <<'PY'
import json, sys
caminho, cid, campo = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(caminho, encoding="utf-8"))
achado = next((c for c in d["cases"] if c["id"] == cid), None)
if achado is None:
    raise SystemExit(f"caso ausente na prova: {cid}")
v = achado.get(campo)
if isinstance(v, bool):
    print("true" if v else "false")
elif isinstance(v, list):
    print(" ".join(str(x) for x in v))
elif v is None:
    print("null")
else:
    print(v)
PY
}

ler_status() {
  python3 - "$F_PROVA" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], encoding="utf-8")).get("status"))
PY
}

exigir_status() { # <esperado> <cenário>
  local esperado="$1" cenario="$2" obtido
  obtido="$(ler_status)"
  if [ "$obtido" != "$esperado" ]; then
    fail "$cenario: o status da prova é '$obtido' e devia ser '$esperado'"
    exit 1
  fi
  pass "$cenario (status = $esperado)"
}

exigir_igual() { # <id> <campo> <esperado> <cenário>
  local id="$1" campo="$2" esperado="$3" cenario="$4" obtido
  obtido="$(ler_caso "$id" "$campo")"
  if [ "$obtido" != "$esperado" ]; then
    fail "$cenario: $id.$campo é '$obtido' e devia ser '$esperado'"
    exit 1
  fi
  pass "$cenario ($id.$campo = $esperado)"
}

exigir_contem() { # <id> <campo> <trecho> <cenário>
  local id="$1" campo="$2" trecho="$3" cenario="$4" obtido
  obtido="$(ler_caso "$id" "$campo")"
  if ! grep -qF -- "$trecho" <<<"$obtido"; then
    fail "$cenario: $id.$campo não contém '$trecho' (leitura: $obtido)"
    exit 1
  fi
  pass "$cenario ($id.$campo contém '$trecho')"
}

exigir_sem() { # <id> <campo> <trecho> <cenário>
  local id="$1" campo="$2" trecho="$3" cenario="$4" obtido
  obtido="$(ler_caso "$id" "$campo")"
  if grep -qF -- "$trecho" <<<"$obtido"; then
    fail "$cenario: $id.$campo contém '$trecho' e NÃO devia (leitura: $obtido)"
    exit 1
  fi
  pass "$cenario ($id.$campo sem '$trecho')"
}

# ── mutar: substituição LITERAL, cirúrgica, no arquivo de ARQUIVO_MUTADO ───
ARQUIVO_MUTADO=""
SUM_ALVO=""

preparar_mutacao() { # <arquivo>
  ARQUIVO_MUTADO="$1"
  case "$ARQUIVO_MUTADO" in
    "$BRING_UP") SUM_ALVO="$SUM_BRING_UP" ;;
    "$ENSURE") SUM_ALVO="$SUM_ENSURE" ;;
    *)
      fail "alvo de mutação desconhecido: $ARQUIVO_MUTADO"
      exit 1
      ;;
  esac
}

sintaxe_ok() { # <arquivo>
  case "$1" in
    *.sh) bash -n "$1" >/dev/null 2>&1 ;;
    *.mjs) node --check "$1" >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

mutar() { # <alvo-texto> <troca-texto>
  local alvo="$1" troca="$2"
  ARQUIVO="$ARQUIVO_MUTADO" ALVO="$alvo" NOVO="$troca" python3 - <<'PY'
import os
p = os.environ["ARQUIVO"]
s = open(p, encoding="utf-8").read()
n = s.count(os.environ["ALVO"])
if n != 1:
    raise SystemExit(
        f"mutacao nao-cirurgica em {p}: {n} ocorrencia(s) do alvo (esperado 1)"
    )
open(p, "w", encoding="utf-8").write(s.replace(os.environ["ALVO"], os.environ["NOVO"]))
PY
  if ! grep -qF 'MUTACAO M' "$ARQUIVO_MUTADO"; then
    fail "a mutação não aplicou em $ARQUIVO_MUTADO (nada a medir)"
    exit 1
  fi
  if [ "$(cksum "$ARQUIVO_MUTADO" | cut -d' ' -f1)" = "$SUM_ALVO" ]; then
    fail "a mutação não alterou $ARQUIVO_MUTADO (checksum idêntico) — o alvo casou e a escrita não"
    exit 1
  fi
  if ! sintaxe_ok "$ARQUIVO_MUTADO"; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: $ARQUIVO_MUTADO mutado não é válido sintaticamente."
    exit 1
  fi
}

# ── A testemunha unitária (recorte DECLARADO + âncora) ─────────────────────
suite_disponivel() { [ -d "$SCRIPT_DIR/node_modules/vitest" ]; }

rodar_suite() { # [filtro]
  local filtro="${1:-$FILTRO_SUITE}"
  set +e
  (cd "$SCRIPT_DIR" && NO_COLOR=1 bun x vitest run --config vitest.config.unit.ts "$SUITE" -t "$filtro") \
    >"$F_SUITE_BRUTO" 2>&1
  SUITE_EXIT=$?
  set -e
  # ANSI FORA antes de julgar (o vitest colore mesmo com a saída redirecionada,
  # e uma sequência de escape no começo da linha esconderia o `FAIL`/`×`).
  sed -E $'s/\033\\[[0-9;]*[a-zA-Z]//g' "$F_SUITE_BRUTO" >"$F_SUITE_TXT"
  FAIL_LINES="$(grep -E "^[[:space:]]*(FAIL|×)" "$F_SUITE_TXT" || true)"
  # O recorte RODADO = passados + falhados da linha `Tests ` (o verde pode ser 0
  # passados quando o vermelho é o que se mede). A linha dos ARQUIVOS não serve:
  # `Test Files 1 passed` casaria um `1 passed` que não é teste nenhum.
  local linha_tests passados falhados
  linha_tests="$(grep -E '^[[:space:]]*Tests ' "$F_SUITE_TXT" | head -1)"
  passados="$(grep -oE '[0-9]+ passed' <<<"$linha_tests" | grep -oE '[0-9]+' || true)"
  falhados="$(grep -oE '[0-9]+ failed' <<<"$linha_tests" | grep -oE '[0-9]+' || true)"
  RODADOS=$(( ${passados:-0} + ${falhados:-0} ))
  # O PISO do recorte: um filtro que não casa NADA também sai 0 — e aí o verde
  # seria de uma suíte que não rodou. Nunca julgar sem ter rodado.
  if [ "$RODADOS" -eq 0 ]; then
    fail "a suíte NÃO rodou nenhum teste (recorte '$filtro') — um recorte vazio daria verde para qualquer mutação"
    grep -E "^[[:space:]]*(Test Files|Tests) " "$F_SUITE_TXT" | sed 's/^/      /' | head -4
    exit 1
  fi
}

mostrar_suite() { grep -E "^[[:space:]]*(FAIL|×)|Tests " "$F_SUITE_TXT" | sed 's/^/      /' | head -12; }

exigir_suite_verde() { # <cenário>
  local cenario="$1"
  if ! suite_disponivel; then
    info "$cenario (suíte): NÃO julgada — node_modules/vitest ausente neste job (declarado; a leitura por execução SEGUE medindo)"
    return 0
  fi
  rodar_suite "$FILTRO_SUITE"
  if [ "$SUITE_EXIT" -ne 0 ]; then
    fail "$cenario: a suíte ficou VERMELHA sem mutação — o vermelho seguinte não provaria nada (ambiente)"
    mostrar_suite
    exit 1
  fi
  pass "$cenario: suíte VERDE ($RODADOS teste(s) do recorte) — a testemunha mede"
}

# exigir_suite_vermelha <cenário> <âncora da metade mutada>
exigir_suite_vermelha() {
  local cenario="$1" ancora="$2"
  if ! suite_disponivel; then
    info "$cenario (suíte): NÃO julgada (vitest ausente, declarado)"
    return 0
  fi
  rodar_suite "$ancora"
  if [ "$SUITE_EXIT" -eq 0 ]; then
    fail "$cenario: a suíte ficou VERDE com o mecanismo desligado — ele não é load-bearing"
    mostrar_suite
    exit 1
  fi
  if ! grep -qF -- "$ancora" <<<"$FAIL_LINES"; then
    fail "$cenario: vermelho pelo motivo ERRADO — a âncora da metade mutada não caiu:"
    echo "      · $ancora"
    mostrar_suite
    exit 1
  fi
  pass "$cenario: suíte VERMELHA pela metade mutada"
}

# ── As âncoras (o título como o vitest o reporta) ─────────────────────────
# Substrings dos títulos das quatro mutações do describe — o vermelho tem de
# cair na metade mutada, não em outro caso do recorte.
ANCORA_M1="bring-up que NÃO repassa a flag"
ANCORA_M2="bring-up que ACEITA o INDETERMINADO sem a flag"
ANCORA_M3="ensure que NUNCA devolve o estado local"
ANCORA_M4="ensure com o probe local SEMPRE"

# Os três casos da família `registry-offline` — os nomes que a leitura usa.
CASO_SEM_FLAG="registry-offline-sem-flag"
CASO_SEM_COPIA="registry-offline-com-flag-sem-copia"
CASO_CONTROLE="registry-offline-com-copia-local"

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   MUTATION TEST — a DECISÃO do host sem registry (--local-image)"
echo "  ═════════════════════════════════════════════════════════════════"

pass "Backup das duas fontes; checksums iniciais $SUM_BRING_UP / $SUM_ENSURE"

# ── CONTROLE: a decisão íntegra, medida nos dois sentidos ─────────────────
header "CONTROLE — a decisão íntegra: sem a flag recusa, com a cópia sobe"
rodar_prova_e_checar "CONTROLE"
exigir_status "holds" "a prova inteira se sustenta na árvore íntegra"
exigir_igual "$CASO_SEM_FLAG" "ok" "true" "sem a flag o gate de sempre passa (recusa e nada sobe)"
exigir_igual "$CASO_SEM_FLAG" "exit" "3" "e o desfecho é o INDETERMINADO de sempre"
exigir_igual "$CASO_SEM_FLAG" "runnerUp" "false" "o runner NÃO sobe sem a flag"
exigir_sem "$CASO_SEM_FLAG" "ensureArgs" "--local-image" "e o ensure NÃO recebe a flag (nada de cópia local foi pedido)"
exigir_igual "$CASO_SEM_COPIA" "ok" "true" "com a flag e SEM a cópia ainda recusa (a flag não é cheque em branco)"
exigir_igual "$CASO_SEM_COPIA" "runnerUp" "false" "o runner NÃO sobe sem a prova"
exigir_contem "$CASO_SEM_COPIA" "ensureArgs" "--local-image" "mas a flag CHEGA ao ensure (o argv medido)"
exigir_igual "$CASO_SEM_COPIA" "exit" "3" "e sem a cópia o ensure sai 3 (UNKNOWN), NÃO o 6 da cópia local"
exigir_igual "$CASO_CONTROLE" "ok" "true" "CONTROLE: com a flag e a cópia local a stack SOBE"
exigir_igual "$CASO_CONTROLE" "exit" "0" "e o exit é o de sucesso"
exigir_igual "$CASO_CONTROLE" "runnerUp" "true" "o runner sobe — é o contraste que faz das recusas uma prova"
exigir_contem "$CASO_CONTROLE" "ensureArgs" "--local-image" "a flag chegou ao ensure também aqui"
exigir_suite_verde "CONTROLE"

# ── M1: o REPASSE da flag (bring-up) ──────────────────────────────────────
header "M1 — o REPASSE: a flag deixa de chegar ao ensure (a cópia local deixa de ser pedida)"
preparar_mutacao "$BRING_UP"
mutar '[ "$LOCAL_IMAGE" -eq 1 ] && ENSURE_ARGS+=(--local-image)' \
  ': # MUTACAO M1: a flag nao chega ao ensure'
rodar_prova_e_checar "M1"
exigir_status "violated" "M1: a prova cai com o repasse removido"
exigir_igual "$CASO_CONTROLE" "ok" "false" "M1: o CONTROLE cai — a cópia local não é mais pedida"
exigir_sem "$CASO_CONTROLE" "ensureArgs" "--local-image" "M1: o ensure NÃO recebeu a flag (o argv medido)"
exigir_igual "$CASO_CONTROLE" "exit" "3" "M1: o desfecho volta a ser o beco (INDETERMINADO recusa)"
exigir_igual "$CASO_CONTROLE" "runnerUp" "false" "M1: e nada sobe — o host sem registry perde a única saída"
exigir_igual "$CASO_SEM_FLAG" "ok" "true" "M1: os casos SEM a flag seguem verdes (a mutação é cirúrgica)"
exigir_suite_vermelha "M1" "$ANCORA_M1"
restaurar_original

# ── M2: a ACEITAÇÃO do INDETERMINADO (bring-up) ───────────────────────────
header "M2 — a ACEITAÇÃO: o exit 3 cru passa por decisão (o beco vira permissão silenciosa)"
preparar_mutacao "$BRING_UP"
mutar '  if [ "$ENSURE_CODE" -eq 6 ]; then' \
  '  if [ "$ENSURE_CODE" -eq 3 ]; then # MUTACAO M2: aceito o indeterminado de qualquer jeito'
rodar_prova_e_checar "M2"
exigir_status "violated" "M2: a prova cai com a aceitação ampliada"
exigir_igual "$CASO_SEM_FLAG" "ok" "false" "M2: a recusa de SEMPRE cai (o caso sem a flag muda de veredito)"
exigir_igual "$CASO_SEM_FLAG" "runnerUp" "true" "M2: o runner SOBE sem o operador ter decidido nada"
exigir_contem "$CASO_SEM_FLAG" "failures" "runner SUBIU" "M2: e a prova nomeia o pior desfecho"
exigir_suite_vermelha "M2" "$ANCORA_M2"
restaurar_original

# ── M3: o ESTADO próprio do ensure ────────────────────────────────────────
header "M3 — o ESTADO: o ensure nunca aceita a cópia local (a cópia vira UNKNOWN)"
preparar_mutacao "$ENSURE"
mutar '      if (local.state === "present") {' \
  '      if (false) { // MUTACAO M3: a copia local nunca e aceita'
rodar_prova_e_checar "M3"
exigir_status "violated" "M3: a prova cai sem o estado próprio"
exigir_igual "$CASO_CONTROLE" "ok" "false" "M3: o CONTROLE cai mesmo COM a cópia presente"
exigir_igual "$CASO_CONTROLE" "exit" "3" "M3: o bring-up recebe o UNKNOWN de sempre (exit 3), não o 6"
exigir_igual "$CASO_CONTROLE" "runnerUp" "false" "M3: e nada sobe — a cópia local deixa de valer como prova"
exigir_contem "$CASO_CONTROLE" "failures" "NÃO traz o estado 'CÓPIA LOCAL'" "M3: a falha nomeada é o estado que deixou de existir"
exigir_igual "$CASO_SEM_COPIA" "ok" "true" "M3: a recusa SEM a cópia segue recusando (a falha é do estado, não do gate)"
exigir_suite_vermelha "M3" "$ANCORA_M3"
restaurar_original

# ── M4: o PROBE local do ensure ───────────────────────────────────────────
header "M4 — o PROBE: a cópia local 'existe' sempre (a flag vira cheque em branco)"
preparar_mutacao "$ENSURE"
mutar '  const res = run("docker", ["image", "inspect", ref], { allowFailure: true, timeoutMs: 20000 })
  if (res.ok) {' \
  '  const res = run("docker", ["image", "inspect", ref], { allowFailure: true, timeoutMs: 20000 })
  if (true) { // MUTACAO M4: a copia local "existe" sempre'
rodar_prova_e_checar "M4"
exigir_status "violated" "M4: a prova cai com o probe cego"
exigir_igual "$CASO_SEM_COPIA" "ok" "false" "M4: o caso SEM a cópia sobe — a prova do pré-requisito some"
exigir_igual "$CASO_SEM_COPIA" "runnerUp" "true" "M4: o runner SOBE sem a cópia local nenhuma"
exigir_contem "$CASO_SEM_COPIA" "failures" "construa a imagem AQUI" "M4: e o remédio que fechava o beco deixa de ser impresso"
exigir_igual "$CASO_CONTROLE" "ok" "true" "M4: o CONTROLE segue verde (a falha é do PROBE, não da decisão)"
exigir_suite_vermelha "M4" "$ANCORA_M4"
restaurar_original

# ── FECHO ─────────────────────────────────────────────────────────────────
header "FECHO"
rodar_prova_e_checar "FECHO"
exigir_status "holds" "na árvore restaurada, a prova volta a se sustentar"
exigir_igual "$CASO_CONTROLE" "ok" "true" "e o CONTROLE volta a subir"
exigir_igual "$CASO_SEM_FLAG" "runnerUp" "false" "e a recusa sem a flag volta a valer"
exigir_suite_verde "FECHO"
pass "as quatro metades (o repasse, a aceitação, o estado, o probe) foram detectadas; as duas fontes estão restauradas e medindo"
echo ""
