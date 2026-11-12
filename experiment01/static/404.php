<?php
// Sends the site's "Page not found" page (404.html) with the 404 status.
//
// GoDaddy replaces Apache's error pages with a bare "404 Not Found" line and
// ignores .htaccess's ErrorDocument, so .htaccess sends missing addresses here
// instead. Browsers and search engines still get "not found", not a normal page.
//
// 404.html pulls in the sections changed with the editor (admin/) through
// server-side includes, which Apache doesn't run on PHP's output, so they're
// filled in here: the edited version from edits/ if there is one, otherwise the
// built-in version that follows "#else".
http_response_code(404);
header('Content-Type: text/html; charset=UTF-8');
$page = file_get_contents(__DIR__ . '/404.html');
$page = str_replace('<!--#config errmsg="" -->', '', $page);
echo preg_replace_callback(
    '~<!--#if expr="[^"]*" --><!--#include virtual="[^"]*/edits/([a-z-]+)\.html" --><!--#else -->(.*?)<!--#endif -->~s',
    function ($m) {
        $file = __DIR__ . '/edits/' . $m[1] . '.html';
        return is_file($file) ? file_get_contents($file) : $m[2];
    },
    $page
);
