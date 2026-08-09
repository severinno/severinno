#!/usr/bin/env bash
# ===========================================================================
# deploy.sh - Severinno Marketplace Deploy Automatico (One-Shot)
# ===========================================================================
# Executa o deploy completo no VPS:
#   1. Git pull + checkout do release branch/tag
#   2. Docker compose pull/build
#   3. Database migrations (Prisma)
#   4. Docker compose up -d (todos os servicos)
#   5. Healthcheck com retry (ate 2 min)
#   6. Rollback automatico em caso de falha
#   7. Cleanup de imagens antigas
#
# Uso:
#   sudo bash scripts/deploy.sh                              # Deploy completo
#   sudo bash scripts/deploy.sh --tag v0.4.0                 # Deploy de tag especifica
#   sudo bash scripts/deploy.sh --branch release/v0.4.0      # Deploy de branch
#   sudo bash scripts/deploy.sh --skip-build                 # Pular build (pull only)
#   sudo bash scripts/deploy.sh --skip-migrate               # Pular migrations
#   sudo bash scripts/deploy.sh --dry-run                    # Simular (sem alteracoes)
#   sudo bash scripts/deploy.sh --rollback                   # Reverter ao deploy anterior
#   sudo bash scripts/deploy.sh --rollback=2                 # Reverter 2 deploys
#   sudo bash scripts/deploy.sh --help                       # Esta ajuda
#
# Config:
#   COMPOSE_FILE         Path do compose (default: docker-compose.prod.yml)
#   DEPLOY_TIMEOUT       Tempo maximo do healthcheck (default: 120s)
#   DEPLOY_DIR           Diretorio do projeto (default: /opt/severinno)
#   KEEP_RELEASES        Numero de releases para manter (default: 5)
#   SLACK_WEBHOOK        Webhook Slack opcional para notificacoes
#
# Exit codes:
#   0  -> Deploy concluido com sucesso
#   1  -> Erro de pre-requisito
#   2  -> Falha no deploy (rollback ativado)
#   3  -> Falha no rollback
# ===========================================================================

set -euo pipefail

# -- Config ----------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DEPLOY_TIMEOUT="${DEPLOY_TIMEOUT:-120}"
DEPLOY_DIR="${DEPLOY_DIR:-$PROJECT_DIR}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
RELEASES_DIR="${DEPLOY_DIR}/releases"

BRANCH="${BRANCH:-release/v0.4.0}"
TAG="${TAG:-}"
SKIP_BUILD=false
SKIP_MIGRATE=false
DRY_RUN=false
ROLLBACK=false
ROLLBACK_STEPS=1

# -- Cores -----------------------------------------------------------------

if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
    RED=$(tput setaf 1); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3)
    CYAN=$(tput setaf 6); BLUE=$(tput setaf 4); BOLD=$(tput bold); RESET=$(tput sgr0)
else
    RED=""; GREEN=""; YELLOW=""; CYAN=""; BLUE=""; BOLD=""; RESET=""
fi

info()  { echo -e "  ${CYAN}[i]${RESET} $1"; }
ok()    { echo -e "  ${GREEN}[OK]${RESET} $1"; }
warn()  { echo -e "  ${YELLOW}[!]${RESET} $1"; }
err()   { echo -e "  ${RED}[X]${RESET} $1"; }
step()  { echo ""; echo -e "${BLUE}${BOLD}<> $1${RESET}"; echo "  ${BLUE}----------------------------------------------${RESET}"; }
dry()   { echo -e "  ${YELLOW}[DRY-RUN]${RESET} $1"; }

# -- Help ------------------------------------------------------------------

show_help() {
    cat <<'HELP'

  +==========================================================+
  |   Severinno Deploy Automatico v1.0                       |
  +==========================================================+

  Uso: sudo bash scripts/deploy.sh [opcoes]

  Opcoes:
    --tag <tag>           Deploy de tag especifica (ex: v0.4.0)
    --branch <branch>     Deploy de branch (default: release/v0.4.0)
    --skip-build          Pular build Docker (so pull)
    --skip-migrate        Pular migrations do banco
    --dry-run             Simular (mostra comandos sem executar)
    --rollback[=N]        Reverter N deploys (default: 1)
    --help                Esta ajuda

  Variaveis de ambiente:
    COMPOSE_FILE          Path do compose (default: docker-compose.prod.yml)
    DEPLOY_TIMEOUT        Timeout do healthcheck (default: 120s)
    DEPLOY_DIR            Diretorio do projeto (default: /opt/severinno)
    KEEP_RELEASES         Releases mantidos (default: 5)
    SLACK_WEBHOOK         Webhook Slack para notificacoes

  Exemplos:
    # Deploy completo
    sudo bash scripts/deploy.sh

    # Deploy de tag especifica
    sudo bash scripts/deploy.sh --tag v0.4.0

    # Apenas pull + restart (sem build, sem migrate)
    sudo bash scripts/deploy.sh --skip-build --skip-migrate

    # Reverter ao deploy anterior
    sudo bash scripts/deploy.sh --rollback

HELP
    exit 0
}

# -- Argument parsing ------------------------------------------------------

while [[ $# -gt 0 ]]; do
    case "$1" in
        --tag)          TAG="$2"; shift 2 ;;
        --tag=*)        TAG="${1#*=}"; shift ;;
        --branch)       BRANCH="$2"; shift 2 ;;
        --branch=*)     BRANCH="${1#*=}"; shift ;;
        --skip-build)   SKIP_BUILD=true; shift ;;
        --skip-migrate) SKIP_MIGRATE=true; shift ;;
        --dry-run)      DRY_RUN=true; shift ;;
        --rollback)     ROLLBACK=true;
                        if [[ "${2:-}" =~ ^[0-9]+$ ]]; then
                            ROLLBACK_STEPS="$2"; shift
                        fi
                        shift ;;
        --rollback=*)   ROLLBACK=true; ROLLBACK_STEPS="${1#*=}"; shift ;;
        --help|-h)      show_help ;;
        *)              echo "Opcao desconhecida: $1"; show_help ;;
    esac
done

# -- Helper functions ------------------------------------------------------

run() {
    if [ "$DRY_RUN" = true ]; then
        dry "$*"
    else
        eval "$*" 2>&1 | while IFS= read -r line; do echo "       $line"; done
        return "${PIPESTATUS[0]}"
    fi
}

# Notificacao Slack (opcional)
notify_slack() {
    local status="$1" message="$2"
    if [ -z "${SLACK_WEBHOOK:-}" ]; then
        return 0
    fi
    local color
    case "$status" in
        success) color="good" ;;
        failure) color="danger" ;;
        *)       color="warning" ;;
    esac
    curl -sf -X POST -H "Content-Type: application/json" \
        -d "{\"attachments\":[{\"color\":\"$color\",\"text\":\"[$status] $message\"}]}" \
        "$SLACK_WEBHOOK" 2>/dev/null || true
}

# -- Prerequisites ---------------------------------------------------------

check_prerequisites() {
    step "1/7 - Verificando pre-requisitos"

    # Root check (Docker commands need it in production)
    if [ "$(id -u)" -ne 0 ]; then
        warn "Recomendado rodar como root (ou com sudo). Alguns comandos Docker podem falhar."
    fi

    # Docker
    if ! command -v docker &>/dev/null; then
        err "Docker nao encontrado! Instale: curl -fsSL https://get.docker.com | sh"
        exit 1
    fi
    ok "Docker: $(docker --version 2>/dev/null)"

    # Docker Compose
    if ! docker compose version &>/dev/null; then
        err "Docker Compose nao encontrado!"
        exit 1
    fi
    ok "Docker Compose: $(docker compose version 2>/dev/null)"

    # docker compose file
    if [ ! -f "$COMPOSE_FILE" ]; then
        err "Arquivo docker-compose nao encontrado: $COMPOSE_FILE"
        exit 1
    fi
    ok "Compose file: $COMPOSE_FILE"

    # .env file
    if [ ! -f ".env.production.local" ] && [ ! -f ".env" ]; then
        err "Arquivo .env nao encontrado! Crie .env.production.local baseado no .env.production"
        exit 1
    fi
    ok "Arquivo .env: $(ls -1 .env.production.local .env 2>/dev/null | head -1)"

    # curl (for healthcheck)
    if ! command -v curl &>/dev/null; then
        err "curl nao encontrado! Instale: apt install curl"
        exit 1
    fi
    ok "curl disponivel"

    # git
    if ! command -v git &>/dev/null; then
        err "git nao encontrado!"
        exit 1
    fi
    ok "git disponivel"

    # Secrets directory
    if [ -d "secrets" ]; then
        local secrets_count
        secrets_count=$(find secrets/ -name '*.secret' -type f 2>/dev/null | wc -l)
        ok "Secrets: $secrets_count arquivos encontrados"
    else
        warn "Diretorio secrets/ nao encontrado"
    fi
}

# -- Git Operations --------------------------------------------------------

git_operations() {
    step "2/7 - Sincronizando repositorio Git"

    # Salva o commit atual para rollback
    local current_commit
    current_commit=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
    info "Commit atual: $current_commit"

    # Store current commit for rollback
    if [ "$DRY_RUN" = false ]; then
        echo "$current_commit" > /tmp/severinno_deploy_previous 2>/dev/null || true
    fi

    # Fetch
    info "Buscando alteracoes do remote..."
    run git fetch --tags --force

    # Checkout
    if [ -n "$TAG" ]; then
        info "Checkout da tag: $TAG"
        run git checkout "$TAG" --force
    else
        info "Checkout do branch: $BRANCH"
        run git checkout "$BRANCH" --force
        info "Atualizando branch..."
        run git pull origin "$BRANCH" --force
    fi

    local new_commit
    new_commit=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
    ok "Commit atual: $new_commit"
}

# -- Docker Build/Pull ----------------------------------------------------

docker_build() {
    step "3/7 - Preparando imagens Docker"

    # Validar compose file
    info "Validando sintaxe do docker-compose..."
    run docker compose -f "$COMPOSE_FILE" config -q
    ok "Sintaxe valida"

    if [ "$SKIP_BUILD" = true ]; then
        info "Pull das imagens (build ignorado)..."
        run docker compose -f "$COMPOSE_FILE" pull
    else
        info "Build das imagens..."
        run docker compose -f "$COMPOSE_FILE" build --pull

        info "Pull das imagens base..."
        run docker compose -f "$COMPOSE_FILE" pull
    fi
}

# -- Database Migrations -------------------------------------------------

run_migrations() {
    step "4/7 - Executando migrations do banco"

    if [ "$SKIP_MIGRATE" = true ]; then
        warn "Migrations puladas (--skip-migrate)"
        return 0
    fi

    # Verificar se o banco esta acessivel
    info "Verificando conexao com banco..."

    # Tenta via container app com bunx prisma
    if docker compose -f "$COMPOSE_FILE" ps --status running postgres 2>/dev/null | grep -q "Up"; then
        ok "PostgreSQL esta rodando"
    else
        warn "PostgreSQL nao esta rodando ainda - tentando iniciar..."
        run docker compose -f "$COMPOSE_FILE" up -d postgres
        sleep 5
    fi

    # Executa migrations
    info "Executando Prisma Migrate..."
    local migrate_output migrate_exit
    migrate_output=$(run docker compose -f "$COMPOSE_FILE" run --rm --no-deps app \
        bunx prisma migrate deploy 2>&1) || true
    migrate_exit=$?
    echo "$migrate_output" | tail -10

    if [ "$migrate_exit" -eq 0 ] || echo "$migrate_output" | grep -qi "already completed\|already been\|success"; then
        ok "Migrations executadas com sucesso!"
    else
        # Fallback: db push
        warn "Prisma Migrate falhou - tentando db push..."
        local push_output push_exit
        push_output=$(run docker compose -f "$COMPOSE_FILE" run --rm --no-deps app \
            bunx prisma db push --accept-data-loss 2>&1) || true
        push_exit=$?
        echo "$push_output" | tail -5

        if [ "$push_exit" -eq 0 ] || echo "$push_output" | grep -qi "success\|already\|applied"; then
            warn "db push usado como fallback - schema atualizado"
        else
            err "Falha nas migrations do banco!"
            return 1
        fi
    fi

    # Gera Prisma Client novamente
    info "Regenerando Prisma Client..."
    run docker compose -f "$COMPOSE_FILE" run --rm --no-deps app \
        bunx prisma generate
}

# -- Docker Up ------------------------------------------------------------

docker_up() {
    step "5/7 - Subindo servicos"

    # Core services (precisa subir primeiro)
    info "Subindo servicos core (postgres, redis, minio, rabbitmq)..."
    run docker compose -f "$COMPOSE_FILE" up -d postgres redis rabbitmq minio || return 1

    # PgBouncer (depende do postgres)
    info "Subindo PgBouncer..."
    run docker compose -f "$COMPOSE_FILE" up -d pgbouncer || return 1

    # Caddy (proxy)
    info "Subindo Caddy..."
    run docker compose -f "$COMPOSE_FILE" up -d caddy || return 1

    # App + Realtime
    info "Subindo App e Realtime..."
    run docker compose -f "$COMPOSE_FILE" up -d --no-deps app realtime || return 1

    # Workers
    info "Subindo Workers (email, notification, search-index)..."
    run docker compose -f "$COMPOSE_FILE" up -d --no-deps \
        email-worker notification-worker search-index-worker || return 1

    # GlitchTip (profile separado - apenas se configurado)
    if [ -f ".env.glitchtip" ]; then
        info "Subindo GlitchTip..."
        run docker compose -f "$COMPOSE_FILE" --profile glitchtip \
            --env-file .env.glitchtip up -d || warn "GlitchTip nao subiu (verifique .env.glitchtip)"
    fi
}

# -- Healthcheck ----------------------------------------------------------

healthcheck() {
    step "6/7 - Aguardando healthcheck"

    local max_attempts=$((DEPLOY_TIMEOUT / 5))
    local attempt=0
    local service_status

    info "Timeout configurado: ${DEPLOY_TIMEOUT}s (${max_attempts} tentativas de 5s)"

    while [ $attempt -lt "$max_attempts" ]; do
        attempt=$((attempt + 1))

        # Healthcheck via Docker (status dos containers)
        local status
        status=$(docker compose -f "$COMPOSE_FILE" ps --format '{{.Name}}||{{.Status}}' 2>/dev/null || true)

        # Verificar containers core
        local unhealthy_count
        unhealthy_count=$(echo "$status" | grep -ci "unhealthy" 2>/dev/null || echo "0")
        local exited_count
        exited_count=$(echo "$status" | grep -ci "exit" 2>/dev/null || echo "0")

        # Healthcheck via API HTTP
        local http_code
        http_code=$(curl -s -o /dev/null -w "%{http_code}" \
            --connect-timeout 5 http://localhost:3000/api/health 2>/dev/null || echo "000")

        if [ "$http_code" = "200" ] && [ "$unhealthy_count" -eq 0 ]; then
            echo ""
            ok "Healthcheck passou! HTTP $http_code, todos os containers saudaveis"

            # Mostrar status resumido
            echo ""
            echo "  ${GREEN}Servicos ativos:${RESET}"
            echo "$status" | while IFS='||' read -r name st; do
                if echo "$st" | grep -qi "up\|healthy"; then
                    echo "    ${GREEN}[OK]${RESET} $name"
                else
                    echo "    ${RED}[X]${RESET} $name ($st)"
                fi
            done
            echo ""
            return 0
        fi

        # Progresso
        if [ $((attempt % 2)) -eq 0 ]; then
            echo -ne "  Tentativa $attempt/$max_attempts - HTTP $http_code, unhealthy: $unhealthy_count, exited: $exited_count\\r"
        fi

        sleep 5
    done

    echo ""
    err "Healthcheck falhou apos $max_attempts tentativas"

    # Diagnostico
    warn "Status final dos containers:"
    docker compose -f "$COMPOSE_FILE" ps 2>/dev/null | head -20 | while IFS= read -r line; do
        echo "  $line"
    done

    # Ultimos logs do app
    warn "Ultimos logs do app:"
    docker compose -f "$COMPOSE_FILE" logs --tail=10 app 2>/dev/null | while IFS= read -r line; do
        echo "  $line"
    done

    return 1
}

# -- Rollback -------------------------------------------------------------

do_rollback() {
    step " ROLLBACK - Revertendo deploy anterior"

    local steps="${1:-1}"

    # Se nao tem releases anteriores, tenta via git
    if [ -d "$RELEASES_DIR" ]; then
        info "Procurando releases anteriores em $RELEASES_DIR..."
        local releases
        releases=$(ls -1 "$RELEASES_DIR" 2>/dev/null | sort -r || true)

        if [ -z "$releases" ]; then
            warn "Nenhum release anterior encontrado. Rollback via git..."
            git_rollback
            return $?
        fi

        local target_release
        target_release=$(echo "$releases" | sed -n "${steps}p" 2>/dev/null || true)
        if [ -z "$target_release" ]; then
            err "Release #${steps} nao encontrado (so temos $(echo "$releases" | wc -l) releases)"
            return 1
        fi

        info "Releases disponiveis: $(echo "$releases" | tr '\n' ' ')"
        info "Revertendo para: $target_release"

        # Swap o symlink ou restore o release
        if [ -L "$DEPLOY_DIR/current" ]; then
            run ln -sfn "$RELEASES_DIR/$target_release" "$DEPLOY_DIR/current"
        else
            run cp -a "$RELEASES_DIR/$target_release/"* "$DEPLOY_DIR/"
        fi

        # Re-subir com a versao anterior
        run docker compose -f "$COMPOSE_FILE" up -d --force-recreate app
        ok "Rollback concluido! App reiniciado com release $target_release"
    else
        git_rollback
    fi
}

git_rollback() {
    # Rollback via git - volta ao commit anterior
    local previous_file="/tmp/severinno_deploy_previous"

    if [ ! -f "$previous_file" ]; then
        info "Sem arquivo de commit anterior - voltando HEAD^ (1 commit)"
        run git checkout HEAD^ --force
    else
        local previous_commit
        previous_commit=$(cat "$previous_file" 2>/dev/null || echo "")
        if [ -n "$previous_commit" ] && git cat-file -t "$previous_commit" &>/dev/null; then
            info "Revertendo para commit: $previous_commit"
            run git checkout "$previous_commit" --force
        else
            warn "Commit anterior ($previous_commit) invalido - voltando HEAD^"
            run git checkout HEAD^ --force
        fi
    fi

    # Re-build e up
    if [ "$SKIP_BUILD" = false ]; then
        info "Rebuildando versao anterior..."
        run docker compose -f "$COMPOSE_FILE" build app
    fi
    run docker compose -f "$COMPOSE_FILE" up -d --force-recreate app

    ok "Rollback via git concluido!"
    return 0
}

# -- Cleanup --------------------------------------------------------------

cleanup() {
    step "7/7 - Limpeza"

    # Remove imagens nao utilizadas
    info "Removendo imagens nao utilizadas..."
    run docker image prune -f

    # Remove volumes orfaos (apenas se explicitamente com --prune-volumes)
    # docker volume prune -f e agressivo demais para rodar automaticamente.
    # Use docker volume prune manualmente quando necessario.

    # Remove containers parados
    info "Removendo containers parados..."
    run docker container prune -f

    ok "Limpeza concluida!"
}

# -- Main ------------------------------------------------------------------

main() {
    echo ""
    echo "  +==============================================================+"
    echo "  |    Severinno Deploy Automatico v1.0                        |"
    echo "  +==============================================================+"
    echo ""

    if [ "$DRY_RUN" = true ]; then
        warn "Modo DRY-RUN - nenhuma alteracao sera feita!"
        echo ""
    fi

    local total_start
    total_start=$(date +%s)
    local deploy_status="success"
    local deploy_error=""

    # -- Rollback mode ---------------------------------------------------
    if [ "$ROLLBACK" = true ]; then
        if do_rollback "$ROLLBACK_STEPS"; then
            notify_slack "warning" "Rollback executado: ${ROLLBACK_STEPS} passo(s) no ${HOSTNAME}"
            ok "Rollback concluido!"
            return 0
        else
            notify_slack "failure" "Rollback FALHOU: ${ROLLBACK_STEPS} passo(s) no ${HOSTNAME}"
            err "Rollback FALHOU"
            exit 3
        fi
    fi

    # -- Deploy normal --------------------------------------------------

    # 1. Pre-requisitos
    if ! check_prerequisites; then
        err "Pre-requisitos nao atendidos. Abortando."
        exit 1
    fi

    # 2. Git
    if ! git_operations; then
        err "Falha na sincronizacao Git. Abortando."
        notify_slack "failure" "Deploy falhou (Git): ${HOSTNAME}"
        exit 1
    fi

    # 3. Docker build
    if ! docker_build; then
        err "Falha no build Docker. Iniciando rollback..."
        notify_slack "failure" "Deploy falhou (Docker build): ${HOSTNAME}"
        do_rollback 1
        exit 2
    fi

    # 4. Migrations
    if ! run_migrations; then
        err "Falha nas migrations. Iniciando rollback..."
        notify_slack "failure" "Deploy falhou (migrations): ${HOSTNAME}"
        do_rollback 1
        exit 2
    fi

    # 5. Docker up
    if ! docker_up; then
        err "Falha ao subir servicos. Iniciando rollback..."
        notify_slack "failure" "Deploy falhou (docker up): ${HOSTNAME}"
        do_rollback 1
        exit 2
    fi

    # 6. Healthcheck
    if ! healthcheck; then
        err "Healthcheck falhou! Iniciando rollback..."
        notify_slack "failure" "Deploy falhou (healthcheck): ${HOSTNAME}"
        do_rollback 1
        exit 2
    fi

    # 7. Cleanup
    cleanup

    # -- Resultado ------------------------------------------------------
    local total_end
    total_end=$(date +%s)
    local total_elapsed=$((total_end - total_start))
    local minutes=$((total_elapsed / 60))
    local seconds=$((total_elapsed % 60))

    echo ""
    echo "  +==============================================================+"
    echo "  |   ${GREEN}[OK] DEPLOY CONCLUIDO COM SUCESSO!${RESET}                        |"
    echo "  +==============================================================+"
    echo ""
    info "Duracao: ${minutes}m ${seconds}s"
    info "Branch:  $BRANCH"
    [ -n "$TAG" ] && info "Tag:     $TAG"
    info "Commit:  $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
    info "Data:    $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""

    notify_slack "success" "Deploy v${TAG#v} concluido em ${minutes}m${seconds}s: ${HOSTNAME}"
}

# -- Trap para rollback automatico em caso de erro nao tratado ------------
cleanup_on_error() {
    local exit_code=$?
    if [ $exit_code -ne 0 ] && [ "$DRY_RUN" = false ] && [ "$ROLLBACK" = false ]; then
        echo ""
        err "Erro nao tratado (exit code: $exit_code). Iniciando rollback..."
        notify_slack "failure" "Deploy falhou com erro nao tratado (${exit_code}): ${HOSTNAME}"
        do_rollback 1 || true
    fi
    exit $exit_code
}
trap cleanup_on_error EXIT

# -- Execute --------------------------------------------------------------
main "$@"
