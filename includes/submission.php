<?php
/**
 * Contact Form 7 submission → Odoo record, following the form's mapping
 * (set in the form editor's "Odoo" tab, stored in the _fto_settings meta).
 */
defined('ABSPATH') || exit;

// Odoo field types whose value is a template filled with the form's tags
const FTO_TEXT_TYPES = ['char', 'text', 'html', 'date', 'datetime', 'integer', 'float', 'monetary', 'boolean'];

/**
 * A form's settings:
 * ['enabled' => bool, 'model' => 'crm.lead', 'mapping' => [['field', 'type', 'value'], …]]
 * 'value' is a template string for text types, the selection key for
 * selection fields, a record id (many2one) or a list of ids (many2many).
 * Selection and relational rows can instead take their value from a form
 * field ('source' => 'form'): 'tag' is the field, 'map' links each of its
 * options to a selection key or record id, e.g. for a language:
 * ['source' => 'form', 'tag' => 'language', 'map' => ['Français' => 12, …]]
 * Text rows can also have a 'transform': a regular expression applied to
 * the filled-in template, ['pattern', 'replace', 'nomatch' => keep|empty].
 */
function fto_form_settings($form_id) {
    $saved = get_post_meta($form_id, '_fto_settings', true);
    return wp_parse_args(is_array($saved) ? $saved : [], ['enabled' => false, 'model' => 'crm.lead', 'mapping' => []]);
}

/**
 * Only valid submissions are sent: also when the notification email
 * failed (the lead matters more than the email), never spam.
 */
add_action('wpcf7_submit', function ($contact_form, $result) {
    if (!in_array($result['status'] ?? '', ['mail_sent', 'mail_failed'], true)) return;

    $settings = fto_form_settings($contact_form->id());
    if (!$settings['enabled'] || !$settings['mapping']) return;

    $submission = WPCF7_Submission::get_instance();
    if (!$submission) return;

    fto_handle_submission($contact_form, $submission->get_posted_data(), $settings);
}, 10, 2);

/**
 * Builds the Odoo values, logs them and sends them right away (retried
 * later if Odoo can't be reached). Returns the log entry id, or 0 when
 * there's nothing to send.
 */
function fto_handle_submission($contact_form, array $posted, array $settings) {
    $values = fto_prepare_values($contact_form, $posted, $settings);
    if (!$values) return 0;

    $id = fto_log_add($contact_form->id(), $contact_form->title(), $settings['model'], $values);
    fto_send_entry($id);
    return $id;
}

// Odoo values for a submission: the mapping, then the fto_values filter.
// Shared by real submissions and the editor's test send.
function fto_prepare_values($contact_form, array $posted, array $settings) {
    $values = fto_build_values($settings['mapping'], $posted);

    /**
     * Last chance to adjust what's sent, e.g. to combine or reformat fields
     * in ways a template can't. Return an empty array to send nothing.
     *
     * @param array             $values       Odoo field => value
     * @param WPCF7_ContactForm $contact_form
     * @param array             $posted       Submitted form data
     * @param array             $settings     The form's Forms to Odoo settings
     */
    return apply_filters('fto_values', $values, $contact_form, $posted, $settings);
}

function fto_build_values(array $mapping, array $posted) {
    $values = [];
    foreach ($mapping as $row) {
        $field = $row['field'] ?? '';
        $type  = $row['type'] ?? 'char';
        $value = $row['value'] ?? '';
        if ($field === '') continue;

        if (in_array($type, FTO_TEXT_TYPES, true)) {
            $text = fto_render_template((string) $value, $posted);
            if (!empty($row['transform']['pattern'])) $text = fto_apply_transform($text, $row['transform']);
            if ($text === '') continue;
            if ($type === 'html') $text = preg_replace('/\R/u', '<br>', esc_html($text));
            $cast = fto_cast($text, $type);
            if ($cast !== null) $values[$field] = $cast;
        } elseif (($row['source'] ?? '') === 'form') {
            $mapped = fto_map_choices($row, $posted);
            if (!$mapped) continue;
            if ($type === 'many2many') $values[$field] = [[6, 0, array_values(array_unique(array_map('intval', $mapped)))]];
            elseif ($type === 'many2one') $values[$field] = (int) $mapped[0];
            else $values[$field] = (string) $mapped[0];
        } elseif ($type === 'selection' && $value !== '') {
            $values[$field] = (string) $value;
        } elseif ($type === 'many2one' && (int) $value) {
            $values[$field] = (int) $value;
        } elseif ($type === 'many2many' && ($ids = array_values(array_filter(array_map('intval', (array) $value))))) {
            // Command.set: link exactly these records
            $values[$field] = [[6, 0, $ids]];
        }
    }
    return $values;
}

// Odoo values linked to the option(s) chosen in the row's form field
function fto_map_choices(array $row, array $posted) {
    $chosen = (array) ($posted[$row['tag'] ?? ''] ?? []);
    $map = (array) ($row['map'] ?? []);
    $out = [];
    foreach ($chosen as $option) {
        $option = trim((string) $option);
        if ($option !== '' && isset($map[$option]) && $map[$option] !== '' && $map[$option] !== 0) $out[] = $map[$option];
    }
    return $out;
}

/**
 * The options a visitor can choose in a select, radio or checkbox field, as
 * submitted (the part after "|" when the field uses pipes), without a
 * leading placeholder option such as "Preferred time".
 */
function fto_tag_options(WPCF7_FormTag $tag) {
    $options = $tag->pipes instanceof WPCF7_Pipes && !$tag->pipes->zero()
        ? $tag->pipes->collect_afters()
        : $tag->values;
    $placeholder = $tag->has_option('first_as_label')
        || ($tag->basetype === 'select' && count($options) > 1 && preg_match('/^(preferred|choose|select|please|your)\b/i', (string) $options[0]));
    if ($placeholder) array_shift($options);
    return array_values(array_map('strval', $options));
}

/**
 * Fills [tags] with the submitted values (lists joined with ", ").
 * A line whose tags are all empty is dropped, so a "Label: [tag]" line
 * disappears when the field wasn't filled in (e.g. a hidden conditional
 * field). Plain text: HTML fields are escaped afterwards.
 */
function fto_render_template($template, array $posted) {
    $lines = [];
    foreach (preg_split('/\R/u', $template) as $line) {
        $tags = 0;
        $filled = 0;
        $out = preg_replace_callback('/\[\s*([a-zA-Z_][0-9a-zA-Z:._-]*)\s*\]/', function ($m) use ($posted, &$tags, &$filled) {
            $tags++;
            $value = fto_tag_value($m[1], $posted);
            if ($value !== '') $filled++;
            return $value;
        }, $line);
        if ($tags && !$filled) continue;
        $lines[] = $out;
    }
    return trim(implode("\n", $lines));
}

// The admin types the pattern without delimiters; always UTF-8 aware
function fto_transform_regex($pattern) {
    return '~' . str_replace('~', '\\~', $pattern) . '~u';
}

// '' when the pattern compiles, else PCRE's message ("missing closing
// parenthesis at offset 4")
function fto_regex_error($pattern) {
    $message = '';
    set_error_handler(function ($no, $str) use (&$message) {
        $message = preg_replace('/^preg_match\(\): (Compilation failed: )?/', '', $str);
        return true;
    });
    $ok = preg_match(fto_transform_regex($pattern), '') !== false;
    restore_error_handler();
    return $ok ? '' : ($message ?: __('Invalid regular expression', 'forms-to-odoo'));
}

/**
 * Regex find & replace on a filled-in template, e.g. "+32 Belgium 0478…"
 * → "+32 478…" with pattern ^(\+\d+)\D*?0*(\d.*)$ and "$1 $2". When the
 * pattern doesn't match, the text is kept or emptied ('nomatch').
 */
function fto_apply_transform($text, array $transform) {
    $regex = fto_transform_regex((string) $transform['pattern']);
    if (fto_regex_error((string) $transform['pattern'])) return $text;
    if (!preg_match($regex, $text)) return ($transform['nomatch'] ?? 'keep') === 'empty' ? '' : $text;
    $out = preg_replace($regex, (string) ($transform['replace'] ?? ''), $text);
    return $out === null ? $text : trim(preg_replace('/[ \t]{2,}/u', ' ', $out));
}

function fto_tag_value($name, array $posted) {
    if (array_key_exists($name, $posted)) {
        $v = $posted[$name];
        return trim(is_array($v) ? implode(', ', array_filter(array_map('strval', $v), 'strlen')) : (string) $v);
    }
    // CF7 special mail tags ([_date], [_url], [_remote_ip]…), only available
    // during a real submission
    if (str_starts_with($name, '_') && function_exists('wpcf7_mail_replace_tags') && WPCF7_Submission::get_instance()) {
        $v = trim(wpcf7_mail_replace_tags('[' . $name . ']'));
        return $v === '[' . $name . ']' ? '' : $v;
    }
    return '';
}

// Converts rendered text to the Odoo field type, null if it doesn't fit
function fto_cast($text, $type) {
    switch ($type) {
        case 'integer':
            return is_numeric($text) ? (int) $text : null;
        case 'float':
        case 'monetary':
            $n = str_replace([' ', ','], ['', '.'], $text);
            return is_numeric($n) ? (float) $n : null;
        case 'boolean':
            return !in_array(strtolower($text), ['0', 'no', 'false', 'off'], true);
        case 'date':
            $t = strtotime($text);
            return $t ? gmdate('Y-m-d', $t) : null;
        case 'datetime':
            // typed in the site's timezone, Odoo stores UTC
            try {
                return (new DateTime($text, wp_timezone()))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
            } catch (Exception $e) {
                return null;
            }
        default:
            return $text;
    }
}
