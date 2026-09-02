#!/usr/bin/env bash
# =============================================================================
# PM2 Startup — Severinno Marketplace
# =============================================================================
# Installs a systemd service that starts PM2 on boot and saves process list.
#
# Usage:
#   sudo bash scripts/pm2-startup.sh
# =============================================================================

set -euo pipefail

PM2_USER="${PM2_USER:-severinno}"
PM2_BIN="/home/${PM2_USER}/.bun/bin/pm2"

# ── Generate systemd service ────────────────────────────────────────────────

cat > /tmp/pm2-severinno.service <<EOF
[Unit]
Description=PM2 Process Manager for Severinno
After=network.target docker.service
Wants=docker.service

[Service]
Type=forking
User=${PM2_USER}
WorkingDirectory=/home/${PM2_USER}/severinno
ExecStart=${PM2_BIN} startup
ExecStop=${PM2_BIN} kill
ExecReload=${PM2_BIN} reload
Restart=on-failure
RestartSec=5
LimitNOFILE=infinity
LimitNPROC=infinity
LimitCORE=infinity
TimeoutStartSec=0
TimeoutStopSec=0

[Install]
WantedBy=multi-user.target
EOF

echo "✅ Systemd service file created at /tmp/pm2-severinno.service"
echo ""
echo "To install:"
echo "  sudo cp /tmp/pm2-severinno.service /etc/systemd/system/"
echo "  sudo systemctl daemon-reload"
echo "  sudo systemctl enable pm2-severinno"
echo "  sudo systemctl start pm2-severinno"
echo ""
echo "To save current process list:"
echo "  pm2 save"
