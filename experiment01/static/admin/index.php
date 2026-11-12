<?php
// The website editor: changes the announcement banner, the office hours and the
// after-hours note on every page. See README.md, "Editing the banner and hours".
//
// How it stays safe:
// - cPanel's Directory Privacy puts a password on this folder, with one login per
//   person. This page refuses to work unless Apache has checked one.
// - It changes only those three sections, as plain text with length limits.
//   Everything is escaped before it's saved, so nothing typed can become HTML,
//   a script or a server-side include.
// - Every form carries a secret token from the editor's session, so another
//   website can't submit changes on someone's behalf, and no other site can
//   show this page in a frame.
// - Each save is logged (who, when, from where), and any earlier version can be
//   brought back.
//
// Changed sections are saved as small HTML files in ../edits/, which the pages
// pull in with server-side includes. A section that matches its built-in
// version (defaults.json, written by build.js) has no file there, so the
// built-in version shows. The saved values and the history are in data/, which
// the web can't reach.

declare(strict_types=1);

require __DIR__ . '/render.php';

const MAX_TEXT = 300;   // the banner and the after-hours note
const MAX_LINE = 40;    // each "Days" or "Hours" box
const HOUR_LINES = 7;
const HISTORY_SHOWN = 15;
const HISTORY_KEPT = 500;
const SECTIONS = ['announcement' => 'Announcement banner', 'hours' => 'Office hours', 'afterHours' => 'After-hours note'];

date_default_timezone_set('America/New_York');

$SITE = dirname(__DIR__);
$EDITS = $SITE . '/edits';
$DATA = __DIR__ . '/data';
$defaults = json_decode((string) file_get_contents(__DIR__ . '/defaults.json'), true, 8, JSON_THROW_ON_ERROR);
$base = $defaults['base'];

header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
header("Content-Security-Policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

// ---------- Who's editing ----------

// Set by Apache only after it has checked the password. Never read from the
// request itself (PHP_AUTH_USER comes from a header anyone can send).
$user = (string) ($_SERVER['REMOTE_USER'] ?? $_SERVER['REDIRECT_REMOTE_USER'] ?? '');
if ($user === '' || !preg_match('/^[\w.@-]{1,64}$/', $user)) {
    page(403, 'The editor is locked', '<p>This page only works behind a password, and this folder doesn\'t have one yet.</p>
      <p>In cPanel, open <strong>Directory Privacy</strong>, go to this folder (<code>' . rfm_esc($base) . 'admin</code> inside <code>public_html</code>), choose
      <strong>Password protect this directory</strong>, save, and add a user for each person who edits.</p>');
}

$https = in_array(strtolower((string) ($_SERVER['HTTPS'] ?? '')), ['on', '1'], true);
session_name('rfm_editor');
session_set_cookie_params(['lifetime' => 0, 'path' => $base . 'admin/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Strict']);
ini_set('session.use_strict_mode', '1');
session_start();
if (($_SESSION['user'] ?? null) !== $user) {
    session_regenerate_id(true);
    $_SESSION = ['user' => $user, 'token' => bin2hex(random_bytes(32))];
}

// ---------- Saved state ----------

// data/current.json holds the sections changed here: section => ['value', 'by', 'at'].
// data/history.jsonl has one line per save: ['at', 'by', 'ip', 'changed', 'values'].

function prepare_folders(string $edits, string $data): void
{
    foreach ([$edits, $data] as $dir) {
        if (!is_dir($dir) && !mkdir($dir, 0755) && !is_dir($dir)) {
            throw new RuntimeException("Can't create the folder " . basename($dir) . '.');
        }
    }
    if (!is_file("$data/.htaccess")) {
        write_file("$data/.htaccess", "# The editor's saved values and history. Not for the web.\nRequire all denied\n");
    }
}

function write_file(string $path, string $content): void
{
    $tmp = dirname($path) . '/.tmp-' . bin2hex(random_bytes(6));
    if (file_put_contents($tmp, $content) === false || !rename($tmp, $path)) {
        @unlink($tmp);
        throw new RuntimeException("Can't save " . basename($path) . '.');
    }
    @chmod($path, 0644);
}

function read_current(string $data): array
{
    $file = "$data/current.json";
    return is_file($file) ? (json_decode((string) file_get_contents($file), true) ?: []) : [];
}

function read_history(string $data): array
{
    $file = "$data/history.jsonl";
    if (!is_file($file)) {
        return [];
    }
    $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
    return array_values(array_filter(array_map(fn($l) => json_decode($l, true), $lines)));
}

// What the website shows for each section now.
function shown_values(array $current, array $defaults): array
{
    $values = [];
    foreach (SECTIONS as $section => $_) {
        $values[$section] = $current[$section]['value'] ?? $defaults[$section];
    }
    return $values;
}

// Saves $values: sections that match their built-in version go back to it,
// the rest are written to edits/. Returns the sections that changed.
function save(array $values, string $user, string $edits, string $data, array $defaults): array
{
    prepare_folders($edits, $data);
    $lock = fopen("$data/lock", 'c');
    flock($lock, LOCK_EX);
    try {
        $current = read_current($data);
        $before = shown_values($current, $defaults);
        $changed = [];
        foreach (SECTIONS as $section => $_) {
            $value = $values[$section];
            if ($value !== $before[$section]) {
                $changed[] = $section;
            }
            if ($value === $defaults[$section]) {
                unset($current[$section]);
                foreach (rfm_section_files($section, $value, $defaults['practiceId']) as $name => $_html) {
                    @unlink("$edits/$name.html");
                }
            } else {
                if (!isset($current[$section]) || $current[$section]['value'] !== $value) {
                    $current[$section] = ['value' => $value, 'by' => $user, 'at' => time()];
                }
                foreach (rfm_section_files($section, $value, $defaults['practiceId']) as $name => $html) {
                    write_file("$edits/$name.html", $html);
                }
            }
        }
        write_file("$data/current.json", json_encode($current, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n");
        if ($changed) {
            $history = read_history($data);
            $history[] = ['at' => time(), 'by' => $user, 'ip' => $_SERVER['REMOTE_ADDR'] ?? '', 'changed' => $changed, 'values' => shown_values($current, $defaults)];
            $history = array_slice($history, -HISTORY_KEPT);
            write_file("$data/history.jsonl", implode("\n", array_map(fn($h) => json_encode($h, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), $history)) . "\n");
        }
        return $changed;
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

// ---------- Reading the form ----------

// Length in characters (not bytes), without needing PHP's mbstring.
function text_length(string $s): int
{
    return (int) preg_match_all('/./us', $s);
}

// One line of plain text: any run of spaces, line breaks, control or invisible
// formatting characters becomes a single space.
function clean($s): ?string
{
    if (!is_string($s)) {
        return '';
    }
    $s = preg_replace('/[\s\p{Z}\p{Cc}\p{Cf}]+/u', ' ', $s);
    return $s === null ? null : trim($s); // null: not valid UTF-8
}

function read_form(array $post, array &$errors): array
{
    $text = function (string $name, string $label) use ($post, &$errors): string {
        $s = clean($post[$name] ?? '');
        if ($s === null) {
            $errors[] = "$label: some characters couldn't be read. Please type it again.";
            return '';
        }
        if (text_length($s) > MAX_TEXT) {
            $errors[] = "$label: please keep it under " . MAX_TEXT . ' characters (it has ' . text_length($s) . ').';
        }
        return $s;
    };
    $values = ['announcement' => $text('announcement', 'Announcement banner'), 'hours' => [], 'afterHours' => $text('afterHours', 'After-hours note')];
    $daysIn = is_array($post['days'] ?? null) ? $post['days'] : [];
    $timeIn = is_array($post['time'] ?? null) ? $post['time'] : [];
    for ($i = 0; $i < HOUR_LINES; $i++) {
        $days = clean($daysIn[$i] ?? '') ?? '';
        $time = clean($timeIn[$i] ?? '') ?? '';
        if ($days === '' && $time === '') {
            continue;
        }
        $n = $i + 1;
        if ($days === '' || $time === '') {
            $errors[] = "Office hours, line $n: fill in both the days and the hours, or leave both empty.";
        }
        if (text_length($days) > MAX_LINE || text_length($time) > MAX_LINE) {
            $errors[] = "Office hours, line $n: please keep each box under " . MAX_LINE . ' characters.';
        }
        $values['hours'][] = ['days' => $days, 'time' => $time];
    }
    if (!$values['hours']) {
        $errors[] = 'Office hours: fill in at least one line.';
    }
    return $values;
}

// ---------- Handling the request ----------

$errors = [];
$notice = '';
$current = read_current($DATA);
$history = read_history($DATA);
$form = shown_values($current, $defaults);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
    $expected = ($https ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? '');
    if (!hash_equals($_SESSION['token'], (string) ($_POST['token'] ?? '')) || ($origin !== null && $origin !== $expected)) {
        page(400, 'Please try again', '<p>The editor couldn\'t confirm that this came from its own page, so nothing was saved. This can happen if the page was open for a long time.</p>
          <p><a class="button" href="' . rfm_esc($base) . 'admin/">Open the editor again</a></p>');
    }
    $action = (string) ($_POST['action'] ?? '');
    try {
        if ($action === 'save') {
            $form = read_form($_POST, $errors);
            if (!$errors) {
                $changed = save($form, $user, $EDITS, $DATA, $defaults);
                redirect($base . 'admin/?' . ($changed ? 'saved=' . implode(',', $changed) : 'unchanged=1'));
            }
        } elseif (preg_match('/^builtin-(announcement|hours|afterHours)$/', $action, $m)) {
            $values = shown_values($current, $defaults);
            $values[$m[1]] = $defaults[$m[1]];
            $changed = save($values, $user, $EDITS, $DATA, $defaults);
            redirect($base . 'admin/?' . ($changed ? 'saved=' . implode(',', $changed) : 'unchanged=1'));
        } else {
            page(400, 'Please try again', '<p>The editor didn\'t recognise that button.</p>');
        }
    } catch (Throwable $e) {
        error_log('Website editor: ' . $e->getMessage());
        $errors[] = 'Nothing was saved: ' . $e->getMessage() . ' Please try again, and tell whoever looks after the website if it keeps happening.';
    }
} elseif ($_SERVER['REQUEST_METHOD'] !== 'GET' && $_SERVER['REQUEST_METHOD'] !== 'HEAD') {
    page(405, 'Not allowed', '<p>The editor only takes its own form.</p>');
} elseif (isset($_GET['restore'])) {
    $i = filter_var($_GET['restore'], FILTER_VALIDATE_INT);
    if ($i !== false && isset($history[$i])) {
        $form = $history[$i]['values'];
        $notice = 'This is the version ' . rfm_esc($history[$i]['by']) . ' saved ' . rfm_esc(when($history[$i]['at'])) . '. Nothing has changed yet: check it, then choose <strong>Save changes</strong> to put it back on the website.';
    }
} elseif (isset($_GET['saved'])) {
    $labels = array_map(fn($s) => SECTIONS[$s] ?? null, explode(',', (string) $_GET['saved']));
    $labels = array_filter($labels);
    if ($labels) {
        $notice = 'Saved: ' . rfm_esc(implode(', ', $labels)) . '. The website shows the change now.';
    }
} elseif (isset($_GET['unchanged'])) {
    $notice = 'Nothing had changed, so nothing was saved.';
}

// Edits only reach the pages if Apache finds them at DOCUMENT_ROOT + base, as
// the pages' includes look for them there.
$lookIn = (string) ($_SERVER['DOCUMENT_ROOT'] ?? '') . $base;
$warning = realpath($lookIn) !== realpath($SITE)
    ? 'Changes may not show on the website: the pages look for them in <code>' . rfm_esc($lookIn) . 'edits</code>, but this editor saves them in <code>' . rfm_esc($SITE) . '/edits</code>.'
    : '';

// ---------- The page ----------

function when(int $time): string
{
    return date('M j, Y \a\t g:i a', $time);
}

function redirect(string $url): void
{
    header('Location: ' . $url, true, 303);
    exit;
}

function page(int $status, string $title, string $body, string $bar = ''): void
{
    global $base;
    http_response_code($status);
    echo '<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>' . rfm_esc($title) . ' | Website editor</title>
  <link rel="stylesheet" href="' . rfm_esc($base) . 'styles.css">
  <link rel="stylesheet" href="' . rfm_esc($base) . 'admin/admin.css">
</head>
<body class="editor-page">
  <header class="editor-bar">
    <div class="container editor-bar-inner">
      <p><strong>Website editor</strong> · Richmond Family Medicine</p>
      ' . $bar . '
    </div>
  </header>
  <main class="container editor">
    <h1>' . rfm_esc($title) . '</h1>
    ' . $body . '
  </main>
</body>
</html>
';
    exit;
}

function status_line(string $section, array $current): string
{
    if (!isset($current[$section])) {
        return '<p class="editor-status">The website shows the built-in version.</p>';
    }
    $c = $current[$section];
    return '<p class="editor-status is-changed">Changed here by ' . rfm_esc($c['by']) . ', ' . rfm_esc(when($c['at'])) . '.
      <button class="editor-link" type="submit" form="builtin-' . $section . '">Go back to the built-in version</button></p>';
}

function hours_text(array $hours): string
{
    return implode('; ', array_map(fn($h) => $h['days'] . ': ' . $h['time'], $hours));
}

$token = rfm_esc($_SESSION['token']);
$hourLines = '';
for ($i = 0; $i < HOUR_LINES; $i++) {
    $h = $form['hours'][$i] ?? ['days' => '', 'time' => ''];
    $n = $i + 1;
    $hourLines .= '<div class="hours-line">
          <input type="text" name="days[]" value="' . rfm_esc($h['days']) . '" maxlength="' . MAX_LINE . '" aria-label="Line ' . $n . ': days" placeholder="Days, e.g. Saturday">
          <input type="text" name="time[]" value="' . rfm_esc($h['time']) . '" maxlength="' . MAX_LINE . '" aria-label="Line ' . $n . ': hours" placeholder="Hours, e.g. 9:00 am – noon">
        </div>';
}

$historyRows = '';
foreach (array_slice(array_reverse($history, true), 0, HISTORY_SHOWN, true) as $i => $h) {
    $what = implode(', ', array_map(fn($s) => SECTIONS[$s] ?? $s, $h['changed']));
    $historyRows .= '<tr><td>' . rfm_esc(when($h['at'])) . '</td><td>' . rfm_esc($h['by']) . '</td><td>' . rfm_esc($what) . '</td>
        <td><a href="?restore=' . $i . '">Bring back</a></td></tr>';
}

$messages = ($warning ? '<p class="editor-message is-warning">' . $warning . '</p>' : '')
    . ($notice ? '<p class="editor-message">' . $notice . '</p>' : '')
    . ($errors ? '<div class="editor-message is-error"><p>Nothing was saved yet:</p><ul>' . implode('', array_map(fn($e) => '<li>' . rfm_esc($e) . '</li>', $errors)) . '</ul></div>' : '');

page($errors ? 422 : 200, 'Banner and hours', $messages . '
    <form method="post" class="editor-form">
      <input type="hidden" name="token" value="' . $token . '">
      <input type="hidden" name="action" value="save">

      <section class="card editor-section">
        <h2><label for="announcement">Announcement banner</label></h2>
        <p class="muted">Shown across the top of every page, e.g. "The office is closed Monday, January 1 for the holiday." Leave it empty for no banner. Web addresses starting with https:// become links.</p>
        ' . status_line('announcement', $current) . '
        <textarea id="announcement" name="announcement" rows="3" maxlength="' . MAX_TEXT . '">' . rfm_esc($form['announcement']) . '</textarea>
      </section>

      <section class="card editor-section">
        <h2>Office hours</h2>
        <p class="muted">Shown in the footer of every page, beside each page, and on the home and Contact Us pages. One line for each group of days, written like the examples, e.g. "Monday – Friday" and "8:00 am – 5:00 pm", or "Closed". Search engines read hours written that way. Leave unused lines empty.</p>
        ' . status_line('hours', $current) . '
        <div class="hours-line hours-head" aria-hidden="true"><span>Days</span><span>Hours</span></div>
        ' . $hourLines . '
      </section>

      <section class="card editor-section">
        <h2><label for="afterHours">After-hours note</label></h2>
        <p class="muted">Shown under the office hours beside each page, and on the home and Contact Us pages.</p>
        ' . status_line('afterHours', $current) . '
        <textarea id="afterHours" name="afterHours" rows="3" maxlength="' . MAX_TEXT . '">' . rfm_esc($form['afterHours']) . '</textarea>
      </section>

      <p class="editor-actions"><button class="button" type="submit">Save changes</button> <a class="button button-ghost" href="' . rfm_esc($base) . 'admin/">Undo unsaved changes</a></p>
    </form>
    ' . implode('', array_map(fn($s) => '<form method="post" id="builtin-' . $s . '"><input type="hidden" name="token" value="' . $token . '"><input type="hidden" name="action" value="builtin-' . $s . '"></form>', array_keys(SECTIONS))) . '

    <section class="editor-history">
      <h2>Recent changes</h2>
      ' . ($historyRows ? '<table><thead><tr><th>When</th><th>Who</th><th>What</th><th><span class="visually-hidden">Restore</span></th></tr></thead><tbody>' . $historyRows . '</tbody></table>'
        : '<p class="muted">Nothing has been changed here yet. Built-in hours: ' . rfm_esc(hours_text($defaults['hours'])) . '.</p>') . '
    </section>', '<p>Signed in as ' . rfm_esc($user) . ' · <a href="' . rfm_esc($base) . '">View the website</a></p>');
