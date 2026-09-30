<?php
/**
 * "Odoo" tab in the Contact Form 7 form editor: turn the sync on, pick the
 * Odoo model and map its fields. The mapping UI itself is assets/admin.js;
 * this renders its container, feeds it Odoo metadata and saves the result.
 */
defined('ABSPATH') || exit;

// Suggested targets; any other model can be typed in
function fto_known_models() {
    return [
        'crm.lead'        => __('CRM lead / opportunity', 'forms-to-odoo'),
        'res.partner'     => __('Contact', 'forms-to-odoo'),
        'helpdesk.ticket' => __('Helpdesk ticket', 'forms-to-odoo'),
        'project.task'    => __('Project task', 'forms-to-odoo'),
        'mailing.contact' => __('Mailing list contact', 'forms-to-odoo'),
    ];
}

add_filter('wpcf7_editor_panels', function ($panels) {
    $panels['fto-panel'] = [
        'title'    => __('Odoo', 'forms-to-odoo'),
        'callback' => 'fto_render_panel',
    ];
    return $panels;
});

function fto_render_panel($contact_form) {
    ?>
    <h2><?php esc_html_e('Send to Odoo', 'forms-to-odoo'); ?></h2>
    <?php if (!fto_is_configured()): ?>
        <div class="notice notice-warning inline"><p>
            <?php echo wp_kses(sprintf(
                /* translators: %s: settings page URL */
                __('Connect Odoo first in <a href="%s">Settings → Forms to Odoo</a>.', 'forms-to-odoo'),
                esc_url(fto_admin_url())
            ), ['a' => ['href' => []]]); ?>
        </p></div>
    <?php endif; ?>
    <?php if (!$contact_form->initial()): ?>
        <?php // filled and kept in sync by admin.js, read by the save hook below ?>
        <input type="hidden" name="fto-settings" id="fto-settings" value="<?php echo esc_attr(wp_json_encode(fto_form_settings($contact_form->id()))); ?>">
        <?php // not "fto-panel": CF7 already gives that id to the tab's own <section> ?>
        <div id="fto-app" class="fto-panel"></div>
    <?php else: ?>
        <p><?php esc_html_e('Save the form once, then come back to this tab.', 'forms-to-odoo'); ?></p>
    <?php endif; ?>
    <?php
}

add_action('wpcf7_save_contact_form', function ($contact_form) {
    if (!isset($_POST['fto-settings']) || !current_user_can('wpcf7_edit_contact_form', $contact_form->id())) return;
    $settings = fto_sanitize_settings(json_decode(wp_unslash($_POST['fto-settings']), true));
    // update_post_meta() strips one level of backslashes (regex patterns,
    // templates), hence wp_slash()
    if ($settings) update_post_meta($contact_form->id(), '_fto_settings', wp_slash($settings));
});

// Settings as sent by admin.js (saved, or used for a test send), cleaned up
function fto_sanitize_settings($raw) {
    if (!is_array($raw)) return null;

    $mapping = [];
    foreach ((array) ($raw['mapping'] ?? []) as $row) {
        $field = preg_replace('/[^a-z0-9_]/', '', strtolower((string) ($row['field'] ?? '')));
        if ($field === '') continue;
        $type = sanitize_key($row['type'] ?? 'char');
        $value = $row['value'] ?? '';
        $clean = [
            'field' => $field,
            'type'  => $type,
            'value' => match ($type) {
                'many2one'  => (int) $value,
                'many2many' => array_values(array_filter(array_map('intval', (array) $value))),
                // templates may hold HTML-ish text and line breaks, they're
                // escaped when rendered
                default     => sanitize_textarea_field((string) $value),
            },
        ];
        if (in_array($type, FTO_TEXT_TYPES, true) && !empty($row['transform']['pattern'])) {
            $clean['transform'] = fto_sanitize_transform($row['transform']);
        }
        if (($row['source'] ?? '') === 'form' && in_array($type, ['selection', 'many2one', 'many2many'], true)) {
            $map = [];
            foreach ((array) ($row['map'] ?? []) as $option => $target) {
                $target = $type === 'selection' ? sanitize_text_field((string) $target) : (int) $target;
                if ($target !== '' && $target !== 0) $map[sanitize_text_field((string) $option)] = $target;
            }
            $clean += [
                'source' => 'form',
                'tag'    => preg_replace('/[^A-Za-z0-9_:.-]/', '', (string) ($row['tag'] ?? '')),
                'map'    => $map,
            ];
        }
        $mapping[] = $clean;
    }
    return [
        'enabled' => !empty($raw['enabled']),
        'model'   => preg_replace('/[^a-z0-9._]/', '', strtolower((string) ($raw['model'] ?? 'crm.lead'))) ?: 'crm.lead',
        'mapping' => $mapping,
    ];
}

// A regex can't go through the usual text sanitizers (they'd eat valid
// syntax like %xx or runs of spaces): only length-capped and null-free.
// Admin-only input, and an invalid pattern is simply not applied.
function fto_sanitize_transform($transform) {
    $clip = fn($v) => mb_substr(str_replace("\0", '', (string) $v), 0, 500);
    return [
        'pattern' => $clip($transform['pattern'] ?? ''),
        'replace' => $clip($transform['replace'] ?? ''),
        'nomatch' => ($transform['nomatch'] ?? '') === 'empty' ? 'empty' : 'keep',
    ];
}

/* ---------- Assets ---------- */
add_action('admin_enqueue_scripts', function () {
    $page = $_GET['page'] ?? '';
    if (!in_array($page, ['wpcf7', 'wpcf7-new'], true) || empty($_GET['post'])) return;
    $contact_form = WPCF7_ContactForm::get_instance((int) $_GET['post']);
    if (!$contact_form) return;

    wp_enqueue_style('fto-admin', FTO_URL . 'assets/admin.css', [], FTO_VERSION);
    wp_enqueue_script('fto-admin', FTO_URL . 'assets/admin.js', [], FTO_VERSION, true);
    wp_localize_script('fto-admin', 'ftoAdmin', [
        'ajaxUrl'    => admin_url('admin-ajax.php'),
        'nonce'      => wp_create_nonce('fto_meta'),
        'configured' => fto_is_configured(),
        'models'     => fto_known_models(),
        'tags'       => array_values(array_unique($contact_form->collect_mail_tags())),
        'samples'    => fto_sample_values($contact_form),
        'choices'    => fto_form_choices($contact_form),
        'formId'     => $contact_form->id(),
        'textTypes'  => FTO_TEXT_TYPES,
        'i18n'       => [
            'enable'        => __('Send submissions of this form to Odoo', 'forms-to-odoo'),
            'model'         => __('Create a', 'forms-to-odoo'),
            'otherModel'    => __('Other model…', 'forms-to-odoo'),
            'modelName'     => __('Technical model name, e.g. x_bookings', 'forms-to-odoo'),
            'mapping'       => __('Fields', 'forms-to-odoo'),
            'odooField'     => __('Odoo field', 'forms-to-odoo'),
            'value'         => __('Value', 'forms-to-odoo'),
            'addField'      => __('Add a field', 'forms-to-odoo'),
            'remove'        => __('Remove', 'forms-to-odoo'),
            'choose'        => __('— Choose —', 'forms-to-odoo'),
            'none'          => __('— None —', 'forms-to-odoo'),
            'loading'       => __('Loading from Odoo…', 'forms-to-odoo'),
            'reload'        => __('Refresh Odoo fields', 'forms-to-odoo'),
            'reloadHelp'    => __('Fields and lists (sources, tags, teams…) are kept 10 minutes. Refresh after adding something in Odoo.', 'forms-to-odoo'),
            'unknownField'  => __('Not found on this Odoo model', 'forms-to-odoo'),
            'required'      => __('required', 'forms-to-odoo'),
            'missingReq'    => __('Required in Odoo and not mapped (fine if Odoo fills in a default):', 'forms-to-odoo'),
            'tagsHelp'      => __('Form tags, click to insert into the focused value. A line whose tags are all empty is left out.', 'forms-to-odoo'),
            'templateHint'  => __('Text and [form-tags], e.g. [your-name]', 'forms-to-odoo'),
            'multiHint'     => __('Ctrl/Cmd-click to select several', 'forms-to-odoo'),
            'notConfigured' => __('Connect Odoo first to choose fields.', 'forms-to-odoo'),
            'test'          => __('Send a test record', 'forms-to-odoo'),
            'testHelp'      => __('Creates a real record in Odoo from the mapping above as it is now (no need to save first), filled with the test values below. Nothing is logged and no email is sent.', 'forms-to-odoo'),
            'testValues'    => __('Test values', 'forms-to-odoo'),
            'testValuesHelp' => __('What the form "submits" for the test. Clear a field to test it left empty (e.g. a hidden conditional field).', 'forms-to-odoo'),
            'testing'       => __('Sending to Odoo…', 'forms-to-odoo'),
            /* translators: 1: Odoo model, 2: record id */
            'testCreated'   => __('Created %1$s #%2$s in Odoo.', 'forms-to-odoo'),
            'testOpen'      => __('Open in Odoo', 'forms-to-odoo'),
            'testDelete'    => __('Remember to delete it there once checked.', 'forms-to-odoo'),
            'testFailed'    => __('Odoo refused the test record:', 'forms-to-odoo'),
            'testSent'      => __('Values sent', 'forms-to-odoo'),
            'testEmpty'     => __('Nothing to send: every mapped value is empty.', 'forms-to-odoo'),
            'sourceFixed'   => __('Fixed value', 'forms-to-odoo'),
            'sourceForm'    => __('Map a form field', 'forms-to-odoo'),
            'formField'     => __('Form field', 'forms-to-odoo'),
            'formOption'    => __('When the visitor chooses', 'forms-to-odoo'),
            'odooValue'     => __('Send to Odoo', 'forms-to-odoo'),
            'noChoices'     => __('This form has no select, radio or checkbox field.', 'forms-to-odoo'),
            'unmappedHelp'  => __('Options left on "— None —" leave the Odoo field empty.', 'forms-to-odoo'),
            'transform'     => __('Transform (regular expression)', 'forms-to-odoo'),
            'find'          => __('Find', 'forms-to-odoo'),
            'replaceWith'   => __('Replace with', 'forms-to-odoo'),
            'findHint'      => __('PHP regex, without delimiters, e.g. ^(\\+\\d+)\\D*?0*(\\d.*)$', 'forms-to-odoo'),
            'replaceHint'   => __('Use $1, $2… for the captured groups', 'forms-to-odoo'),
            'noMatch'       => __('If it doesn\'t match', 'forms-to-odoo'),
            'noMatchKeep'   => __('keep the value as is', 'forms-to-odoo'),
            'noMatchEmpty'  => __('leave the Odoo field empty', 'forms-to-odoo'),
            'preview'       => __('With the test values:', 'forms-to-odoo'),
            'previewEmpty'  => __('(empty, not sent)', 'forms-to-odoo'),
            'removeTransform' => __('Remove the transform', 'forms-to-odoo'),
        ],
    ]);
});

/**
 * A plausible value for each field of the form, used by the test send:
 * [tag name => value]. Lists take their first real option.
 */
function fto_sample_values($contact_form) {
    $samples = [];
    foreach ($contact_form->scan_form_tags() as $tag) {
        // groups (Conditional Fields for CF7) wrap fields, they aren't one
        if (!$tag->name || isset($samples[$tag->name]) || $tag->basetype === 'group') continue;
        $options = in_array($tag->basetype, ['select', 'radio', 'checkbox'], true) ? fto_tag_options($tag) : [];
        $samples[$tag->name] = match ($tag->basetype) {
            'email'                        => 'test@example.com',
            'tel'                          => '0470 00 00 00',
            'url'                          => home_url('/'),
            'number', 'range'              => '1',
            'date'                         => wp_date('Y-m-d'),
            'textarea'                     => __('Test message sent from the Forms to Odoo settings.', 'forms-to-odoo'),
            'select', 'radio', 'checkbox'  => (string) ($options[0] ?? ''),
            'acceptance'                   => '1',
            'file', 'submit', 'quiz'       => '',
            default                        => sprintf(__('Test %s', 'forms-to-odoo'), $tag->name),
        };
    }
    return $samples;
}

// Form fields with a fixed list of options: [tag name => [option, …]]
function fto_form_choices($contact_form) {
    $choices = [];
    foreach ($contact_form->scan_form_tags(['basetype' => ['select', 'radio', 'checkbox']]) as $tag) {
        if ($tag->name && ($options = fto_tag_options($tag))) $choices[$tag->name] = $options;
    }
    return $choices;
}

/* ---------- AJAX: Odoo metadata for the mapping UI ---------- */
function fto_ajax_guard() {
    check_ajax_referer('fto_meta', 'nonce');
    if (!current_user_can('wpcf7_edit_contact_forms')) wp_send_json_error(['message' => __('Not allowed', 'forms-to-odoo')], 403);
}

add_action('wp_ajax_fto_fields', function () {
    fto_ajax_guard();
    $model = preg_replace('/[^a-z0-9._]/', '', strtolower((string) ($_GET['model'] ?? '')));
    $fields = fto_model_fields($model, !empty($_GET['refresh']));
    is_wp_error($fields) ? wp_send_json_error(['message' => $fields->get_error_message()]) : wp_send_json_success($fields);
});

add_action('wp_ajax_fto_records', function () {
    fto_ajax_guard();
    $model = preg_replace('/[^a-z0-9._]/', '', strtolower((string) ($_GET['model'] ?? '')));
    $records = fto_model_records($model, !empty($_GET['refresh']));
    is_wp_error($records) ? wp_send_json_error(['message' => $records->get_error_message()]) : wp_send_json_success($records);
});

/**
 * Test send from the editor: creates a record in Odoo from the unsaved
 * mapping and the test values, the same way a submission would (including
 * the fto_values filter), without logging it.
 */
add_action('wp_ajax_fto_test_send', function () {
    fto_ajax_guard();
    $contact_form = WPCF7_ContactForm::get_instance((int) ($_POST['form_id'] ?? 0));
    $settings = fto_sanitize_settings(json_decode(wp_unslash($_POST['settings'] ?? ''), true));
    if (!$contact_form || !$settings) wp_send_json_error(['message' => __('Invalid request', 'forms-to-odoo')], 400);

    $posted = [];
    foreach ((array) json_decode(wp_unslash($_POST['samples'] ?? ''), true) as $name => $value) {
        // same characters as CF7 tag names, case kept
        $posted[preg_replace('/[^A-Za-z0-9_:.-]/', '', (string) $name)] = sanitize_textarea_field((string) $value);
    }

    $values = fto_prepare_values($contact_form, $posted, $settings);
    if (!$values) wp_send_json_error(['message' => __('Nothing to send: every mapped value is empty.', 'forms-to-odoo'), 'values' => (object) []]);

    $result = fto_call($settings['model'], 'create', ['vals_list' => [$values]]);
    if (is_wp_error($result)) wp_send_json_error(['message' => $result->get_error_message(), 'values' => $values]);

    $id = (int) ($result[0] ?? 0);
    wp_send_json_success(['id' => $id, 'model' => $settings['model'], 'url' => fto_record_url($settings['model'], $id), 'values' => $values]);
});

/**
 * Live preview of a text row in the editor: the template filled with the
 * test values, then its transform, computed by the same PHP code as a
 * real submission (PHP and JavaScript regexes differ).
 */
add_action('wp_ajax_fto_preview', function () {
    fto_ajax_guard();
    $row = json_decode(wp_unslash($_POST['row'] ?? ''), true);
    if (!is_array($row)) wp_send_json_error(['message' => __('Invalid request', 'forms-to-odoo')], 400);

    $posted = [];
    foreach ((array) json_decode(wp_unslash($_POST['samples'] ?? ''), true) as $name => $value) {
        $posted[preg_replace('/[^A-Za-z0-9_:.-]/', '', (string) $name)] = sanitize_textarea_field((string) $value);
    }
    $filled = fto_render_template(sanitize_textarea_field((string) ($row['value'] ?? '')), $posted);
    $transform = fto_sanitize_transform($row['transform'] ?? []);
    $error = $transform['pattern'] !== '' ? fto_regex_error($transform['pattern']) : '';
    $matched = $transform['pattern'] !== '' && !$error ? (bool) preg_match(fto_transform_regex($transform['pattern']), $filled) : null;

    wp_send_json_success([
        'filled'  => $filled,
        'result'  => $error || $transform['pattern'] === '' ? $filled : fto_apply_transform($filled, $transform),
        'matched' => $matched,
        'error'   => $error,
    ]);
});
