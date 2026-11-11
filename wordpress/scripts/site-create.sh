#!/bin/sh
# Usage: site-create.sh <slug> <title> <template> <admin_email>
# Creates (or returns, if the slug exists) a site at /<slug>/ with the template
# theme and pages, plus a per-site admin user with a freshly generated password.
# stdout: {"blogId":12,"url":"...","adminUser":"...","adminPassword":"..."}
set -eu
. "$(dirname -- "$0")/lib.sh"

[ "$#" -eq 4 ] || die "usage: site-create.sh <slug> <title> <template> <admin_email>"

APPSHELF_OP=create APPSHELF_SLUG=$1 APPSHELF_TITLE=$2 APPSHELF_TEMPLATE=$3 APPSHELF_EMAIL=$4
export APPSHELF_OP APPSHELF_SLUG APPSHELF_TITLE APPSHELF_TEMPLATE APPSHELF_EMAIL
run_site_op
