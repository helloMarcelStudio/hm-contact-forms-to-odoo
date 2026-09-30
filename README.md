# Forms to Odoo

Send Contact Form 7 submissions to Odoo: per-form field mapping, send log and automatic retries.

Forms to Odoo turns Contact Form 7 submissions into Odoo records: CRM leads, contacts, helpdesk tickets, project tasks, or records of any other model. Each form gets its own mapping in an **Odoo** tab of the form editor. No code is needed, and a submission is never silently lost: every send is logged and retried if Odoo can't be reached.

- **Requires:** WordPress 6.0+, PHP 8.0+, Contact Form 7, Odoo 19+ (JSON-2 API)
- **License:** GPL-2.0-or-later
- **Status:** early development (0.1.x)

---

## Features

**Per-form mapping**
- Turn the sync on form by form, and choose the Odoo model to create (lead, contact, ticket, task, mailing contact, or any technical model name).
- Fields are loaded from Odoo, with required fields flagged. Only writable, supported fields are listed.
- **Text, number and date fields** take a template with form tags, e.g. `Tour – [visit-type] – [name] [surname]`. A line whose tags are all empty is left out, which suits conditional fields.
- **Choice and relational fields** (sales team, salesperson, tags, language, source…) take either:
  - a **fixed value** picked from a list loaded from Odoo, or
  - **Map a form field**: each option of a select, radio or checkbox field is linked to an Odoo value. For example, "Français" → *French / Français*, or checkboxes → several tags.
- **Regex transform** on any text field: find and replace with capture groups, optionally leaving the field empty when the pattern doesn't match. A live preview, computed by the same PHP code, shows the result with test values.

**Reliable sending**
- Every valid submission is logged before being sent. It's sent even if the notification email fails, and never for spam.
- **Automatic retries** when Odoo can't be reached (network error, timeout, 5xx, 429): after 5 min, 30 min, 2 h and 12 h.
- Rejected sends (missing field, access rights, invalid value) are marked **failed** straight away, with Odoo's error message.
- An admin notice on every admin page when a send failed, and a **Resend now** button.
- Log entries are deleted after 90 days, since they contain personal data.

**Tools**
- **Test connection**: shows the Odoo version and the user behind the API key.
- **Send a test record** from the form editor. It uses the mapping currently on screen and editable test values, and links to the created record.
- A developer hook to adjust the values before they're sent.

---

## Installation

1. Copy the `forms-to-odoo` folder to `wp-content/plugins/` and activate **Forms to Odoo**. Contact Form 7 must be active.
2. In Odoo, create an API key: **your user → Preferences → Account Security → New API Key**. Records are created with that user's access rights.
3. In WordPress, go to **Settings → Forms to Odoo**, enter the Odoo URL, the database (only needed if the server hosts several) and the API key, then click **Test connection**.
4. Edit a form in **Contact → Contact Forms**, open its **Odoo** tab and set up the mapping.
5. Click **Send a test record**, check it in Odoo and delete it. Then tick **Send submissions of this form to Odoo** and save.

### Connection settings in `wp-config.php`

To keep secrets out of the database, leave the fields empty in the settings page and define constants instead:

```php
define('FTO_ODOO_URL', 'https://mycompany.odoo.com');
define('FTO_ODOO_DB', 'mycompany');        // optional
define('FTO_ODOO_API_KEY', '…');
```

The older `ODOO_URL`, `ODOO_DB` and `ODOO_API_KEY` names also work. A value saved in the settings page takes precedence over a constant.

---

## Mapping reference

| Odoo field type | Value in the mapping | Sent to Odoo |
|---|---|---|
| char, text | template | the filled-in text |
| html | template | escaped text, line breaks as `<br>` |
| integer, float, monetary | template | the number; not sent if it isn't numeric |
| boolean | template | false for `0`, `no`, `false`, `off`, else true |
| date | template | `YYYY-MM-DD` |
| datetime | template | converted from the site's timezone to UTC |
| selection | fixed value, or map a form field | the option key |
| many2one | fixed record, or map a form field | the record ID |
| many2many | fixed records, or map a form field | `[[6, 0, [ids]]]` (replace the links) |

Empty values are never sent, so Odoo applies its defaults.

**Template tags:** any form tag, e.g. `[your-name]`. Multiple choices are joined with `, `. Contact Form 7's special tags such as `[_date]`, `[_url]` and `[_post_title]` also work.

### Regex transform example

Contact Form 7 splits a phone number into a country code select (`+32 Belgium`) and a number (`0478 93 42 97`). To send `+32 478 93 42 97`:

| Setting | Value |
|---|---|
| Template | `[country-code] [phone]` |
| Find | `^(\+\d+) [^\d+]+ 0*(.+)$\|^(?!\+\d+ [^\d+]+$)(.+)$` |
| Replace with | `$1 $2$3` |
| If it doesn't match | leave the Odoo field empty |

Patterns are PHP (PCRE) regular expressions, written without delimiters. The `u` (UTF-8) flag is always on.

---

## For developers

### Hook: `fto_values`

Adjust the values right before they're sent, for rules a template or a regex can't express. Return an empty array to send nothing.

```php
// Add the page the form was sent from to the lead's notes
add_filter('fto_values', function (array $values, WPCF7_ContactForm $form, array $posted, array $settings) {
    $submission = WPCF7_Submission::get_instance();
    if ($form->id() === 123 && $submission && ($url = $submission->get_meta('url'))) {
        $values['description'] = ($values['description'] ?? '') . '<br>Page: ' . esc_html($url);
    }
    return $values;
}, 10, 4);
```

The same filter runs for the editor's **Send a test record**, where there's no real submission: check `WPCF7_Submission::get_instance()` before using it, as above.

### Actions

- `fto_sent` (`int $odoo_id, object $log_entry`): a record was created in Odoo.
- `fto_failed` (`object $log_entry, WP_Error $error`): a send failed and won't be retried automatically.

### Storage

| What | Where |
|---|---|
| Connection | options `fto_url`, `fto_db`, `fto_api_key` |
| Form settings | post meta `_fto_settings` on the Contact Form 7 form |
| Send log | table `{prefix}fto_log` |
| Odoo fields and records cache | transients, 1 h for fields and 10 min for records ("Refresh Odoo fields" clears them) |
| Scheduled jobs | `fto_retry` (every 5 min), `fto_cleanup` (daily) |

Uninstalling the plugin removes all of the above.

### Odoo API

The plugin uses the JSON-2 API (`POST /json/2/{model}/{method}`, bearer API key) with `fields_get`, `search_read`, `create` and `res.users.context_get`.

### Project structure

```
forms-to-odoo.php      bootstrap, activation, migration from the old mu-plugin
includes/client.php    Odoo API client, connection test, cached metadata
includes/submission.php  CF7 hook, mapping → values, templates, regex transforms
includes/log.php       log table, retries (WP-Cron), cleanup
includes/settings.php  Settings → Forms to Odoo (connection, log)
includes/form-panel.php  "Odoo" tab in the CF7 editor, AJAX endpoints
assets/admin.js        mapping UI (vanilla JS, no build step)
assets/admin.css
uninstall.php
```

---

## Limitations

- **Odoo 19+ only** (JSON-2 API). Older versions (XML-RPC / JSON-RPC) aren't supported yet.
- **Contact Form 7 only** for now.
- **One Odoo record per submission.** No file attachments yet.
- **Relational lists** show at most 500 records.
- **Retries rely on WP-Cron.** On low-traffic sites, set up a real server cron calling `wp-cron.php`.

## Roadmap

- Support for Odoo 17 and 18 (XML-RPC)
- Gravity Forms, WPForms, Elementor Forms and Fluent Forms
- File attachments
- UTM / source tracking from the visitor's landing URL
- Record search for large relational lists
- French translation

## Credits

Built by [hellomarcel](https://marcel-pirnay.be).
