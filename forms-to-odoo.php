<?php
/**
 * Plugin Name:       Forms to Odoo
 * Description:       Sends Contact Form 7 submissions to Odoo (leads, contacts, tickets or any model), with per-form field mapping, a send log and automatic retries.
 * Version:           0.1.5
 * Requires at least: 6.0
 * Requires PHP:      8.0
 * Requires Plugins:  contact-form-7
 * Author:            hellomarcel
 * Author URI:        https://marcel-pirnay.be
 * License:           GPL-2.0-or-later
 * Text Domain:       forms-to-odoo
 */
defined('ABSPATH') || exit;

const FTO_VERSION = '0.1.5';
const FTO_DB_VERSION = '1';
define('FTO_FILE', __FILE__);
define('FTO_DIR', plugin_dir_path(__FILE__));
define('FTO_URL', plugin_dir_url(__FILE__));

require FTO_DIR . 'includes/client.php';
require FTO_DIR . 'includes/log.php';
require FTO_DIR . 'includes/submission.php';

if (is_admin()) {
    require FTO_DIR . 'includes/settings.php';
    require FTO_DIR . 'includes/form-panel.php';
}

add_action('init', function () {
    load_plugin_textdomain('forms-to-odoo', false, dirname(plugin_basename(FTO_FILE)) . '/languages');
});

register_activation_hook(__FILE__, function () {
    fto_install();

    // Coming from the single-site "CF7 → Odoo CRM" mu-plugin: keep its
    // connection settings instead of asking for them again
    foreach (['url', 'db', 'api_key'] as $key) {
        $legacy = get_option('cf7_odoo_' . $key);
        if ($legacy && !get_option('fto_' . $key)) update_option('fto_' . $key, $legacy, false);
    }
});

register_deactivation_hook(__FILE__, function () {
    wp_clear_scheduled_hook('fto_retry');
    wp_clear_scheduled_hook('fto_cleanup');
});

// Also covers updates that don't go through activation
add_action('plugins_loaded', function () {
    if (get_option('fto_db_version') !== FTO_DB_VERSION) fto_install();
});
