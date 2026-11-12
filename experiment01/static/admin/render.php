<?php
// The HTML for each section the editor changes: what goes in each file in
// edits/. build.js writes the same HTML for the built-in versions (see
// "Sections edited at admin/" there), so change the two together.
//
// Hours are a list of ['days' => 'Monday – Friday', 'time' => '8:00 am – 5:00 pm'].

declare(strict_types=1);

// The same as build.js's esc(): escapes & < > and ".
function rfm_esc(string $s): string
{
    return htmlspecialchars($s, ENT_COMPAT | ENT_SUBSTITUTE, 'UTF-8');
}

// The banner across the top of every page. Web addresses starting with
// https:// become links.
function rfm_announcement(string $text): string
{
    if ($text === '') {
        return '';
    }
    $html = preg_replace_callback('~https://[^\s<>"]+~u', function (array $m): string {
        $url = rtrim($m[0], '.,;:!?)');
        return '<a href="' . $url . '">' . $url . '</a>' . substr($m[0], strlen($url));
    }, rfm_esc($text));
    return '<div class="announcement">' . $html . '</div>';
}

// The lines of every hours list (inside its <dl>).
function rfm_hours_rows(array $hours): string
{
    $html = '';
    foreach ($hours as $h) {
        $html .= '<div><dt>' . rfm_esc($h['days']) . '</dt><dd>' . rfm_esc($h['time']) . '</dd></div>';
    }
    return $html;
}

const RFM_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const RFM_COUNTS = ['', 'one day', 'two days', 'three days', 'four days', 'five days', 'six days', 'seven days'];

// "Open six days a week", counted from the lines that aren't "Closed". Days can
// be single ("Saturday"), ranges ("Monday – Friday") or lists ("Monday,
// Wednesday"). Anything else gives "Office hours".
function rfm_open_days_heading(array $hours): string
{
    $open = [];
    foreach ($hours as $h) {
        if (preg_match('/closed/i', $h['time'])) {
            continue;
        }
        foreach (preg_split('/\s*(?:,|&|\band\b)\s*/u', strtolower($h['days'])) as $part) {
            $ends = array_map(fn(string $d) => array_search(trim($d), RFM_DAYS, true), preg_split('/\s*[–-]\s*/u', $part));
            if (count($ends) > 2 || in_array(false, $ends, true)) {
                return 'Office hours';
            }
            $from = $ends[0];
            $to = $ends[1] ?? $from;
            for ($d = $from; ; $d = ($d + 1) % 7) {
                $open[$d] = true;
                if ($d === $to) {
                    break;
                }
            }
        }
    }
    return $open ? 'Open ' . RFM_COUNTS[count($open)] . ' a week' : 'Office hours';
}

// The home page card: "Open six days a week" and the days that are open.
function rfm_hours_summary(array $hours): string
{
    $html = '<strong>' . rfm_open_days_heading($hours) . '</strong>';
    foreach ($hours as $h) {
        if (!preg_match('/closed/i', $h['time'])) {
            $html .= '<span>' . rfm_esc($h['days']) . ' · ' . rfm_esc($h['time']) . '</span>';
        }
    }
    return $html;
}

// The hours for search engines, e.g. "Mo-Fr 08:00-17:00". Lines in another
// form are left out.
function rfm_opening_hours(array $hours): array
{
    $days = ['monday' => 'Mo', 'tuesday' => 'Tu', 'wednesday' => 'We', 'thursday' => 'Th', 'friday' => 'Fr', 'saturday' => 'Sa', 'sunday' => 'Su'];
    $to24 = function (?string $t): ?string {
        if ($t === null || !preg_match('/^(noon|(\d{1,2})(?::(\d\d))?\s*(am|pm))$/', strtolower(trim($t)), $m)) {
            return null;
        }
        if ($m[1] === 'noon') {
            return '12:00';
        }
        $hr = ((int) $m[2]) % 12 + ($m[4] === 'pm' ? 12 : 0);
        return sprintf('%02d:%s', $hr, $m[3] !== '' ? $m[3] : '00');
    };
    $list = [];
    foreach ($hours as $x) {
        $d = array_map(fn(string $s) => $days[trim($s)] ?? null, preg_split('/\s*[–-]\s*/u', strtolower($x['days'])));
        $times = preg_split('/\s+[–-]\s+/u', $x['time']);
        $from = $to24($times[0]);
        $to = $to24($times[1] ?? null);
        if (!in_array(null, $d, true) && $from && $to) {
            $list[] = implode('-', $d) . " $from-$to";
        }
    }
    return $list;
}

// The search engine block for the hours, attached to the practice's other
// details (on the home page) by $practiceId.
function rfm_hours_data(array $hours, string $practiceId): string
{
    $list = rfm_opening_hours($hours);
    if (!$list) {
        return '';
    }
    $json = json_encode(
        ['@context' => 'https://schema.org', '@id' => $practiceId, 'openingHours' => $list],
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
    );
    return '<script type="application/ld+json">' . str_replace('<', '<', $json) . '</script>';
}

// Every file in edits/ for one section, as name => HTML.
function rfm_section_files(string $section, $value, string $practiceId): array
{
    switch ($section) {
        case 'announcement':
            return ['announcement' => rfm_announcement($value)];
        case 'hours':
            return [
                'hours' => rfm_hours_rows($value),
                'hours-summary' => rfm_hours_summary($value),
                'hours-data' => rfm_hours_data($value, $practiceId),
            ];
        case 'afterHours':
            return ['after-hours' => rfm_esc($value)];
    }
    throw new InvalidArgumentException("Unknown section $section");
}
