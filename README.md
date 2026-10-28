# Forms to Odoo

Send Contact Form 7 submissions to Odoo: per-form field mapping, send log and automatic retries.

Forms to Odoo turns Contact Form 7 submissions into Odoo records: CRM leads, contacts, helpdesk tickets, project tasks, or records of any other model. Each form gets its own mapping in an **Odoo** tab of the form editor. No code is needed, and a submission is never silently lost: every send is logged and retried if Odoo can't be reached.

- **Requires:** WordPress 6.5+, PHP 8.0+, Contact Form 7, Odoo 19+ (JSON-2 API)
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

**No duplicate contacts**
- **Link to an Odoo contact, found by email**: the lead, ticket or task is linked to the contact that already has the submitted email (case-insensitive, oldest first), in `partner_id` or any other contact field. When no contact has that email, one is created from name and phone templates, or the record is sent without a contact if you turn creation off.
- On a form that creates **contacts** (`res.partner`), an existing contact with the same email is reused instead of creating a duplicate.
- The lookup runs when the record is sent, so a retry never creates the contact twice. A contact set explicitly in the mapping takes precedence.

**Booking requests (Odoo Appointments)**
- **Create a: Booking request** turns a form into a booking in Odoo Appointments, e.g. a room for one or more nights: the visitor picks the room (a select or radio field, its options mapped to Odoo's resources) and the arrival and departure dates (two date fields). Check-in and check-out times are set per form, 15:00 and 11:00 by default.
- Bookings are created as **requests**: the team confirms or refuses them in Odoo. Odoo emails the visitor nothing meanwhile; the form's own email acknowledges the request. No prices or payment.
- **Availability is checked when the visitor sends the form**: a room already requested or booked for one of the nights shows an error on the form, and nothing is sent. If Odoo can't be reached, the visitor is asked to try again later. Each send checks again, so a retried send never double-books a room (it fails for the team to handle instead).
- **Booked nights for a calendar**: a booking form gets a `data-fto-nights` attribute, the URL of `GET /wp-json/fto/v1/nights/{form}`. It returns the room and date field names and, per room option, the nights already booked or requested from today (`{"room": "room", "arrival": "arrival", "departure": "departure", "nights": {"The Blue Loft": ["2026-11-17", …]}}`): dates only, no booking details, cached a minute and refreshed after each request sent. A date picker can fetch it when the page loads and when the room changes, to grey those nights out. The plugin ships no calendar; the check when the form is sent still applies.
- To preselect the room from a room's own page, add `default:get` to the field and link to the form with the room in the URL: `[select* room default:get "The Yellow Loft" "The Blue Loft"]` and `/booking/?room=The+Blue+Loft`.
- The visitor is linked as an attendee through the **Contact** section (`partner_ids`).

**Marketing source (UTM)**
- Fills a lead's **Source**, **Medium** and **Campaign** from the `utm_source`, `utm_medium` and `utm_campaign` tags of the link the visitor arrived by, e.g. `?utm_source=newsletter&utm_medium=email&utm_campaign=spring`. The visitor can browse other pages before sending the form.
- Without tags, the website they came from can be used instead: Google, Bing… with medium `organic`, Facebook, LinkedIn… with `social`, any other site's domain with `referral`.
- Sources, mediums and campaigns are found in Odoo by name (ignoring case), and created when missing if you allow it. A field set in the mapping keeps its value.
- Available on models with these fields, such as CRM leads.

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

**UTM tags** are remembered for 90 days in the visitor's browser (`localStorage`, nothing is sent until a form is), and replaced by the next tagged link. The small script that does it (1 KB) only loads on the website when at least one form uses this option. If your site asks visitors for consent before tracking, hold it back with the `fto_utm_capture` filter (see below).

**Contact lookup:** the email is matched exactly (ignoring case) against the contacts' **Email** field, archived contacts excluded. If the submitted email is empty or invalid, the record is sent without a contact.

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

### Filter: `fto_utm_capture`

Return `false` to keep the UTM script off the website, e.g. until the visitor accepts marketing cookies:

```php
add_filter('fto_utm_capture', fn() => isset($_COOKIE['cookie_consent_marketing']));
```

### Actions

- `fto_sent` (`int $odoo_id, object $log_entry`): a record was created in Odoo.
- `fto_failed` (`object $log_entry, WP_Error $error`): a send failed and won't be retried automatically.

### Storage

| What | Where |
|---|---|
| Connection | options `fto_url`, `fto_db`, `fto_api_key` |
| Form settings | post meta `_fto_settings` on the Contact Form 7 form |
| Send log | table `{prefix}fto_log` |
| Whether any form uses UTM | option `fto_utm_enabled` |
| Visitor's UTM tags | `localStorage` key `fto_utm` in their browser, sent with a form as the hidden `_fto_utm` field |
| Odoo fields and records cache | transients, 1 h for fields and 10 min for records ("Refresh Odoo fields" clears them) |
| Scheduled jobs | `fto_retry` (every 5 min), `fto_cleanup` (daily) |

Uninstalling the plugin removes all of the above.

### Odoo API

The plugin uses the JSON-2 API (`POST /json/2/{model}/{method}`, bearer API key) with `fields_get`, `search_read`, `create` and `res.users.context_get`.

### Project structure

```
forms-to-odoo.php        bootstrap, activation, migration from the old mu-plugin
includes/client.php      Odoo API client, connection test, cached metadata, contact lookup
includes/submission.php  CF7 hook, mapping → values, templates, regex transforms
includes/log.php         log table, retries (WP-Cron), cleanup
includes/settings.php    Settings → Forms to Odoo page, failed sends notice
includes/form-panel.php  "Odoo" tab in the CF7 editor, settings sanitizing
includes/rest.php        REST API (fto/v1) behind both admin screens
includes/utm.php         marketing source: UTM settings, Odoo lookup, website script
includes/booking.php     booking requests: stay, availability check, Odoo values
src/settings/            settings page app (React, @wordpress/components)
src/form-panel/          "Odoo" tab app (React, @wordpress/components)
src/utm/                 website script remembering UTM tags (no dependencies)
build/                   compiled apps, committed so the plugin runs from git
uninstall.php
```

### REST API

Both admin screens talk to `fto/v1`: `settings`, `test` and `log` (with `log/{id}/resend`) need `manage_options`; `fields`, `records`, `test-send` and `preview` need the capability to edit Contact Form 7 forms.

### Development

The admin screens are React apps built with [`@wordpress/scripts`](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-scripts/) and the [WordPress components](https://wordpress.github.io/gutenberg/). WordPress packages are loaded from WordPress itself, not bundled.

```sh
npm install
npm run start    # rebuild on change
npm run build    # production build into build/, commit it
npm run lint:js
npm run env:start  # local WordPress with Contact Form 7 (wp-env, Docker)
```

Commit `build/` together with the `src/` changes that produced it.

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
- Record search for large relational lists
- French translation

## Credits

Built by [hellomarcel.be](https://hellomarcel.be).
