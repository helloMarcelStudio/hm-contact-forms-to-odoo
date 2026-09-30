<?php
/**
 * Odoo API client, over the JSON-2 API (Odoo 19+):
 * POST {url}/json/2/{model}/{method} with named arguments as JSON body.
 */
defined('ABSPATH') || exit;

/**
 * Connection setting: the value saved in Settings → Forms to Odoo, else
 * a constant from wp-config.php (FTO_ODOO_URL, FTO_ODOO_DB, FTO_ODOO_API_KEY,
 * or the older ODOO_* names), so secrets can stay out of the database.
 */
function fto_config($key) {
    $option = get_option('fto_' . $key);
    if ($option !== false && $option !== '') return $option;

    foreach (['FTO_ODOO_', 'ODOO_'] as $prefix) {
        $constant = $prefix . strtoupper($key);
        if (defined($constant)) return constant($constant);
    }
    return '';
}

function fto_is_configured() {
    return fto_config('url') && fto_config('api_key');
}

/**
 * Calls a model method. Returns the decoded result, or a WP_Error whose
 * data holds the HTTP status ('status', 0 for network errors) so callers
 * can tell a temporary failure from a rejected request.
 */
function fto_call($model, $method, array $args = [], $timeout = 15) {
    if (!fto_is_configured()) {
        return new WP_Error('fto_not_configured', __('The Odoo connection isn\'t configured yet.', 'forms-to-odoo'), ['status' => 0]);
    }

    $headers = [
        'Authorization' => 'bearer ' . fto_config('api_key'),
        'Content-Type'  => 'application/json',
    ];
    // only needed when the Odoo server hosts several databases
    if (fto_config('db')) $headers['X-Odoo-Database'] = fto_config('db');

    $res = wp_remote_post(untrailingslashit(fto_config('url')) . '/json/2/' . rawurlencode($model) . '/' . rawurlencode($method), [
        'timeout' => $timeout,
        'headers' => $headers,
        'body'    => wp_json_encode((object) $args),
    ]);

    if (is_wp_error($res)) {
        return new WP_Error('fto_network', $res->get_error_message(), ['status' => 0]);
    }

    $status = (int) wp_remote_retrieve_response_code($res);
    $body = json_decode(wp_remote_retrieve_body($res), true);

    if ($status >= 300) {
        // Odoo errors come back as {"name": "odoo.exceptions.X", "message": "..."}
        $message = is_array($body) && !empty($body['message'])
            ? $body['message']
            : sprintf(__('Odoo answered with HTTP %d.', 'forms-to-odoo'), $status);
        return new WP_Error('fto_http', $message, ['status' => $status, 'odoo_error' => $body['name'] ?? '']);
    }
    return $body;
}

/**
 * Whether a failed call is worth retrying later: network errors, timeouts
 * and server-side errors are; a request Odoo rejected (missing field,
 * access rights, bad value) will fail the same way every time.
 */
function fto_is_temporary_error(WP_Error $error) {
    $status = (int) ($error->get_error_data()['status'] ?? 0);
    return $status === 0 || $status === 408 || $status === 429 || $status >= 500;
}

/**
 * Returns ['version' => '19.0', 'user' => 'Name', 'login' => '…', 'db' => '…']
 * or a WP_Error.
 */
function fto_test_connection() {
    $context = fto_call('res.users', 'context_get', [], 10);
    if (is_wp_error($context)) return $context;

    $user = fto_call('res.users', 'search_read', [
        'domain' => [['id', '=', (int) ($context['uid'] ?? 0)]],
        'fields' => ['name', 'login'],
        'limit'  => 1,
    ], 10);
    if (is_wp_error($user)) return $user;

    return [
        'version' => fto_server_version(),
        'user'    => $user[0]['name'] ?? '?',
        'login'   => $user[0]['login'] ?? '',
        'db'      => fto_config('db'),
    ];
}

// Public JSON-RPC route, doesn't need the API key; empty string if unknown
function fto_server_version() {
    $res = wp_remote_post(untrailingslashit(fto_config('url')) . '/web/version', [
        'timeout' => 10,
        'headers' => ['Content-Type' => 'application/json'],
        'body'    => wp_json_encode(['jsonrpc' => '2.0', 'method' => 'call', 'params' => (object) []]),
    ]);
    if (is_wp_error($res)) return '';
    $body = json_decode(wp_remote_retrieve_body($res), true);
    return (string) ($body['result']['version'] ?? '');
}

/* ---------- Model metadata (cached, used by the form editor) ---------- */

// Field types that can't be filled from a form
const FTO_UNSUPPORTED_TYPES = ['one2many', 'binary', 'many2one_reference', 'reference', 'properties', 'properties_definition', 'json'];

/**
 * Writable fields of a model, sorted by label:
 * [name => ['label', 'type', 'required', 'relation', 'selection']]
 */
function fto_model_fields($model, $refresh = false) {
    $cache_key = 'fto_fields_' . md5(fto_config('url') . $model);
    if (!$refresh && is_array($cached = get_transient($cache_key))) return $cached;

    $raw = fto_call($model, 'fields_get', ['attributes' => ['string', 'type', 'required', 'readonly', 'relation', 'selection']]);
    if (is_wp_error($raw)) return $raw;

    $fields = [];
    foreach ($raw as $name => $f) {
        if (!empty($f['readonly']) || in_array($f['type'], FTO_UNSUPPORTED_TYPES, true)) continue;
        if (in_array($name, ['id', 'create_date', 'write_date', 'create_uid', 'write_uid'], true)) continue;
        $fields[$name] = [
            'label'     => $f['string'] ?? $name,
            'type'      => $f['type'],
            'required'  => !empty($f['required']),
            'relation'  => $f['relation'] ?? '',
            'selection' => $f['selection'] ?? [],
        ];
    }
    uasort($fields, fn($a, $b) => strcasecmp($a['label'], $b['label']));

    set_transient($cache_key, $fields, HOUR_IN_SECONDS);
    return $fields;
}

/**
 * Records to pick from for a relational field (sales teams, tags, users…):
 * [['id' => 3, 'name' => 'Sales'], …], at most 500.
 */
function fto_model_records($model, $refresh = false) {
    $cache_key = 'fto_records_' . md5(fto_config('url') . $model);
    if (!$refresh && is_array($cached = get_transient($cache_key))) return $cached;

    // display_name isn't stored on most models, so it can't be used to
    // order in Odoo: sorted here instead
    $raw = fto_call($model, 'search_read', ['domain' => [], 'fields' => ['display_name'], 'limit' => 500]);
    if (is_wp_error($raw)) return $raw;

    $records = array_map(fn($r) => ['id' => (int) $r['id'], 'name' => (string) ($r['display_name'] ?? $r['id'])], $raw);
    usort($records, fn($a, $b) => strcasecmp($a['name'], $b['name']));
    set_transient($cache_key, $records, 10 * MINUTE_IN_SECONDS);
    return $records;
}

// Link to a record in the Odoo backend
function fto_record_url($model, $id) {
    return untrailingslashit(fto_config('url')) . '/web#' . http_build_query(['id' => $id, 'model' => $model, 'view_type' => 'form']);
}
