#!/bin/sh
# AppShelf entrypoint: Compose sets WORDPRESS_DB_PASSWORD; a container started
# with only MARIADB_PASSWORD still gets the variable the official image expects.
set -eu

: "${WORDPRESS_DB_PASSWORD:=${MARIADB_PASSWORD:-}}"
export WORDPRESS_DB_PASSWORD

exec docker-entrypoint.sh "$@"
