<?php
/**
 * Settings → Forms to Odoo: connection (with a test) and the send log.
 */
defined('ABSPATH') || exit;

const FTO_LOG_PER_PAGE = 20;

function fto_admin_url($args = []) {
    return add_query_arg(array_merge(['page' => 'forms-to-odoo'], $args), admin_url('options-general.php'));
}

add_action('admin_menu', function () {
    add_options_page(__('Forms to Odoo', 'forms-to-odoo'), __('Forms to Odoo', 'forms-to-odoo'), 'manage_options', 'forms-to-odoo', 'fto_render_admin_page');
});

add_filter('plugin_action_links_' . plugin_basename(FTO_FILE), function ($links) {
    array_unshift($links, '<a href="' . esc_url(fto_admin_url()) . '">' . esc_html__('Settings', 'forms-to-odoo') . '</a>');
    return $links;
});

add_action('admin_init', function () {
    register_setting('fto_connection', 'fto_url', ['sanitize_callback' => fn($v) => untrailingslashit(esc_url_raw(trim((string) $v))), 'default' => '']);
    register_setting('fto_connection', 'fto_db', ['sanitize_callback' => 'sanitize_text_field', 'default' => '']);
    register_setting('fto_connection', 'fto_api_key', [
        'sanitize_callback' => function ($submitted) {
            // blank on save = keep the stored key, so saving the other
            // fields doesn't wipe it
            $submitted = trim((string) $submitted);
            return $submitted === '' ? get_option('fto_api_key', '') : $submitted;
        },
        'default' => '',
    ]);
});

// The connection changed: cached Odoo fields and records may be stale
foreach (['url', 'db', 'api_key'] as $fto_key) {
    add_action("update_option_fto_$fto_key", 'fto_flush_cache');
}
unset($fto_key);

function fto_flush_cache() {
    global $wpdb;
    $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '\\_transient\\_fto\\_%' OR option_name LIKE '\\_transient\\_timeout\\_fto\\_%'");
}

/* ---------- Actions ---------- */
add_action('admin_post_fto_test', function () {
    if (!current_user_can('manage_options')) wp_die(esc_html__('Not allowed', 'forms-to-odoo'));
    check_admin_referer('fto_test');
    $result = fto_test_connection();
    // shown once on the next page load
    set_transient('fto_test_result_' . get_current_user_id(), is_wp_error($result) ? ['error' => $result->get_error_message()] : $result, MINUTE_IN_SECONDS);
    wp_safe_redirect(fto_admin_url());
    exit;
});

add_action('admin_post_fto_resend', function () {
    global $wpdb;
    if (!current_user_can('manage_options')) wp_die(esc_html__('Not allowed', 'forms-to-odoo'));
    $id = (int) ($_POST['id'] ?? 0);
    check_admin_referer('fto_resend_' . $id);
    // a manual resend starts a fresh series of automatic retries
    $wpdb->update(fto_log_table(), ['attempts' => 0, 'status' => 'pending'], ['id' => $id, 'status' => 'failed']);
    $wpdb->update(fto_log_table(), ['attempts' => 0], ['id' => $id, 'status' => 'pending']);
    $ok = fto_send_entry($id);
    wp_safe_redirect(fto_admin_url(['tab' => 'log', 'fto_notice' => $ok ? 'resent' : 'resend_failed']));
    exit;
});

/* ---------- Failed sends notice (whole admin) ---------- */
add_action('admin_notices', function () {
    if (!current_user_can('manage_options') || (($_GET['page'] ?? '') === 'forms-to-odoo' && ($_GET['tab'] ?? '') === 'log')) return;
    $failed = fto_failed_count();
    if (!$failed) return;
    printf(
        '<div class="notice notice-error"><p><strong>%s</strong> %s <a href="%s">%s</a></p></div>',
        esc_html__('Forms to Odoo:', 'forms-to-odoo'),
        esc_html(sprintf(_n('%d form submission couldn\'t be sent to Odoo.', '%d form submissions couldn\'t be sent to Odoo.', $failed, 'forms-to-odoo'), $failed)),
        esc_url(fto_admin_url(['tab' => 'log', 'status' => 'failed'])),
        esc_html__('Review and resend', 'forms-to-odoo')
    );
});

/* ---------- Page ---------- */
function fto_render_admin_page() {
    if (!current_user_can('manage_options')) return;
    $tab = ($_GET['tab'] ?? '') === 'log' ? 'log' : 'connection';
    $failed = fto_failed_count();
    ?>
    <div class="wrap">
        <h1><?php esc_html_e('Forms to Odoo', 'forms-to-odoo'); ?></h1>
        <nav class="nav-tab-wrapper">
            <a href="<?php echo esc_url(fto_admin_url()); ?>" class="nav-tab <?php echo $tab === 'connection' ? 'nav-tab-active' : ''; ?>"><?php esc_html_e('Connection', 'forms-to-odoo'); ?></a>
            <a href="<?php echo esc_url(fto_admin_url(['tab' => 'log'])); ?>" class="nav-tab <?php echo $tab === 'log' ? 'nav-tab-active' : ''; ?>">
                <?php esc_html_e('Log', 'forms-to-odoo'); ?>
                <?php if ($failed): ?><span class="awaiting-mod count-<?php echo (int) $failed; ?>"><span class="pending-count"><?php echo (int) $failed; ?></span></span><?php endif; ?>
            </a>
        </nav>
        <?php $tab === 'log' ? fto_render_log_tab() : fto_render_connection_tab(); ?>
    </div>
    <?php
}

function fto_render_connection_tab() {
    $test = get_transient('fto_test_result_' . get_current_user_id());
    if ($test) delete_transient('fto_test_result_' . get_current_user_id());
    $constant_hint = fn($key) => defined('FTO_ODOO_' . strtoupper($key)) || defined('ODOO_' . strtoupper($key))
        ? __('Set in wp-config.php', 'forms-to-odoo') : '';
    ?>
    <?php if ($test && isset($test['error'])): ?>
        <div class="notice notice-error"><p><strong><?php esc_html_e('Connection failed:', 'forms-to-odoo'); ?></strong> <?php echo esc_html($test['error']); ?></p></div>
    <?php elseif ($test): ?>
        <div class="notice notice-success"><p>
            <?php echo esc_html(sprintf(
                /* translators: 1: Odoo user name, 2: login, 3: Odoo version */
                __('Connected as %1$s (%2$s) to Odoo %3$s.', 'forms-to-odoo'),
                $test['user'], $test['login'], $test['version'] ?: __('(version unknown)', 'forms-to-odoo')
            )); ?>
        </p></div>
    <?php endif; ?>

    <form method="post" action="options.php">
        <?php settings_fields('fto_connection'); ?>
        <table class="form-table" role="presentation">
            <tr>
                <th scope="row"><label for="fto_url"><?php esc_html_e('Odoo URL', 'forms-to-odoo'); ?></label></th>
                <td>
                    <input type="url" id="fto_url" name="fto_url" class="regular-text" value="<?php echo esc_attr(get_option('fto_url', '')); ?>" placeholder="<?php echo esc_attr($constant_hint('url') ?: 'https://mycompany.odoo.com'); ?>">
                </td>
            </tr>
            <tr>
                <th scope="row"><label for="fto_db"><?php esc_html_e('Database', 'forms-to-odoo'); ?></label></th>
                <td>
                    <input type="text" id="fto_db" name="fto_db" class="regular-text" value="<?php echo esc_attr(get_option('fto_db', '')); ?>" placeholder="<?php echo esc_attr($constant_hint('db')); ?>">
                    <p class="description"><?php esc_html_e('Only needed when your Odoo server hosts several databases.', 'forms-to-odoo'); ?></p>
                </td>
            </tr>
            <tr>
                <th scope="row"><label for="fto_api_key"><?php esc_html_e('API key', 'forms-to-odoo'); ?></label></th>
                <td>
                    <input type="password" id="fto_api_key" name="fto_api_key" class="regular-text" value="" autocomplete="new-password"
                           placeholder="<?php echo esc_attr(get_option('fto_api_key', '') !== '' ? __('•••••••• (leave blank to keep the current key)', 'forms-to-odoo') : $constant_hint('api_key')); ?>">
                    <p class="description"><?php esc_html_e('Created in Odoo under your user\'s Preferences → Account Security → New API Key. Never displayed once saved. Records are created with that user\'s access rights.', 'forms-to-odoo'); ?></p>
                </td>
            </tr>
        </table>
        <?php submit_button(); ?>
    </form>

    <hr>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
        <input type="hidden" name="action" value="fto_test">
        <?php wp_nonce_field('fto_test'); ?>
        <?php submit_button(__('Test connection', 'forms-to-odoo'), 'secondary', 'submit', false, fto_is_configured() ? [] : ['disabled' => 'disabled']); ?>
        <span class="description">&nbsp;<?php esc_html_e('Save your changes first. Requires Odoo 19 or later (JSON-2 API).', 'forms-to-odoo'); ?></span>
    </form>
    <p>
        <?php esc_html_e('Forms are connected one by one: edit a form in Contact → Contact Forms and open its "Odoo" tab.', 'forms-to-odoo'); ?>
    </p>
    <?php
}

function fto_render_log_tab() {
    global $wpdb;
    $table = fto_log_table();
    $statuses = [
        ''        => __('All', 'forms-to-odoo'),
        'failed'  => __('Failed', 'forms-to-odoo'),
        'pending' => __('Retrying', 'forms-to-odoo'),
        'sent'    => __('Sent', 'forms-to-odoo'),
    ];
    $status = sanitize_key($_GET['status'] ?? '');
    if (!isset($statuses[$status])) $status = '';
    $paged = max(1, (int) ($_GET['paged'] ?? 1));
    $where = $status ? $wpdb->prepare('WHERE status = %s', $status) : '';

    $counts = $wpdb->get_results("SELECT status, COUNT(*) AS n FROM $table GROUP BY status", OBJECT_K);
    $total = (int) $wpdb->get_var("SELECT COUNT(*) FROM $table $where");
    $rows = $wpdb->get_results($wpdb->prepare(
        "SELECT * FROM $table $where ORDER BY id DESC LIMIT %d OFFSET %d",
        FTO_LOG_PER_PAGE, ($paged - 1) * FTO_LOG_PER_PAGE
    ));
    $notice = $_GET['fto_notice'] ?? '';
    $badge = [
        'sent'    => ['#00a32a', __('Sent', 'forms-to-odoo')],
        'pending' => ['#dba617', __('Retrying', 'forms-to-odoo')],
        'failed'  => ['#d63638', __('Failed', 'forms-to-odoo')],
    ];
    $local = fn($utc) => $utc ? wp_date(get_option('date_format') . ' ' . get_option('time_format'), strtotime($utc . ' UTC')) : '';
    ?>
    <?php if ($notice === 'resent'): ?>
        <div class="notice notice-success is-dismissible"><p><?php esc_html_e('Sent to Odoo.', 'forms-to-odoo'); ?></p></div>
    <?php elseif ($notice === 'resend_failed'): ?>
        <div class="notice notice-error is-dismissible"><p><?php esc_html_e('Still couldn\'t be sent, see the error below.', 'forms-to-odoo'); ?></p></div>
    <?php endif; ?>

    <style>
        .fto-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; color: #fff; font-size: 12px; }
        .fto-log pre { white-space: pre-wrap; max-height: 260px; overflow: auto; background: #f6f7f7; padding: 8px; margin: 6px 0 0; }
        .fto-log td { vertical-align: top; }
        .fto-log .fto-error { color: #d63638; }
    </style>

    <ul class="subsubsub" style="float:none">
        <?php $i = 0; foreach ($statuses as $key => $label): ?>
            <li>
                <?php echo $i++ ? '| ' : ''; ?>
                <a href="<?php echo esc_url(fto_admin_url(['tab' => 'log', 'status' => $key ?: false])); ?>" <?php echo $status === $key ? 'class="current"' : ''; ?>>
                    <?php echo esc_html($label); ?>
                    <span class="count">(<?php echo (int) ($key ? ($counts[$key]->n ?? 0) : array_sum(array_map(fn($c) => $c->n, $counts))); ?>)</span>
                </a>
            </li>
        <?php endforeach; ?>
    </ul>

    <table class="widefat striped fto-log">
        <thead>
            <tr>
                <th><?php esc_html_e('Date', 'forms-to-odoo'); ?></th>
                <th><?php esc_html_e('Form', 'forms-to-odoo'); ?></th>
                <th><?php esc_html_e('Status', 'forms-to-odoo'); ?></th>
                <th><?php esc_html_e('Odoo record', 'forms-to-odoo'); ?></th>
                <th style="width:40%"><?php esc_html_e('Details', 'forms-to-odoo'); ?></th>
                <th></th>
            </tr>
        </thead>
        <tbody>
            <?php if (!$rows): ?>
                <tr><td colspan="6"><?php esc_html_e('Nothing sent yet.', 'forms-to-odoo'); ?></td></tr>
            <?php endif; ?>
            <?php foreach ($rows as $r): ?>
                <tr>
                    <td><?php echo esc_html($local($r->created_at)); ?></td>
                    <td>
                        <a href="<?php echo esc_url(admin_url('admin.php?page=wpcf7&post=' . (int) $r->form_id . '&action=edit')); ?>"><?php echo esc_html($r->form_title); ?></a>
                        <br><code><?php echo esc_html($r->model); ?></code>
                    </td>
                    <td>
                        <span class="fto-badge" style="background:<?php echo esc_attr($badge[$r->status][0] ?? '#8c8f94'); ?>"><?php echo esc_html($badge[$r->status][1] ?? $r->status); ?></span>
                        <br><small>
                            <?php echo esc_html(sprintf(_n('%d attempt', '%d attempts', (int) $r->attempts, 'forms-to-odoo'), (int) $r->attempts)); ?>
                            <?php if ($r->status === 'pending' && $r->next_attempt_at): ?>
                                <br><?php echo esc_html(sprintf(__('next: %s', 'forms-to-odoo'), $local($r->next_attempt_at))); ?>
                            <?php endif; ?>
                        </small>
                    </td>
                    <td>
                        <?php if ($r->odoo_id): ?>
                            <a href="<?php echo esc_url(fto_record_url($r->model, (int) $r->odoo_id)); ?>" target="_blank">#<?php echo (int) $r->odoo_id; ?></a>
                        <?php else: ?>–<?php endif; ?>
                    </td>
                    <td>
                        <?php if ($r->error): ?><div class="fto-error"><?php echo esc_html($r->error); ?></div><?php endif; ?>
                        <details>
                            <summary><?php esc_html_e('Sent values', 'forms-to-odoo'); ?></summary>
                            <pre><?php echo esc_html(wp_json_encode(json_decode($r->payload), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)); ?></pre>
                        </details>
                    </td>
                    <td>
                        <?php if ($r->status !== 'sent'): ?>
                            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                                <input type="hidden" name="action" value="fto_resend">
                                <input type="hidden" name="id" value="<?php echo (int) $r->id; ?>">
                                <?php wp_nonce_field('fto_resend_' . $r->id); ?>
                                <?php submit_button(__('Resend now', 'forms-to-odoo'), 'small', 'submit', false); ?>
                            </form>
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; ?>
        </tbody>
    </table>

    <?php
    $links = paginate_links([
        'base'    => add_query_arg('paged', '%#%', remove_query_arg('fto_notice')),
        'format'  => '',
        'current' => $paged,
        'total'   => max(1, (int) ceil($total / FTO_LOG_PER_PAGE)),
    ]);
    if ($links) echo '<div class="tablenav"><div class="tablenav-pages">' . $links . '</div></div>';
    ?>
    <p class="description">
        <?php echo esc_html(sprintf(
            __('Sends that fail because Odoo can\'t be reached are retried automatically after 5 min, 30 min, 2 h and 12 h. Entries are deleted after %d days, as they contain submitted personal data.', 'forms-to-odoo'),
            FTO_LOG_RETENTION_DAYS
        )); ?>
    </p>
    <?php
}
