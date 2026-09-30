<?php
/**
 * REST API (fto/v1) behind the admin screens, which are React apps built
 * from src/: the settings page (connection, log) and the form editor's
 * "Odoo" tab (Odoo metadata, test send, transform preview).
 */
defined('ABSPATH') || exit;

add_action('rest_api_init', function () {
    $admin = fn() => current_user_can('manage_options');
    $editor = fn() => current_user_can('wpcf7_edit_contact_forms');
    $model_arg = ['model' => ['type' => 'string', 'required' => true, 'sanitize_callback' => 'fto_sanitize_model']];

    /* ---------- Settings page ---------- */
    register_rest_route('fto/v1', '/settings', [
        ['methods' => 'GET', 'permission_callback' => $admin, 'callback' => fn() => fto_rest_connection()],
        [
            'methods'             => 'POST',
            'permission_callback' => $admin,
            'args'                => [
                'url'     => ['type' => 'string'],
                'db'      => ['type' => 'string'],
                'api_key' => ['type' => 'string'],
            ],
            'callback'            => function (WP_REST_Request $request) {
                if ($request->has_param('url')) update_option('fto_url', untrailingslashit(esc_url_raw(trim((string) $request['url']))), false);
                if ($request->has_param('db')) update_option('fto_db', sanitize_text_field((string) $request['db']), false);
                // blank = keep the stored key, which is never sent back
                $key = trim((string) $request['api_key']);
                if ($key !== '') update_option('fto_api_key', $key, false);
                return fto_rest_connection();
            },
        ],
    ]);

    register_rest_route('fto/v1', '/test', [
        'methods'             => 'POST',
        'permission_callback' => $admin,
        'callback'            => function () {
            $result = fto_test_connection();
            return is_wp_error($result) ? fto_rest_error($result) : $result;
        },
    ]);

    register_rest_route('fto/v1', '/log', [
        'methods'             => 'GET',
        'permission_callback' => $admin,
        'args'                => [
            'status' => ['type' => 'string', 'enum' => ['', 'sent', 'pending', 'failed'], 'default' => ''],
            'page'   => ['type' => 'integer', 'minimum' => 1, 'default' => 1],
        ],
        'callback'            => function (WP_REST_Request $request) {
            global $wpdb;
            $table = fto_log_table();
            $where = $request['status'] ? $wpdb->prepare('WHERE status = %s', $request['status']) : '';
            $total = (int) $wpdb->get_var("SELECT COUNT(*) FROM $table $where");
            $rows = $wpdb->get_results($wpdb->prepare(
                "SELECT * FROM $table $where ORDER BY id DESC LIMIT %d OFFSET %d",
                FTO_LOG_PER_PAGE, ($request['page'] - 1) * FTO_LOG_PER_PAGE
            ));
            return [
                'items'  => array_map('fto_rest_log_entry', $rows),
                'total'  => $total,
                'pages'  => max(1, (int) ceil($total / FTO_LOG_PER_PAGE)),
                'counts' => fto_log_counts(),
            ];
        },
    ]);

    register_rest_route('fto/v1', '/log/(?P<id>\d+)/resend', [
        'methods'             => 'POST',
        'permission_callback' => $admin,
        'callback'            => function (WP_REST_Request $request) {
            $id = (int) $request['id'];
            if (!fto_log_get($id)) return new WP_Error('fto_not_found', __('Log entry not found.', 'forms-to-odoo'), ['status' => 404]);
            $ok = fto_resend_entry($id);
            return ['sent' => $ok, 'entry' => fto_rest_log_entry(fto_log_get($id)), 'counts' => fto_log_counts()];
        },
    ]);

    /* ---------- Form editor ---------- */
    register_rest_route('fto/v1', '/fields', [
        'methods'             => 'GET',
        'permission_callback' => $editor,
        'args'                => $model_arg + ['refresh' => ['type' => 'boolean', 'default' => false]],
        'callback'            => function (WP_REST_Request $request) {
            $fields = fto_model_fields($request['model'], $request['refresh']);
            return is_wp_error($fields) ? fto_rest_error($fields) : (object) $fields;
        },
    ]);

    register_rest_route('fto/v1', '/records', [
        'methods'             => 'GET',
        'permission_callback' => $editor,
        'args'                => $model_arg + ['refresh' => ['type' => 'boolean', 'default' => false]],
        'callback'            => function (WP_REST_Request $request) {
            $records = fto_model_records($request['model'], $request['refresh']);
            return is_wp_error($records) ? fto_rest_error($records) : $records;
        },
    ]);

    /**
     * Test send: creates a record in Odoo from the unsaved mapping and the
     * test values, the same way a submission would (including the
     * fto_values filter and the contact lookup), without logging it.
     */
    register_rest_route('fto/v1', '/test-send', [
        'methods'             => 'POST',
        'permission_callback' => $editor,
        'callback'            => function (WP_REST_Request $request) {
            $contact_form = WPCF7_ContactForm::get_instance((int) $request['form_id']);
            $settings = fto_sanitize_settings($request['settings']);
            if (!$contact_form || !$settings) return new WP_Error('fto_invalid', __('Invalid request', 'forms-to-odoo'), ['status' => 400]);

            $posted = fto_sanitize_samples($request['samples']);
            $values = fto_prepare_values($contact_form, $posted, $settings);
            if (!$values) return ['ok' => false, 'message' => __('Nothing to send: every mapped value is empty.', 'forms-to-odoo'), 'values' => (object) []];

            $result = fto_create_record($settings['model'], $values, fto_contact_for($settings, $posted));
            if (is_wp_error($result)) return ['ok' => false, 'message' => $result->get_error_message(), 'values' => $values];

            return [
                'ok'             => true,
                'id'             => $result['id'],
                'model'          => $settings['model'],
                'url'            => fto_record_url($settings['model'], $result['id']),
                'values'         => $values,
                'partnerId'      => $result['partner_id'],
                'partnerCreated' => $result['partner_created'],
                'partnerUrl'     => $result['partner_id'] ? fto_record_url('res.partner', $result['partner_id']) : '',
                'existing'       => $result['existing'],
            ];
        },
    ]);

    /**
     * What a submission with the test values would send, without sending
     * it: the Odoo values and the contact to look up. Drawn as the
     * summary next to the mapping.
     */
    register_rest_route('fto/v1', '/summary', [
        'methods'             => 'POST',
        'permission_callback' => $editor,
        'callback'            => function (WP_REST_Request $request) {
            $contact_form = WPCF7_ContactForm::get_instance((int) $request['form_id']);
            $settings = fto_sanitize_settings($request['settings']);
            if (!$contact_form || !$settings) return new WP_Error('fto_invalid', __('Invalid request', 'forms-to-odoo'), ['status' => 400]);

            $posted = fto_sanitize_samples($request['samples']);
            return [
                'values'  => (object) fto_prepare_values($contact_form, $posted, $settings),
                'contact' => fto_contact_for($settings, $posted),
            ];
        },
    ]);

    /**
     * Live preview of a text row: the template filled with the test values,
     * then its transform, computed by the same PHP code as a real
     * submission (PHP and JavaScript regexes differ).
     */
    register_rest_route('fto/v1', '/preview', [
        'methods'             => 'POST',
        'permission_callback' => $editor,
        'callback'            => function (WP_REST_Request $request) {
            $row = $request['row'];
            if (!is_array($row)) return new WP_Error('fto_invalid', __('Invalid request', 'forms-to-odoo'), ['status' => 400]);

            $filled = fto_render_template(sanitize_textarea_field((string) ($row['value'] ?? '')), fto_sanitize_samples($request['samples']));
            $transform = fto_sanitize_transform($row['transform'] ?? []);
            $error = $transform['pattern'] !== '' ? fto_regex_error($transform['pattern']) : '';
            $matched = $transform['pattern'] !== '' && !$error ? (bool) preg_match(fto_transform_regex($transform['pattern']), $filled) : null;

            return [
                'filled'  => $filled,
                'result'  => $error || $transform['pattern'] === '' ? $filled : fto_apply_transform($filled, $transform),
                'matched' => $matched,
                'error'   => $error,
            ];
        },
    ]);
});

// Odoo errors keep their message; 502 since it's Odoo that failed
function fto_rest_error(WP_Error $error) {
    return new WP_Error($error->get_error_code(), $error->get_error_message(), ['status' => 502]);
}

function fto_sanitize_model($model) {
    return preg_replace('/[^a-z0-9._]/', '', strtolower((string) $model));
}

// Test values from the editor, as a submission's posted data
function fto_sanitize_samples($samples) {
    $posted = [];
    foreach ((array) $samples as $name => $value) {
        // same characters as CF7 tag names, case kept
        $posted[preg_replace('/[^A-Za-z0-9_:.-]/', '', (string) $name)] = sanitize_textarea_field((string) $value);
    }
    return $posted;
}

// Connection settings as shown on the settings page; the key never leaves
function fto_rest_connection() {
    $constant = fn($key) => defined('FTO_ODOO_' . strtoupper($key)) || defined('ODOO_' . strtoupper($key));
    return [
        'url'        => (string) get_option('fto_url', ''),
        'db'         => (string) get_option('fto_db', ''),
        'hasKey'     => get_option('fto_api_key', '') !== '',
        'constants'  => ['url' => $constant('url'), 'db' => $constant('db'), 'api_key' => $constant('api_key')],
        'configured' => (bool) fto_is_configured(),
    ];
}

function fto_rest_log_entry($r) {
    $local = fn($utc) => $utc ? wp_date(get_option('date_format') . ' ' . get_option('time_format'), strtotime($utc . ' UTC')) : '';
    return [
        'id'          => (int) $r->id,
        'date'        => $local($r->created_at),
        'formId'      => (int) $r->form_id,
        'formTitle'   => $r->form_title,
        'formUrl'     => admin_url('admin.php?page=wpcf7&post=' . (int) $r->form_id . '&action=edit'),
        'model'       => $r->model,
        'status'      => $r->status,
        'attempts'    => (int) $r->attempts,
        'nextAttempt' => $r->status === 'pending' ? $local($r->next_attempt_at) : '',
        'odooId'      => (int) $r->odoo_id,
        'odooUrl'     => $r->odoo_id ? fto_record_url($r->model, (int) $r->odoo_id) : '',
        'partnerId'   => (int) $r->partner_id,
        'partnerUrl'  => $r->partner_id ? fto_record_url('res.partner', (int) $r->partner_id) : '',
        'error'       => (string) $r->error,
        'payload'     => json_decode($r->payload),
        'contact'     => $r->contact ? json_decode($r->contact) : null,
    ];
}
