<?php
/**
 * Marketing source (UTM): fills a record's Source, Medium and Campaign
 * (source_id, medium_id, campaign_id: Odoo's utm.mixin, e.g. on CRM leads)
 * from the utm_source, utm_medium and utm_campaign tags of the link the
 * visitor arrived by. A small script (src/utm) remembers them in the
 * browser for 90 days, across pages, and adds them to the CF7 forms the
 * visitor sends, as the hidden _fto_utm field.
 */
defined('ABSPATH') || exit;

// Odoo field => UTM model, as on every utm.mixin model
const FTO_UTM_FIELDS = ['source_id' => 'utm.source', 'medium_id' => 'utm.medium', 'campaign_id' => 'utm.campaign'];

/**
 * A form's UTM settings: 'enabled', 'referrer' (without UTM tags, use the
 * referring website as the source) and 'create' (create the sources,
 * mediums and campaigns Odoo doesn't have yet).
 */
function fto_utm_defaults() {
    return ['enabled' => false, 'referrer' => true, 'create' => true];
}

function fto_sanitize_utm_settings($utm) {
    $utm = wp_parse_args(is_array($utm) ? $utm : [], fto_utm_defaults());
    return ['enabled' => !empty($utm['enabled']), 'referrer' => !empty($utm['referrer']), 'create' => !empty($utm['create'])];
}

/**
 * The marketing source of a submission, for a form that uses it:
 * ['source', 'medium', 'campaign' (names, those known), 'via' => utm|referrer,
 * 'landing', 'referrer', 'create'], or null. $raw is what the browser
 * script captured; read from the request when not given.
 */
function fto_utm_for(array $settings, ?array $raw = null) {
    $utm = wp_parse_args((array) ($settings['utm'] ?? []), fto_utm_defaults());
    if (!$utm['enabled']) return null;

    if ($raw === null) {
        // the script's hidden field: CF7 leaves "_" fields out of the posted data
        $raw = json_decode(wp_unslash((string) ($_POST['_fto_utm'] ?? '')), true);
        if (!is_array($raw)) return null;
    }
    $via = ($raw['via'] ?? 'utm') === 'referrer' ? 'referrer' : 'utm';
    if ($via === 'referrer' && !$utm['referrer']) return null;

    $clip = fn($key, $max = 100) => mb_substr(sanitize_text_field((string) ($raw[$key] ?? '')), 0, $max);
    $out = array_filter([
        'source'   => $clip('source'),
        'medium'   => $clip('medium'),
        'campaign' => $clip('campaign'),
    ], 'strlen');
    if (!$out) return null;

    return $out + [
        'via'      => $via,
        'landing'  => esc_url_raw($clip('landing', 500)),
        'referrer' => esc_url_raw($clip('referrer', 500)),
        'create'   => (bool) $utm['create'],
    ];
}

/**
 * Odoo values for a submission's marketing source: [field => record id]
 * for the fields not already set, finding each source, medium and
 * campaign by name (or creating it, when allowed). A UTM record Odoo
 * refuses to create is left out rather than failing the whole send; a
 * temporary error is returned, so the send is retried.
 */
function fto_utm_values(array $utm, array $values) {
    $out = [];
    foreach (['source' => 'source_id', 'medium' => 'medium_id', 'campaign' => 'campaign_id'] as $key => $field) {
        if (empty($utm[$key]) || !empty($values[$field])) continue;
        $id = fto_find_or_create_named(FTO_UTM_FIELDS[$field], $utm[$key], !empty($utm['create']));
        if (is_wp_error($id)) {
            if (fto_is_temporary_error($id)) return $id;
            continue;
        }
        if ($id) $out[$field] = $id;
    }
    return $out;
}

/**
 * Id of the record of $model with this name (case-insensitive, oldest
 * first), else of a new one when $create; 0 when there's none.
 */
function fto_find_or_create_named($model, $name, $create) {
    // =ilike treats "_" and "%" as wildcards (utm_campaign values often
    // have underscores): fetch the candidates, then keep an exact match
    $found = fto_call($model, 'search_read', [
        'domain' => [['name', '=ilike', $name]],
        'fields' => ['name'],
        'order'  => 'id',
        'limit'  => 20,
    ]);
    if (is_wp_error($found)) return $found;
    foreach ($found as $record) {
        if (strcasecmp(trim((string) ($record['name'] ?? '')), $name) === 0) return (int) $record['id'];
    }
    if (!$create) return 0;

    $created = fto_call($model, 'create', ['vals_list' => [['name' => $name]]]);
    return is_wp_error($created) ? $created : (int) ($created[0] ?? 0);
}

/* ---------- Capture on the website ---------- */

/**
 * The capture script only runs when a form uses UTM. Sites that need
 * visitor consent first can return false from the fto_utm_capture
 * filter until it's given.
 */
add_action('wp_enqueue_scripts', function () {
    if (!get_option('fto_utm_enabled') || !apply_filters('fto_utm_capture', true)) return;
    $asset_file = FTO_DIR . 'build/utm.asset.php';
    if (!file_exists($asset_file)) return;
    $asset = require $asset_file;
    wp_enqueue_script('fto-utm', FTO_URL . 'build/utm.js', $asset['dependencies'], $asset['version'], ['in_footer' => true, 'strategy' => 'defer']);
});

// Whether any form sending to Odoo uses UTM, kept in an option so the
// website doesn't check every form on each page view
function fto_refresh_utm_flag() {
    global $wpdb;
    $enabled = false;
    foreach ($wpdb->get_col("SELECT meta_value FROM {$wpdb->postmeta} WHERE meta_key = '_fto_settings'") as $meta) {
        $settings = maybe_unserialize($meta);
        if (!empty($settings['enabled']) && !empty($settings['utm']['enabled'])) {
            $enabled = true;
            break;
        }
    }
    update_option('fto_utm_enabled', $enabled ? 1 : 0);
}
add_action('wpcf7_save_contact_form', 'fto_refresh_utm_flag', 20);
add_action('deleted_post', function ($post_id, $post) {
    if ($post && $post->post_type === 'wpcf7_contact_form') fto_refresh_utm_flag();
}, 10, 2);
