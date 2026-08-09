#!/bin/sh
# ===========================================================================
# setup-secrets.sh - Criacao de Docker Secrets para o Severinno
# ===========================================================================
# Uso:
#   ./scripts/setup-secrets.sh                    # Cria todos os secrets
#   ./scripts/setup-secrets.sh --list             # Lista secrets existentes
#   ./scripts/setup-secrets.sh --remove           # Remove todos os secrets
#
# Pre-requisitos:
#   - Docker em Swarm mode (docker swarm init)
#   - Arquivos .secret em ./secrets/ (copiados de .example)
#
# Exemplo:
#   cp secrets/postgres_password.secret.example secrets/postgres_password.secret
#   echo "my_secure_password" > secrets/postgres_password.secret
#   ./scripts/setup-secrets.sh
# ===========================================================================

set -e

SECRETS_DIR="./secrets"
NAMESPACE="severinno"

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# -- Help ------------------------------------------------------------------
show_help() {
  cat <<EOF
Uso: $0 [opcao]

Opcoes:
  (sem opcao)    Cria todos os Docker Secrets a partir dos arquivos .secret
  --list         Lista todos os Docker Secrets ativos
  --remove       Remove todos os Docker Secrets do namespace severinno
  --help         Mostra esta mensagem

Pre-requisitos:
  - Docker em modo Swarm: docker swarm init (se necessario)
  - Arquivos .secret em $SECRETS_DIR/

Exemplo:
  # 1. Copie os templates
  for f in $SECRETS_DIR/*.example; do
    cp "\$f" "\${f%.example}"
  done

  # 2. Edite os arquivos com valores reais
  # vim $SECRETS_DIR/postgres_password.secret

  # 3. Crie os secrets
  $0
EOF
}

# -- List secrets ----------------------------------------------------------
list_secrets() {
  echo " Docker Secrets ativos (namespace: $NAMESPACE):"
  docker secret ls --format "table {{.ID}}\t{{.Name}}\t{{.CreatedAt}}" | \
    grep "$NAMESPACE" || echo "  (nenhum secret encontrado)"
}

# -- Remove secrets --------------------------------------------------------
remove_secrets() {
  echo "  Removendo todos os Docker Secrets do namespace $NAMESPACE..."
  docker secret ls --format "{{.Name}}" | \
    grep "$NAMESPACE" | \
    while read -r secret; do
      echo "  Removendo: $secret"
      docker secret rm "$secret" 2>/dev/null || true
    done
  echo "[OK] Todos os secrets removidos."
}

# -- Create secrets --------------------------------------------------------
create_secrets() {
  echo " Criando Docker Secrets para o Severinno..."
  echo "   Namespace: $NAMESPACE"
  echo "   Diretorio: $SECRETS_DIR"
  echo ""

  created=0
  skipped=0
  errors=0

  for secret_file in "$SECRETS_DIR"/*.secret; do
    [ -f "$secret_file" ] || continue

    filename=$(basename "$secret_file")           # postgres_password.secret
    secret_name="${filename%.secret}"             # postgres_password
    swarm_name="${NAMESPACE}_${secret_name}"      # severinno_postgres_password

    # Pula .example files
    case "$filename" in
      *.example) continue ;;
    esac

    # Verifica se o arquivo contem placeholder
    if grep -qi "changeme\|your_secret_here\|replace_me" "$secret_file" 2>/dev/null; then
      echo -e "  ${YELLOW}[!]  PULANDO${NC} $secret_name (contem placeholder - edite o arquivo primeiro)"
      skipped=$((skipped + 1))
      continue
    fi

    # Verifica se o secret ja existe
    if docker secret inspect "$swarm_name" >/dev/null 2>&1; then
      echo -e "  ${YELLOW}[!]  EXISTE${NC}  $swarm_name (ja existe - pulando)"
      skipped=$((skipped + 1))
      continue
    fi

    # Cria o secret
    if docker secret create "$swarm_name" "$secret_file" >/dev/null; then
      echo -e "  ${GREEN}-  CRIADO${NC}  $swarm_name <- $filename"
      created=$((created + 1))
    else
      echo -e "  ${RED}[X]  ERRO${NC}   $swarm_name (falha ao criar)"
      errors=$((errors + 1))
    fi
  done

  echo ""
  echo "=== Resumo ==="
  echo "  Criados:  $created"
  echo "  Pulados:  $skipped"
  echo "  Erros:    $errors"

  if [ "$errors" -gt 0 ]; then
    return 1
  fi
}

# -- Main ------------------------------------------------------------------
case "${1:-}" in
  --help|-h)
    show_help
    ;;
  --list|-l)
    list_secrets
    ;;
  --remove|-r)
    remove_secrets
    ;;
  "")
    # Verifica se Docker Swarm esta ativo
    if ! docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q "active"; then
      echo -e "${YELLOW}[!]  Docker Swarm nao esta ativo.${NC}"
      echo "   Execute 'docker swarm init' primeiro, ou use Docker Compose file:"
      echo "   docker compose -f docker-compose.prod.yml --env-file .env.production up -d"
      echo ""
    fi
    create_secrets
    ;;
  *)
    echo "Opcao desconhecida: $1"
    show_help
    exit 1
    ;;
esac
