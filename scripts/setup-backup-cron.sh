#!/usr/bin/env bash
# =============================================================================
# Setup Backup Cron Jobs — Severinno Marketplace
# =============================================================================
# Installs cron jobs for automated PostgreSQL backups:
#   - Daily at 02:00 AM
#   - Weekly on Sunday at 03:00 AM
#   - Monthly on 1st at 04:00 AM
#
# Usage:
#   sudo bash scripts/setup-backup-cron.sh
#
# Exit codes:
#   0 — cron jobs installed
#   1 — failure
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup-postgres.sh"
LOG_DIR="/var/log/severinno-backups"
USER="${SUDO_USER:-$(whoami)}"

# Create log directory
mkdir -p "$LOG_DIR" 2>/dev/null || true

echo "Installing PostgreSQL backup cron jobs..."

# Remove existing Severinno backup crons
(crontab -l 2>/dev/null | grep -v "severinno.*backup" || true) | crontab - 2>/dev/null || true

# Add new cron jobs
(crontab -l 2>/dev/null || true; cat <<CRON
# Severinno PostgreSQL Backups (installed $(date))
# Daily backup at 02:00 AM
0 2 * * * $BACKUP_SCRIPT daily >> $LOG_DIR/daily.log 2>&1
# Weekly backup on Sunday at 03:00 AM
0 3 * * 0 $BACKUP_SCRIPT weekly >> $LOG_DIR/weekly.log 2>&1
# Monthly backup on 1st at 04:00 AM
0 4 1 * * $BACKUP_SCRIPT monthly >> $LOG_DIR/monthly.log 2>&1
CRON
) | crontab -

echo "✅ Cron jobs installed:"
echo "   Daily:   02:00 AM"
echo "   Weekly:  Sunday 03:00 AM"
echo "   Monthly: 1st of month 04:00 AM"
echo ""
echo "Logs: $LOG_DIR/"
echo ""
echo "Testing backup..."
bash "$BACKUP_SCRIPT" daily
