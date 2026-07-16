#!/bin/bash
# Start both realtime mini-service and Next.js dev server as detached daemons.
# Usage: .zscripts/start-bg.sh

PROJECT_DIR="/home/z/my-project"
RT_DIR="$PROJECT_DIR/mini-services/realtime"

# Kill any existing instances
pkill -f "next dev -p 3000" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
pkill -f "bun --hot index.ts" 2>/dev/null || true
sleep 1

# Start realtime mini-service
cd "$RT_DIR"
nohup bun run dev > "$RT_DIR/service.log" 2>&1 < /dev/null &
RT_PID=$!
echo "Realtime PID: $RT_PID"

# Start Next.js dev server
cd "$PROJECT_DIR"
nohup bun run dev > "$PROJECT_DIR/dev.log" 2>&1 < /dev/null &
DEV_PID=$!
echo "Dev PID: $DEV_PID"

# Save PIDs
echo "$RT_PID" > "$RT_DIR/service.pid"
echo "$DEV_PID" > "$PROJECT_DIR/.zscripts/dev.pid"

# Disown so they survive shell exit
disown "$RT_PID" 2>/dev/null || true
disown "$DEV_PID" 2>/dev/null || true

echo "Started. PIDs saved."
