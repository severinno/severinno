#!/bin/bash
cd "$(dirname "$0")"
nohup npx next start -p 3000 > /tmp/severinno-next.log 2>&1 &
echo $! > /tmp/severinno-next.pid
echo "Next.js started with PID $(cat /tmp/severinno-next.pid)"
