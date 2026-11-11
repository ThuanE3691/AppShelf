<?php
/**
 * Plugin Name: AppShelf demo labelling
 * Description: Shows the personal-demo banner on every site of the network and keeps email off.
 * Version: 1.0.0
 */

defined( 'ABSPATH' ) || exit;

const APPSHELF_DEMO_BANNER = 'Personal demo project — test payments only (Stripe test mode). Sites delete themselves after 48 hours.';

function appshelf_demo_banner_html(): string {
	return '<div class="appshelf-demo-banner" role="note" style="margin:0;padding:8px 16px;background:#111;color:#fff;'
		. 'font:500 14px/1.45 system-ui,-apple-system,\'Segoe UI\',Roboto,sans-serif;text-align:center">'
		. esc_html( APPSHELF_DEMO_BANNER ) . '</div>';
}

// Front end (block themes call wp_body_open()).
add_action(
	'wp_body_open',
	static function () {
		echo appshelf_demo_banner_html(); // phpcs:ignore WordPress.Security.EscapeOutput -- escaped above.
	},
	1
);

// Login screen and dashboard.
add_action(
	'login_header',
	static function () {
		echo appshelf_demo_banner_html(); // phpcs:ignore WordPress.Security.EscapeOutput -- escaped above.
	}
);
add_action(
	'admin_notices',
	static function () {
		echo '<div class="notice notice-info"><p>' . esc_html( APPSHELF_DEMO_BANNER ) . '</p></div>';
	}
);

// No real email in this demo: every wp_mail() call is skipped.
add_filter( 'pre_wp_mail', '__return_false' );
