#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════════
# docker-entrypoint.sh — Leitor de Docker Secrets + URL Constructor
# ═══════════════════════════════════════════════════════════════════════════
# Uso:
#   ENTRYPOINT: ["./scripts/docker-entrypoint.sh"]
#   CMD: (imagem original — mantida inalterada)
#
# Funcionamento:
#   FASE 1 — Leitura de Secrets
#   Varre /run/secrets/ por arquivos de segredos (Docker Secrets).
#   Para cada segredo, exporta como variável de ambiente:
#     /run/secrets/postgres_password  →  export POSTGRES_PASSWORD=...
#     (nome do arquivo em UPPER_SNAKE_CASE, hífens viram underscores)
#
#   FASE 2 — Construção de URLs
#   Reconstrói URLs de conexão que usam senhas inline.
#   Isso é NECESSÁRIO porque a interpolação ${VAR} do Docker Compose
#   ocorre no HOST (antes do container rodar), mas os secrets só
#   estão disponíveis DENTRO do container via /run/secrets/.
#   Sem esta fase, DATABASE_URL teria a senha vazia.
#
#   FASE 3 — Execução
#   Executa o comando original da imagem (CMD) com todas as env vars
#   corretamente configuradas.
#
# Suporta:
#   - Docker Compose secrets (file:)          → /run/secrets/<nome>
#   - Docker Swarm secrets (external: true)   → /run/secrets/<nome>
#   - Kubernetes secrets montados em /run/secrets/
# ═══════════════════════════════════════════════════════════════════════════

set -e

SECRETS_DIR="/run/secrets"

# ═══════════════════════════════════════════════════════════════════════════
# FASE 1 — Leitura de Secrets
# ═══════════════════════════════════════════════════════════════════════════

if [ -d "$SECRETS_DIR" ]; then
  echo "[entrypoint] Reading secrets from $SECRETS_DIR..."

  for secret_file in "$SECRETS_DIR"/*; do
    [ -f "$secret_file" ] || continue

    secret_name=$(basename "$secret_file")

    # Pula arquivos de metadados do Kubernetes
    case "$secret_name" in
      ..*|*.kubernetes.io*) continue ;;
    esac

    # Converte nome do arquivo para UPPER_SNAKE_CASE
    # Exemplo: "postgres-password" → "POSTGRES_PASSWORD"
    #           "s3_secret_key"   → "S3_SECRET_KEY"
    env_name=$(echo "$secret_name" | tr '[:lower:]' '[:upper:]' | tr '-' '_')

    # Verifica se já existe uma env var com o mesmo nome
    # (env vars tem precedência sobre secrets)
    if eval "[ -z \"\${${env_name}-}\" ]"; then
      secret_value=$(cat "$secret_file" | tr -d '\n\r')
      export "$env_name=$secret_value"
      echo "[entrypoint]  ✓ $env_name (from secret $secret_name)"
    else
      echo "[entrypoint]  - $env_name already set via env var (skipping secret)"
    fi
  done
else
  echo "[entrypoint] No secrets directory found ($SECRETS_DIR). Using env vars only."
fi

# ═══════════════════════════════════════════════════════════════════════════
# FASE 2 — Construção de URLs com senhas a partir de secrets
# ═══════════════════════════════════════════════════════════════════════════
# IMPORTANTE: O Docker Compose interpola ${VAR} no HOST (docker compose up).
# Como os secrets não estão no host (estão em /run/secrets/ dentro do
# container), as URLs no docker-compose.yml teriam a senha vazia.
#
# A solução é reconstruir as URLs AQUI, dentro do container, DEPOIS de
# ler os secrets. O export sobrescreve o que o Compose definiu.
# ═══════════════════════════════════════════════════════════════════════════

# ── PostgreSQL (app e workers) ──────────────────────────────────────────
# ATENCAO: Sobrescreve SEMPRE (sem ${VAR:-fallback}).
# O Docker Compose interpola ${VAR} no HOST, entao as URLs no compose
# tem a senha VAZIA (ja que o secret so existe dentro do container).
# Precisamos reconstruir as URLs AQUI com a senha real do secret.
export DATABASE_URL="postgresql://${POSTGRES_USER:-severinno}:${POSTGRES_PASSWORD}@pgbouncer:6432/${POSTGRES_DB:-severinno}"
export DIRECT_URL="postgresql://${POSTGRES_USER:-severinno}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-severinno}"

# ── RabbitMQ (app e workers que consomem da fila) ───────────────────────
export RABBITMQ_URL="amqp://${RABBITMQ_USER:-severinno}:${RABBITMQ_PASS}@rabbitmq:5672/${RABBITMQ_VHOST:-severinno}"

echo "[entrypoint] URLs constructed: DATABASE_URL, DIRECT_URL, RABBITMQ_URL"

# ═══════════════════════════════════════════════════════════════════════════
# FASE 3 — Execução do comando original
# ═══════════════════════════════════════════════════════════════════════════

echo "[entrypoint] Starting: $@"
exec "$@"
