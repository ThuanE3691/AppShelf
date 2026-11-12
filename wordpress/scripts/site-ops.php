<?php
/**
 * AppShelf site operations, run by the site-*.sh scripts through `wp eval-file`.
 *
 * Input comes from APPSHELF_* environment variables (never from wp-cli arguments,
 * so a site title cannot be read as a wp-cli flag). On success it prints exactly
 * one JSON line starting with {"blogId": on stdout; on failure it calls
 * WP_CLI::error(), which writes to stderr and exits non-zero.
 */

if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	exit( 1 );
}
if ( ! is_multisite() ) {
	WP_CLI::error( 'WordPress is not running as a multisite network.' );
}

require_once ABSPATH . 'wp-admin/includes/admin.php';
require_once ABSPATH . 'wp-admin/includes/ms.php';

// Personal demo: no email ever leaves the network.
add_filter( 'pre_wp_mail', '__return_false' );
// Template content is trusted, versioned block markup.
kses_remove_filters();

const APPSHELF_TEMPLATES      = array( 'restaurant', 'agency', 'services' );
const APPSHELF_SHOWCASE_SLUGS = array( 'restaurant-demo', 'agency-demo', 'services-demo' );
// The network itself and its admin login (wp-init.sh); never a customer site.
const APPSHELF_RESERVED_SLUGS = array( 'appshelf', 'appshelf-admin' );
// User meta that marks the admin AppShelf created for a site slug.
const APPSHELF_ADMIN_META = 'appshelf_site_slug';

function appshelf_env( string $name ): string {
	$value = getenv( $name );
	return false === $value ? '' : trim( $value );
}

function appshelf_result( array $data ): void {
	WP_CLI::line( wp_json_encode( $data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) );
}

function appshelf_site_url( int $blog_id ): string {
	return trailingslashit( get_home_url( $blog_id, '/' ) );
}

/** Returns the site, refusing the main site and the showcase sites. */
function appshelf_customer_site( int $blog_id ): ?WP_Site {
	if ( $blog_id <= 0 ) {
		WP_CLI::error( 'blogId must be a positive integer.' );
	}
	if ( is_main_site( $blog_id ) ) {
		WP_CLI::error( 'Refusing to change the main site.' );
	}
	$site = get_site( $blog_id );
	if ( $site && in_array( trim( $site->path, '/' ), APPSHELF_SHOWCASE_SLUGS, true ) ) {
		WP_CLI::error( 'Refusing to change a showcase site.' );
	}
	return $site;
}

function appshelf_validate_slug( string $slug ): void {
	if ( ! preg_match( '/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/', $slug ) ) {
		WP_CLI::error( 'slug must be 3-50 characters: lowercase letters, digits and inner hyphens.' );
	}
	if ( in_array( $slug, get_subdirectory_reserved_names(), true ) ) {
		WP_CLI::error( "slug '$slug' is reserved by WordPress." );
	}
	if ( in_array( $slug, APPSHELF_RESERVED_SLUGS, true ) ) {
		WP_CLI::error( "slug '$slug' is reserved by AppShelf." );
	}
}

/**
 * Stops the job unless the user is a plain admin of this site only: never a
 * super admin, never a member of another site ($blog_id 0: of no site yet).
 */
function appshelf_assert_site_only_user( WP_User $user, int $blog_id ): void {
	if ( is_super_admin( $user->ID ) ) {
		WP_CLI::error( "Refusing to use user {$user->user_login}: it is a network super admin." );
	}
	foreach ( array_keys( get_blogs_of_user( $user->ID, true ) ) as $member_of ) {
		if ( (int) $member_of !== $blog_id ) {
			WP_CLI::error( "Refusing to use user {$user->user_login}: it belongs to another site." );
		}
	}
}

/**
 * The admin an earlier run created for this slug, or null. Sites created before
 * logins got a random suffix used "<slug>-admin"; that user is adopted only for
 * an existing site and only after the same safety checks.
 */
function appshelf_find_site_admin( string $slug, int $blog_id ): ?WP_User {
	$users = get_users(
		array(
			'blog_id'    => 0,
			'meta_key'   => APPSHELF_ADMIN_META, // phpcs:ignore WordPress.DB.SlowDBQuery
			'meta_value' => $slug, // phpcs:ignore WordPress.DB.SlowDBQuery
			'number'     => 2,
		)
	);
	if ( count( $users ) > 1 ) {
		WP_CLI::error( "Several admin users are marked for site '$slug'." );
	}
	$user = $users[0] ?? null;
	if ( ! $user && $blog_id > 0 ) {
		$user = get_user_by( 'login', $slug . '-admin' ) ?: null;
	}
	if ( $user ) {
		appshelf_assert_site_only_user( $user, $blog_id );
	}
	return $user;
}

/**
 * Creates or refreshes the per-site admin user and returns [user_id, login, password].
 * A fresh password is generated on every call so a retried create still returns
 * working credentials. Logins are "<slug>-<random hex>", so a slug can never name
 * an existing account such as the network admin.
 */
function appshelf_upsert_admin( string $slug, string $email, int $blog_id ): array {
	$password = wp_generate_password( 20, false );
	$user     = appshelf_find_site_admin( $slug, $blog_id );

	if ( $user ) {
		wp_set_password( $password, $user->ID );
		update_user_meta( $user->ID, APPSHELF_ADMIN_META, $slug );
		return array( $user->ID, $user->user_login, $password );
	}

	do {
		$login = $slug . '-' . bin2hex( random_bytes( 4 ) );
	} while ( username_exists( $login ) );

	// WordPress needs unique emails; one customer may own several sites.
	if ( email_exists( $email ) ) {
		$email = $login . '@users.invalid';
	}
	$user_id = wp_insert_user(
		array(
			'user_login'   => $login,
			'user_pass'    => $password,
			'user_email'   => $email,
			'display_name' => 'Site admin',
			'role'         => '',
		)
	);
	if ( is_wp_error( $user_id ) ) {
		WP_CLI::error( 'Could not create the site admin: ' . $user_id->get_error_message() );
	}
	// wp_insert_user() adds the user to the main site; site admins belong only to their site.
	remove_user_from_blog( $user_id, get_main_site_id() );
	update_user_meta( $user_id, APPSHELF_ADMIN_META, $slug );
	if ( is_super_admin( $user_id ) ) {
		WP_CLI::error( "New site admin $login is a super admin; refusing to continue." );
	}
	return array( $user_id, $login, $password );
}

/** Creates or updates the template pages and site settings inside the given site. */
function appshelf_apply_template( int $blog_id, string $template, string $title, string $email ): void {
	$theme = wp_get_theme( 'appshelf-' . $template );
	if ( ! $theme->exists() ) {
		WP_CLI::error( "Theme appshelf-$template is not installed; run wp-init first." );
	}
	$content_dir = $theme->get_stylesheet_directory() . '/content';
	$manifest    = json_decode( (string) file_get_contents( $content_dir . '/site.json' ), true );
	if ( ! is_array( $manifest ) || empty( $manifest['pages'] ) ) {
		WP_CLI::error( "Invalid content manifest for template $template." );
	}

	switch_to_blog( $blog_id );

	switch_theme( $theme->get_stylesheet() );

	$replacements = array(
		'{{home}}'       => (string) wp_parse_url( home_url( '/' ), PHP_URL_PATH ),
		'{{assets}}'     => (string) wp_parse_url( $theme->get_stylesheet_directory_uri(), PHP_URL_PATH ) . '/assets',
		'{{site_title}}' => esc_html( $title ),
	);

	$front_id  = 0;
	$nav_links = '';
	foreach ( $manifest['pages'] as $order => $page ) {
		$body = file_get_contents( $content_dir . '/' . basename( $page['file'] ) );
		if ( false === $body ) {
			restore_current_blog();
			WP_CLI::error( "Missing content file {$page['file']} for template $template." );
		}
		$existing = get_page_by_path( $page['slug'], OBJECT, 'page' );
		$postarr  = array(
			'ID'             => $existing ? $existing->ID : 0,
			'post_type'      => 'page',
			'post_status'    => 'publish',
			'post_name'      => $page['slug'],
			'post_title'     => strtr( $page['title'], $replacements ),
			'post_content'   => strtr( $body, $replacements ),
			'menu_order'     => (int) $order,
			'comment_status' => 'closed',
			'ping_status'    => 'closed',
			'meta_input'     => array( '_appshelf_description' => strtr( $page['description'], $replacements ) ),
		);
		$page_id  = wp_insert_post( wp_slash( $postarr ), true );
		if ( is_wp_error( $page_id ) ) {
			restore_current_blog();
			WP_CLI::error( 'Could not save page ' . $page['slug'] . ': ' . $page_id->get_error_message() );
		}
		if ( ! empty( $page['front'] ) ) {
			$front_id = $page_id;
		}
		$nav_links .= '<!-- wp:navigation-link ' . wp_json_encode(
			array(
				'label' => $postarr['post_title'],
				'type'  => 'page',
				'id'    => $page_id,
				'url'   => $replacements['{{home}}'] . ( empty( $page['front'] ) ? $page['slug'] . '/' : '' ),
				'kind'  => 'post-type',
			),
			JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
		) . " /-->\n";
	}

	// The theme's navigation blocks have no ref, so they render the site's latest
	// wp_navigation menu; the customer can edit it in the Site Editor.
	$menu   = get_page_by_path( 'appshelf-main-menu', OBJECT, 'wp_navigation' );
	$nav_id = wp_insert_post(
		wp_slash(
			array(
				'ID'           => $menu ? $menu->ID : 0,
				'post_type'    => 'wp_navigation',
				'post_status'  => 'publish',
				'post_name'    => 'appshelf-main-menu',
				'post_title'   => 'Main menu',
				'post_content' => $nav_links,
			)
		),
		true
	);
	if ( is_wp_error( $nav_id ) ) {
		restore_current_blog();
		WP_CLI::error( 'Could not save the menu: ' . $nav_id->get_error_message() );
	}

	// Remove WordPress's sample content.
	foreach ( array( 'hello-world' => 'post', 'sample-page' => 'page' ) as $path => $type ) {
		$sample = get_page_by_path( $path, OBJECT, $type );
		if ( $sample ) {
			wp_delete_post( $sample->ID, true );
		}
	}
	$privacy = (int) get_option( 'wp_page_for_privacy_policy' );
	if ( $privacy && 'draft' === get_post_status( $privacy ) ) {
		wp_delete_post( $privacy, true );
		update_option( 'wp_page_for_privacy_policy', 0 );
	}

	update_option( 'blogname', $title );
	update_option( 'blogdescription', strtr( (string) ( $manifest['tagline'] ?? '' ), $replacements ) );
	update_option( 'admin_email', $email );
	update_option( 'show_on_front', 'page' );
	update_option( 'page_on_front', $front_id );
	update_option( 'page_for_posts', 0 );
	update_option( 'default_comment_status', 'closed' );
	update_option( 'default_ping_status', 'closed' );
	update_option( 'permalink_structure', '/%postname%/' );
	delete_option( 'rewrite_rules' ); // rebuilt on the site's next request
	update_option( 'appshelf_template', $template );

	restore_current_blog();
}

function appshelf_create(): void {
	$slug     = strtolower( appshelf_env( 'APPSHELF_SLUG' ) );
	$title    = appshelf_env( 'APPSHELF_TITLE' );
	$template = appshelf_env( 'APPSHELF_TEMPLATE' );
	$email    = appshelf_env( 'APPSHELF_EMAIL' );

	appshelf_validate_slug( $slug );
	if ( '' === $title || mb_strlen( $title ) > 100 ) {
		WP_CLI::error( 'title must be 1-100 characters.' );
	}
	if ( ! in_array( $template, APPSHELF_TEMPLATES, true ) ) {
		WP_CLI::error( 'template must be one of: ' . implode( ', ', APPSHELF_TEMPLATES ) );
	}
	if ( ! is_email( $email ) ) {
		WP_CLI::error( 'admin_email is not a valid email address.' );
	}
	if ( ! wp_get_theme( 'appshelf-' . $template )->exists() ) {
		WP_CLI::error( "Theme appshelf-$template is not installed; run wp-init first." );
	}

	$network = get_network();
	$path    = $network->path . $slug . '/';
	$blog_id = (int) get_blog_id_from_url( $network->domain, $path );

	list( $user_id, $login, $password ) = appshelf_upsert_admin( $slug, $email, $blog_id );

	$is_new = 0 === $blog_id;
	if ( $is_new ) {
		$blog_id = wpmu_create_blog( $network->domain, $path, $title, $user_id, array( 'public' => 1 ), $network->id );
		if ( is_wp_error( $blog_id ) ) {
			WP_CLI::error( 'Could not create the site: ' . $blog_id->get_error_message() );
		}
	} else {
		add_user_to_blog( $blog_id, $user_id, 'administrator' );
	}

	// New sites, sites whose template run was interrupted, and refresh requests get the template.
	$applied = get_blog_option( $blog_id, 'appshelf_template' );
	if ( $is_new || $applied !== $template || '1' === appshelf_env( 'APPSHELF_REAPPLY_TEMPLATE' ) ) {
		appshelf_apply_template( $blog_id, $template, $title, $email );
	}

	appshelf_result(
		array(
			'blogId'        => $blog_id,
			'url'           => appshelf_site_url( $blog_id ),
			'adminUser'     => $login,
			'adminPassword' => $password,
		)
	);
}

function appshelf_set_archived( bool $archived ): void {
	$blog_id = (int) appshelf_env( 'APPSHELF_BLOG_ID' );
	if ( ! appshelf_customer_site( $blog_id ) ) {
		WP_CLI::error( "Site $blog_id does not exist." );
	}
	update_blog_status( $blog_id, 'archived', $archived ? '1' : '0' );
	clean_blog_cache( $blog_id );
	appshelf_result( array( 'blogId' => $blog_id, 'archived' => $archived ) );
}

function appshelf_delete(): void {
	$blog_id = (int) appshelf_env( 'APPSHELF_BLOG_ID' );
	if ( ! appshelf_customer_site( $blog_id ) ) {
		appshelf_result( array( 'blogId' => $blog_id, 'deleted' => true ) );
		return;
	}

	switch_to_blog( $blog_id );
	$uploads  = wp_upload_dir( null, false );
	$user_ids = get_users( array( 'blog_id' => $blog_id, 'fields' => 'ID' ) );
	restore_current_blog();

	$deleted = wp_delete_site( $blog_id );
	if ( is_wp_error( $deleted ) ) {
		WP_CLI::error( 'Could not delete the site: ' . $deleted->get_error_message() );
	}

	// wp_delete_site() empties the uploads folder; make sure nothing is left behind.
	$basedir = $uploads['basedir'] ?? '';
	if ( $basedir && str_contains( $basedir, '/sites/' . $blog_id ) && is_dir( $basedir ) ) {
		global $wp_filesystem;
		WP_Filesystem();
		$wp_filesystem->delete( $basedir, true );
	}

	foreach ( $user_ids as $user_id ) {
		if ( ! is_super_admin( (int) $user_id ) && empty( get_blogs_of_user( (int) $user_id ) ) ) {
			wpmu_delete_user( (int) $user_id );
		}
	}

	appshelf_result( array( 'blogId' => $blog_id, 'deleted' => true ) );
}

switch ( appshelf_env( 'APPSHELF_OP' ) ) {
	case 'create':
		appshelf_create();
		break;
	case 'archive':
		appshelf_set_archived( true );
		break;
	case 'unarchive':
		appshelf_set_archived( false );
		break;
	case 'delete':
		appshelf_delete();
		break;
	default:
		WP_CLI::error( 'Unknown APPSHELF_OP.' );
}
