#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# bump-bun.sh — bump automatizado da versão do Bun (fonte única vars.BUN_VERSION)
#
# WHY: trocar o Bun no CI exige 3 passos coordenados que, feitos à mão, têm
# risco de drift silencioso (esquecer o .actrc, esquecer de re-disparar um
# mirror, ou re-disparar o mirror ANTES da variável). Este script automatiza
# o fluxo completo documentado em docs/BUN_BUMP.md:
#
#   1. gh variable set BUN_VERSION <nova>   (FONTE ÚNICA — a única edição
#      obrigatória no CI; cache keys bun-/prisma- viram miss sozinhas)
#   2. Atualizar os DOIS espelhos da versao (.actrc para o act local; e
#      deploy/env.gitea.example para o runner da forja) — o guard estático só
#      valida a EXISTÊNCIA da linha, não o valor; o job semanal actrc-sync
#      avisa via ::warning:: se qualquer um dos dois divergir
#   3. Re-disparar os DOIS mirrors GHCR     (sync-bun-mirror.yml = binário
#      scratch tier-3; sync-ubuntu-bun-mirror.yml = imagem runner tier-1) e
#      aguardar conclusão via POLLING do gh run list + check de conclusion
#      (mesma técnica do bench-setup-bun.sh — não usa gh run watch)
#   4. Aviso de CACHE MISS na 1ª execução   (esperado: toolchain nova ≠ chave
#      nova — ~20-30s por job, re-popula com as chaves novas)
#
# --dry-run imprime TODOS os comandos que seriam executados sem executar
# NENHUM (o preflight de auth/variável continua VIVO — um dry-run com gh sem
# acesso falha de propósito, para você não planejar em cima de um ambiente
# quebrado).
#
# Usage:
#   ./scripts/bump-bun.sh 1.3.15                    # bump completo (variável + espelhos + mirrors)
#   ./scripts/bump-bun.sh 1.3.15 --dry-run          # só mostra o que faria (preflight vivo)
#   ./scripts/bump-bun.sh 1.3.15 --skip-mirrors     # variável + espelhos, sem re-dispatch
#   ./scripts/bump-bun.sh 1.3.15 --skip-actrc       # variável + env da forja + mirrors
#   ./scripts/bump-bun.sh 1.3.15 --skip-env         # variável + .actrc + mirrors
#   ./scripts/bump-bun.sh --repo owner/repo 1.3.15  # repo explícito (default: remote origin)
#   ./scripts/bump-bun.sh --ref main 1.3.15         # ref do dispatch dos mirrors
#   ./scripts/bump-bun.sh -h                        # ajuda
#
# Env overrides: BUMP_GH_REPO (owner/repo), BUMP_REF, BUMP_WATCH_TIMEOUT_S.
#
# Exit codes:
#   0 — bump completo (variável atualizada + espelhos + mirrors concluídos)
#   1 — falha de infra/run (dispatch falhou ou run do mirror falhou)
#   2 — uso (versão ausente/malformada, gh ausente, repo não derivável,
#       .actrc ou deploy/env.gitea.example sem a linha BUN_VERSION)
#   3 — versão nova == versão atual (nada a fazer)
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── defaults ────────────────────────────────────────────────────────────────
# Deriva owner/repo do remote origin (ex.: git@github.com:severinno/severinno.git)
REMOTE_URL="$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null || true)"
case "$REMOTE_URL" in
  git@github.com:*)        GH_REPO="${REMOTE_URL#git@github.com:}" ;;
  https://github.com/*)    GH_REPO="${REMOTE_URL#https://github.com/}" ;;
  *) GH_REPO="" ;;
esac
GH_REPO="${GH_REPO%.git}"
GH_REPO="${BUMP_GH_REPO:-$GH_REPO}"
REF="${BUMP_REF:-main}"
WATCH_TIMEOUT_S="${BUMP_WATCH_TIMEOUT_S:-900}"
NEW_VERSION=""
DRY_RUN=0
SKIP_MIRRORS=0
SKIP_ACTRC=0
SKIP_ENV=0

# ── arg parsing ─────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) GH_REPO="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    --timeout) WATCH_TIMEOUT_S="$2"; shift 2 ;;    --skip-mirrors) SKIP_MIRRORS=1; shift ;;
    --skip-actrc) SKIP_ACTRC=1; shift ;;
    --skip-env) SKIP_ENV=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      END_SEP="$(grep -n '^# ---' "$0" | sed -n '2p' | cut -d: -f1)"
      [ -n "$END_SEP" ] || { echo "bump-bun: separadores do header não encontrados — não consigo imprimir --help" >&2; exit 2; }
      sed -n "2,${END_SEP}p" "$0"
      exit 0 ;;
    -*) echo "bump-bun: argumento desconhecido: $1" >&2
        echo "Usage: $0 [--repo owner/repo] [--ref BRANCH] [--timeout S] [--skip-mirrors] [--skip-actrc] [--skip-env] [--dry-run] <X.Y.Z>" >&2
        exit 2 ;;
    *) [ -z "$NEW_VERSION" ] || { echo "bump-bun: versão duplicada: $1 (já passou '$NEW_VERSION')" >&2; exit 2; }
       NEW_VERSION="$1"; shift ;;
  esac
done

# ── validação da versão (semver X.Y.Z estrito) ─────────────────────────────
# Mesma forma do parseActrcVersion do check-bun-mirror.mjs (X.Y.Z completo +
# lookahead negativo): rejeita 1.3, 1.3.14.. e 1.3.14-beta.
if [ -z "$NEW_VERSION" ]; then
  # Os exemplos NÃO têm número de propósito: uma versão concreta na mensagem
  # envelhece sozinha depois do bump e passa a parecer a versão vigente.
  echo "bump-bun: versão nova é OBRIGATÓRIA (ex.: ./scripts/bump-bun.sh X.Y.Z)" >&2
  echo "Usage: $0 [opções] <X.Y.Z>" >&2
  exit 2
fi
if ! grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' <<< "$(printf '%s' "$NEW_VERSION")"; then
  echo "bump-bun: versão '$NEW_VERSION' inválida — use semver X.Y.Z completo" >&2
  exit 2
fi

# ── validação de inteiros (pós-parse — cobre --timeout passado na CLI) ────
case "$WATCH_TIMEOUT_S" in
  ''|*[!0-9]*) echo "bump-bun: --timeout deve ser um inteiro positivo (obtido: '$WATCH_TIMEOUT_S')" >&2; exit 2 ;;
esac
if [ "$WATCH_TIMEOUT_S" -lt 1 ]; then echo "bump-bun: --timeout deve ser >= 1" >&2; exit 2; fi

# ── preflight ───────────────────────────────────────────────────────────────
if [ -z "$GH_REPO" ]; then
  echo "bump-bun: não consegui derivar owner/repo do remote origin — passe --repo owner/repo" >&2
  exit 2
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "bump-bun: gh CLI não encontrado — instale o GitHub CLI e rode gh auth login" >&2
  exit 2
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "bump-bun: gh NÃO autenticado — rode 'gh auth login' (conta com acesso a $GH_REPO) e complete NO ambiente do worktree (device flow — ver Bugs conhecidos no README)" >&2
  exit 2
fi
if ! gh api "repos/$GH_REPO" >/dev/null 2>&1; then
  echo "bump-bun: gh autenticado mas SEM acesso ao repo $GH_REPO (404 = conta errada/escopos)" >&2
  exit 2
fi

CURRENT_VERSION="$(gh api "repos/$GH_REPO/actions/variables/BUN_VERSION" --jq .value 2>/dev/null || true)"
if [ -z "$CURRENT_VERSION" ]; then
  echo "bump-bun: vars.BUN_VERSION NÃO EXISTE em $GH_REPO — crie primeiro:" >&2
  echo "    gh variable set BUN_VERSION $NEW_VERSION -R $GH_REPO" >&2
  echo "  (URL: https://github.com/$GH_REPO/settings/variables/actions)" >&2
  exit 2
fi

# ── nada a fazer? ───────────────────────────────────────────────────────────
if [ "$CURRENT_VERSION" = "$NEW_VERSION" ]; then
  echo "bump-bun: versão nova ($NEW_VERSION) == versão atual ($CURRENT_VERSION) — nada a fazer (exit 3)" >&2
  exit 3
fi

ACTRC_PATH="$REPO_ROOT/.actrc"
ACTRC_LINE="--var BUN_VERSION=$NEW_VERSION"
# Espelho da variável para o RUNNER da forja (o arquivo comitado; no VPS ele é
# copiado para deploy/.env.gitea). É o irmão do .actrc: mesmo valor, outro
# consumidor — o job semanal actrc-sync compara os DOIS com a variável.
ENV_MIRROR_PATH="$REPO_ROOT/deploy/env.gitea.example"
ENV_MIRROR_LINE="BUN_VERSION=$NEW_VERSION"

echo "▶ bump-bun — repo=$GH_REPO ref=$REF  $CURRENT_VERSION → $NEW_VERSION"
[ "$DRY_RUN" = "1" ] && echo "  (dry-run — comandos abaixo serão APENAS impressos, nada executado)"
echo ""

# ── helpers: executa ou imprime (dry-run) / dispatch + watch de mirror ────
run() { # $@ = comando a executar
  if [ "$DRY_RUN" = "1" ]; then
    printf '  [dry-run] $ %s\n' "$*"
    return 0
  fi
  "$@"
}

# Dispara UM workflow de mirror e aguarda conclusão com --exit-status (0 =
# sucesso). Precisão ms: created_at da API tem ms e a comparação é
# lexicográfica — sem '.000Z' o run disparado no MESMO segundo seria excluído
# (. < Z). Definida NO TOPO (não aninhada no branch) para legibilidade.
dispatch_and_watch() { # $1=workflow.yml  $2=label
  local wf="$1" label="$2" before run_id="" status="" conclusion
  local deadline now line
  before="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  echo "  ▶ $label: gh workflow run $wf --ref $REF"
  if ! gh workflow run "$wf" --ref "$REF" -R "$GH_REPO" 2>/dev/null; then
    echo "  ❌ dispatch de $wf falhou (workflow existe no ref? rode sem --ref em main)" >&2
    return 1
  fi
  deadline=$(( $(date +%s) + WATCH_TIMEOUT_S ))
  while [ -z "$run_id" ] || [ "$status" != "completed" ]; do
    sleep 10
    line="$(gh run list --workflow "$wf" --limit 5 --json databaseId,status,created_at --jq ".[] | select(.created_at >= \"$before\") | \"\(.databaseId) \(.status)\"" 2>/dev/null | tail -1 || true)"
    [ -n "$line" ] && read -r run_id status <<< "$line"
    now=$(date +%s)
    if [ "$now" -ge "$deadline" ]; then
      echo "  ❌ timeout (${WATCH_TIMEOUT_S}s) aguardando $label concluir" >&2
      return 1
    fi
  done
  conclusion="$(gh run view "$run_id" --json conclusion --jq .conclusion -R "$GH_REPO" 2>/dev/null || echo unknown)"
  if [ "$conclusion" != "success" ]; then
    echo "  ❌ $label (run $run_id) concluiu com conclusion=$conclusion — veja o log: gh run view $run_id" >&2
    return 1
  fi
  echo "  ✅ $label (run $run_id) concluído com sucesso"
}

# Atualiza UMA linha de espelho preservando o resto do arquivo (header de
# comentário incluso). awk POSIX — `sed -i` não é portável. Em dry-run o
# redirect NÃO é criado (senão um Ctrl-C no meio deixaria um .tmp órfão — fix D
# do review). O grep final é a prova de que a escrita pegou: sem ele um awk que
# não casa nada "atualizaria" o arquivo para o mesmo conteúdo e seguiríamos
# como se tivesse funcionado.
update_mirror() { # $1=path  $2=regex da linha  $3=linha nova
  local path="$1" re="$2" line="$3"
  if [ "$DRY_RUN" = "1" ]; then
    run awk -v new="$line" -v re="$re" '$0 ~ re { print new; next } { print }' "$path"
    echo "  [dry-run] > $line (escrita em $path)"
    return 0
  fi
  awk -v new="$line" -v re="$re" '$0 ~ re { print new; next } { print }' "$path" > "$path.tmp"
  mv "$path.tmp" "$path"
  # grep -- : a linha do .actrc começa com '--' e o grep a parsearia como opção
  # sem o separador explícito (bug real pego no teste do awk).
  if ! grep -qx -- "$line" "$path"; then
    echo "bump-bun: falha ao atualizar $path — linha esperada '$line' não encontrada após a escrita" >&2
    exit 1
  fi
  echo "  $path → $line"
}

# ── Passo 1: repository variable (FONTE ÚNICA) ─────────────────────────────
echo "──────────────────────────────────────────────────────────────"
echo "1/4  Repository variable BUN_VERSION (fonte única)"
echo "──────────────────────────────────────────────────────────────"
run gh variable set BUN_VERSION "$NEW_VERSION" -R "$GH_REPO"

# ── Passo 2: espelhos da variável (.actrc + env da forja) ──────────────────
echo ""
echo "──────────────────────────────────────────────────────────────"
echo "2/4  Espelhos da versão (act local + runner da forja — mantém o actrc-sync em silêncio)"
echo "──────────────────────────────────────────────────────────────"

# ── 2a. .actrc (o act local não lê as variables do repositório) ──
if [ "$SKIP_ACTRC" = "1" ]; then
  echo "  (--skip-actrc — .actrc NÃO será tocado; o job semanal actrc-sync vai avisar via ::warning::)"
elif [ ! -f "$ACTRC_PATH" ]; then
  echo "bump-bun: $ACTRC_PATH ausente — o guard check-bun-mirror falharia sem ele; crie com '$ACTRC_LINE'" >&2
  exit 2
elif ! grep -qE '^--var BUN_VERSION=' "$ACTRC_PATH"; then
  echo "bump-bun: $ACTRC_PATH não define a linha '--var BUN_VERSION=' — adicione '$ACTRC_LINE' (o guard exige a linha; o valor é o que este script mantém)" >&2
  exit 2
else
  update_mirror "$ACTRC_PATH" '^--var BUN_VERSION=' "$ACTRC_LINE"
  echo "  Lembrete: commite o .actrc junto (git log -p -- .actrc registra o bump — ver docs/BUN_BUMP.md §8)"
fi

# ── 2b. env do runner da forja (a imagem que roda TODOS os jobs da forja) ──
if [ "$SKIP_ENV" = "1" ]; then
  echo "  (--skip-env — $ENV_MIRROR_PATH NÃO será tocado; o job semanal actrc-sync vai avisar via ::warning::)"
elif [ ! -f "$ENV_MIRROR_PATH" ]; then
  echo "bump-bun: $ENV_MIRROR_PATH ausente — a label do runner ficaria sem versão; restaure o arquivo (o guard check-bun-mirror exige a linha BUN_VERSION nele)" >&2
  exit 2
elif ! grep -qE '^BUN_VERSION=' "$ENV_MIRROR_PATH"; then
  echo "bump-bun: $ENV_MIRROR_PATH não define a linha 'BUN_VERSION=' — adicione '$ENV_MIRROR_LINE' (o guard exige a linha; o valor é o que este script mantém)" >&2
  exit 2
else
  update_mirror "$ENV_MIRROR_PATH" '^BUN_VERSION=' "$ENV_MIRROR_LINE"
  echo "  Lembrete: commite o $ENV_MIRROR_PATH junto, e no VPS copie para deploy/.env.gitea"
  echo "  ⚠️  Divergir aqui NÃO deixa o CI vermelho: o setup-bun funciona igual com ou"
  echo "      sem Bun pré-instalado — o que muda é o fast path de 0s do tier-1, que"
  echo "      DESLIGA em silêncio (todo job da forja volta a pagar o download)."
fi

# ── 2c. defaults de BUN_VERSION nos composes (build args da versão) ────────
# O default de `${BUN_VERSION:-<x>}` é o que VALE onde a variável não existe, e
# o guard check-bun-mirror exige que ele seja IGUAL ao valor declarado no
# espelho. Sem esta escrita o bump deixaria 4 composes para trás e o próprio
# bump terminaria vermelho (ele roda o guard no fim) — o default é um espelho,
# e espelho de bump se escreve no bump.
#
# Um `BUN_VERSION: "1.4.0"` (literal PURO, sem `${...}`) NÃO é alcançado por
# esta reescrita de propósito: ele não é espelho, é um segundo valor — o guard
# o recusa e o conserto é à mão (trocar pela forma derivada).
echo ""
echo "  ── defaults de BUN_VERSION nos composes (espelho derivado) ──"
COMPOSE_ALVOS=0
for _f in "$REPO_ROOT"/docker-compose*.yml "$REPO_ROOT"/docker-compose*.yaml \
          "$REPO_ROOT"/deploy/docker-compose*.yml "$REPO_ROOT"/deploy/docker-compose*.yaml; do
  [ -f "$_f" ] || continue
  grep -qE '\$\{BUN_VERSION:-' "$_f" || continue
  COMPOSE_ALVOS=$((COMPOSE_ALVOS + 1))
  if [ "$DRY_RUN" = "1" ]; then
    echo "  [dry-run] ${_f#"$REPO_ROOT"/}: default de BUN_VERSION → $NEW_VERSION"
    continue
  fi
  awk -v new="$NEW_VERSION" '{ if ($0 ~ /\$\{BUN_VERSION:-/) sub(/\$\{BUN_VERSION:-[^}]*\}/, "${BUN_VERSION:-" new "}"); print }' "$_f" > "$_f.tmp"
  mv "$_f.tmp" "$_f"
  if ! grep -qE "\$\{BUN_VERSION:-$NEW_VERSION\}" "$_f"; then
    echo "bump-bun: falha ao atualizar o default de BUN_VERSION em $_f (reescrita não pegou)" >&2
    exit 1
  fi
  echo "  ${_f#"$REPO_ROOT"/} → \${BUN_VERSION:-$NEW_VERSION}"
done
[ "$COMPOSE_ALVOS" = "0" ] && echo "  (nenhum compose com default de BUN_VERSION)"

# ── Passo 3: re-dispatch dos mirrors GHCR ──────────────────────────────────
echo ""
echo "──────────────────────────────────────────────────────────────"
echo "3/4  Re-dispatch dos mirrors GHCR (leem vars.BUN_VERSION)"
echo "──────────────────────────────────────────────────────────────"
if [ "$SKIP_MIRRORS" = "1" ]; then
  echo "  (--skip-mirrors — dispatch NÃO será feito; rode manualmente depois:)"
  echo "    gh workflow run sync-bun-mirror.yml -R $GH_REPO"
  echo "    gh workflow run sync-ubuntu-bun-mirror.yml -R $GH_REPO"
else
  if [ "$DRY_RUN" = "1" ]; then
    echo "  [dry-run] $ gh workflow run sync-bun-mirror.yml --ref $REF -R $GH_REPO"
    echo "  [dry-run] $ gh workflow run sync-ubuntu-bun-mirror.yml --ref $REF -R $GH_REPO"
    echo "  [dry-run]   (aguardaria conclusão com gh run watch --exit-status)"
  else
    dispatch_and_watch "sync-bun-mirror.yml" "Mirror bun (binário scratch, tier-3)" || exit 1
    dispatch_and_watch "sync-ubuntu-bun-mirror.yml" "Mirror ubuntu-bun (imagem runner, tier-1)" || exit 1
  fi

  echo ""
  echo "  ⚠️  Pacotes GHCR criados via GITHUB_TOKEN nascem PRIVADOS — se o pull anônimo"
  echo "      falhar, torne público em https://github.com/orgs/${GH_REPO%/*}/packages"
  echo "      (não-bloqueante: o tier-3 do setup-bun tem fallback p/ GitHub Releases)."
fi

# ── Passo 4: aviso de cache miss ───────────────────────────────────────────
echo ""
echo "──────────────────────────────────────────────────────────────"
echo "4/4  Aviso: CACHE MISS na 1ª execução do CI pós-bump"
echo "──────────────────────────────────────────────────────────────"
echo "  A 1ª execução roda com cache miss em TODAS as keys bun-*/prisma-*"
echo "  (~20-30s por job) e re-popula o cache com as chaves novas — toolchain"
echo "  nova ≠ chave nova. É ESPERADO e não é regressão (docs/BUN_BUMP.md §3.5)."

# ── validação local (guard estático) ────────────────────────────────────────
echo ""
if [ "$DRY_RUN" = "1" ]; then
  echo "  [dry-run] Validação pós-bump que você rodaria:"
  echo "    node scripts/check-bun-mirror.mjs"
  echo "    node scripts/check-actrc-sync.mjs --expected $NEW_VERSION"
  echo ""
  echo "  ✅ dry-run OK — nenhum comando executado. Rode sem --dry-run para aplicar."
else
  echo "  ▶ Validação local pós-bump..."
  GUARD_FAIL=0
  # Fix B (review): os guards usam process.cwd() para achar .github/ e .actrc —
  # rodam DENTRO de um subshell com cd "$REPO_ROOT" para serem cwd-independentes
  # (o script é executável de qualquer diretório via BASH_SOURCE).
  if (cd "$REPO_ROOT" && node "$SCRIPT_DIR/check-bun-mirror.mjs") >/dev/null 2>&1; then
    echo "  ✅ check-bun-mirror.mjs passou (fonte única ok)"
  else
    echo "  ❌ check-bun-mirror.mjs FALHOU — um bump que deixa o guard vermelho NÃO está completo (docs/BUN_BUMP.md §8 exige verde)" >&2
    GUARD_FAIL=1
  fi
  # --fail: divergência vira ERRO (não aviso) — o bump mudou a variável; se um
  # espelho não acompanhou, é regressão, não nota. Fix A (review): com
  # --skip-actrc/--skip-env o check roda SEM --fail e vira aviso não-bloqueante
  # (o usuário declarou que vai sincronizar aquele espelho em outro momento).
  SKIPPED=""
  if [ "$SKIP_ACTRC" = "1" ]; then SKIPPED=".actrc"; fi
  if [ "$SKIP_ENV" = "1" ]; then SKIPPED="${SKIPPED:+$SKIPPED e }deploy/env.gitea.example"; fi
  if [ -n "$SKIPPED" ]; then
    if (cd "$REPO_ROOT" && node "$SCRIPT_DIR/check-actrc-sync.mjs" --expected "$NEW_VERSION") >/dev/null 2>&1; then
      echo "  ✅ check-actrc-sync.mjs ok (espelhos == variável — mesmo com --skip)"
    else
      echo "  ⚠️  check-actrc-sync.mjs acusou drift em $SKIPPED (pulado por flag) vs $NEW_VERSION — esperado; o job semanal actrc-sync avisa via ::warning::; sincronize manualmente"
    fi
  elif (cd "$REPO_ROOT" && node "$SCRIPT_DIR/check-actrc-sync.mjs" --expected "$NEW_VERSION" --fail) >/dev/null 2>&1; then
    echo "  ✅ check-actrc-sync.mjs ok (os DOIS espelhos == variável)"
  else
    echo "  ❌ check-actrc-sync.mjs acusou DRIFT entre um dos espelhos e $NEW_VERSION (--fail) — corrija o .actrc / deploy/env.gitea.example e re-rode" >&2
    GUARD_FAIL=1
  fi
  if [ "$GUARD_FAIL" = "1" ]; then
    echo ""
    echo "  ❌ Validação pós-bump FALHOU — a variável foi atualizada e os mirrors disparados,"
    echo "     mas o repositório local NÃO está verde. Corrija e re-rode a validação:"
    echo "       cd \"$REPO_ROOT\" && node scripts/check-bun-mirror.mjs"
    echo "       node scripts/check-actrc-sync.mjs --expected $NEW_VERSION --fail"
    echo "     (os dois espelhos: .actrc e deploy/env.gitea.example)"
    exit 1
  fi
fi

echo ""
echo "  ✅ bump $CURRENT_VERSION → $NEW_VERSION concluído. Registre no worklog.md (docs/BUN_BUMP.md §8)."
exit 0
