#!/bin/sh
# =============================================================================
# GlitchTip Entrypoint Wrapper
# =============================================================================
# Reads Docker secrets from /run/secrets/ and exports them as environment
# variables before calling the original GlitchTip entrypoint.
#
# This allows the third-party GlitchTip image to use Docker Secrets instead
# of plaintext environment variables for sensitive credentials.
#
# Usage:
#   scripts/glitchtip-entrypoint.sh <original-command> [args...]
#
#   This script is used as the entrypoint in docker-compose.prod.yml:
#     glitchtip-web:
#       image: glitchtip/glitchtip:v5.2
#       entrypoint: ["./scripts/glitchtip-entrypoint.sh"]
#       command: ["./bin/run-web"]
#       secrets:
#         - glitchtip_db_password
#         - glitchtip_secret_key
#         - glitchtip_s3_secret_key
#
# Exit codes:
#   0 — success (secrets loaded, original command executed)
#   1 — original command failed
# =============================================================================

set -e

# ── Read Docker Secrets ────────────────────────────────────────────────────
# Secrets are mounted at /run/secrets/<secret_name> by Docker.
# We read them and export as environment variables that GlitchTip expects.

read_secret() {
  local secret_name="$1"
  local env_var="$2"
  local secret_file="/run/secrets/${secret_name}"
  
  if [ -f "$secret_file" ] && [ -s "$secret_file" ]; then
    export "$env_var"="$(cat "$secret_file")"
    echo "[glitchtip-entrypoint] ✅ Loaded secret: ${secret_name} -> ${env_var}"
  else
    echo "[glitchtip-entrypoint] ⚠️  Secret file not found or empty: ${secret_file}"
  fi
}

# ── Database Password ──────────────────────────────────────────────────────
# GlitchTip expects GLITCHTIP_DB_PASSWORD or DATABASE_URL with the password
read_secret "glitchtip_db_password" "GLITCHTIP_DB_PASSWORD"

# If DATABASE_URL is set via env but has a placeholder password, replace it
if [ -n "$GLITCHTIP_DB_PASSWORD" ] && [ -n "$DATABASE_URL" ]; then
  # Replace password placeholder in DATABASE_URL if present
  # Pattern: postgres://user:PASSWORD@host/db
  DATABASE_URL="$(echo "$DATABASE_URL" | sed "s|:${GLITCHTIP_DB_PASSWORD}@|:${GLITCHTIP_DB_PASSWORD}@|g")"
  export DATABASE_URL
fi

# ── Secret Key (Django) ────────────────────────────────────────────────────
read_secret "glitchtip_secret_key" "SECRET_KEY"

# ── S3 Secret Key ──────────────────────────────────────────────────────────
read_secret "glitchtip_s3_secret_key" "S3_SECRET_ACCESS_KEY"

# ── Call Original Entrypoint ───────────────────────────────────────────────
echo "[glitchtip-entrypoint] Starting GlitchTip with secrets loaded..."

# Execute the original command (passed as arguments)
exec "$@"
