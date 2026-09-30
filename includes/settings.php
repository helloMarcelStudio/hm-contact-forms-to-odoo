<?php
/**
 * Settings → Forms to Odoo: connection (with a test) and the send log.
 * The page is a React app (src/settings), fed by the REST API in rest.php.
 */
defined('ABSPATH') || exit;

function fto_admin_url($args = []) {
    return add_query_arg(array_merge(['page' => 'forms-to-odoo'], $args), admin_url('options-general.php'));
}

add_action('admin_menu', function () {
    $hook = add_options_page(__('Forms to Odoo', 'forms-to-odoo'), __('Forms to Odoo', 'forms-to-odoo'), 'manage_options', 'forms-to-odoo', 'fto_render_admin_page');
    add_action("admin_print_scripts-$hook", 'fto_enqueue_settings_app');
});

add_filter('plugin_action_links_' . plugin_basename(FTO_FILE), function ($links) {
    array_unshift($links, '<a href="' . esc_url(fto_admin_url()) . '">' . esc_html__('Settings', 'forms-to-odoo') . '</a>');
    return $links;
});

/* ---------- Failed sends notice (whole admin) ---------- */
add_action('admin_notices', function () {
    // the settings page shows the failed count itself
    if (!current_user_can('manage_options') || ($_GET['page'] ?? '') === 'forms-to-odoo') return;
    $failed = fto_failed_count();
    if (!$failed) return;
    printf(
        '<div class="notice notice-error"><p><strong>%s</strong> %s <a href="%s">%s</a></p></div>',
        esc_html__('Forms to Odoo:', 'forms-to-odoo'),
        esc_html(sprintf(_n('%d form submission couldn\'t be sent to Odoo.', '%d form submissions couldn\'t be sent to Odoo.', $failed, 'forms-to-odoo'), $failed)),
        esc_url(fto_admin_url(['tab' => 'log', 'status' => 'failed'])),
        esc_html__('Review and resend', 'forms-to-odoo')
    );
});

/* ---------- Page ---------- */
function fto_render_admin_page() {
    if (!current_user_can('manage_options')) return;
    ?>
    <div class="wrap">
        <h1><?php esc_html_e('Forms to Odoo', 'forms-to-odoo'); ?></h1>
        <div id="fto-settings-app"></div>
    </div>
    <?php
}

function fto_enqueue_settings_app() {
    fto_enqueue_app('settings', [
        'failed'        => fto_failed_count(),
        'retentionDays' => FTO_LOG_RETENTION_DAYS,
        'formsUrl'      => admin_url('admin.php?page=wpcf7'),
    ]);
}

/**
 * Enqueues a React app built by @wordpress/scripts into build/, with its
 * WordPress dependencies, its styles and translations, and its data as
 * window.ftoData.
 */
function fto_enqueue_app($name, array $data) {
    $asset_file = FTO_DIR . "build/$name.asset.php";
    if (!file_exists($asset_file)) return;
    $asset = require $asset_file;
    $handle = "fto-$name";

    wp_enqueue_script($handle, FTO_URL . "build/$name.js", $asset['dependencies'], $asset['version'], true);
    wp_add_inline_script($handle, 'window.ftoData = ' . wp_json_encode($data) . ';', 'before');
    wp_set_script_translations($handle, 'forms-to-odoo', FTO_DIR . 'languages');
    wp_enqueue_style('wp-components');
    if (file_exists(FTO_DIR . "build/$name.css")) {
        wp_enqueue_style($handle, FTO_URL . "build/$name.css", ['wp-components'], $asset['version']);
        // build/{name}-rtl.css, for right-to-left admin languages
        wp_style_add_data($handle, 'rtl', 'replace');
    }
}
