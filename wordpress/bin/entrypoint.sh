#!/bin/sh
# AppShelf entrypoint: the MariaDB password is shared through MARIADB_PASSWORD
# (secrets file), so map it to the variable the official image expects.
set -eu

: "${WORDPRESS_DB_PASSWORD:=${MARIADB_PASSWORD:-}}"
export WORDPRESS_DB_PASSWORD

exec docker-entrypoint.sh "$@"
