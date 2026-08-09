#!/bin/bash
# keep-alive.sh - Ensures the Next.js standalone server is running
# Usage: Run via cron every 2 minutes
#   */2 * * * * /home/z/my-project/scripts/keep-alive.sh

SERVER_PORT=3000
STANDALONE="/home/z/my-project/.next/standalone/server.js"
LOG="/home/z/my-project/dev.log"
MAX_OLD_SPACE=200

# Check if server is responding
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:${SERVER_PORT}/ 2>/dev/null)

if [ "$HTTP_CODE" = "200" ]; then
  exit 0
fi

# Server not responding - kill any remaining processes and restart
pkill -9 -f "server.js" 2>/dev/null
sleep 1

NODE_OPTIONS="--max-old-space-size=${MAX_OLD_SPACE}" \
  nohup node "${STANDALONE}" -p ${SERVER_PORT} > "${LOG}" 2>&1 &
disown -a

sleep 3

# Verify restart
NEW_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:${SERVER_PORT}/ 2>/dev/null)
echo "$(date '+%Y-%m-%d %H:%M:%S') keep-alive: restarted (HTTP ${NEW_CODE})" >> /home/z/my-project/keep-alive.log