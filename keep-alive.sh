#!/bin/bash
# Check if Next.js server is running on port 3000, restart if not
if ! ss -tlnp | grep -q ':3000'; then
  echo "[$(date)] Server not running, starting..." >> /home/z/my-project/dev.log
  cd /home/z/my-project
  # Kill any stale Chrome processes to free memory
  pkill -9 chrome 2>/dev/null
  sleep 2
  node node_modules/next/dist/bin/next start -p 3000 >> /home/z/my-project/dev.log 2>&1 &
  disown -a
  echo "[$(date)] Server restarted" >> /home/z/my-project/dev.log
fi
