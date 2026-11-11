#!/bin/sh
# Usage: site-archive.sh <blogId>
# Archives the site; visitors see WordPress's "archived" page. Idempotent.
# stdout: {"blogId":12,"archived":true}
set -eu
. "$(dirname -- "$0")/lib.sh"

[ "$#" -eq 1 ] || die "usage: site-archive.sh <blogId>"
require_blog_id "$1"

APPSHELF_OP=archive APPSHELF_BLOG_ID=$1
export APPSHELF_OP APPSHELF_BLOG_ID
run_site_op
