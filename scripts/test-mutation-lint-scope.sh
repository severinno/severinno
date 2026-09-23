#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-lint-scope.sh — Mutation test do ESCPO do lint
# (`scripts/check-lint-scope.mjs`)
#
# Usage:
#   ./scripts/test-mutation-lint-scope.sh
#
# Exit codes:
#   0 — as SEIS metades foram DETECTADAS (a leitura por execução muda na
#       direção do defeito E a suíte unitária fica vermelha pela metade certa) e
#       os controles passaram ✅
#   1 — uma metade NÃO sustentou o veredito (o guard seguiu medindo igual com o
#       mecanismo desligado), mutação não-cirúrgica, âncora errada ou
#       restauração falhou ❌
#   2 — infra: não foi possível montar a bancada (git ausente)
#
# O QUE ISTO PROVA (e por que o guard passar hoje não basta)
#
# O `check-lint-scope` existe porque o lint julhava uma LISTA A MAO e o hook
# julga TODO arquivo estagiado: 13 diretorios com arquivo que o prettier julga
# ficavam fora dela (`.gitea/` incluso — as workflows da forja dona do merge) e
# o `ci/unproven.json` fora do padrao passou o lint verde. O veredito dele e um
# CONTRATO — e um contrato que passa nao prova que as SEIS reguas que o
# sustentam estao no lugar:
#
#   M1 — O ORACULO. Quem sabe se o prettier JULGA um arquivo e o proprio
#        prettier (`getFileInfo`); sem perguntar, um diretorio cheio de binario
#        vira violacao (falso positivo) e a bancada saudavel fica vermelha.
#        Mutacao: o oraculo deixa de ser consultado e todo candidato vira
#        julgado.
#   M2 — A COBERTURA. `coveredBy` e o que responde "algum globo cobre este
#        caminho?" — a semantica do fast-glob, com `**` cruzando diretorio e
#        `*.json` casando so a raiz. Mutacao: todo caminho passa a ser coberto, e
#        o buraco (o diretorio novo) desaparece do veredito: o guard fica CEGO
#        exatamente para o defeito que ele existe para pegar.
#   M3 — A DECLARACAO DE ESCOPO. O `.prettierignore` e a outra metade do escopo
#        (e o instrumento do artefato gerado). Em UTF-16 o prettier o le como
#        UTF-8, todo padrao vira lixo e a declaracao nao declara nada. Mutacao:
#        a ilegibilidade deixa de ser violacao.
#   M4 — O RECORTE `--staged`. O hook julga o INDICE; a arvore pode carregar WIP
#        que nao e o commit. Mutacao: o recorte le a arvore e acusa o WIP que
#        ninguem vai commitar.
#   M5 — A ISENCAO ORFA. Uma entrada de `EXEMPT` que nao casa com arquivo nenhum
#        e uma tabela que ninguem revisa — o proximo diretorio pode entrar nela
#        em silencio. Mutacao: a isencao sem efeito deixa de ser violacao.
#   M6 — O RECORTE POR RELEVANCIA. Um globo REMOVIDO nao aparece em arquivo
#        estagiado nenhum (o que saiu foi a linha da declaracao), entao um commit
#        que mexe no escopo tem de julgar a ARVORE — e a declaracao lida e a do
#        INDICE (o conteudo do commit). Mutacao: mexer na declaracao deixa de
#        julgar a arvore, e o buraco que o commit abre passa em silencio.
#
# A DIRECAO e a do defeito, nao a do guard: em cada metade se exige que a LEITURA
# mude para o lado do defeito (falso positivo no sao, cegueira no buraco), e cada
# uma tem por CONTROLE a leitura integra da MESMA bancada ANTES da injecao.
#
# DUAS TESTEMUNHAS INDEPENDENTES
#
#   (1) A LEITURA POR EXECUCAO — o driver importa o `check-lint-scope.mjs` (o
#       mutado, quando ha mutacao) e mede contra uma BANCADA: repositorios git
#       temporarios FORA do projeto, com o `package.json` do lint, um arquivo
#       COBERTO, um diretorio NOVO com arquivo que o prettier julga, um binario
#       (que o prettier NAO julga) e uma variante com o `.prettierignore` em
#       UTF-16. O que se le e o RESULTADO (exit, `judged`, as violacoes),
#       nunca o texto do arquivo. O oraculo e o prettier REAL (resolvido do
#       `node_modules` do repo, porque o import e do lugar do guard).
#   (2) A SUITE UNITARIA (`check-lint-scope.test.ts`) — o que roda em todo PR.
#       Cada metade exige o vermelho DELA, com a ancora da metade certa. Sem
#       `vitest` instalado a testemunha se declara NAO JULGAVEL em voz alta.
#
# POR QUE A ANCORA E SO A DA METADE MUTADA: as seis reguas nao vivem em testes
# independentes — `coveredBy` (M2) decide tambem o caso do indice, e o oraculo
# (M1) decide tambem o da bancada `--staged`. Exigir "as outras metades verdes"
# mediria o acoplamento dos testes, nao a regua. O que a ancora prova e que o
# vermelho veio da metade CERTA, e nao de um modulo que morreu.
#
# A CIRURGIA: cada injecao casa exatamente 1 ocorrencia (0 ou 2+ = a suite PARA
# em vez de medir outra coisa), o guard mutado tem de continuar com sintaxe
# valida, e a restauracao e conferida por CHECKSUM no trap EXIT — um `exit` no
# meio nao deixa o guard mutado na arvore.
#
# LIMITES DECLARADOS (o que esta prova NAO cobre):
#   · o teste de INTEGRACAO do guard (o CLI no repo real) cai junto com qualquer
#     metade mutada — ele roda a arvore de verdade, e nao e ancora de metade
#     nenhuma: por isso fica fora das ancoras exigidas.
#   · a bancada e um repo git de FIXTURE: os diretorios reais do projeto (o
#     `.gitea/`, o `ci/`) nao sao mutados por esta suite — o que se mede e a
#     REGUA, e o guard real sobre a arvore real e o proprio `check-lint-scope`
#     rodando no CI.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'M1|o ORÁCULO: o prettier deixa de ser consultado e todo candidato vira julgado (falso positivo no são)'
  'M2|a COBERTURA: todo caminho passa a ser coberto e o diretório novo desaparece do veredito (cegueira no buraco)'
  'M3|a DECLARAÇÃO de escopo: o `.prettierignore` ilegível (UTF-16) deixa de ser violação'
  'M4|o RECORTE `--staged`: lê a árvore em vez do índice e um commit que não abre o buraco é bloqueado por ele'
  'M5|a ISENÇÃO ÓRFÃ: uma entrada de EXEMPT sem efeito deixa de ser violação'
  'M6|o RECORTE POR RELEVÂNCIA: mexer na DECLARAÇÃO do escopo deixa de julgar a árvore (o globo removido passa)'
)

cd "$SCRIPT_DIR"

GUARD="scripts/check-lint-scope.mjs"
SUITE="src/lib/__tests__/check-lint-scope.test.ts"

TMP_DIR="$(mktemp -d)"
BANCADA="$TMP_DIR/bancada"
BANCADA_OK="$TMP_DIR/bancada-ok"
BANCADA_UTF16="$TMP_DIR/bancada-utf16"
BANCADA_IDX="$TMP_DIR/bancada-indice"
F_DRIVER="$TMP_DIR/driver.json"
F_SUITE="$TMP_DIR/suite.txt"

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
# A mutação é aplicada NO LUGAR (é o arquivo que o driver importa e que a suíte
# unitária lê). O checksum é a testemunha de que a árvore voltou.
BACKUP="$TMP_DIR/guard.original.mjs"
cp "$GUARD" "$BACKUP"
GUARD_SUM="$(cksum "$GUARD" | cut -d' ' -f1)"

restore() {
  if [ -f "$BACKUP" ]; then cp -f "$BACKUP" "$GUARD" 2>/dev/null || true; fi
  rm -rf "$TMP_DIR"
}
trap restore EXIT

restaurar_original() {
  cp -f "$BACKUP" "$GUARD"
  if [ "$(cksum "$GUARD" | cut -d' ' -f1)" != "$GUARD_SUM" ]; then
    fail "RESTAURAÇÃO FALHOU (checksum do guard diverge) — restaure a partir de $BACKUP"
    exit 1
  fi
  pass "guard restaurado (checksum confere)"
}

# ── montar_bancada <dir> <globs do lint> <arquivos extras> ────────────────
# O `package.json` da bancada declara o comando do lint — é dele que o guard
# DERIVA os globs (a fonte única), então a bancada mede a régua inteira.
montar_bancada() {
  local dir="$1" globs="$2"
  rm -rf "$dir"
  mkdir -p "$dir/src" "$dir/ci" "$dir/assets"
  cat >"$dir/package.json" <<JSON
{
  "scripts": {
    "lint": "prettier --check --ignore-unknown $globs && eslint . --max-warnings 0"
  }
}
JSON
  printf 'const a = 1\n' >"$dir/src/a.ts"
  printf '{\n  "x": 1\n}\n' >"$dir/ci/dado.json"
  # Um PNG: o prettier NÃO o julga (é o caso do falso positivo da M1).
  printf 'PNG-bytes\n' >"$dir/assets/foto.png"
  git -C "$dir" init -q
  git -C "$dir" config user.email "mutation@test"
  git -C "$dir" config user.name "mutation test"
  git -C "$dir" config core.autocrlf false
  git -C "$dir" add -A
  git -C "$dir" commit -qm "bancada"
}

# A bancada COM o buraco: `ci/` fora dos globs (é o defeito que o guard pega).
montar_bancada "$BANCADA" "'src/**' '*.json'"
# A bancada SÃ: o mesmo conteúdo com `ci/` coberto.
montar_bancada "$BANCADA_OK" "'src/**' 'ci/**' '*.json'"
# A bancada com a DECLARAÇÃO ilegível (o estado real do .prettierignore antes
# desta rodada: BOM UTF-16LE + NUL entre os bytes).
cp -r "$BANCADA_OK/." "$BANCADA_UTF16/"
python3 - "$BANCADA_UTF16/.prettierignore" <<'PY'
import sys
open(sys.argv[1], "wb").write(b"\xff\xfe" + "public/openapi.json\r\n".encode("utf-16le"))
PY
git -C "$BANCADA_UTF16" add -A
git -C "$BANCADA_UTF16" commit -qm "declaracao ilegivel"

# A bancada em que o COMMIT move a DECLARACAO: o indice declara sem `ci/**` (o
# globo removido) e a arvore de trabalho segue com ele. E o caso que nenhum
# arquivo estagiado denuncia — o que saiu foi a linha do comando.
montar_bancada "$BANCADA_IDX" "'src/**' 'ci/**' '*.json'"
cp "$BANCADA_IDX/package.json" "$TMP_DIR/pkg-ok.json"
python3 - "$BANCADA_IDX/package.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d["scripts"]["lint"] = d["scripts"]["lint"].replace("'ci/**' ", "")
json.dump(d, open(p, "w"), indent=2)
open(p, "a").write("\n")
PY
git -C "$BANCADA_IDX" add package.json
cp "$TMP_DIR/pkg-ok.json" "$BANCADA_IDX/package.json"

# ── O DRIVER: a leitura por execução ───────────────────────────────────────
# Importa o guard (mutado, quando há mutação) e mede as bancadas. O stdout é o
# JSON da leitura; as asserções leem ARQUIVO (nunca `… | grep` sob pipefail).
rodar_driver() {
  set +e
  GUARD_URL="file://$SCRIPT_DIR/$GUARD" \
  BANCADA="$BANCADA" BANCADA_OK="$BANCADA_OK" BANCADA_UTF16="$BANCADA_UTF16" \
  BANCADA_IDX="$BANCADA_IDX" \
    node --input-type=module -e '
const mod = await import(process.env.GUARD_URL)

// O ESTADO DO RECORTE e RESTAURADO antes de medir: o WIP da rodada anterior
// ficou no indice da bancada (e o `ok` desta rodada o leria na arvore).
const { mkdirSync, writeFileSync, rmSync } = await import("node:fs")
const { execFileSync } = await import("node:child_process")
rmSync(process.env.BANCADA_OK + "/e2e", { recursive: true, force: true })
try {
  execFileSync("git", ["rm", "-r", "--cached", "-q", "e2e"], { cwd: process.env.BANCADA_OK })
} catch {
  /* nada estagiado: o estado ja e o inicial */
}

const gap = await mod.analyze({ cwd: process.env.BANCADA })
// O RECORTE contra o buraco PRE-EXISTENTE: nada esta estagiado, entao o commit
// nao abre a lacuna e ele nao pode ser bloqueado por ela (quem a julga e a
// varredura do CI).
const stagedGap = await mod.analyze({ cwd: process.env.BANCADA, staged: true })
// A DECLARACAO que o commit move: o indice sem `ci/**`, a arvore com ele.
const idxStaged = await mod.analyze({ cwd: process.env.BANCADA_IDX, staged: true })
const idxTree = await mod.analyze({ cwd: process.env.BANCADA_IDX })
const ok = await mod.analyze({ cwd: process.env.BANCADA_OK })
const utf16 = await mod.analyze({ cwd: process.env.BANCADA_UTF16 })
// A ISENÇÃO ÓRFÃ: uma entrada que não casa com arquivo nenhum da bancada.
const orfa = await mod.analyze({
  cwd: process.env.BANCADA_OK,
  exempt: new Map([["k6", "carga (diretorio que a bancada nao tem)"]]),
})

// O RECORTE: um arquivo escrito na ÁRVORE e fora do índice não é o commit.
mkdirSync(process.env.BANCADA_OK + "/e2e", { recursive: true })
writeFileSync(process.env.BANCADA_OK + "/e2e/wip.spec.ts", "const b = 1\n")
const stagedWip = await mod.analyze({ cwd: process.env.BANCADA_OK, staged: true })
execFileSync("git", ["add", "e2e/wip.spec.ts"], { cwd: process.env.BANCADA_OK })
const stagedIdx = await mod.analyze({ cwd: process.env.BANCADA_OK, staged: true })

process.stdout.write(
  JSON.stringify({
    gap: { exit: gap.exit, judged: gap.judged, dirs: gap.dirs },
    stagedGap: { exit: stagedGap.exit, judged: stagedGap.judged, files: stagedGap.files },
    idxStaged: { exit: idxStaged.exit, judged: idxStaged.judged, scope: idxStaged.scope },
    idxTree: { exit: idxTree.exit, judged: idxTree.judged },
    ok: { exit: ok.exit, judged: ok.judged, candidates: ok.candidates },
    utf16: { exit: utf16.exit, violacoes: utf16.violations },
    orfa: { exit: orfa.exit, violacoes: orfa.violations },
    stagedWip: { exit: stagedWip.exit, judged: stagedWip.judged },
    stagedIdx: { exit: stagedIdx.exit, judged: stagedIdx.judged },
  }) + "\n",
)
' >"$F_DRIVER" 2>"$TMP_DIR/driver.err"
  DRIVER_EXIT=$?
  set -e
}

ler() { python3 -c "
import json,sys
d = json.load(open('$F_DRIVER'))
v = d
for k in sys.argv[1].split('.'):
    v = v[int(k)] if k.isdigit() else v[k]
print(v)
" "$1"; }

rodar_driver_e_checar() { # <cenário> — o driver rodou e produziu leitura
  local cenario="$1"
  rodar_driver
  if [ "$DRIVER_EXIT" -ne 0 ]; then
    fail "$cenario: a LEITURA QUEBROU (driver exit $DRIVER_EXIT) — a mutação derrubou o módulo em vez de medir a régua"
    sed 's/^/      /' "$TMP_DIR/driver.err" | tail -6
    exit 1
  fi
}

# exigir_igual <caminho> <esperado> <cenário> — o valor MEDIDO, byte a byte.
exigir_igual() {
  local caminho="$1" esperado="$2" cenario="$3"
  local obtido
  obtido="$(ler "$caminho")"
  if [ "$obtido" != "$esperado" ]; then
    fail "$cenario: a leitura de $caminho é '$obtido' e devia ser '$esperado'"
    echo "      leitura: $(cat "$F_DRIVER")"
    exit 1
  fi
  pass "$cenario ($caminho = $esperado)"
}

# ── mutar <alvo> <troca>: substituição LITERAL, cirúrgica ─────────────────
mutar() {
  local alvo="$1" troca="$2"
  ARQUIVO="$GUARD" ALVO="$alvo" NOVO="$troca" python3 - <<'PY'
import os
p = os.environ["ARQUIVO"]
s = open(p, encoding="utf-8").read()
n = s.count(os.environ["ALVO"])
if n != 1:
    raise SystemExit(
        f"mutacao nao-cirurgica no guard: {n} ocorrencia(s) do alvo (esperado 1)"
    )
open(p, "w", encoding="utf-8").write(s.replace(os.environ["ALVO"], os.environ["NOVO"]))
PY
  if ! grep -qF 'MUTACAO M' "$GUARD"; then
    fail "a mutação não aplicou no guard (nada a medir)"
    exit 1
  fi
  if [ "$(cksum "$GUARD" | cut -d' ' -f1)" = "$GUARD_SUM" ]; then
    fail "a mutação não alterou o guard (checksum idêntico) — o alvo casou e a escrita não"
    exit 1
  fi
  if ! node --check "$GUARD" >/dev/null 2>&1; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: o guard mutado não é válido sintaticamente."
    exit 1
  fi
}

# ── A testemunha unitária (âncoras) ───────────────────────────────────────
suite_disponivel() { [ -d "$SCRIPT_DIR/node_modules/vitest" ]; }

rodar_suite() {
  set +e
  (cd "$SCRIPT_DIR" && NO_COLOR=1 bun x vitest run --config vitest.config.unit.ts "$SUITE") \
    >"$TMP_DIR/suite.bruto" 2>&1
  SUITE_EXIT=$?
  set -e
  # ANSI FORA antes de julgar (o vitest colore mesmo com a saída redirecionada,
  # e uma sequência de escape no começo da linha esconderia o `FAIL`/`×`).
  sed -E $'s/\033\\[[0-9;]*[a-zA-Z]//g' "$TMP_DIR/suite.bruto" >"$F_SUITE"
  FAIL_LINES="$(grep -E "^[[:space:]]*(FAIL|×)" "$F_SUITE" || true)"
}

mostrar_suite() { grep -E "^[[:space:]]*(FAIL|×)|Tests " "$F_SUITE" | sed 's/^/      /' | head -12; }

exigir_suite_verde() {
  local cenario="$1"
  if ! suite_disponivel; then
    info "$cenario (suíte): NÃO julgada — node_modules/vitest ausente neste job (declarado; a leitura por execução SEGUE medindo)"
    return 0
  fi
  rodar_suite
  if [ "$SUITE_EXIT" -ne 0 ]; then
    fail "$cenario: a suíte ficou VERMELHA sem mutação — o vermelho seguinte não provaria nada (ambiente)"
    mostrar_suite
    exit 1
  fi
  pass "$cenario: suíte VERDE (exit 0) — a testemunha mede"
}

# exigir_suite_vermelha <cenário> <âncora da metade mutada>
exigir_suite_vermelha() {
  local cenario="$1" ancora="$2"
  if ! suite_disponivel; then
    info "$cenario (suíte): NÃO julgada (vitest ausente, declarado)"
    return 0
  fi
  rodar_suite
  if [ "$SUITE_EXIT" -eq 0 ]; then
    fail "$cenario: a suíte ficou VERDE com o mecanismo desligado — ele não é load-bearing"
    mostrar_suite
    exit 1
  fi
  if ! grep -qF "$ancora" <<<"$FAIL_LINES"; then
    fail "$cenario: vermelho pelo motivo ERRADO — a âncora da metade mutada não caiu:"
    echo "      · $ancora"
    mostrar_suite
    exit 1
  fi
  pass "$cenario: suíte VERMELHA pela metade mutada"
}

# ── As âncoras (títulos como o vitest os reporta) ─────────────────────────
ANCORA_M1="arquivo que o prettier NÃO julga (imagem) não é falso positivo"
ANCORA_M2="diretório novo com arquivo JULGADO é violação, nomeando diretório e remédio"
ANCORA_M3="um arquivo ILEGÍVEL de declaração (UTF-16/NUL) é violação — a declaração que não declara nada"
ANCORA_M4="o recorte --staged lê o ÍNDICE: o arquivo que só existe na árvore não é julgado"
ANCORA_M5="isenção ÓRFÃ (não casa com arquivo nenhum) é violação"
ANCORA_M6="a DECLARAÇÃO que o commit move julga a ÁRVORE: o globo removido no índice abre buraco em todo o repositório"

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   MUTATION TEST — o escopo do lint ($GUARD)"
echo "  ═════════════════════════════════════════════════════════════════"

pass "Backup do guard; checksum inicial $GUARD_SUM"

# ── CONTROLE: a leitura íntegra das bancadas ──────────────────────────────
header "CONTROLE — a régua íntegra mede as duas direções"
rodar_driver_e_checar "CONTROLE"
exigir_igual "gap.exit" "1" "o buraco é visto"
exigir_igual "gap.judged" "['ci/dado.json']" "o arquivo do diretório fora é nomeado"
exigir_igual "ok.exit" "0" "a bancada são fica verde"
exigir_igual "ok.judged" "[]" "e o PNG não é julgado (o oráculo respondeu)"
exigir_igual "utf16.exit" "1" "a declaração ilegível é violação"
exigir_igual "orfa.exit" "1" "a isenção órfã é violação"
exigir_igual "stagedGap.exit" "0" "o recorte NÃO bloqueia um commit que não abre o buraco"
exigir_igual "stagedGap.judged" "[]" "e não julga nada quando o índice não tem mudança"
exigir_igual "idxStaged.exit" "1" "o commit que move a DECLARAÇÃO é julgado pela árvore"
exigir_igual "idxStaged.judged" "['ci/dado.json']" "e o buraco que ele abre é nomeado"
exigir_igual "idxTree.exit" "0" "a árvore, que ainda declara o globo, é o outro veredito (o do CI)"
exigir_igual "stagedWip.judged" "[]" "o recorte não vê o WIP"
exigir_igual "stagedIdx.judged" "['e2e/wip.spec.ts']" "e vê o que entrou no índice"
exigir_suite_verde "CONTROLE"

# ── M1: o ORÁCULO ─────────────────────────────────────────────────────────
header "M1 — o ORÁCULO: o prettier deixa de ser consultado"
mutar 'judged: info.inferredParser !== null && info.inferredParser !== undefined' \
  'judged: true /* MUTACAO M1 */'
rodar_driver_e_checar "M1"
exigir_igual "ok.exit" "1" "M1: a bancada SÃ passa a ser acusada (o defeito do falso positivo)"
exigir_igual "ok.judged" "['assets/foto.png']" "M1: o PNG vira 'julgado' sem o oráculo"
exigir_igual "gap.exit" "1" "M1: o buraco CONTINUA visto (a régua mutada não é a da cobertura)"
exigir_suite_vermelha "M1" "$ANCORA_M1"
restaurar_original

# ── M2: a COBERTURA ───────────────────────────────────────────────────────
header "M2 — a COBERTURA: todo caminho passa a ser coberto"
mutar 'return globs.some((g) => globToRegExp(g).test(path))' \
  'return true /* MUTACAO M2 */'
rodar_driver_e_checar "M2"
exigir_igual "gap.exit" "0" "M2: o diretório novo sai do veredito — o guard fica CEGO no buraco"
exigir_igual "gap.judged" "[]" "M2: nada é julgado"
exigir_igual "ok.exit" "0" "M2: a bancada são segue verde (a cegueira não acusa o são)"
exigir_suite_vermelha "M2" "$ANCORA_M2"
restaurar_original

# ── M3: a DECLARAÇÃO de escopo ────────────────────────────────────────────
header "M3 — a DECLARAÇÃO: o .prettierignore ilegível deixa de ser violação"
mutar '    if (!verdict.ok) base.violations.push(verdict.why)' \
  '    if (false /* MUTACAO M3 */) base.violations.push(verdict.why)'
rodar_driver_e_checar "M3"
exigir_igual "utf16.exit" "0" "M3: a declaração ilegível passa em silêncio"
exigir_igual "gap.exit" "1" "M3: o buraco CONTINUA visto (a régua mutada não é a da cobertura)"
exigir_suite_vermelha "M3" "$ANCORA_M3"
restaurar_original

# ── M4: o RECORTE --staged ────────────────────────────────────────────────
header "M4 — o RECORTE: lê a árvore em vez do índice"
mutar '  const args = staged ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR"] : ["ls-files"]' \
  '  const args = staged ? ["ls-files"] /* MUTACAO M4 */ : ["ls-files"]'
rodar_driver_e_checar "M4"
exigir_igual "stagedGap.exit" "1" "M4: um commit que NÃO abre o buraco passa a ser bloqueado por ele"
exigir_igual "stagedGap.judged" "['ci/dado.json']" "M4: e o recorte o nomeia"
exigir_igual "stagedWip.judged" "[]" "M4: o recorte segue sem ver o WIP (a mutação é cirúrgica)"
exigir_igual "gap.exit" "1" "M4: o buraco CONTINUA visto (a régua mutada não é a da cobertura)"
exigir_suite_vermelha "M4" "$ANCORA_M4"
restaurar_original

# ── M5: a ISENÇÃO ÓRFÃ ────────────────────────────────────────────────────
header "M5 — a ISENÇÃO ÓRFÃ: a tabela que ninguém revisa"
mutar '  for (const dir of exempt.keys()) {
    if (!usedExempt.has(dir)) {' \
  '  for (const dir of []) {
    if (!usedExempt.has(dir)) { /* MUTACAO M5 */'
rodar_driver_e_checar "M5"
exigir_igual "orfa.exit" "0" "M5: a isenção sem efeito passa sem ninguém decidir"
exigir_igual "gap.exit" "1" "M5: o buraco CONTINUA visto (a régua mutada não é a da isenção)"
exigir_suite_vermelha "M5" "$ANCORA_M5"
restaurar_original

# ── M6: o RECORTE POR RELEVÂNCIA ──────────────────────────────────────────
header "M6 — o RECORTE POR RELEVÂNCIA: mexer na declaração deixa de julgar a árvore"
mutar "const tocaDeclaracao = staged && files.some((f) => f === PKG || f === IGNORE_FILE)" \
  "const tocaDeclaracao = false /* MUTACAO M6 */"
rodar_driver_e_checar "M6"
exigir_igual "idxStaged.exit" "0" "M6: o globo removido no commit passa em silêncio"
exigir_igual "idxStaged.judged" "[]" "M6: nada é julgado — o buraco não tem arquivo estagiado que o denuncie"
exigir_igual "idxTree.exit" "0" "M6: a árvore segue verde (a régua mutada não é a da árvore)"
exigir_igual "gap.exit" "1" "M6: o buraco da bancada simples CONTINUA visto (a mutação é cirúrgica)"
exigir_suite_vermelha "M6" "$ANCORA_M6"
restaurar_original

# ── Fecho ─────────────────────────────────────────────────────────────────
header "FECHO"
rodar_driver_e_checar "FECHO"
exigir_igual "gap.judged" "['ci/dado.json']" "na árvore restaurada, o buraco volta a ser visto"
exigir_igual "idxStaged.exit" "1" "e a declaração movida volta a ser julgada pela árvore"
exigir_igual "ok.exit" "0" "e a bancada são volta a ficar verde"
exigir_suite_verde "FECHO"
pass "as SEIS metades foram detectadas; o guard está restaurado e medindo"
echo ""
