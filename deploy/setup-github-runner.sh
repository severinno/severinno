#!/usr/bin/env bash
# =============================================================================
# setup-github-runner.sh — Instala GitHub Actions Self-Hosted Runner
# =============================================================================
# Uso:
#   bash deploy/setup-github-runner.sh
#
# Pré-requisitos:
#   1. GitHub Personal Access Token (PAT) com permissões: repo, admin:repo_hook, workflow
#   2. Docker instalado no VPS
#   3. Rodar como root ou com sudo
#
# O script:
#   1. Cria usuário não-root 'github-runner'
#   2. Garante a TOOLCHAIN do runner (bun pinado, node do .nvmrc, gh, python)
#   3. Baixa e configura o runner
#   4. Instala como serviço systemd
#   5. Garante o bun no PATH do daemon (symlink em /usr/local/bin — issue #32)
#   6. Inicia o runner
#
# O passo 4 existe porque o PATH do daemon é o do PID 1 e é FIXADO NO START do
# serviço: bun instalado ou atualizado DEPOIS não é visto pelo runner, e as
# provas reais das meta-suítes (que invocam `bun` via spawnSync) saem
# fail-closed ('unavailable') sem nomear a causa. O mecanismo é o mesmo da
# imagem ubuntu-bun (binário em /usr/local/bin, PATH universal de daemons) e o
# preflight do CI (scripts/preflight-bun-path.sh) é a segunda metade da garantia.
# =============================================================================

set -euo pipefail

# ── Configurações ──────────────────────────────────────────────────────────
RUNNER_USER="github-runner"
RUNNER_HOME="/home/${RUNNER_USER}/actions-runner"
RUNNER_NAME="hostinger-runner"
RUNNER_LABELS="self-hosted,linux,x64,docker"
REPO_URL="https://github.com/severinno/severinno"
# A versao TEM de ser uma que o servico aceite. MEDIDO em 22/09/2026: com
# 2.320.0 o runner registrou, pegou o primeiro job e se AUTO-ATUALIZOU para
# 2.337.0 no meio dele — o update derruba o worker, e o job fica PRESO em
# `in_progress` segurando o unico runner (o cancel do run e o remove do runner
# respondem 422 "is currently running a job"): so `force-cancel` + DELETE do run
# limpam a atribuicao. O `version` do registro e legivel na API
# (`GET /repos/<o>/<r>/actions/runners`), e e o valor que este pin tem de casar.
RUNNER_VERSION="2.337.0"
RUNNER_ARCH="linux-x64"
RUNNER_ARCHIVE="actions-runner-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
RUNNER_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_ARCHIVE}"

# ── Cores ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ── Verificar pré-requisitos ───────────────────────────────────────────────
echo ""
echo "==========================================="
echo "  GitHub Actions Self-Hosted Runner Setup"
echo "==========================================="
echo ""

# Verificar se está rodando como root
if [[ $EUID -ne 0 ]]; then
  err "Execute como root: sudo bash $0"
fi

# Verificar Docker
if ! command -v docker &>/dev/null; then
  err "Docker não encontrado. Instale: https://docs.docker.com/engine/install/"
fi

# ── Toolchain do runner (medido em 28/09/2026) ─────────────────────────────
#
# POR QUE AQUI: um runner recém-provisionado SEM toolchain produz vermelhos
# que não são do código — `node: command not found` derrubou 26 jobs, `spawnSync
# gh ENOENT` derrubou o guard que consulta a API, e a ausência do `python`
# (alias do python3) quebrou os guards de encoding que o chamam pelo nome curto.
# O provisionamento é o lugar da garantia: cada ferramenta tem FONTE ÚNICA de
# versão (nunca latest), instalação idempotente (pula o que já existe) e
# verificação no fim.

instalarBun() {
  if command -v bun >/dev/null 2>&1; then
    log "bun já presente: $(bun --version)"
    return 0
  fi
  [ -n "${BUN_ESPERADO}" ] || err "bun ausente e sem BUN_VERSION declarado (env, .actrc ou deploy/env.gitea.example) — o pin da fonte única é obrigatório"
  log "Instalando bun v${BUN_ESPERADO} (pin da fonte única) em /opt/bun"
  BUN_INSTALL=/opt/bun curl -fsSL https://bun.sh/install | BUN_INSTALL=/opt/bun bash -s "bun-v${BUN_ESPERADO}" >/dev/null
  ln -sf /opt/bun/bin/bun /usr/local/bin/bun
  ln -sf /opt/bun/bin/bunx /usr/local/bin/bunx
  [ "$(/usr/local/bin/bun --version)" = "${BUN_ESPERADO}" ] || err "bun instalado não bate com o pin ${BUN_ESPERADO}"
}

instalarNode() {
  if command -v node >/dev/null 2>&1; then
    log "node já presente: $(node -v)"
    return 0
  fi
  local pin=""
  if [ -n "${NODE_VERSION:-}" ]; then
    pin="${NODE_VERSION}"
  elif [ -s .nvmrc ]; then
    pin="$(head -n1 .nvmrc | tr -d '[:space:]')"
  else
    warn "node ausente e sem NODE_VERSION/.nvmrc no diretório corrente — instale o node do pin do repo antes de rodar jobs de leitura"
    return 0
  fi
  log "Instalando node v${pin} (pin do .nvmrc/NODE_VERSION)"
  curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/v${pin}/node-v${pin}-linux-x64.tar.xz"
  mkdir -p /usr/local/lib/nodejs
  tar -xJf /tmp/node.tar.xz -C /usr/local/lib/nodejs
  rm -f /tmp/node.tar.xz
  ln -sf "/usr/local/lib/nodejs/node-v${pin}-linux-x64/bin/node" /usr/local/bin/node
  ln -sf "/usr/local/lib/nodejs/node-v${pin}-linux-x64/bin/npm" /usr/local/bin/npm
  ln -sf "/usr/local/lib/nodejs/node-v${pin}-linux-x64/bin/npx" /usr/local/bin/npx
  [ "$(node -v)" = "v${pin}" ] || err "node instalado não bate com o pin v${pin}"
}

instalarGh() {
  if command -v gh >/dev/null 2>&1; then
    log "gh já presente: $(gh --version | head -1)"
    return 0
  fi
  if command -v apt-get >/dev/null 2>&1; then
    log "Instalando gh (apt)"
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
    apt-get update -qq && apt-get install -y -qq gh >/dev/null
  else
    warn "gh ausente e apt-get indisponível — instale manualmente (https://cli.github.com)"
  fi
}

instalarPythonAlias() {
  if command -v python >/dev/null 2>&1; then
    log "python já presente: $(python --version 2>&1)"
    return 0
  fi
  if command -v apt-get >/dev/null 2>&1; then
    log "Instalando python-is-python3 (os guards chamam `python` pelo nome curto)"
    apt-get install -y -qq python-is-python3 >/dev/null
  else
    warn "python ausente e apt-get indisponível — os guards de encoding que chamam 'python' vão falhar"
  fi
}

instalarBun
instalarNode
instalarGh
instalarPythonAlias

# ── Bun no PATH do daemon (issue #32) — fonte da versão esperada ───────────
#
# FONTE ÚNICA da versão: vars.BUN_VERSION, espelhada no repositório (.actrc /
# deploy/env.gitea.example, escritos por scripts/bump-bun.sh) e entregue ao CI
# pelo env do passo. Sem nenhuma das três, o script SEGUE (o symlink é
# versão-independente) mas perde a ASSERÇÃO — nunca chuta um literal de reserva,
# que é o defeito que scripts/bun-version.mjs existe para eliminar.
if [ -n "${BUN_VERSION:-}" ]; then
  BUN_ESPERADO="${BUN_VERSION}"
elif [ -s .actrc ] && grep -q '^--var BUN_VERSION=' .actrc 2>/dev/null; then
  BUN_ESPERADO="$(grep '^--var BUN_VERSION=' .actrc | head -n1 | cut -d= -f2)"
elif [ -s deploy/env.gitea.example ] && grep -q '^BUN_VERSION=' deploy/env.gitea.example 2>/dev/null; then
  BUN_ESPERADO="$(grep '^BUN_VERSION=' deploy/env.gitea.example | head -n1 | cut -d= -f2)"
else
  BUN_ESPERADO=""
  warn "BUN_VERSION não declarado (env, .actrc ou deploy/env.gitea.example) — a asserção de versão do bun fica desligada"
fi

garantirBunNoPath() {
  local alvo versao
  alvo="$(command -v bun 2>/dev/null || true)"
  if [ -z "${alvo}" ]; then
    err "bun NÃO resolve pelo PATH — as provas reais das meta-suítes (doctor-ci, forge-doctor, pre-push-blocks, prove-runner-image, pre-commit-real-proof) saem fail-closed ('unavailable') sem ele. Instale o bun e rode este script de novo: 'curl -fsSL https://bun.sh/install | bash' (issue #32; preflight do CI: scripts/preflight-bun-path.sh)"
  fi
  if [ ! -e /usr/local/bin/bun ]; then
    log "Bun no PATH do daemon: /usr/local/bin/bun -> ${alvo}"
    ln -sf "${alvo}" /usr/local/bin/bun
    ln -sf /usr/local/bin/bun /usr/local/bin/bunx
  fi
  if [ ! -x /usr/local/bin/bun ]; then
    err "/usr/local/bin/bun existe mas não é executável — corrija o alvo do symlink e rode de novo"
  fi
  versao="$(/usr/local/bin/bun --version 2>/dev/null || echo '?')"
  log "bun ${versao} acessível como /usr/local/bin/bun (o PATH do daemon o resolve)"
  if [ -n "${BUN_ESPERADO}" ] && [ "${versao}" != "${BUN_ESPERADO}" ]; then
    err "versão do bun em /usr/local/bin (${versao}) ≠ BUN_VERSION declarado (${BUN_ESPERADO}) — atualize o bun no host e rode este script de novo (a fonte única é vars.BUN_VERSION, espelhada em .actrc / deploy/env.gitea.example)"
  fi
}

# Solicitar token
echo ""
read -rp "Cole seu GitHub Personal Access Token (PAT): " GITHUB_PAT
if [[ -z "$GITHUB_PAT" ]]; then
  err "Token não pode ser vazio"
fi

# ── Criar usuário ──────────────────────────────────────────────────────────
if ! id "$RUNNER_USER" &>/dev/null; then
  log "Criando usuário ${RUNNER_USER}..."
  useradd -m -s /bin/bash "$RUNNER_USER"
  usermod -aG docker "$RUNNER_USER"
  log "Usuário criado e adicionado ao grupo docker"
else
  warn "Usuário ${RUNNER_USER} já existe"
  usermod -aG docker "$RUNNER_USER" 2>/dev/null || true
fi

# ── Criar diretório ────────────────────────────────────────────────────────
log "Criando diretório do runner..."
mkdir -p "$RUNNER_HOME"
chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_HOME"

# ── Baixar runner ──────────────────────────────────────────────────────────
log "Baixando GitHub Actions Runner v${RUNNER_VERSION}..."
sudo -u "$RUNNER_USER" curl -L -o "${RUNNER_HOME}/${RUNNER_ARCHIVE}" "$RUNNER_URL"

# ── Extrair ────────────────────────────────────────────────────────────────
log "Extraindo archive..."
sudo -u "$RUNNER_USER" tar xzf "${RUNNER_HOME}/${RUNNER_ARCHIVE}" -C "$RUNNER_HOME"
rm -f "${RUNNER_HOME}/${RUNNER_ARCHIVE}"

# ── Configurar runner ──────────────────────────────────────────────────────
log "Configurando runner..."
echo ""
echo "==========================================="
echo "  Configuração do Runner"
echo "==========================================="
echo ""
echo "URL do repositório: ${REPO_URL}"
echo "Nome do runner: ${RUNNER_NAME}"
echo "Labels: ${RUNNER_LABELS}"
echo ""

sudo -u "$RUNNER_USER" "${RUNNER_HOME}/config.sh" \
  --url "$REPO_URL" \
  --token "$GITHUB_PAT" \
  --name "$RUNNER_NAME" \
  --labels "$RUNNER_LABELS" \
  --work "_work" \
  --replace \
  --unattended

# ── Instalar como serviço systemd ──────────────────────────────────────────
# O svc.sh EXIGE rodar DE DENTRO do diretório do runner (medido em 28/09/2026:
# invocado por caminho absoluto de fora, ele falha com "Must run from runner root
# or install is corrupt" DEPOIS de o runner já ter registrado — o registro fica,
# mas o serviço não sobe). O subshell com `cd` garante a raiz certa.
log "Instalando como serviço systemd..."
( cd "$RUNNER_HOME" && ./svc.sh install "$RUNNER_USER" )

# ── Bun no PATH do daemon (issue #32) ──────────────────────────────────────
# O PATH do serviço é fixado NO START: o remédio tem de ser aplicado ENTRE o
# install e o start, como root, antes de o daemon resolver o primeiro job.
garantirBunNoPath

# ── Iniciar serviço ────────────────────────────────────────────────────────
log "Iniciando serviço..."
( cd "$RUNNER_HOME" && ./svc.sh start )

# ── Verificar status ───────────────────────────────────────────────────────
sleep 2
if systemctl is-active --quiet "actions.runner.*.service" 2>/dev/null ||    grep -q "actions.runner" <<< "$(systemctl list-units --type=service)"; then
  log "Runner instalado e rodando!"
else
  warn "Serviço pode não estar rodando. Verifique: systemctl status actions.runner.*"
fi

# ── Resumo ─────────────────────────────────────────────────────────────────
echo ""
echo "==========================================="
echo "  ✅ Instalação Concluída!"
echo "==========================================="
echo ""
echo "Runner: ${RUNNER_NAME}"
echo "Labels: ${RUNNER_LABELS}"
echo "Repositório: ${REPO_URL}"
echo ""
echo "Para verificar no GitHub:"
echo "  https://github.com/severinno/severinno/settings/actions/runners"
echo ""
echo "Comandos úteis:"
echo "  sudo systemctl status actions.runner.*   # Ver status"
echo "  sudo systemctl restart actions.runner.*  # Reiniciar"
echo "  sudo journalctl -u actions.runner.* -f   # Ver logs"
echo ""
