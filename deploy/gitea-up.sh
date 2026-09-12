#!/usr/bin/env bash
# =============================================================================
# deploy/gitea-up.sh — Sobe a stack da forja GARANTINDO antes que a imagem do
# runner existe no registry.
#
# Por que existe: o `depends_on` do compose só ordena containers, não o mundo
# externo. Os labels do runner apontam para
# <registry>/<namespace>/ubuntu-bun:<BUN_VERSION> e, se a tag não estiver
# publicada (ou o pacote estiver privado), TODO job falha ao iniciar o
# container — longe da causa. Este script torna a publicação um PRÉ-REQUISITO
# mecânico da subida: primeiro `scripts/ensure-runner-image.mjs` confirma (e
# publica, se preciso), depois o Gitea/Caddy sobem, e SÓ ENTÃO o runner.
#
# A ordem é invariante (o guard checkGiteaBringUp falha se ela for invertida):
# o `up -d runner` NÃO pode vir antes da garantia da imagem.
#
# Usage:
#   bash deploy/gitea-up.sh                     # garante a imagem + sobe tudo
#   bash deploy/gitea-up.sh --check-only        # só confere a imagem (não sobe nada)
#   bash deploy/gitea-up.sh --no-runner         # sobe só Gitea + Caddy
#   bash deploy/gitea-up.sh --re-register       # garante a imagem + re-registra o runner
#   ENV_FILE=deploy/.env.gitea bash deploy/gitea-up.sh
#
# --re-register: para quem TROCOU os labels (ou a BUN_VERSION) e precisa que o
# runner envie o registro de novo. O act_runner envia os labels NO REGISTRO e
# depois usa os que ficaram gravados em /data/.runner — `restart` não aplica
# label novo, e o volume sobrevive ao `rm` do container. Então este modo apaga
# o container E o registro gravado antes de subir, e a garantia da imagem
# continua valendo (o passo 1 roda igual).
# CONFLITA com --check-only e --no-runner (ambos dizem "não subir o runner").
#
# Flags repassadas ao ensure:
#   --source auto|workflow|local   (default: auto)
#
# Exit codes:
#   0 — stack no ar (ou imagem em ordem no --check-only)
#   1 — uso/arquivo/ESTADO LOCAL (flag contraditória, volume do registro que
#       não sai, compose ou env ausente) — nada é subido
#   >=2 — código do ensure-runner-image.mjs (2 env, 3 indeterminado,
#         4 ausente no --check-only, 5 falha ao publicar) — NADA é subido
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/docker-compose.gitea.yml}"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env.gitea}"
ENSURE_SCRIPT="${ENSURE_SCRIPT:-$REPO_DIR/scripts/ensure-runner-image.mjs}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
SOURCE="auto"
CHECK_ONLY=0
NO_RUNNER=0
RE_REGISTER=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠️${NC} $1"; }
info() { echo -e "  ${CYAN}▸${NC} $1"; }

# Imprime o header de comentário INTEIRO (do 2º separador '# ====' para trás).
# Não usar uma faixa fixa de linhas: ela corta o bloco Usage quando o header
# cresce — e o usuário veria a ajuda pela metade sem nenhum sinal de que falta
# pedaço (foi o que aconteceu ao documentar --re-register).
usage() {
  END_SEP="$(grep -n '^# ====' "${BASH_SOURCE[0]}" | sed -n '2p' | cut -d: -f1)"
  [ -n "$END_SEP" ] || {
    echo "gitea-up: separadores do header não encontrados — não consigo imprimir a ajuda" >&2
    exit 1
  }
  sed -n "2,$((END_SEP - 1))p" "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --check-only) CHECK_ONLY=1 ;;
    --no-runner) NO_RUNNER=1 ;;
    --re-register) RE_REGISTER=1 ;;
    --env-file) ENV_FILE="${2:-}"; shift ;;
    --source) SOURCE="${2:-}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "argumento desconhecido: $1"; usage; exit 1 ;;
  esac
  shift
done

# Combinações contraditórias: --re-register pressupõe subir o runner depois de
# apagar o registro; as duas outras flags dizem o contrário. Falhar aqui vale
# mais que escolher uma precedência silenciosa.
if [ "$RE_REGISTER" -eq 1 ] && [ "$CHECK_ONLY" -eq 1 ]; then
  fail "--re-register e --check-only são contraditórios (um re-registra, o outro não toca em nada)"
  exit 1
fi
if [ "$RE_REGISTER" -eq 1 ] && [ "$NO_RUNNER" -eq 1 ]; then
  fail "--re-register e --no-runner são contraditórios (um sobe o runner, o outro o deixa de fora)"
  exit 1
fi

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🐳 FORJA — subir com a imagem do runner GARANTIDA"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ── Pré-condições locais ───────────────────────────────────────────────────
[ -f "$COMPOSE_FILE" ] || { fail "compose não encontrado: $COMPOSE_FILE"; exit 1; }
[ -f "$ENV_FILE" ] || {
  fail "env não encontrado: $ENV_FILE"
  fail "Crie com: cp $SCRIPT_DIR/env.gitea.example $ENV_FILE  (e preencha RUNNER_TOKEN)"
  exit 1
}
command -v docker >/dev/null 2>&1 || { fail "docker não encontrado no PATH"; exit 1; }
command -v node >/dev/null 2>&1 || { fail "node não encontrado no PATH (o ensure roda em node)"; exit 1; }
[ -f "$ENSURE_SCRIPT" ] || { fail "ensure não encontrado: $ENSURE_SCRIPT"; exit 1; }

info "compose : $COMPOSE_FILE"
info "env     : $ENV_FILE"
echo ""

# ── 1. PRÉ-REQUISITO: a imagem do runner existe no registry ────────────────
# --no-runner pula a garantia (não vamos subir o runner, então a imagem dele
# não é pré-requisito de nada nesta execução).
# --gitea-env (e não --env-file): `--env-file` é flag do PRÓPRIO Node e o
# runtime a consome antes do script — com o arquivo ausente o processo morreria
# com exit 9, sem a nossa mensagem.
ENSURE_ARGS=(--gitea-env "$ENV_FILE" --source "$SOURCE")
[ "$CHECK_ONLY" -eq 1 ] && ENSURE_ARGS+=(--check)

ENSURE_CODE=0
if [ "$NO_RUNNER" -eq 1 ] && [ "$CHECK_ONLY" -eq 0 ]; then
  warn "--no-runner: pulando a garantia da imagem (o runner não vai subir)"
else
  info "garantindo a imagem do runner (publica se necessário)..."
  echo ""
  node "$ENSURE_SCRIPT" "${ENSURE_ARGS[@]}"
  ENSURE_CODE=$?
  echo ""
  if [ "$ENSURE_CODE" -ne 0 ]; then
    fail "imagem do runner NÃO garantida (exit ${ENSURE_CODE}) — NADA foi subido."
    fail "O runner subiria e todos os jobs falhariam ao iniciar o container."
    exit "$ENSURE_CODE"
  fi
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  echo ""
  pass "check-only: imagem em ordem, stack NÃO foi tocada."
  exit 0
fi

DOCKER_COMPOSE=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

# ── 2. Gitea + Caddy ───────────────────────────────────────────────────────
info "subindo gitea + caddy..."
"${DOCKER_COMPOSE[@]}" up -d gitea caddy || { fail "docker compose up (gitea caddy) falhou"; exit 1; }

info "aguardando o Gitea responder em http://localhost:3000/api/healthz ..."
READY=0
for _ in $(seq 1 $((HEALTH_TIMEOUT / 3))); do
  if curl -fsS -o /dev/null http://localhost:3000/api/healthz 2>/dev/null; then
    READY=1
    break
  fi
  sleep 3
done
if [ "$READY" -eq 1 ]; then
  pass "Gitea no ar"
else
  warn "Gitea não respondeu em ${HEALTH_TIMEOUT}s — verifique: docker compose -f $COMPOSE_FILE logs gitea"
fi

# ── 3. Runner — SÓ DEPOIS da imagem garantida no passo 1 ───────────────────
if [ "$NO_RUNNER" -eq 1 ]; then
  echo ""
  pass "gitea + caddy no ar (runner não subiu: --no-runner)"
  exit 0
fi

# ── 3a. Re-registro: apaga o container E o registro GRAVADO ────────────────
# POR QUE apagar o volume: o runner guarda os labels que recebeu no REGISTRO em
# /data/.runner e depois usa ESSES — não relê o compose. Sem apagar o volume, o
# container sobe com os labels ANTIGOS e o tier-1 continua desligado, sem
# nenhum sintoma (o setup-bun funciona igual, só mais lento). Apagar só o
# container não basta: o volume sobrevive ao `rm`.
if [ "$RE_REGISTER" -eq 1 ]; then
  # O nome sai do COMPOSE (esta fixado em `runner-data: name: <nome>`), não de
  # uma cópia aqui — um rename no compose tem de chegar até nós.
  RUNNER_VOLUME="$(grep -A2 -E '^  runner-data:' "$COMPOSE_FILE" | sed -n 's/^[[:space:]]*name:[[:space:]]*//p' | head -1)"
  if [ -z "$RUNNER_VOLUME" ]; then
    fail "não consegui ler o nome do volume do registro em $COMPOSE_FILE (procurei 'runner-data:' seguido de 'name:')."
    fail "Sem apagar o volume o runner voltaria com os labels ANTIGOS — prefiro falhar a re-registrar em silêncio."
    exit 1
  fi

  warn "re-registrando: removendo o container do runner..."
  "${DOCKER_COMPOSE[@]}" rm -sf runner || { fail "docker compose rm -sf runner falhou"; exit 1; }

  if docker volume inspect "$RUNNER_VOLUME" >/dev/null 2>&1; then
    docker volume rm "$RUNNER_VOLUME" >/dev/null 2>&1 || true
    if docker volume inspect "$RUNNER_VOLUME" >/dev/null 2>&1; then
      fail "o volume '$RUNNER_VOLUME' ainda existe — o registro antigo sobreviveria e os labels NÃO seriam aplicados"
      fail "Remédio: docker volume rm $RUNNER_VOLUME (com o container parado) e rode de novo."
      exit 1
    fi
    pass "registro apagado ($RUNNER_VOLUME) — o próximo 'up' envia os labels do compose"
  else
    info "volume do registro ainda não existe (primeira subida) — nada a apagar"
  fi
fi

info "subindo o act_runner (a imagem já foi confirmada no registry)..."
"${DOCKER_COMPOSE[@]}" up -d runner || { fail "docker compose up (runner) falhou"; exit 1; }

echo ""
if [ "$RE_REGISTER" -eq 1 ]; then
  pass "stack no ar — runner RE-REGISTRADO com os labels do compose (tier-1 ativo)"
  info "se o runner não aparecer em Site Administration → Runners, o RUNNER_TOKEN está velho: gere outro na UI e repita"
else
  pass "stack no ar — runner rodando a imagem com o Bun pré-instalado (tier-1 ativo)"
fi
info "confirme em: Site Administration → Runners (o runner envia os labels no REGISTRO)"
info "smoke da forja: rode o workflow 'Forge Smoke' e leia a prova do tier-1"
