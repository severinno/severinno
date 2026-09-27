#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-act-origin.sh — Mutation test do
# `scripts/check-act-origin.mjs` ("o registro do ato carrega a matriz que ele
# declara ter medido?")
#
# Usage:
#   ./scripts/test-mutation-act-origin.sh
#
# Exit codes:
#   0 — as OITO metades foram DETECTADAS (a mutação cega a regra) e os controles
#       passaram ✅
#   1 — alguma regra NÃO sustentou o veredito (a mutação não mudou o gate, ou o
#       gate mudou por outro motivo) ❌
#   2 — infra: `git`/`node`/`python3` ausentes do PATH, marcador de mutação
#       ambíguo/ausente, ou a mutação deixou o gate sem sintaxe válida — mutação
#       que não muta é pior que nenhuma, e não medir nunca vale verde ◐
#
# O QUE ISTO PROVA (e por que o gate passar hoje não basta)
#
# O `check-act-origin` existe porque DUAS árvores podem concordar entre si e mesmo
# assim a procedência mentir: o registro versionado diz "MEDIDO: N sub-tests" e
# "medido no commit X", e o único jeito de saber se X CARREGA essa matriz é abrir
# a árvore de X. Um gate desses passa a vida verde se as regras que ele diz ter
# forem cegas — e um gate verde sobre um registro que descreve uma árvore que não
# existiu é PIOR que não ter gate: ele afirma o que não mediu. Esta suíte tira
# cada regra do lugar, uma por vez, e exige que o MESMO registro desonesto deixe
# de ser recusado:
#
#   M1 — R1 (a EXISTÊNCIA da origem): o nome morto de uma reescrita volta a valer.
#   M2 — R2 (a HISTÓRIA): a origem que existe e está FORA da história passa.
#   M3 — R3a (forma declarada AUSENTE na árvore da origem): o registro declara
#        medido um sub-test que a origem não tinha (a classe do defeito real).
#   M4 — R3b (as METADES): a forma existe na origem com MENOS metades do que o
#        registro declara — a nona metade "medida" numa árvore que não a tinha.
#   M5 — R3c (a forma SOBRANDO): a árvore da origem carrega um sub-test que o
#        registro não declara — a medição declarada é MENOR que a matriz.
#   M6 — R3d (o TOTAL `subtests`): o count declarado deixa de ser confrontado.
#   M7 — a ORIGEM DECLARADA: sem `meta.commit`, o registro deixa de ser recusado.
#   M8 — o FAIL-CLOSED: registro que não é JSON deixa de sair 2.
#
# M1 É MEDIDA PELA ACUSAÇÃO, NÃO PELO EXIT — e isso é do fenômeno, não da suíte:
# uma origem que não resolve é, POR CONSTRUÇÃO, também fora da história (e sem
# árvore), então cegar R1 não faz o registro passar — faz ele ser acusado pela
# regra SEGUINTE, com o nome errado. A metade mede exatamente o que R1 sustenta:
# o NOME da classe (sem a regra, some o `R1 ·` e sobra o `R2 ·`). As outras sete
# medem o exit: cegada a regra, o mesmo registro deixa de ser recusado (0).
#
# O FIXTURE É UM REPOSITÓRIO GIT DE VERDADE, com a matriz mínima que o gate lê: o
# master (`scripts/test-mutation-guards.sh`, com o bloco `SUBTESTS=(...)`) e duas
# suítes com os seus blocos `METADES=(...)` (três e duas metades). A partir dele o
# fixture escreve o REGISTRO DO ATO de cada metade — e cada registro é um defeito
# de uma classe: a origem morta, a origem fora da história, a forma a mais, a
# metade a mais, a forma a menos, o total errado, o registro sem origem e o
# registro ilegível. O sujeito é o VEREDITO do gate sobre esses registros, e o
# vitest do repositório não é a régua desta suíte.
#
# A LEITURA É O EXIT CODE do gate, medido por EXECUÇÃO sobre o fixture — e o
# controle de cada metade é o gate ÍNTEGRO no MESMO estado do fixture (exit 1):
# sem esse controle, uma mutação "detectada" poderia ser só um fixture que
# ninguém recusava. Cada `mutar_linha` é conferida com `node --check`: uma
# mutação que não parseia mediria a si mesma.
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-act-origin.mjs"
# O FECHO DE IMPORTS do gate é DERIVADO do grafo (`scripts/fecho-imports.mjs`),
# nunca uma lista à mão: ele lê a matriz da árvore com as MESMAS réguas da casa
# (`check-mutation-count` → `bench-table` → o FORMATADOR do repositório, que entrou
# quando o gerado passou a sair DENTRO do lint) e o fixture roda o gate COPIADO —
# sem os vizinhos, a cópia morre com ERR_MODULE_NOT_FOUND e o exit 1 do NODE
# passaria por veredito do gate.
#
# POR QUE DERIVADO: a lista à mão envelhecia sem aviso — medido em 26/09/2026, o
# vizinho de SEGUNDO grau que a entrega do gerado trouxe deixou esta cópia MORTA e
# o exit 1 do NODE passou por veredito. Aqui quem responde é a aresta do próprio
# gate, e aresta que não resolva sai 2 (infra declarada).
fecho_do_gate() { # ecoa os módulos do fecho, relativos à raiz do repositório
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
  done < <(fecho_do_gate)
}

METADES=(
  'M1|R1 — a origem que NÃO resolve deixa de ser recusa (o nome da classe)'
  'M2|R2 — a origem FORA da história do HEAD deixa de ser recusa'
  'M3|R3a — a forma declarada que a árvore da origem NÃO carrega'
  'M4|R3b — as METADES: a forma existe na origem com menos metades'
  'M5|R3c — a forma SOBRANDO: a árvore carrega um sub-test que o registro omite'
  'M6|R3d — o TOTAL `subtests` do registro deixa de ser confrontado'
  'M7|a ORIGEM DECLARADA — o registro sem `meta.commit` deixa de ser recusa'
  'M8|o FAIL-CLOSED — o registro que não é JSON deixa de sair 2 (não medido)'
)

falhas=0
fail() {
  echo "❌ $*" >&2
  falhas=$((falhas + 1))
}
pass() { echo "  ✅ $1"; }

for bin in git node python3; do
  command -v "$bin" >/dev/null 2>&1 || {
    echo "◐ infra: \`$bin\` não está no PATH — não medido, nunca verde" >&2
    exit 2
  }
done
[ -f "$GUARD" ] || {
  echo "◐ infra: $GUARD não existe" >&2
  exit 2
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
F="$TMP/fixture"
mkdir -p "$F/scripts" "$F/docs/benchmarks"
git -C "$F" init -q
git -C "$F" config user.email "fixture@test"
git -C "$F" config user.name "fixture"
git -C "$F" config commit.gpgsign false

# ── A MATRIZ MÍNIMA: o master com duas formas e as duas suítes com as metades ──
cat >"$F/scripts/test-mutation-guards.sh" <<'SH'
#!/usr/bin/env bash
SUBTESTS=(
  "alfa|scripts/test-mutation-alfa.sh"
  "beta|scripts/test-mutation-beta.sh"
)
SH
cat >"$F/scripts/test-mutation-alfa.sh" <<'SH'
#!/usr/bin/env bash
METADES=(
  'A1|a primeira metade'
  'A2|a segunda metade'
  'A3|a terceira metade'
)
SH
cat >"$F/scripts/test-mutation-beta.sh" <<'SH'
#!/usr/bin/env bash
METADES=(
  'B1|a primeira metade'
  'B2|a segunda metade'
)
SH
git -C "$F" add -A
git -C "$F" commit -qm "a matriz nasce (duas formas, cinco metades)"
A="$(git -C "$F" rev-parse HEAD)"
BASE_BRANCH="$(git -C "$F" rev-parse --abbrev-ref HEAD)"

# O ramo IRMÃO — a origem que EXISTE e está FORA da história de HEAD (M2). Ele
# nasce do MESMO commit A, com a mesma árvore, e a volta para o ramo base
# acontece ANTES de qualquer registro existir: um registro não-rastreado seria
# `git add -A`-ado no ramo irmão e a volta o levaria embora (medido: era o que
# fazia o fixture perder o `docs/benchmarks/` no meio da suíte).
git -C "$F" checkout -q -b fora
git -C "$F" commit -q --allow-empty -m "fora da história"
FORA="$(git -C "$F" rev-parse HEAD)"
git -C "$F" checkout -q "$BASE_BRANCH"

# ── Um registro do ato, com a origem e a matriz que cada metade precisa ───────
# $1 = commit de origem ("" = registro SEM origem), $2 = subtests, $3 = metades,
# $4.. = "forma:metades". Escreve os DOIS registros que o gate julga, direto na
# ÁRVORE DE TRABALHO (o gate lê os arquivos; a matriz da origem ele lê do git).
registro() {
  python3 - "$F" "$@" <<'PY'
import json, os, sys
raiz, origem, subtests, metades = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
os.makedirs(f"{raiz}/docs/benchmarks", exist_ok=True)
formas = []
for par in sys.argv[5:]:
    forma, n = par.split(":")
    formas.append({"role": forma, "label": forma, "ms": 10, "exit": 0, "metades": int(n), "ok": True})
registro = {
    "meta": {
        "tool": "bench-guard-timing",
        "version": 6,
        "commit": origem,
        "commitDate": "2026-09-25 10:00:00 -0300",
        "act": "bench-guard-timing --only mutations --json --baseline --merge",
    },
    "summary": {},
    "mutations": {
        "measured": True,
        "cmd": "bash scripts/test-mutation-guards.sh --json",
        "exit": 0,
        "subtests": subtests,
        "metades": metades,
        "forms": formas,
    },
}
for nome in ("guard-timing-baseline.json", "guard-timing-latest.json"):
    with open(f"{raiz}/docs/benchmarks/{nome}", "w") as fh:
        json.dump(registro, fh, indent=2)
        fh.write("\n")
PY
}

# ── O gate, do fixture, e a cópia que cada metade muta ───────────────────────
instalar_guard() {
  cp "$GUARD" "$F/scripts/check-act-origin.mjs"
  copiar_fecho "$F"
}
rodar() { # ecoa o exit code do gate contra o fixture; a saída fica em $TMP/saida
  local rc=0
  (cd "$F" && node scripts/check-act-origin.mjs) >"$TMP/saida" 2>&1 || rc=$?
  echo "$rc"
}

# O MÓDULO QUE NÃO CARREGOU NÃO É VEREDITO: se a cópia do gate morre por um
# import que faltou (uma aresta que a derivação não viu), o `node` sai 1 — e o
# exit 1 do NODE passaria por "o gate recusou". A checagem mora AQUI, e não dentro
# do `rodar`, por uma razão de shell: `rodar` é chamado em SUBSTITUIÇÃO DE COMANDO
# (`$(rodar)`), e um `exit` lá dentro termina o SUBSHELL — o pai seguiria com o
# fixture morto. Quem chama `recebe` passa por aqui, no processo que decide.
checar_carga() {
  if grep -q "ERR_MODULE_NOT_FOUND\|Cannot find module" "$TMP/saida" 2>/dev/null; then
    fail "o gate COPIADO não CARREGOU (o fecho do fixture está incompleto): o veredito seria do NODE, não do gate"
    sed 's/^/   /' "$TMP/saida" >&2
    exit 2
  fi
}
acusa() { # $1 = trecho que a saída do ÚLTIMO rodar tem de conter
  if grep -qF -- "$1" "$TMP/saida"; then
    pass "a acusação '$1' está na saída"
  else
    fail "a saída NÃO acusa '$1' (o diagnóstico da regra sumiu)"
  fi
}
nao_acusa() { # $1 = trecho que a saída do ÚLTIMO rodar NÃO pode conter
  if grep -qF -- "$1" "$TMP/saida"; then
    fail "a saída AINDA acusa '$1' (a mutação não cegou a regra)"
  else
    pass "sem a regra, a acusação '$1' desaparece"
  fi
}

# A MUTAÇÃO, fail-closed: o marcador tem de existir UMA vez no gate, o arquivo
# tem de MUDAR e a cópia tem de continuar parseando. Sem as três, uma mutação que
# não muta (o marcador sumiu num refactor) faria a suíte "provar" à toa.
mutar_linha() { # $1 = marcador (literal), $2 = a linha nova
  local arq="$F/scripts/check-act-origin.mjs" n antes depois
  n="$(grep -cF -- "$1" "$arq")"
  if [ "$n" != "1" ]; then
    fail "marcador de mutação com $n ocorrência(s) no gate: $1"
    echo "     (a mutação precisa de UM alvo — marcador ambíguo é mutação não medida)" >&2
    exit 2
  fi
  antes="$(cksum <"$arq")"
  python3 - "$arq" "$1" "$2" <<'PY'
import sys
arq, marcador, nova = sys.argv[1], sys.argv[2], sys.argv[3]
linhas = open(arq, encoding="utf-8").read().split("\n")
alvos = [i for i, linha in enumerate(linhas) if marcador in linha]
assert len(alvos) == 1, alvos
linhas[alvos[0]] = nova
open(arq, "w", encoding="utf-8").write("\n".join(linhas))
PY
  depois="$(cksum <"$arq")"
  [ "$antes" != "$depois" ] || {
    fail "a mutação NÃO alterou o gate: $1"
    exit 2
  }
  node --check "$arq" >/dev/null 2>&1 || {
    fail "a mutação deixou o gate com sintaxe inválida: $1"
    exit 2
  }
}

recebe() { # $1 = rótulo, $2 = exit obtido, $3 = esperado, $4 = o que a medição diz
  checar_carga
  if [ "$2" = "$3" ]; then
    pass "$1 — exit $2 ($4)"
  else
    fail "$1 — exit $2, esperado $3 ($4)"
  fi
}

# A metade padrão: o registro desonesto é RECUSADO pelo gate íntegro (controle),
# e com UMA regra cegada o MESMO registro passa (exit 0).
metade() { # $1 = rótulo, $2 = marcador, $3 = linha mutante
  local rotulo="$1"
  instalar_guard
  recebe "CONTROLE $rotulo (defeito presente)" "$(rodar)" 1 "o registro desonesto tem de ser RECUSADO"
  mutar_linha "$2" "$3"
  recebe "$rotulo (cegada)" "$(rodar)" 0 "cegada a regra, o mesmo registro PASSA"
}

echo "== controles: o fixture HONESTO passa, e o não-repositório sai 2"

registro "$A" 2 5 "alfa:3" "beta:2"
instalar_guard
recebe "CONTROLE honesto" "$(rodar)" 0 "a origem carrega exatamente as duas formas e as metades"

mkdir -p "$TMP/norepo/scripts" "$TMP/norepo/docs/benchmarks"
cp "$GUARD" "$TMP/norepo/scripts/check-act-origin.mjs"
copiar_fecho "$TMP/norepo"
recebe "CONTROLE fail-closed (não é repositório)" \
  "$(cd "$TMP/norepo" && node scripts/check-act-origin.mjs >/dev/null 2>&1; echo $?)" 2 \
  "árvore que não é repositório é INDISPONÍVEL, nunca verde"

echo "== as OITO metades"

# ── M1 — R1: a EXISTÊNCIA da origem (medida pela ACUSAÇÃO, ver o cabeçalho) ──
# O hash MORTO é montado em SETE pedaços de ≤6 hex. Um literal de 40 aqui seria
# ele MESMO uma citação de commit para o `check-doc-hashes` (que lê os `.sh` da
# prosa) — e o token que a M1 usa NÃO existe como commit nenhum: é o nome que
# uma reescrita deixou, a classe da regra. É a mesma montagem em metades que a
# suíte das citações usa para o id de seed dela.
MORTO="c0ffee""123456""7890c0""ffee12""345678""90c0ff""ee12"
registro "$MORTO" 2 5 "alfa:3" "beta:2"
instalar_guard
recebe "CONTROLE M1 (origem morta)" "$(rodar)" 1 "a origem que não existe tem de ser RECUSADA"
acusa "R1 ·"
mutar_linha '${o}^{commit}' 'const origemResolve = () => true'
recebe "M1 (cegada)" "$(rodar)" 1 "a origem morta só é recusada pela regra seguinte"
nao_acusa "R1 ·"
acusa "R2 ·"

# ── M2 — R2: a HISTÓRIA (origem que existe e está FORA da história) ──────────
registro "$FORA" 2 5 "alfa:3" "beta:2"
metade "M2 (origem FORA da história)" \
  '"merge-base", "--is-ancestor", o, head' \
  'const origemNaHistoria = () => true'

# ── M3 — R3a: a forma declarada AUSENTE na árvore da origem ──────────────────
registro "$A" 2 5 "alfa:3" "beta:2" "gama:4"
metade "M3 (forma declarada AUSENTE na origem)" \
  '=> !formas.has(id)' \
  'const formaAusente = () => false'

# ── M4 — R3b: as METADES da forma ────────────────────────────────────────────
registro "$A" 2 5 "alfa:4" "beta:2"
metade "M4 (as METADES da forma)" \
  'julgada(dito)' \
  'const metadesDivergem = () => false'

# ── M5 — R3c: a forma SOBRANDO na árvore da origem ───────────────────────────
registro "$A" 2 5 "alfa:3"
metade "M5 (a forma SOBRANDO na árvore)" \
  '=> !declaradas.has(id)' \
  'const formaSobrando = () => false'

# ── M6 — R3d: o TOTAL `subtests` ─────────────────────────────────────────────
registro "$A" 9 5 "alfa:3" "beta:2"
metade "M6 (o TOTAL subtests)" \
  'declarado !== null && declarado !== carregado' \
  'const totalDiverge = () => false'

# ── M7 — a ORIGEM DECLARADA: o registro SEM `meta.commit` ────────────────────
registro "" 2 5 "alfa:3" "beta:2"
metade "M7 (o registro SEM meta.commit)" \
  'registro.meta.commit.trim() : ""' \
  'const origem = typeof registro?.meta?.commit === "string" && registro.meta.commit.trim() ? registro.meta.commit.trim() : "HEAD"'

# ── M8 — o FAIL-CLOSED: o registro que não é JSON ────────────────────────────
# Aqui o controle mede o exit 2 (não medido) e a metade exigida é o exit 0: com a
# porta do "não consegui ler" cegada, o gate passa a JULGAR o lixo — e um registro
# que ele declara HONESTO, sem nunca ter conseguido lê-lo, é o defeito exato.
registro "$A" 2 5 "alfa:3" "beta:2"
instalar_guard
echo "{ isso não é JSON" >"$F/docs/benchmarks/guard-timing-baseline.json"
recebe "CONTROLE M8 (registro ilegível)" "$(rodar)" 2 "ilegível é INDISPONÍVEL, nunca verde"
mutar_linha 'o registro não é JSON válido' \
  "    registro = { meta: { commit: \"$A\" }, mutations: { subtests: 2, forms: [{ role: \"alfa\", metades: 3 }, { role: \"beta\", metades: 2 }] } }"
recebe "M8 (cegada)" "$(rodar)" 0 "cegado o fail-closed, um registro ilegível passa a HONESTO"

echo
if [ "$falhas" -gt 0 ]; then
  echo "❌ test-mutation-act-origin: $falhas metade(s)/controle(s) NÃO sustentaram o veredito" >&2
  exit 1
fi
echo "✅ test-mutation-act-origin: as ${#METADES[@]} metades foram DETECTADAS e os controles passaram"
