#!/usr/bin/env bash
# =============================================================================
# scripts/publish-ubuntu-bun.sh — Publica a imagem custom ubuntu-bun no registry
# DECLARADO (IMAGE_REGISTRY/IMAGE_NAMESPACE) e valida o tier-1 do setup-bun com a
# imagem REMOTA (não só a local).
#
# Por que existe: o fast path (tier-1) do scripts/setup-bun-ci.sh só
# dispara quando a imagem do runner embarca bun na versão pedida. A imagem
# custom Dockerfile.ubuntu-bun ativa esse caminho (~0-2s vs ~25-35s do
# oven-sh/setup-bun@v2). Este script fecha o ciclo completo de operação:
# publicar, tornar o pacote público e COMPROVAR que a imagem publicada
# (puxada de novo do registry, com a imagem local removida antes) mantém o
# tier-1 funcionando via act.
#
# O REGISTRY não é literal: sai de IMAGE_REGISTRY/IMAGE_NAMESPACE (a fonte
# única — o mesmo par que o compose da forja e os workflows resolvem). Um
# `ghcr.io` cravado aqui sobreviveria à virada do registry e o script passaria
# a publicar/conferir a tag no registry VELHO, em silêncio.
#
# ⚠️ REQUISITO: credencial do registry declarado. Sem ela o preflight falha
# ANTES de qualquer push, com instruções. Autentique de UMA destas formas:
#   1. docker login <IMAGE_REGISTRY>  (o caminho direto — vale para o registry
#                                      próprio, o OCI embutido do Gitea)
#   2. gh auth login        (SÓ onde o registry é o GHCR: além do push,
#                            habilita a etapa 3 de visibilidade via gh api)
#   3. export GH_TOKEN=<PAT com write:packages>  e rode:
#        echo "$GH_TOKEN" | gh auth login --with-token
#   4. No CI: o workflow .github/workflows/sync-ubuntu-bun-mirror.yml já
#      publica com secrets.GITHUB_TOKEN (packages: write) — mas pacotes
#      criados com GITHUB_TOKEN nascem PRIVADOS e exigem marcar público nas
#      settings da org (ver etapa 3 do fluxo).
#
# Fluxo:
#   1. Preflight  — docker, credencial do registry, imagem local com a versão certa
#   2. docker push <registry>/<namespace>/ubuntu-bun:<version>
#   3. gh api     — (SÓ GHCR — etapa 3 do corte do GitHub) tenta tornar o
#                   pacote PÚBLICO (user level; em org o admin marca nas
#                   settings — o script avisa se falhar e SEGUE)
#   4. docker rmi — remove a imagem LOCAL (força o pull REAL do remote)
#   5. docker pull <registry>/<namespace>/ubuntu-bun:<version>
#   6. act -j check com -P ubuntu-latest=<registry>/<namespace>/ubuntu-bun:<version>
#      --pull=false e valida a evidência do tier-1 no log:
#        - o step 'Setup Bun' passou
#        - '✅ Usando Bun pré-instalado: <version> (0s, sem download)'
#      (o act é o runner LOCAL do GitHub — etapa 5 do corte; a validação do
#      tier-1 no runtime da FORJA é o job `pre-commit-in-runner-proof`)
#
# Usage:
#   ./scripts/publish-ubuntu-bun.sh                 # registry declarado, v1.3.14
#   IMAGE_REGISTRY=127.0.0.1:5000 BUN_VERSION=1.3.14 ./scripts/publish-ubuntu-bun.sh
#
# Environment:
#   IMAGE_REGISTRY   Host do registry OCI (default: git.severinno.com — o
#                    MESMO default do compose; o valor declarado é a variável)
#   IMAGE_NAMESPACE  Namespace no registry (default: severinno — o declarado)
#   OWNER        Owner do remote — usado SÓ nas etapas gh (visibilidade, act)
#   BUN_VERSION  Versão do Bun (default: 1.3.14 — FONTE ÚNICA: vars.BUN_VERSION)
#   ACT_BIN      Caminho do binário do act (default: tool-results/act/act.exe)
#   ACT_TIMEOUT  Timeout do act em segundos (default: 600 — o job `check`
#                completo roda bun install + typecheck e pode exceder)
#
# Exit codes:
#   0 — publicada E tier-1 validado com a imagem remota
#   1 — preflight falhou (credenciais/imagem/docker ausentes)
#   2 — push/visibilidade falharam
#   3 — pull remoto falhou (imagem não publicada ou privada)
#   4 — act falhou (parse, image, ou evidência do tier-1 não encontrada)
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── Configuração (com overrides por env) ─────────────────────────────────────
OWNER="${OWNER:-$(git -C "$SCRIPT_DIR" remote get-url origin 2>/dev/null | sed -E 's#.*[:/]([^/:]+)/[^/]+(\.git)?$#\1#')}"
# A TAG da imagem publicada: da variável do ambiente (quando passada) ou do
# ESPELHO do repositório (.actrc — a versão declarada, escrita pelo bump-bun e
# comparada com a repository variable pelo guard semanal). NUNCA de um literal
# de reserva: um `:-1.3.14` aqui sobrevive ao bump e este script passa a
# publicar/conferir a tag ANTIGA em silêncio (o script funciona igual).
VERSION="${BUN_VERSION:-$(sed -n 's/^--var BUN_VERSION=//p' "$SCRIPT_DIR/.actrc" 2>/dev/null | head -1 || true)}"
if [ -z "$VERSION" ]; then
  echo "publish-ubuntu-bun: nenhuma versão declarada — nem BUN_VERSION no ambiente, nem '--var BUN_VERSION=' em $SCRIPT_DIR/.actrc" >&2
  echo "  (o literal de reserva foi removido de propósito: ele sobrevive ao bump e a tag fica velha sem sintoma)." >&2
  echo "  Declare em .actrc ou passe BUN_VERSION=<X.Y.Z> no comando." >&2
  exit 2
fi
REGISTRY="${IMAGE_REGISTRY:-git.severinno.com}"
# O default ACOMPANHA o valor declarado (`deploy/env.gitea.example`): o guard da
# invariante 9 compara default x declarado POR VALOR, e um default que ninguém
# declara faria a imagem que roda não ser a que o repositório diz.
NAMESPACE="${IMAGE_NAMESPACE:-severinno}"
IMAGE="${REGISTRY}/${NAMESPACE}/ubuntu-bun:${VERSION}"
ACT_BIN="${ACT_BIN:-$SCRIPT_DIR/tool-results/act/act.exe}"
ACT_TIMEOUT="${ACT_TIMEOUT:-600}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠️${NC} $1"; }
info() { echo -e "  ${CYAN}▸${NC} $1"; }

if [ -z "${OWNER}" ]; then
  fail "Não foi possível derivar o namespace (OWNER) do git remote. Passe OWNER=... ou IMAGE_NAMESPACE=... explicitamente."
  exit 1
fi

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🚀 PUBLISH UBUNTU-BUN → ${REGISTRY} + VALIDAÇÃO DO TIER-1 REMOTO"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""
echo "  Imagem : ${IMAGE}"
echo "  Act    : ${ACT_BIN}"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# 1. Preflight — credenciais + docker + imagem local
# ═════════════════════════════════════════════════════════════════════════
info "Preflight..."

if ! command -v docker >/dev/null 2>&1; then
  fail "docker não encontrado no PATH."
  exit 1
fi
pass "docker disponível"

# Auth: gh (melhor) ou docker login pré-existente no config do GHCR.
GH_AUTH=0
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  GH_AUTH=1
  pass "gh autenticado ($(gh api user --jq .login 2>/dev/null || echo '?'))"
else
  warn "gh NÃO está autenticado — a etapa de visibilidade pública (passo 3) será pulada."
fi

if ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
  fail "Imagem local '${IMAGE}' não existe. Build com:"
  fail "  docker build --build-arg BUN_VERSION=${VERSION} -f Dockerfile.ubuntu-bun -t ${IMAGE} ."
  exit 1
fi
pass "imagem local presente: ${IMAGE}"

# Confirma a versão do bun EMBARCADA (mesma da tag).
BUN_EMBEDDED="$(docker run --rm --entrypoint bun "${IMAGE}" --version 2>/dev/null || echo '?')"
if [ "${BUN_EMBEDDED}" != "${VERSION}" ]; then
  fail "bun embarcado (${BUN_EMBEDDED}) ≠ versão da tag (${VERSION}) — imagem errada?"
  exit 1
fi
pass "bun embarcado: ${BUN_EMBEDDED} (confere com a tag)"

# ═════════════════════════════════════════════════════════════════════════
# 2. Push
# ═════════════════════════════════════════════════════════════════════════
echo ""
info "docker push ${IMAGE} ..."
# Separar timeout (124 — imagem de ~600MB pode demorar em uplink lento) de
# falha real de auth (exit != 0 e != 124): a mensagem precisa ser a certa.
# ATENÇÃO (bash): com `if ! pipeline; then` o $? dentro do then seria SEMPRE
# 0 (o `!` nega o status da pipeline) — por isso if/else SEM `!`, lendo $?
# no else (com pipefail, o status da pipeline é o do timeout/docker push,
# não o do tail).
if timeout 600 docker push "${IMAGE}" 2>&1 | tail -15; then
  pass "push ok"
else
  PUSH_CODE=$?
  echo ""
  if [ "${PUSH_CODE}" -eq 124 ]; then
    fail "Push excedeu 600s (timeout) — aumente o limite ou verifique o uplink. Nada de credencial aqui."
  else
    fail "Push falhou (exit ${PUSH_CODE}) — provável falta de credenciais. Autentique com UMA das opções:"
    fail "  1. gh auth login"
    fail "  2. export GH_TOKEN=<PAT write:packages> && echo \"\$GH_TOKEN\" | gh auth login --with-token"
    fail "  3. echo <token> | docker login ${REGISTRY} -u <usuario> --password-stdin"
  fi
  exit 2
fi

# ═════════════════════════════════════════════════════════════════════════
# 3. Visibilidade pública (user level via gh api)
# ═════════════════════════════════════════════════════════════════════════
echo ""
# A visibilidade via `gh api` só EXISTE no GHCR: com o registry declarado sendo
# outro (o OCI embutido do Gitea, que é o caso depois da virada da etapa 1), a
# etapa não tem o que fazer — e dizer "pacote público" ali seria uma afirmação
# sobre um pacote que este script não publicou.
if [ "${REGISTRY}" != "ghcr.io" ]; then
  warn "visibilidade via gh api pulada: o registry declarado é ${REGISTRY} (esta etapa é do caminho GHCR — etapa 3 do corte do GitHub)."
elif [ "${GH_AUTH}" -eq 1 ]; then
  info "Tentando tornar o pacote PÚBLICO..."
  # GHCR container packages: nome do pacote = nome da imagem (ubuntu-bun).
  # O remote é severinno/severinno → owner quase certamente ORG: tenta primeiro
  # o endpoint de USER e, em falha (404/403), o de ORG — que é o caso comum.
  # Obs.: org pública exige a config da org 'Allow packages to be public'
  # (Settings → Packages) — sem ela, o endpoint de org retorna 422/403.
  if gh api -X PUT "user/packages/container/ubuntu-bun/visibility" -f visibility=public >/dev/null 2>&1; then
    pass "pacote público (user level — ghcr.io/${OWNER}/ubuntu-bun)"
  elif gh api -X PUT "orgs/${OWNER}/packages/container/ubuntu-bun/visibility" -f visibility=public >/dev/null 2>&1; then
    pass "pacote público (org level — ghcr.io/${OWNER}/ubuntu-bun)"
  else
    warn "Não consegui setar visibilidade (user E org) — o token pode não ter write:packages, ou a org não permite pacotes públicos."
    warn "Ajuste manualmente em:"
    warn "  GitHub → Packages → ghcr.io/${OWNER}/ubuntu-bun → Package settings → Change visibility"
    warn "Sem visibilidade pública, o docker pull (passo 5) falhará com acesso negado."
  fi
else
  warn "gh não autenticado — pulando visibilidade pública. Se o pacote nascer privado,"
  warn "o pull remoto (passo 5) falhará. Marque público manualmente nas settings da org."
fi

# ═════════════════════════════════════════════════════════════════════════
# 4-5. Remove a imagem LOCAL e puxa a REMOTA — prova que o remote funciona
# ═════════════════════════════════════════════════════════════════════════
echo ""
info "Removendo imagem local (força o pull REAL do remote)..."
RMI_OK=0
docker rmi "${IMAGE}" >/dev/null 2>&1 && RMI_OK=1
if [ "${RMI_OK}" -ne 1 ]; then
  warn "não consegui remover a imagem local (em uso?) — se o pull abaixo disser 'up to date', a validação usa a imagem LOCAL."
fi

info "docker pull ${IMAGE} ..."
if timeout 600 docker pull "${IMAGE}" 2>&1 | tail -5; then
  pass "pull remoto ok"
else
  PULL_CODE=$?
  echo ""
  if [ "${PULL_CODE}" -eq 124 ]; then
    fail "Pull excedeu 600s (timeout)."
  else
    fail "Pull remoto falhou (exit ${PULL_CODE}) — imagem não publicada ou pacote privado (veja passo 3)."
  fi
  exit 3
fi

# Prova do REMOTE: o RepoDigest após o pull referencia o registry DECLARADO (não
# um digest local de build). Se o rmi falhou e o pull foi 'up to date', o digest
# local ainda aponta para o build — o aviso acima já cobriu; aqui validamos o
# caso normal (imagem recém-baixada).
DIGEST="$(docker image inspect "${IMAGE}" --format '{{range .RepoDigests}}{{.}}{{end}}' 2>/dev/null || echo '')"
case "${DIGEST}" in
  "${REGISTRY}"/*) pass "RepoDigest confirma origem remota: ${DIGEST}" ;;
  *) warn "RepoDigest não referencia ${REGISTRY} (${DIGEST:-vazio}) — provável imagem local sem pull real; re-rode com a imagem local removida." ;;
esac

# Confirma que a imagem baixada mantém a versão certa.
BUN_PULLED="$(docker run --rm --entrypoint bun "${IMAGE}" --version 2>/dev/null || echo '?')"
if [ "${BUN_PULLED}" != "${VERSION}" ]; then
  fail "bun da imagem remota (${BUN_PULLED}) ≠ ${VERSION} — imagem remota divergente?"
  exit 3
fi
pass "bun da imagem remota: ${BUN_PULLED} (confere com a tag)"

# ═════════════════════════════════════════════════════════════════════════
# 6. act -j check com a imagem REMOTA (--pull=false usa a recém-baixada)
# ═════════════════════════════════════════════════════════════════════════
echo ""
if [ ! -x "${ACT_BIN}" ]; then
  fail "act não encontrado em ${ACT_BIN} — passe ACT_BIN=... ou rode o passo 6 manualmente:"
  fail "  tool-results/act/act.exe -b -W .github/workflows/pr-check.yml -j check -P ubuntu-latest=${IMAGE} --pull=false"
  exit 4
fi

LOG="$(mktemp)"
info "act -j check com -P ubuntu-latest=${IMAGE} --pull=false (timeout ${ACT_TIMEOUT}s)..."
echo ""
timeout "${ACT_TIMEOUT}" "${ACT_BIN}" -b -W "${SCRIPT_DIR}/.github/workflows/pr-check.yml" -j check \
  -P "ubuntu-latest=${IMAGE}" --pull=false >"${LOG}" 2>&1
ACT_CODE=$?

echo ""
info "Extraindo evidência do tier-1 no log do act..."
if grep -q "Unknown Variable Access vars\|expressions are not allowed here" "${LOG}"; then
  fail "act falhou no parse dos workflows (expressão não resolvida) — ver log."
  tail -25 "${LOG}"
  rm -f "${LOG}"
  exit 4
fi

TIER1_STEP=$(grep -c "Success - Main Setup Bun" "${LOG}" || true)
TIER1_MSG=$(grep -o "✅ Usando Bun pré-instalado: [0-9.]* (0s, sem download)" "${LOG}" | head -1 || true)

if [ "${TIER1_STEP}" -ge 1 ] && [ -n "${TIER1_MSG}" ]; then
  pass "TIER-1 CONFIRMADO com a imagem REMOTA:"
  pass "  ${TIER1_MSG}"
  pass "  (setup-bun rodou em ~0-2s, zero download — mesmo comportamento da imagem local)"
  rm -f "${LOG}"
  echo ""
  echo -e "  ${GREEN}✅✅ FLUXO COMPLETO VALIDADO — publicada + pública + tier-1 remoto OK${NC}"
  exit 0
else
  fail "Evidência do tier-1 NÃO encontrada no log do act (step='${TIER1_STEP}', msg='${TIER1_MSG}')."
  warn "O job completo roda bun install + typecheck e pode ter excedido o timeout (${ACT_TIMEOUT}s, exit ${ACT_CODE})."
  warn "Se o act parou no tier-1 mas o resto do job não terminou, re-rode com ACT_TIMEOUT maior."
  echo ""
  echo "── Trecho do log (últimas 30 linhas) ──"
  tail -30 "${LOG}"
  rm -f "${LOG}"
  exit 4
fi
