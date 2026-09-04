#!/usr/bin/env bash
# =============================================================================
# Seed Staging — Severinno Marketplace
# =============================================================================
# Creates demo accounts and additional realistic data for staging environment.
#
# Demo accounts:
#   Provider:  provider@severinno.com.br / Provider123
#   Client:    client@severinno.com.br / Client123
#
# Usage:
#   bash scripts/seed-staging.sh
#
# Exit codes:
#   0 — seed completed successfully
#   1 — error during seed
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Seeding staging environment..."

# Run the main GV seed first
cd "$PROJECT_DIR"
npx tsx scripts/seed-governador-valadares.ts 2>&1 | tail -5

echo ""
echo "Creating demo accounts..."

# Provider (needs cpfCnpj, whatsapp, city for validation)
curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Carlos Encanador","email":"provider@severinno.com.br","password":"Provider123","confirmPassword":"Provider123","role":"PROVIDER","cpfCnpj":"12345678901","whatsapp":"33999998888","cep":"35020460","city":"Governador Valadares"}' > /dev/null 2>&1 && echo "  Provider: created" || echo "  Provider: exists or error"

# Client
curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Maria Silva","email":"client@severinno.com.br","password":"Client123","confirmPassword":"Client123","role":"CLIENT"}' > /dev/null 2>&1 && echo "  Client: created" || echo "  Client: exists or error"

echo ""
echo "Staging seed complete!"
echo ""
echo "Demo accounts:"
echo "  Provider: provider@severinno.com.br / Provider123"
echo "  Client:   client@severinno.com.br / Client123"
echo ""
echo "Database stats:"
docker exec severinno-postgis-new psql -U severinno -d severinno -c "SELECT (SELECT count(*) FROM \"User\") as users, (SELECT count(*) FROM \"Booking\") as bookings, (SELECT count(*) FROM \"Review\") as reviews, (SELECT count(*) FROM \"Service\") as services;" 2>/dev/null
