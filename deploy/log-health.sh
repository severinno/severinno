#!/usr/bin/env bash
# =============================================================================
# /opt/gitea/log-health.sh — monitor da perda de logs de job da forja.
# =============================================================================
# Contexto (medido): um SUBCONJUNTO de jobs perde o log fisico
# (log_in_storage=0, sem arquivo) de forma DETERMINISTICA POR JOB — Lint,
# Bring-up Gate Proof e Pre-commit Proof perdem SEMPRE; Stack Per-Commit e
# TypeCheck ganham SEMPRE; Repo Guards e Tests oscilam. O padrao sobreviveu ao
# upgrade 1.22.6 -> 1.24.7 e o runner 0.6.1 ja e o latest (familia do relato
# upstream go-gitea/gitea#33822). O veredito (status no banco) e confiavel;
# o que se perde e o LOG.
#
# Este monitor classifica as tasks novas de cada dia:
#   - perda em job do padrao CONHECIDO (Lint/Bring-up/Pre-commit) = esperado;
#   - perda em job FORA do padrao (incluindo o oscilante piorando) = REGRESSAO
#     -> abre/comenta issue em severinno/alertas.
#
# Uso:    cd /home/severinno/severinno && . deploy/.env.alertas && bash /opt/gitea/log-health.sh [--silencioso]
# Cron:   40 11 * * * cd /home/severinno/severinno && set -a && . deploy/.env.alertas && set +a && bash /opt/gitea/log-health.sh >> /var/log/forja-log-health.log 2>&1
# Saida:  <data> tarefas=<N> boas=<B> esperadas=<E> regressao=<R> ids=[...]
# =============================================================================
set -euo pipefail

DESDE="${DESDE:-2026-10-07 03:00:00}"   # instante do upgrade (baseline do monitor)
REPO_ALERTAS="${REPO_ALERTAS:-severinno/alertas}"
# ROTAÇÃO 2026-10-06: o token NÃO tem mais default hardcoded — o valor ficou
# no histórico do git (pusheado em 939a25c8) e foi rotacionado; o VIVO mora no
# cofre gitignored deploy/.env.alertas (local e VPS), e o script falha se não
# houver credencial no ambiente (fail-closed, sem credencial não há como
# abrir a issue de regressão de qualquer forma).
TOKEN="${GITEA_TOKEN_ALERTAS:-${GITEA_TOKEN:-}}"  # aceita os dois nomes (env pós-rotação usa GITEA_TOKEN)
if [ -z "$TOKEN" ]; then
  echo "$(date '+%F %T') ERRO: GITEA_TOKEN_ALERTAS não definido — source deploy/.env.alertas antes de rodar"
  exit 2
fi
URL="https://git.severinno.com/api/v1"
SILENCIOSO=0
[ "${1:-}" = "--silencioso" ] && SILENCIOSO=1

OUT=$(docker run --rm -v /var/lib/docker/volumes/gitea-data/_data:/data:ro \
  -e DESDE="$DESDE" \
  git.severinno.com/severinno/ubuntu-bun:1.3.14 bun -e '
const {Database} = require("bun:sqlite");
const {existsSync} = require("fs");
const db = new Database("/data/gitea/gitea.db", {readonly:true});
const base = "/data/gitea/actions_log";
function comRetry(fn){let e;for(let i=0;i<12;i++){try{return fn()}catch(x){e=x;const f=Date.now()+2000;while(Date.now()<f){}}}throw e}
const rows = comRetry(()=>db.prepare(
  `SELECT t.id, t.status, t.log_filename, t.log_in_storage, j.name AS job,
          datetime(t.created,"unixepoch") c
   FROM action_task t JOIN action_run_job j ON j.id = t.job_id
   WHERE t.status != 6 AND datetime(t.created,"unixepoch") >= ? ORDER BY t.id`
).all(process.env.DESDE));
const PERDE_SEMPRE = /Lint|Bring-up Gate Proof|Pre-commit Proof/;
const OSCILA = /Repo Guards|Tests|TypeCheck|UTF-8 Check/;
let boas=0, esperadas=0, oscilou=0; const regressao=[];
for (const r of rows){
  if (r.status === 4) { esperadas++; continue; } // Skipped: job pulado roda e não grava log — não é perda
  const arquivo = existsSync(base+"/"+r.log_filename) || existsSync(base+"/"+r.log_filename.replace(/\.zst$/,""));
  const ganhou = r.log_in_storage === 1 && arquivo;
  if (ganhou) { boas++; continue; }
  if (PERDE_SEMPRE.test(r.job)) esperadas++;
  else if (OSCILA.test(r.job)) oscilou++;
  else regressao.push(r.id + " " + r.job + " (status=" + r.status + ")");
}
console.log(JSON.stringify({total: rows.length, boas, esperadas, oscilou, regressao}));
' 2>/dev/null) || { echo "$(date '+%F %T') ERRO: probe do banco falhou"; exit 2; }

TOTAL=$(echo "$OUT" | sed -E 's/.*"total":([0-9]+).*/\1/')
BOAS=$(echo "$OUT" | sed -E 's/.*"boas":([0-9]+).*/\1/')
ESP=$(echo "$OUT" | sed -E 's/.*"esperadas":([0-9]+).*/\1/')
REG=$(echo "$OUT" | sed -E 's/.*"regressao":\[(.*)\].*/\1/')
OSCI=$(echo "$OUT" | sed -E 's/.*"oscilou":([0-9]+).*/\1/')
echo "$(date '+%F %T') desde='$DESDE' tarefas=$TOTAL boas=$BOAS esperadas=$ESP oscilacao=$OSCI regressao=$REG"

if [ "$REG" = "0" ] || [ -z "$REG" ] || [ "$REG" = "$OUT" ]; then
  echo "  -> sem regressao (perdas, se houve, estao no padrao conhecido)"
  exit 0
fi
[ "$SILENCIOSO" = "1" ] && exit 3

TITULO="forja-log-health: perda de log FORA do padrao conhecido (pos-1.24)"
ABERTAS=$(curl -s "$URL/repos/$REPO_ALERTAS/issues?state=open&type=issues" -H "Authorization: token $TOKEN")
NUM=$(echo "$ABERTAS" | python3 -c '
import json, sys
try:
    issues = json.load(sys.stdin)
    m = [i for i in issues if "forja-log-health" in i.get("title", "")]
    print(m[0]["number"] if m else "")
except Exception:
    print("")')
CORPO=$(python3 -c "
import json, sys
corpo = '''Monitor de $(date '+%F %T'): perda de log FORA do padrao conhecido
(Lint/Bring-up/Pre-commit perdem sempre — esses saem da conta).
tarefas=$TOTAL boas=$BOAS esperadas=$ESP
regressao:
$REG
Baseline do padrao: rodadas 21-28 (1.22.6 e 1.24.7), familia go-gitea/gitea#33822.'''
print(json.dumps(corpo))")
if [ -n "$NUM" ]; then
  curl -s -X POST "$URL/repos/$REPO_ALERTAS/issues/$NUM/comments" \
    -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
    -d "{\"body\": $CORPO}" >/dev/null
  echo "  -> comentou na issue #$NUM (regressao fora do padrao)"
else
  curl -s -X POST "$URL/repos/$REPO_ALERTAS/issues" \
    -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
    -d "{\"title\": \"$TITULO\", \"body\": $CORPO}" >/dev/null
  echo "  -> issue aberta em $REPO_ALERTAS (regressao fora do padrao)"
fi
exit 3
