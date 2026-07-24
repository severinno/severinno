#!/bin/sh
# Generate pgbouncer userlist from environment
echo '"severinno" "'${DB_PASSWORD:-severinno}'"' > /etc/pgbouncer/userlist.txt
exec "$@"
