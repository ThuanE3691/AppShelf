#!/bin/sh
# Usage: site-unarchive.sh <blogId>
# Reopens an archived site. Idempotent.
# stdout: {"blogId":12,"archived":false}
set -eu
. "$(dirname -- "$0")/lib.sh"

[ "$#" -eq 1 ] || die "usage: site-unarchive.sh <blogId>"
require_blog_id "$1"

APPSHELF_OP=unarchive APPSHELF_BLOG_ID=$1
export APPSHELF_OP APPSHELF_BLOG_ID
run_site_op
