#!/bin/bash
# Auto-restart supervisor for the Next.js server
# Keeps restarting the server after crashes (OOM, etc.)
cd /home/z/my-project
while true; do
  node node_modules/next/dist/bin/next start -p 3000 >> /home/z/my-project/dev.log 2>&1
  EXIT=$?
  echo "[$(date)] Server exited with code $EXIT, restarting in 2s..." >> /home/z/my-project/dev.log
  sleep 2
done
