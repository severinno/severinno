#!/usr/bin/env bash
# =============================================================================
# scripts/check-schema-drift.sh — Guard de drift schema ↔ migrations custom
# =============================================================================
# Compara os objetos que as migrations CUSTOMIZADAS prometem (índices,
# triggers, materialized views e tabelas de suporte — o SQL que o `prisma db
# push` NÃO gerencia) com o catálogo real do Postgres, e falha apontando o
# objeto faltante ou a definição divergente.
#
# Por que existe: o db-setup.sh (fluxo de dev, db push) marca TODAS as
# migrations como aplicadas mas só REAPLICA a lista CUSTOM_MIGRATIONS —
# qualquer migration com SQL customizado fora dessa lista nasce "aplicada"
# no papel e omissa no banco (caso real: 20260722120000_add_performance_
#_indexes nunca reaplicada → trg_service_search_vector e 3 índices GIN/GiST
# ausentes no dev, busca full-text zerada). No CI (infra-guards, migrate
# deploy) o mesmo guard prova que o deploy cobre tudo que as migrations
# criam.
#
# Duas camadas de verificação:
#
#   1. EXISTÊNCIA (por nome) — todos os kinds (CREATE [OR REPLACE] [UNIQUE]
#      INDEX/TRIGGER, MATERIALIZED VIEW, TABLE), consultando pg_catalog.
#
#   2. DEFINIÇÃO (só CREATE INDEX) — pg_indexes.indexdef comparada com a
#      definição que o PRÓPRIO Postgres produz ao executar o CREATE INDEX
#      da migration ("probe"): o statement é extraído por inteiro (a
#      declaração costuma spanear várias linhas), o nome é trocado por um
#      nome de probe e executado dentro de BEGIN … ROLLBACK; o indexdef do
#      probe é então comparado com o indexdef do índice real. Quem faz a
#      canonicalização é o deparser do próprio servidor — reimplementar em
#      texto as reescritas do Postgres (cast '-1' → ('-1'::integer)::double
#      precision, 'PROVIDER' → 'PROVIDER'::"Role", parênteses extras,
#      USING btree explícito, lowercasing de funções) seria inviável e
#      frágil. indexdef idênticos ⇔ expressões semanticamente iguais para o
#      planner (mesmo servidor, mesmo deparser).
#
#      - Quando o MESMO índice é declarado em mais de uma migration (caso
#        real: os 3 GiST de location em XX_add_postgis e em 20260722…) e as
#        declarações DIVERGEM, a definição real deve casar com PELO MENOS
#        UMA das prometidas (matches-any): db-setup reaplica na ordem da
#        lista (XX primeiro) enquanto migrate deploy ordena lexicográfico —
#        escolher "a que vence" por ordem decidiria mal num dos dois fluxos.
#        Divergência entre declarações = ⚠️; real não casa com NENHUMA = ❌.
#      - CREATE INDEX CONCURRENTLY ou statement não parseável → existência
#        ok, definição reportada como NÃO VERIFICADA (⚠️ — visível, nunca
#        silêncio).
#      - Probe que não executa no banco (coluna/tipo/extensão ausente) = ❌
#        drift (fail-closed).
#      - O probe roda em transação com ROLLBACK; CREATE INDEX (não
#        concurrent) toma lock SHARE momentâneo na tabela alvo — aceitável
#        num guard de dev/CI.
#
# Fonte da verdade: a própria lista CUSTOM_MIGRATIONS de scripts/db-setup.sh
# (extraída aqui) — acrescentar uma migration à lista do db-setup
# automaticamente a coloca sob vigilância deste guard.
#
# Transporte (mesmo padrão do check-money-decimal.sh):
#   PG_CONTAINER=<id> PGUSER=... PGDATABASE=... → docker exec psql
#   senão DATABASE_URL (ou extraído do .env na raiz)
#
# Usage:
#   bash scripts/check-schema-drift.sh
#
# Exit codes:
#   0 — todos os objetos prometidos existem e as definições de índice conferem
#   1 — drift: objeto(s) faltante(s) e/ou definição(ões) de índice divergente(s)
#   2 — pré-requisito ausente (psql indisponível / lista não encontrada)
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DB_SETUP="scripts/db-setup.sh"
[ -f "$DB_SETUP" ] || { echo "❌ $DB_SETUP não encontrado" >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── Transporte psql (espelho do check-money-decimal.sh) ──────────────────────
if [ -n "${PG_CONTAINER:-}" ]; then
  : "${PGUSER:?PGUSER é obrigatório com PG_CONTAINER}"
  : "${PGDATABASE:?PGDATABASE é obrigatório com PG_CONTAINER}"
  psqlq() { docker exec "${PG_CONTAINER}" psql -U "${PGUSER}" -d "${PGDATABASE}" -v ON_ERROR_STOP=1 -qtAc "$1"; }
  psqlf() { docker exec -i "${PG_CONTAINER}" psql -U "${PGUSER}" -d "${PGDATABASE}" -v ON_ERROR_STOP=1 -qtA -f -; }
else
  if [ -z "${DATABASE_URL:-}" ] && [ -f ".env" ]; then
    DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '\"')"
    export DATABASE_URL
  fi
  : "${DATABASE_URL:?DATABASE_URL é obrigatório (ou use PG_CONTAINER)}"
  psqlq() { psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qtAc "$1"; }
  psqlf() { psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qtA -f -; }
fi

psqlq "SELECT 1" >/dev/null 2>&1 || { echo "❌ psql indisponível/banco inacessível" >&2; exit 2; }

# ── Lista customizada: extraída do db-setup.sh (fonte única) ─────────────────
CUSTOM_LIST="$(sed -n '/^CUSTOM_MIGRATIONS=(/,/^)/p' "$DB_SETUP" | grep -oE '\"[^\"]+\"' | tr -d '\"' || true)"
[ -n "$CUSTOM_LIST" ] || { echo "❌ CUSTOM_MIGRATIONS vazio/não encontrado em $DB_SETUP" >&2; exit 2; }

# ── Extração dos objetos prometidos por cada migration.sql (passe de nomes) ──
# Emite linhas "kind name" para CREATE [OR REPLACE] [UNIQUE] INDEX / TRIGGER /
# MATERIALIZED VIEW / TABLE (nomes normalizados, sem aspas).
extract_objects() {
  # Só o grep — a classificação é feita por classify_line (bash case), porque
  # o mawk do runner não suporta flag /i e silenciosamente classificava mal.
  # Comentários (-- ...) fora antes: "Create trigger function ... " em texto
  # de comentário gerava falso positivo.
  grep -v '^[[:space:]]*--' "$1" 2>/dev/null \
    | grep -ioE "CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?(UNIQUE[[:space:]]+)?(INDEX|TRIGGER|MATERIALIZED[[:space:]]+VIEW|TABLE)[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?[A-Za-z_\"](\.?[A-Za-z0-9_\"])*" || true
}

classify_line() {
  local lower="${1,,}"
  local kind=""
  case "$lower" in
    create\ unique\ index*) kind="index" ;;
    create\ index*)          kind="index" ;;
    create\ or\ replace\ trigger*) kind="trigger" ;;
    create\ trigger*)        kind="trigger" ;;
    create\ materialized\ view*) kind="materialized view" ;;
    create\ table*)          kind="table" ;;
    *) return 0 ;;
  esac
  local name="${lower##* }"   # último token do match (nome do objeto)
  name="${name//\"/}"
  [ -n "$name" ] && echo "$kind|$name"
  return 0
}

object_exists() {
  local kind="$1" name="$2"
  case "$kind" in
    index)              [ "$(psqlq "SELECT count(*) FROM pg_indexes WHERE indexname='${name}'")" = "1" ] ;;
    trigger)             [ "$(psqlq "SELECT count(*) FROM pg_trigger WHERE tgname='${name}' AND NOT tgisinternal")" = "1" ] ;;
    "materialized view") [ "$(psqlq "SELECT count(*) FROM pg_matviews WHERE matviewname='${name}'")" = "1" ] ;;
    table)               [ "$(psqlq "SELECT count(*) FROM pg_tables WHERE tablename='${name}'")" = "1" ] ;;
    *) return 1 ;;  # fail-closed: kind desconhecido é VIOLAÇÃO, nunca verde
  esac
}

# ── Extrator de statements completos (multilinha) ────────────────────────────
# Emite cada statement SQL do arquivo em UMA linha de saída, respeitando
# dollar-quotes ($$ e $tag$ — corpos de função plpgsql têm ';' internos) e
# strings '...' (com '' como aspa escapada), e removendo comentários -- fora
# de strings. Compatível com mawk (sem flag /i, sem gawk-ismos).
AWK_STATEMENTS=$(cat <<'AWK'
BEGIN { buf = ""; in_sq = 0; in_dq = 0; dtag = "" }
{
  line = $0
  i = 1
  n = length(line)
  while (i <= n) {
    c = substr(line, i, 1)
    if (in_dq) {
      closer = "$" dtag "$"
      if (substr(line, i, length(closer)) == closer) {
        buf = buf closer
        i += length(closer)
        in_dq = 0
        continue
      }
      buf = buf c
      i++
      continue
    }
    if (in_sq) {
      if (c == "'") {
        if (substr(line, i, 2) == "''") { buf = buf "''"; i += 2; continue }
        in_sq = 0
      }
      buf = buf c
      i++
      continue
    }
    # fora de strings
    if (c == "-" && substr(line, i, 2) == "--") break
    if (c == "'") { in_sq = 1; buf = buf c; i++; continue }
    if (c == "$") {
      dlen = 0
      if (substr(line, i, 2) == "$$") dlen = 2
      else if (match(substr(line, i), /^\$[A-Za-z_][A-Za-z0-9_]*\$/)) dlen = RLENGTH
      if (dlen > 0) {
        dtag = substr(line, i + 1, dlen - 2)
        in_dq = 1
        buf = buf substr(line, i, dlen)
        i += dlen
        continue
      }
    }
    if (c == ";") {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", buf)
      if (buf != "") print buf
      buf = ""
      i++
      continue
    }
    buf = buf c
    i++
  }
  if (!in_dq && !in_sq) buf = buf " "
}
AWK
)

# ── Canonicalização de indexdef para comparação ──────────────────────────────
# Substitui o NOME do índice por <X> (preservando o flag UNIQUE), colapsa
# espaços e normaliza maiúsculas — ambos os lados vêm do mesmo deparser.
canon_def() {
  sed -E 's/^(CREATE[[:space:]]+(UNIQUE[[:space:]]+)?INDEX)[[:space:]]+"?[^[:space:]]+"?[[:space:]]+ON[[:space:]]/\1 <X> ON /I' \
    | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//' \
    | tr '[:upper:]' '[:lower:]'
}

echo "── check-schema-drift: migrations customizadas ↔ catálogo ──"
CHECKS=0
FAILS=0
declare -A SEEN

# ══ Passe 1: existência por nome ════════════════════════════════════════════
for mig in $CUSTOM_LIST; do
  SQL_FILE="prisma/migrations/$mig/migration.sql"
  if [ ! -f "$SQL_FILE" ]; then
    echo "⚠️  $mig: migration.sql não encontrado — pulando"
    continue
  fi
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    classification="$(classify_line "$line")" || true
    IFS='|' read -r kind name <<<"$classification"
    [ -n "${kind:-}" ] && [ -n "${name:-}" ] || continue
    # só nomes seguros (proteção da interpolação no psqlq)
    if ! grep -qE '^[a-z0-9_]+$' <<<"$name"; then
      echo "⚠️  $mig: nome estranho ignorado: $kind/$name"
      continue
    fi
    key="$kind|$name"
    [ -n "${SEEN[$key]:-}" ] && continue
    SEEN[$key]=1
    CHECKS=$((CHECKS + 1))
    if object_exists "$kind" "$name"; then
      echo "  ✅ $kind $name"
    else
      echo "  ❌ $kind $name — definido em $mig, AUSENTE no banco"
      FAILS=$((FAILS + 1))
    fi
  done < <(extract_objects "$SQL_FILE")
done

# ══ Passe 2: definição dos índices (probe em transação com ROLLBACK) ════════
# Cada declaração DISTINTA de um mesmo índice é sondada; a veredito final
# compara o indexdef real com o conjunto de definições prometidas (matches-any).
echo ""
echo "── definições de índice (indexdef: migration via probe ↔ banco) ──"
DEF_CHECKS=0
DEF_FAILS=0
DEF_SKIPS=0
DUP_WARNS=0
PROBE_SEQ=0
declare -A DEF_NAMES DEF_NORM_SEEN DEF_EXPECTED DEF_FIRST_MIG DEF_BROKEN

for mig in $CUSTOM_LIST; do
  SQL_FILE="prisma/migrations/$mig/migration.sql"
  [ -f "$SQL_FILE" ] || continue
  while IFS= read -r raw; do
    [ -n "${raw//[[:space:]]/}" ] || continue
    stmt="$(sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//' <<<"$raw")"
    lower="${stmt,,}"
    re_idx='^create( unique)? index '
    [[ "$lower" =~ $re_idx ]] || continue

    # Nome do índice declarado (sed GNU, keywords case-insensitive; sem match
    # ⇒ saída idêntica à entrada).
    name="$(sed -E 's/^CREATE[[:space:]]+(UNIQUE[[:space:]]+)?INDEX([[:space:]]+IF[[:space:]]+NOT[[:space:]]+EXISTS)?[[:space:]]+"?([A-Za-z_][A-Za-z0-9_]*)"?[[:space:]]+ON[[:space:]].*$/\3/I' <<<"$stmt")"
    if [ "$name" = "$stmt" ]; then
      echo "  ⚠️  ($mig): CREATE INDEX não parseável — definição NÃO VERIFICADA: ${stmt:0:100}…"
      DEF_SKIPS=$((DEF_SKIPS + 1))
      continue
    fi
    if ! grep -qE '^[a-z0-9_]+$' <<<"$name"; then
      echo "  ⚠️  ($mig): nome de índice fora do padrão [$name] — definição NÃO VERIFICADA"
      DEF_SKIPS=$((DEF_SKIPS + 1))
      continue
    fi

    re_conc='^create( unique)? index concurrently '
    if [[ "$lower" =~ $re_conc ]]; then
      echo "  ⚠️  index $name — CONCURRENTLY: existência ok, definição não verificável dentro de transação"
      DEF_SKIPS=$((DEF_SKIPS + 1))
      continue
    fi

    # Declarações idênticas repetidas: sondar uma vez só. Divergentes: ⚠️ e
    # sonda também — o banco pode ter materializado qualquer uma delas.
    norm="$(sed -E 's/[[:space:]]+IF[[:space:]]+NOT[[:space:]]+EXISTS//I' <<<"$stmt" | tr '[:upper:]' '[:lower:]' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"
    prev="${DEF_NORM_SEEN[$name]:-}"
    if grep -Fxq "$norm" <<<"$prev"; then
      continue
    fi
    if [ -n "$prev" ]; then
      DUP_WARNS=$((DUP_WARNS + 1))
      echo "  ⚠️  index $name: redeclarado com definição DIFERENTE em $mig (1ª declaração: ${DEF_FIRST_MIG[$name]}) — aceita-se a variante que o banco materializou"
    fi
    DEF_NORM_SEEN[$name]="${prev:+$prev
}$norm"
    [ -n "${DEF_FIRST_MIG[$name]:-}" ] || DEF_FIRST_MIG[$name]="$mig"
    DEF_NAMES[$name]=1

    # Probe: mesmo statement, outro nome, sem IF NOT EXISTS (para não virar
    # no-op e mascarar a comparação). \1 preserva o flag UNIQUE.
    PROBE_SEQ=$((PROBE_SEQ + 1))
    probe="drift_probe_${PROBE_SEQ}_${BASHPID}"
    probe_stmt="$(sed -E "s/^CREATE[[:space:]]+(UNIQUE[[:space:]]+)?INDEX([[:space:]]+IF[[:space:]]+NOT[[:space:]]+EXISTS)?[[:space:]]+\"?[A-Za-z_][A-Za-z0-9_]*\"?[[:space:]]+ON[[:space:]]/CREATE \\1INDEX ${probe} ON /I" <<<"$stmt")"
    if [ "$probe_stmt" = "$stmt" ]; then
      echo "  ⚠️  ($mig): cabeçalho do CREATE INDEX não parseável — definição NÃO VERIFICADA: ${stmt:0:100}…"
      DEF_SKIPS=$((DEF_SKIPS + 1))
      continue
    fi

    prc=0
    {
      printf 'BEGIN;\n'
      printf 'SET LOCAL client_min_messages = warning;\n'
      printf '%s;\n' "$probe_stmt"
      printf "SELECT 'DEF:' || indexdef FROM pg_indexes WHERE indexname = '%s';\n" "$probe"
      printf 'ROLLBACK;\n'
    } | psqlf >"$WORK/probe.out" 2>"$WORK/probe.err" || prc=$?

    if [ "$prc" -ne 0 ]; then
      echo "  ❌ index $name — probe FALHOU (definição da migration não executa neste banco):"
      tail -2 "$WORK/probe.err" | sed 's/^/       /'
      DEF_BROKEN[$name]=1
      DEF_FAILS=$((DEF_FAILS + 1))
      continue
    fi

    ndef="$(grep -cE '^DEF:' "$WORK/probe.out" || true)"
    probe_def="$(sed -nE 's/^DEF://p' "$WORK/probe.out" | head -1 || true)"
    if [ "$ndef" != "1" ] || [ -z "$probe_def" ]; then
      echo "  ⚠️  index $name — probe não retornou definição única — NÃO VERIFICADA"
      DEF_SKIPS=$((DEF_SKIPS + 1))
      continue
    fi

    exp_def="$(canon_def <<<"$probe_def")"
    DEF_EXPECTED[$name]="${DEF_EXPECTED[$name]:-}${DEF_EXPECTED[$name]:+
}$exp_def"
  done < <(awk "$AWK_STATEMENTS" "$SQL_FILE")
done

# ── Veredito: indexdef real ∈ {definições prometidas} ────────────────────────
for name in $(printf '%s\n' "${!DEF_NAMES[@]}" | LC_ALL=C sort); do
  [ -n "${DEF_BROKEN[$name]:-}" ] && continue   # probe falhou: já é ❌
  real_def="$(psqlq "SELECT indexdef FROM pg_indexes WHERE indexname='${name}' ORDER BY 1 LIMIT 1" || true)"
  [ -n "$real_def" ] || continue                 # ausência já reportada no passe 1
  got_def="$(canon_def <<<"$real_def")"
  match=0
  while IFS= read -r exp; do
    [ -n "$exp" ] || continue
    if [ "$exp" = "$got_def" ]; then match=1; break; fi
  done <<<"${DEF_EXPECTED[$name]}"
  DEF_CHECKS=$((DEF_CHECKS + 1))
  if [ "$match" = 1 ]; then
    echo "  ✅ index $name — definição confere"
  else
    n_variants="$(grep -c . <<<"${DEF_EXPECTED[$name]}" || true)"
    echo "  ❌ index $name — DEFINIÇÃO DIVERGENTE do banco:"
    echo "       esperado (migration ${DEF_FIRST_MIG[$name]}): ${DEF_EXPECTED[$name]%%$'\n'*}"
    [ "$n_variants" -gt 1 ] && echo "       (…ou uma das outras $((n_variants - 1)) variante(s) prometida(s) — ver ⚠️ acima)"
    echo "       real (pg_indexes):         $got_def"
    DEF_FAILS=$((DEF_FAILS + 1))
  fi
done

echo ""
if [ "$FAILS" -gt 0 ] || [ "$DEF_FAILS" -gt 0 ]; then
  echo "❌ DRIFT: $FAILS de $CHECKS objetos ausentes; $DEF_FAILS definição(ões) de índice divergente(s)/inválida(s)."
  echo "   Correção: reaplique os SQLs customizados → bash scripts/db-setup.sh"
  exit 1
fi
msg="✅ Sem drift: os $CHECKS objetos das migrations customizadas existem no banco e as $DEF_CHECKS definições de índice conferem."
extras=""
[ "$DUP_WARNS" -gt 0 ] && extras="$extras, $DUP_WARNS redeclaração(ões) divergente(s)"
[ "$DEF_SKIPS" -gt 0 ] && extras="$extras, $DEF_SKIPS definição(ões) não verificada(s)"
[ -n "$extras" ] && msg="$msg (avisos:${extras#,*} — ver ⚠️ acima)"
echo "$msg"
