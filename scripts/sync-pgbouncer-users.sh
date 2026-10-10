#!/bin/bash
# ==============================================================================
# Sincroniza a senha real do Postgres com o userlist.txt do PgBouncer
# ==============================================================================
# Garante que o userlist.txt montado no PgBouncer sempre contenha a senha
# atualizada de secrets/postgres_password.secret, evitando divergência após
# git pull/reset ou rotação de segredos.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

PW_FILE="$ROOT_DIR/secrets/postgres_password.secret"
USERLIST="$ROOT_DIR/config/pgbouncer/userlist.txt"

if [ -s "$PW_FILE" ]; then
    PASSWORD=$(tr -d '\r\n' < "$PW_FILE")
    cat << USERLIST_EOF > "$USERLIST"
"severinno" "$PASSWORD"
"postgres" "$PASSWORD"
"glitchtip" ""
USERLIST_EOF
    chmod 644 "$USERLIST"
fi
