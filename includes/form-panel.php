<?php
/**
 * "Odoo" tab in the Contact Form 7 form editor: turn the sync on, pick the
 * Odoo model and map its fields. The mapping UI itself is a React app
 * (src/form-panel); this renders its container, feeds it the form's data
 * and saves the result. Odoo metadata comes from the REST API (rest.php).
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
        'calendar.event'  => __('Booking request (Appointments)', 'forms-to-odoo'),
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
        <?php // filled and kept in sync by the React app, read by the save hook below ?>
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

// Settings as sent by the React app (saved, or used for a test send), cleaned up
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
        'model'   => fto_sanitize_model($raw['model'] ?? 'crm.lead') ?: 'crm.lead',
        'mapping' => $mapping,
        'contact' => fto_sanitize_contact($raw['contact'] ?? []),
        'utm'     => fto_sanitize_utm_settings($raw['utm'] ?? []),
        'booking' => fto_sanitize_booking($raw['booking'] ?? []),
    ];
}

function fto_sanitize_contact($contact) {
    $contact = wp_parse_args(is_array($contact) ? $contact : [], fto_contact_defaults());
    return [
        'enabled' => !empty($contact['enabled']),
        'email'   => sanitize_text_field((string) $contact['email']),
        'name'    => sanitize_text_field((string) $contact['name']),
        'phone'   => sanitize_text_field((string) $contact['phone']),
        'field'   => preg_replace('/[^a-z0-9_]/', '', strtolower((string) $contact['field'])) ?: 'partner_id',
        'multi'   => !empty($contact['multi']),
        'create'  => !empty($contact['create']),
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

    fto_enqueue_app('form-panel', [
        'configured'  => fto_is_configured(),
        'settingsUrl' => fto_admin_url(),
        'models'      => fto_known_models(),
        'tags'        => array_values(array_unique($contact_form->collect_mail_tags())),
        'samples'     => (object) fto_sample_values($contact_form),
        'choices'     => (object) fto_form_choices($contact_form),
        'formId'      => $contact_form->id(),
        'formTitle'   => $contact_form->title(),
        'dateTags'    => array_values(array_unique(array_map(fn($t) => $t->name, $contact_form->scan_form_tags(['basetype' => 'date'])))),
        'bookingFields' => FTO_BOOKING_FIELDS,
        'textTypes'   => FTO_TEXT_TYPES,
    ]);
});

/**
 * A realistic value for each field of the form, used by the test send and
 * the summary: [tag name => value]. Guessed from the field's type, then its
 * name (first-name, company, city…); lists take their first real option.
 * Emails use example.com, which never reaches anyone.
 */
function fto_sample_values($contact_form) {
    $samples = [];
    foreach ($contact_form->scan_form_tags() as $tag) {
        // groups (Conditional Fields for CF7) wrap fields, they aren't one
        if (!$tag->name || isset($samples[$tag->name]) || $tag->basetype === 'group') continue;
        $options = in_array($tag->basetype, ['select', 'radio', 'checkbox'], true) ? fto_tag_options($tag) : [];
        $samples[$tag->name] = match ($tag->basetype) {
            'email'                        => 'marie.dubois@example.com',
            'tel'                          => '+32 470 12 34 56',
            'url'                          => 'https://www.example.com',
            'number', 'range'              => '12',
            // a stay: departure three nights after arrival
            'date'                         => wp_date('Y-m-d', strtotime(preg_match('/out|depart|départ|end|leav|until|fin/i', $tag->name) ? '+17 days' : '+2 weeks')),
            'textarea'                     => __("Hello,\nWe are a group of 12 people and would like to book a guided tour in May. Could you send us your availability and prices?\nThank you!", 'forms-to-odoo'),
            'select', 'radio', 'checkbox'  => (string) ($options[0] ?? ''),
            'acceptance'                   => '1',
            'file', 'submit', 'quiz'       => '',
            default                        => fto_sample_text($tag->name),
        };
    }
    return $samples;
}

// A text field's sample, from its name: "your-name" → "Marie Dubois"
function fto_sample_text($name) {
    $guesses = [
        '/first|prenom|prénom|given/i'         => 'Marie',
        '/last|surname|family|^nom$/i'         => 'Dubois',
        '/company|organi[sz]|soci[eé]t|business|firm/i' => 'Atelier Dubois',
        '/mail/i'                              => 'marie.dubois@example.com',
        '/phone|tel|gsm|mobile/i'              => '+32 470 12 34 56',
        '/name|nom/i'                          => 'Marie Dubois',
        '/subject|sujet|objet|topic/i'         => __('Guided tour for a group', 'forms-to-odoo'),
        '/street|address|adresse|rue/i'        => 'Rue de la Loi 16',
        '/zip|postal|postcode|cp$/i'           => '1000',
        '/city|ville|town|locality/i'          => 'Brussels',
        '/country|pays/i'                      => 'Belgium',
        '/vat|tva/i'                           => 'BE0123456789',
        '/url|website|site/i'                  => 'https://www.example.com',
        '/job|function|fonction|title|role/i'  => __('Office manager', 'forms-to-odoo'),
        '/budget|price|amount|montant/i'       => '1500',
        '/date|day|jour/i'                     => wp_date('Y-m-d', strtotime('+2 weeks')),
    ];
    foreach ($guesses as $pattern => $value) {
        if (preg_match($pattern, $name)) return $value;
    }
    // "your-message-extra" → "Message extra"
    return ucfirst(trim(str_replace(['your-', '-', '_'], ['', ' ', ' '], $name)));
}

// Form fields with a fixed list of options: [tag name => [option, …]]
function fto_form_choices($contact_form) {
    $choices = [];
    foreach ($contact_form->scan_form_tags(['basetype' => ['select', 'radio', 'checkbox']]) as $tag) {
        if ($tag->name && ($options = fto_tag_options($tag))) $choices[$tag->name] = $options;
    }
    return $choices;
}
