#!/bin/bash
cd /home/z/my-project
echo $$ > /tmp/next-server.pid
exec node node_modules/next/dist/bin/next start -p 3000
