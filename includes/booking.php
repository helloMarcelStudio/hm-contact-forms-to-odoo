<?php
/**
 * Booking requests: a form that creates an Odoo Appointments booking
 * (calendar.event) for a room over one or more nights, e.g. "The Blue Loft,
 * from Friday 15:00 to Sunday 11:00". The visitor picks the room and the
 * dates; the booking is created as a request for the team to confirm.
 *
 * Odoo's own booking page only offers slots within a day, so availability
 * is checked here: when the visitor sends the form (an error if a night is
 * taken, or "try again later" if Odoo can't be reached), and again before
 * each send, so a retried send never double-books a room.
 */
defined('ABSPATH') || exit;

const FTO_BOOKING_MODEL = 'calendar.event';
// Filled from the booking settings, not the mapping
const FTO_BOOKING_FIELDS = ['start', 'stop', 'appointment_type_id', 'booking_line_ids', 'appointment_status'];
const FTO_BOOKING_MAX_NIGHTS = 60;

/**
 * A form's booking settings: 'type_id' (appointment.type), 'room_tag' (the
 * form field with the room) and 'room_map' (its options => appointment.resource
 * ids), 'checkin_tag' and 'checkout_tag' (date fields), 'checkin_time' and
 * 'checkout_time' (HH:MM, in the site's timezone).
 */
function fto_booking_defaults() {
    return ['type_id' => 0, 'room_tag' => '', 'room_map' => [], 'checkin_tag' => '', 'checkout_tag' => '', 'checkin_time' => '15:00', 'checkout_time' => '11:00'];
}

function fto_sanitize_booking($booking) {
    $booking = wp_parse_args(is_array($booking) ? $booking : [], fto_booking_defaults());
    $tag = fn($v) => preg_replace('/[^A-Za-z0-9_:.-]/', '', (string) $v);
    $time = fn($v, $default) => preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string) $v) ? (string) $v : $default;
    $map = [];
    foreach ((array) $booking['room_map'] as $option => $id) {
        if ((int) $id) $map[sanitize_text_field((string) $option)] = (int) $id;
    }
    return [
        'type_id'       => (int) $booking['type_id'],
        'room_tag'      => $tag($booking['room_tag']),
        'room_map'      => $map,
        'checkin_tag'   => $tag($booking['checkin_tag']),
        'checkout_tag'  => $tag($booking['checkout_tag']),
        'checkin_time'  => $time($booking['checkin_time'], '15:00'),
        'checkout_time' => $time($booking['checkout_time'], '11:00'),
    ];
}

function fto_is_booking(array $settings) {
    return ($settings['model'] ?? '') === FTO_BOOKING_MODEL;
}

/**
 * The stay a submission asks for: ['type_id', 'resource_id', 'room' (the
 * option chosen), 'start', 'stop' (UTC, as Odoo stores them), 'nights',
 * 'arrival', 'departure' (Y-m-d)], a WP_Error to show the visitor (code
 * fto_booking_room or fto_booking_dates, for the field to flag), or null
 * when the form doesn't book.
 */
function fto_booking_for(array $settings, array $posted) {
    if (!fto_is_booking($settings)) return null;
    $b = wp_parse_args((array) ($settings['booking'] ?? []), fto_booking_defaults());

    $room = trim((string) (is_array($posted[$b['room_tag']] ?? null) ? reset($posted[$b['room_tag']]) : ($posted[$b['room_tag']] ?? '')));
    $resource = (int) ($b['room_map'][$room] ?? 0);
    if (!$resource) return new WP_Error('fto_booking_room', __('Please choose a room.', 'forms-to-odoo'));

    $tz = wp_timezone();
    $day = function ($tag) use ($posted, $tz) {
        $value = trim((string) ($posted[$tag] ?? ''));
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, $tz);
        return $date && $date->format('Y-m-d') === $value ? $date : null;
    };
    $arrival = $day($b['checkin_tag']);
    $departure = $day($b['checkout_tag']);
    if (!$arrival || !$departure) return new WP_Error('fto_booking_dates', __('Please choose your arrival and departure dates.', 'forms-to-odoo'));

    $nights = (int) $arrival->diff($departure)->format('%r%a');
    if ($nights < 1) return new WP_Error('fto_booking_dates', __('The departure must be at least one night after the arrival.', 'forms-to-odoo'));
    if ($nights > FTO_BOOKING_MAX_NIGHTS) return new WP_Error('fto_booking_dates', sprintf(__('Stays are limited to %d nights.', 'forms-to-odoo'), FTO_BOOKING_MAX_NIGHTS));
    if ($arrival < new DateTimeImmutable('today', $tz)) return new WP_Error('fto_booking_dates', __('The arrival date is in the past.', 'forms-to-odoo'));

    $at = function (DateTimeImmutable $date, $time) {
        [$h, $m] = array_map('intval', explode(':', $time));
        return $date->setTime($h, $m)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    };
    return [
        'type_id'     => (int) $b['type_id'],
        'resource_id' => $resource,
        'room'        => $room,
        'start'       => $at($arrival, $b['checkin_time']),
        'stop'        => $at($departure, $b['checkout_time']),
        'nights'      => $nights,
        'arrival'     => $arrival->format('Y-m-d'),
        'departure'   => $departure->format('Y-m-d'),
    ];
}

/**
 * Whether the room already has a booking (or a request) during the stay:
 * true, false, or a WP_Error when Odoo can't tell. Cancelled bookings are
 * archived in Odoo, so they don't count.
 */
function fto_booking_taken(array $booking) {
    $found = fto_call('appointment.booking.line', 'search_read', [
        'domain' => [
            ['appointment_resource_id', '=', $booking['resource_id']],
            ['event_start', '<', $booking['stop']],
            ['event_stop', '>', $booking['start']],
            ['calendar_event_id.active', '=', true],
        ],
        'fields' => ['id'],
        'limit'  => 1,
    ]);
    return is_wp_error($found) ? $found : (bool) $found;
}

/**
 * Odoo values for the stay: dates, appointment type, the room as a booking
 * line, and the "request" status when this Odoo has it, so the team
 * confirms each booking.
 */
function fto_booking_values(array $booking) {
    $values = [
        'start'               => $booking['start'],
        'stop'                => $booking['stop'],
        'appointment_type_id' => $booking['type_id'],
        // Command.create
        'booking_line_ids'    => [[0, 0, ['appointment_resource_id' => $booking['resource_id'], 'capacity_reserved' => 1]]],
    ];
    $fields = fto_model_fields(FTO_BOOKING_MODEL);
    if (!is_wp_error($fields) && in_array('request', array_column($fields['appointment_status']['selection'] ?? [], 0), true)) {
        $values['appointment_status'] = 'request';
    }
    return $values;
}

/* ---------- Booked nights, for the form's calendar ---------- */

// How far ahead the calendar shows booked nights, and how long they're kept
const FTO_BOOKING_CALENDAR_DAYS = 400;
const FTO_BOOKING_CALENDAR_CACHE = MINUTE_IN_SECONDS;

/**
 * Nights already booked (or requested) per room of a booking form, from
 * today: [room option => ['2026-11-02', …]], a night being the date of its
 * evening, as the visitor picks it. A night counts when a booking overlaps
 * it, from check-in time to check-out time the next day. Only dates: no
 * names or details of who booked.
 */
function fto_booked_nights($form_id) {
    $settings = fto_form_settings($form_id);
    if (!$settings['enabled'] || !fto_is_booking($settings)) return [];
    $b = wp_parse_args((array) $settings['booking'], fto_booking_defaults());
    if (!$b['room_map']) return [];

    $cache_key = 'fto_nights_' . md5(fto_config('url') . $form_id);
    if (is_array($cached = get_transient($cache_key))) return $cached;

    $tz = wp_timezone();
    $utc = new DateTimeZone('UTC');
    $today = new DateTimeImmutable('today', $tz);
    $lines = fto_call('appointment.booking.line', 'search_read', [
        'domain' => [
            ['appointment_resource_id', 'in', array_values(array_unique($b['room_map']))],
            ['event_stop', '>', $today->setTimezone($utc)->format('Y-m-d H:i:s')],
            ['event_start', '<', $today->modify('+' . FTO_BOOKING_CALENDAR_DAYS . ' days')->setTimezone($utc)->format('Y-m-d H:i:s')],
            ['calendar_event_id.active', '=', true],
        ],
        'fields' => ['appointment_resource_id', 'event_start', 'event_stop'],
        'limit'  => 5000,
    ]);
    if (is_wp_error($lines)) return $lines;

    $at = function (DateTimeImmutable $day, $time) {
        [$h, $m] = array_map('intval', explode(':', $time));
        return $day->setTime($h, $m);
    };
    $by_room = [];
    foreach ($lines as $line) {
        $room = (int) (is_array($line['appointment_resource_id']) ? $line['appointment_resource_id'][0] : $line['appointment_resource_id']);
        $start = new DateTimeImmutable($line['event_start'], $utc);
        $stop = new DateTimeImmutable($line['event_stop'], $utc);
        // from the night before the start, in case it ends after check-in
        for ($night = $start->setTimezone($tz)->setTime(0, 0)->modify('-1 day'); $night < $stop->setTimezone($tz); $night = $night->modify('+1 day')) {
            if ($night < $today) continue;
            if ($start < $at($night->modify('+1 day'), $b['checkout_time']) && $stop > $at($night, $b['checkin_time'])) {
                $by_room[$room][$night->format('Y-m-d')] = true;
            }
        }
    }

    $nights = [];
    foreach ($b['room_map'] as $option => $room) {
        $dates = array_keys($by_room[$room] ?? []);
        sort($dates);
        $nights[$option] = $dates;
    }
    set_transient($cache_key, $nights, FTO_BOOKING_CALENDAR_CACHE);
    return $nights;
}

// A booking request was just made: its nights are no longer free
function fto_forget_booked_nights($form_id) {
    delete_transient('fto_nights_' . md5(fto_config('url') . $form_id));
}

/**
 * Tells the page where to find the booked nights of a booking form, for
 * a calendar to grey them out (the theme's date picker reads it):
 * data-fto-nights on the form, the URL of fto/v1/nights/{form}, which
 * returns ['room' (field name), 'arrival', 'departure' (date field
 * names), 'nights' => fto_booked_nights()].
 */
add_filter('wpcf7_form_additional_atts', function ($atts) {
    $contact_form = WPCF7_ContactForm::get_current();
    if (!$contact_form) return $atts;
    $settings = fto_form_settings($contact_form->id());
    if ($settings['enabled'] && fto_is_booking($settings) && $settings['booking']['room_map']) {
        $atts['data-fto-nights'] = rest_url('fto/v1/nights/' . $contact_form->id());
    }
    return $atts;
});

add_action('rest_api_init', function () {
    // public: the form's visitors read it; only dates, no booking details
    register_rest_route('fto/v1', '/nights/(?P<form>\d+)', [
        'methods'             => 'GET',
        'permission_callback' => '__return_true',
        'callback'            => function (WP_REST_Request $request) {
            $form_id = (int) $request['form'];
            $settings = fto_form_settings($form_id);
            if (!$settings['enabled'] || !fto_is_booking($settings)) {
                return new WP_Error('fto_not_booking', __('This form doesn\'t take bookings.', 'forms-to-odoo'), ['status' => 404]);
            }
            $nights = fto_booked_nights($form_id);
            if (is_wp_error($nights)) {
                // the visitor can still send the form: it's checked then
                return new WP_Error('fto_unavailable', __('We can\'t check the availability right now.', 'forms-to-odoo'), ['status' => 503]);
            }
            $response = rest_ensure_response([
                'room'      => $settings['booking']['room_tag'],
                'arrival'   => $settings['booking']['checkin_tag'],
                'departure' => $settings['booking']['checkout_tag'],
                'nights'    => (object) $nights,
            ]);
            $response->header('Cache-Control', 'no-store');
            return $response;
        },
    ]);
});

/* ---------- Check when the visitor sends the form ---------- */

/**
 * Refuses a booking whose room is taken for one of the nights, or that
 * can't be checked because Odoo doesn't answer, before CF7 sends anything.
 */
add_filter('wpcf7_validate', function ($result, $tags) {
    if (!$result->is_valid()) return $result;
    $contact_form = WPCF7_ContactForm::get_current();
    $submission = WPCF7_Submission::get_instance();
    if (!$contact_form || !$submission) return $result;
    $settings = fto_form_settings($contact_form->id());
    if (!$settings['enabled'] || !fto_is_booking($settings)) return $result;

    $b = $settings['booking'];
    $tag = function ($name) use ($tags) {
        foreach ($tags as $t) if ($t->name === $name) return $t;
        return null;
    };
    $flag = function ($name, $message) use ($result, $tag, $tags) {
        // on the field concerned, else on the first one so the visitor sees it
        $t = $tag($name) ?: ($tags[0] ?? null);
        if ($t) $result->invalidate($t, $message);
        return $result;
    };

    $booking = fto_booking_for($settings, $submission->get_posted_data());
    if (is_wp_error($booking)) {
        return $flag($booking->get_error_code() === 'fto_booking_room' ? $b['room_tag'] : $b['checkin_tag'], $booking->get_error_message());
    }

    $taken = fto_booking_taken($booking);
    if (is_wp_error($taken)) {
        return $flag($b['checkin_tag'], __('We can\'t check the availability right now. Please try again later.', 'forms-to-odoo'));
    }
    if ($taken) {
        return $flag($b['checkin_tag'], sprintf(
            /* translators: %s: room name */
            __('%s is already booked for some of these nights. Please choose other dates or another room.', 'forms-to-odoo'),
            $booking['room']
        ));
    }
    return $result;
}, 20, 2);
