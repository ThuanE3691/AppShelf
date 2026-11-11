#!/bin/sh
# One-shot, idempotent network setup (compose service wp-init):
# copies themes and mu-plugins into wp_data, writes the multisite .htaccess,
# installs the network, and creates or refreshes the three showcase sites.
set -eu

APPSHELF_WP_DIR=/opt/appshelf/wp
. "$APPSHELF_WP_DIR/lib.sh"

SRC=/opt/appshelf
WP_SCHEME=${WP_SCHEME:-http}
WP_DOMAIN=${WP_DOMAIN:-wp.appshelf.localhost}

log() { printf 'wp-init: %s\n' "$*"; }

[ -n "${WP_NETWORK_ADMIN_PASSWORD:-}" ] || die "WP_NETWORK_ADMIN_PASSWORD is not set"

log "waiting for WordPress core files"
i=0
until [ -f "$WP_PATH/wp-config.php" ] && [ -f "$WP_PATH/wp-includes/version.php" ]; do
	i=$((i + 1))
	[ "$i" -le 120 ] || die "WordPress core files did not appear in $WP_PATH"
	sleep 1
done

log "syncing themes and mu-plugins"
for src in "$SRC"/templates/*/; do
	dest="$WP_PATH/wp-content/themes/appshelf-$(basename "$src")"
	rm -rf "$dest.new"
	cp -R "$src" "$dest.new"
	rm -rf "$dest"
	mv "$dest.new" "$dest"
	chown -R www-data:www-data "$dest"
done
mkdir -p "$WP_PATH/wp-content/mu-plugins"
cp "$SRC"/mu-plugins/*.php "$WP_PATH/wp-content/mu-plugins/"
chown -R www-data:www-data "$WP_PATH/wp-content/mu-plugins"
cp "$SRC/htaccess-multisite" "$WP_PATH/.htaccess"
chown www-data:www-data "$WP_PATH/.htaccess"

if wp_cli core is-installed --network >/dev/null 2>&1; then
	log "network already installed"
else
	log "installing the multisite network"
	# Multisite constants stay undefined until the network tables exist.
	export APPSHELF_WP_INSTALLING=1
	printf '%s\n' "$WP_NETWORK_ADMIN_PASSWORD" |
		wp_cli core multisite-install \
			--url="$WP_SCHEME://$WP_DOMAIN" \
			--base=/ \
			--title="AppShelf Sites" \
			--admin_user=appshelf-admin \
			--admin_email=admin@example.invalid \
			--skip-email \
			--skip-config \
			--prompt=admin_password >/dev/null || die "network install failed"
	unset APPSHELF_WP_INSTALLING
	wp_cli core is-installed --network || die "network install did not complete"
fi

log "network settings"
wp_cli network meta update 1 registration none >/dev/null
wp_cli network meta update 1 registrationnotification no >/dev/null
wp_cli network meta update 1 add_new_users 0 >/dev/null
wp_cli option update blog_public 0 >/dev/null
for src in "$SRC"/templates/*/; do
	wp_cli theme enable "appshelf-$(basename "$src")" --network >/dev/null
done

log "showcase sites"
create_showcase() {
	result=$(APPSHELF_REAPPLY_TEMPLATE=1 "$APPSHELF_WP_DIR/site-create.sh" "$1-demo" "$2" "$1" admin@example.invalid) ||
		die "showcase $1-demo failed"
	printf '%s\n' "$result" | sed 's/"adminPassword":"[^"]*"/"adminPassword":"[redacted]"/'
}
create_showcase restaurant "Ember & Rye"
create_showcase agency "Halftone Studio"
create_showcase services "Brightwell Home Repair"

log "done"
