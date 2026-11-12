<?php
// Sends the site's "Page not found" page (404.html) with the 404 status.
//
// GoDaddy replaces Apache's error pages with a bare "404 Not Found" line and
// ignores .htaccess's ErrorDocument, so .htaccess sends missing addresses here
// instead. Browsers and search engines still get "not found", not a normal page.
http_response_code(404);
header('Content-Type: text/html; charset=UTF-8');
readfile(__DIR__ . '/404.html');
