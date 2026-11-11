<?php
/**
 * Plugin Name: AppShelf front-end hygiene
 * Description: Lean front end for every site: no emoji script, per-block CSS only, small styles inlined, meta description, theme favicon and explicit image dimensions.
 * Version: 1.0.0
 */

defined( 'ABSPATH' ) || exit;

// Emoji detection script and styles.
remove_action( 'wp_head', 'print_emoji_detection_script', 7 );
remove_action( 'admin_print_scripts', 'print_emoji_detection_script' );
remove_action( 'wp_print_styles', 'print_emoji_styles' );
remove_action( 'admin_print_styles', 'print_emoji_styles' );
remove_action( 'wp_enqueue_scripts', 'wp_enqueue_emoji_styles' );
remove_action( 'admin_enqueue_scripts', 'wp_enqueue_emoji_styles' );
remove_filter( 'the_content_feed', 'wp_staticize_emoji' );
remove_filter( 'comment_text_rss', 'wp_staticize_emoji' );
remove_filter( 'wp_mail', 'wp_staticize_emoji_for_email' );
add_filter( 'emoji_svg_url', '__return_false' );

// Head links nobody needs on a brochure site.
remove_action( 'wp_head', 'wp_generator' );
remove_action( 'wp_head', 'rsd_link' );
remove_action( 'wp_head', 'wlwmanifest_link' );
remove_action( 'wp_head', 'wp_shortlink_wp_head' );
remove_action( 'wp_head', 'wp_oembed_add_discovery_links' );

// Only the CSS of blocks present on the page, and small stylesheets inlined
// (fewer render-blocking requests on mobile).
add_filter( 'should_load_separate_core_block_assets', '__return_true' );
add_filter( 'styles_inline_size_limit', static fn() => 60000 );
add_action(
	'wp_enqueue_scripts',
	static function () {
		wp_dequeue_style( 'classic-theme-styles' );
	},
	20
);

// Meta description: the page's own text from the template content, else the tagline.
add_action(
	'wp_head',
	static function () {
		$description = is_singular() ? (string) get_post_meta( get_queried_object_id(), '_appshelf_description', true ) : '';
		if ( '' === $description ) {
			$description = get_bloginfo( 'description' );
		}
		if ( '' !== $description ) {
			printf( '<meta name="description" content="%s">' . "\n", esc_attr( wp_strip_all_tags( $description ) ) );
		}
	},
	1
);

// Theme favicon when the site has no site icon (avoids a /favicon.ico round trip).
add_action(
	'wp_head',
	static function () {
		if ( has_site_icon() ) {
			return;
		}
		if ( file_exists( get_stylesheet_directory() . '/assets/favicon.svg' ) ) {
			printf( '<link rel="icon" href="%s" type="image/svg+xml">' . "\n", esc_url( get_stylesheet_directory_uri() . '/assets/favicon.svg' ) );
		}
	},
	2
);

/**
 * Intrinsic size of a local image under wp-content, or null.
 *
 * @return array{0:int,1:int}|null
 */
function appshelf_local_image_size( string $src ): ?array {
	static $cache = array();
	$path = (string) wp_parse_url( $src, PHP_URL_PATH );
	// Subdirectory sites serve wp-content both at /wp-content/ and /<slug>/wp-content/.
	if ( ! preg_match( '#^/(?:[a-z0-9-]+/)?wp-content(/.+)$#', $path, $match ) || str_contains( $path, '..' ) ) {
		return null;
	}
	if ( array_key_exists( $path, $cache ) ) {
		return $cache[ $path ];
	}
	$file = WP_CONTENT_DIR . $match[1];
	$size = null;
	if ( is_readable( $file ) ) {
		if ( str_ends_with( $file, '.svg' ) ) {
			$head = (string) file_get_contents( $file, false, null, 0, 600 );
			if ( preg_match( '/<svg[^>]*\swidth="(\d+)"[^>]*\sheight="(\d+)"/', $head, $m ) ) {
				$size = array( (int) $m[1], (int) $m[2] );
			}
		} else {
			$info = wp_getimagesize( $file );
			if ( $info ) {
				$size = array( (int) $info[0], (int) $info[1] );
			}
		}
	}
	$cache[ $path ] = $size;
	return $size;
}

// Explicit width/height on theme images in content (prevents layout shift).
add_filter(
	'render_block_core/image',
	static function ( string $html ): string {
		$tags = new WP_HTML_Tag_Processor( $html );
		if ( ! $tags->next_tag( 'img' ) || null !== $tags->get_attribute( 'width' ) ) {
			return $html;
		}
		$size = appshelf_local_image_size( (string) $tags->get_attribute( 'src' ) );
		if ( ! $size ) {
			return $html;
		}
		$tags->set_attribute( 'width', (string) $size[0] );
		$tags->set_attribute( 'height', (string) $size[1] );
		$tags->set_attribute( 'decoding', 'async' );
		return $tags->get_updated_html();
	}
);
