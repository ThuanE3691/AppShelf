<?php
/**
 * AppShelf Services theme setup.
 *
 * @package appshelf-services
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'after_setup_theme',
	static function () {
		add_theme_support( 'editor-styles' );
		add_editor_style( 'style.css' );
	}
);

// style.css carries the section styles; with 'path' set WordPress can inline it.
add_action(
	'wp_enqueue_scripts',
	static function () {
		$theme = wp_get_theme();
		wp_enqueue_style( 'appshelf-services', get_stylesheet_uri(), array(), $theme->get( 'Version' ) );
		wp_style_add_data( 'appshelf-services', 'path', get_stylesheet_directory() . '/style.css' );
	}
);
