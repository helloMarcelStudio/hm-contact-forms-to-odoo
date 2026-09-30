<?php
/**
 * Forms to Odoo: removes everything the plugin stored when it's deleted
 * (not when it's only deactivated).
 */
defined('WP_UNINSTALL_PLUGIN') || exit;

global $wpdb;
$wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}fto_log");
foreach (['fto_url', 'fto_db', 'fto_api_key', 'fto_db_version'] as $option) delete_option($option);
delete_post_meta_by_key('_fto_settings');
$wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '\\_transient\\_fto\\_%' OR option_name LIKE '\\_transient\\_timeout\\_fto\\_%'");
wp_clear_scheduled_hook('fto_retry');
wp_clear_scheduled_hook('fto_cleanup');
