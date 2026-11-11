<?php
/**
 * AppShelf WordPress settings, required from wp-config.php through
 * WORDPRESS_CONFIG_EXTRA in every container that runs this install
 * (wordpress, wp-init, worker). Proxy HTTPS detection (X-Forwarded-Proto)
 * is already handled by the official wp-config-docker.php.
 */

define( 'WP_ALLOW_MULTISITE', true );

// wp-init sets APPSHELF_WP_INSTALLING=1 only while it installs the network.
if ( getenv( 'APPSHELF_WP_INSTALLING' ) !== '1' ) {
	define( 'MULTISITE', true );
	define( 'SUBDOMAIN_INSTALL', false );
	define( 'DOMAIN_CURRENT_SITE', getenv( 'WP_DOMAIN' ) ?: 'wp.appshelf.localhost' );
	define( 'PATH_CURRENT_SITE', '/' );
	define( 'SITE_ID_CURRENT_SITE', 1 );
	define( 'BLOG_ID_CURRENT_SITE', 1 );
}

// Core is pinned by the image tag; no background updates or file editors.
define( 'AUTOMATIC_UPDATER_DISABLED', true );
define( 'DISALLOW_FILE_EDIT', true );
define( 'WP_POST_REVISIONS', 5 );
