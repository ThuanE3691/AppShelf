# shellcheck shell=sh
# Shared helpers for the AppShelf site scripts. Sourced, not executed.
# Works in the wordpress image and in the worker image (scripts at /opt/appshelf/wp/).

APPSHELF_WP_DIR=${APPSHELF_WP_DIR:-$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)}
WP_PATH=${WP_PATH:-/var/www/html}

# wp-config.php reads these at runtime; derive them when the caller did not set them.
: "${WORDPRESS_DB_PASSWORD:=${MARIADB_PASSWORD:-}}"
# shellcheck disable=SC2016 # the single quotes are PHP; $APPSHELF_WP_DIR does expand here.
: "${WORDPRESS_CONFIG_EXTRA:=require '$APPSHELF_WP_DIR/wp-config-extra.php';}"
export WORDPRESS_DB_PASSWORD WORDPRESS_CONFIG_EXTRA

die() {
	printf 'error: %s\n' "$*" >&2
	exit 1
}

# wp_cli: wp-cli against the shared install, without plugins or the main site's theme.
# As root it drops to www-data so files it creates (uploads) stay writable by Apache.
wp_cli() {
	if [ "$(id -u)" = 0 ] && id www-data >/dev/null 2>&1 && command -v setpriv >/dev/null 2>&1; then
		WP_CLI_CACHE_DIR=${WP_CLI_CACHE_DIR:-/tmp/wp-cli-cache} \
			setpriv --reuid=www-data --regid=www-data --init-groups -- \
			wp --path="$WP_PATH" --skip-plugins --skip-themes "$@"
	else
		wp --path="$WP_PATH" --allow-root --skip-plugins --skip-themes "$@"
	fi
}

# run_site_op: run site-ops.php (input via APPSHELF_* env vars set by the caller),
# send every log line to stderr and print the single JSON result line on stdout.
run_site_op() {
	out=$(wp_cli eval-file "$APPSHELF_WP_DIR/site-ops.php") || die "wp-cli failed (exit $?)"
	json=$(printf '%s\n' "$out" | grep '^{"blogId":' | tail -n 1)
	printf '%s\n' "$out" | grep -v '^{"blogId":' >&2 || true
	[ -n "$json" ] || die "no result from site-ops.php"
	printf '%s\n' "$json"
}

require_blog_id() {
	case ${1:-} in
		'' | *[!0-9]*) die "blogId must be a positive integer" ;;
	esac
}
