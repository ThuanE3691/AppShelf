#!/bin/sh
# Usage: site-delete.sh <blogId>
# Drops the site's tables, removes its uploads and its admin user (when the user
# has no other site). Succeeds when the site is already gone.
# stdout: {"blogId":12,"deleted":true}
set -eu
. "$(dirname -- "$0")/lib.sh"

[ "$#" -eq 1 ] || die "usage: site-delete.sh <blogId>"
require_blog_id "$1"

APPSHELF_OP=delete APPSHELF_BLOG_ID=$1
export APPSHELF_OP APPSHELF_BLOG_ID
run_site_op
