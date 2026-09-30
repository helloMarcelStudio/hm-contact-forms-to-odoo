<?php
/**
 * Send log: every submission is stored before it's sent to Odoo, so a
 * failed send is never lost. Temporary failures are retried by WP-Cron,
 * rejected ones wait for a manual "Resend" from the log screen.
 */
defined('ABSPATH') || exit;

// Delay before each retry, in minutes: after the 1st, 2nd, 3rd and 4th failure
const FTO_RETRY_DELAYS = [5, 30, 120, 720];
// The log holds submitted personal data, so it isn't kept forever
const FTO_LOG_RETENTION_DAYS = 90;

function fto_log_table() { global $wpdb; return $wpdb->prefix . 'fto_log'; }

function fto_install() {
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    dbDelta("CREATE TABLE " . fto_log_table() . " (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        form_id bigint(20) unsigned NOT NULL,
        form_title varchar(200) NOT NULL DEFAULT '',
        model varchar(100) NOT NULL,
        payload longtext NOT NULL,
        status varchar(10) NOT NULL,
        attempts tinyint(3) unsigned NOT NULL DEFAULT 0,
        odoo_id bigint(20) unsigned NULL,
        error text NULL,
        created_at datetime NOT NULL,
        updated_at datetime NOT NULL,
        next_attempt_at datetime NULL,
        PRIMARY KEY  (id),
        KEY status (status, next_attempt_at),
        KEY created_at (created_at)
    ) " . $wpdb->get_charset_collate() . ";");
    update_option('fto_db_version', FTO_DB_VERSION);
    fto_schedule_events();
}

/* ---------- Cron ---------- */
add_filter('cron_schedules', function ($schedules) {
    $schedules['fto_five_minutes'] = ['interval' => 5 * MINUTE_IN_SECONDS, 'display' => __('Every 5 minutes', 'forms-to-odoo')];
    return $schedules;
});

function fto_schedule_events() {
    if (!wp_next_scheduled('fto_retry')) wp_schedule_event(time() + 5 * MINUTE_IN_SECONDS, 'fto_five_minutes', 'fto_retry');
    if (!wp_next_scheduled('fto_cleanup')) wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', 'fto_cleanup');
}

add_action('fto_retry', function () {
    global $wpdb;
    $due = $wpdb->get_col(
        "SELECT id FROM " . fto_log_table() . "
         WHERE status = 'pending' AND next_attempt_at <= UTC_TIMESTAMP()
         ORDER BY next_attempt_at LIMIT 20"
    );
    foreach ($due as $id) fto_send_entry((int) $id);
});

add_action('fto_cleanup', function () {
    global $wpdb;
    $wpdb->query($wpdb->prepare(
        "DELETE FROM " . fto_log_table() . " WHERE created_at < UTC_TIMESTAMP() - INTERVAL %d DAY",
        FTO_LOG_RETENTION_DAYS
    ));
});

/* ---------- Entries ---------- */

// Stores a submission to send, returns its id. It's sent right away by the
// caller; the retry job only picks it up if that attempt never finished
// (e.g. PHP stopped mid-request), hence the first retry time.
function fto_log_add($form_id, $form_title, $model, array $values) {
    global $wpdb;
    $now = current_time('mysql', true);
    $wpdb->insert(fto_log_table(), [
        'form_id'         => $form_id,
        'form_title'      => mb_substr($form_title, 0, 200),
        'model'           => $model,
        'payload'         => wp_json_encode($values),
        'status'          => 'pending',
        'created_at'      => $now,
        'updated_at'      => $now,
        'next_attempt_at' => gmdate('Y-m-d H:i:s', time() + FTO_RETRY_DELAYS[0] * MINUTE_IN_SECONDS),
    ]);
    return (int) $wpdb->insert_id;
}

function fto_log_get($id) {
    global $wpdb;
    return $wpdb->get_row($wpdb->prepare("SELECT * FROM " . fto_log_table() . " WHERE id = %d", $id));
}

/**
 * Sends a logged entry to Odoo and records the outcome. On failure it's
 * either scheduled for a retry (temporary error, retries left) or marked
 * failed. Returns true when the record was created in Odoo.
 */
function fto_send_entry($id) {
    global $wpdb;
    $entry = fto_log_get($id);
    if (!$entry || $entry->status === 'sent') return false;

    $values = json_decode($entry->payload, true) ?: [];
    $result = fto_call($entry->model, 'create', ['vals_list' => [$values]]);
    $attempts = (int) $entry->attempts + 1;
    $now = current_time('mysql', true);

    if (!is_wp_error($result)) {
        $wpdb->update(fto_log_table(), [
            'status'          => 'sent',
            'attempts'        => $attempts,
            'odoo_id'         => (int) ($result[0] ?? 0) ?: null,
            'error'           => null,
            'updated_at'      => $now,
            'next_attempt_at' => null,
        ], ['id' => $id]);
        do_action('fto_sent', (int) ($result[0] ?? 0), $entry);
        return true;
    }

    $retry = fto_is_temporary_error($result) && isset(FTO_RETRY_DELAYS[$attempts - 1]);
    $wpdb->update(fto_log_table(), [
        'status'          => $retry ? 'pending' : 'failed',
        'attempts'        => $attempts,
        'error'           => $result->get_error_message(),
        'updated_at'      => $now,
        'next_attempt_at' => $retry ? gmdate('Y-m-d H:i:s', time() + FTO_RETRY_DELAYS[$attempts - 1] * MINUTE_IN_SECONDS) : null,
    ], ['id' => $id]);
    if (!$retry) do_action('fto_failed', $entry, $result);
    return false;
}

function fto_failed_count() {
    global $wpdb;
    return (int) $wpdb->get_var("SELECT COUNT(*) FROM " . fto_log_table() . " WHERE status = 'failed'");
}
