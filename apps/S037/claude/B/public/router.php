<?php

declare(strict_types=1);

/*
 * Router for the PHP built-in web server.
 *
 *   php -S 127.0.0.1:5037 -t public public/router.php
 *
 * Real, existing static files inside the public/ directory (e.g. the
 * stylesheet) are served directly; everything else is handled by the
 * front controller. Uploaded images live OUTSIDE public/ and are never
 * served by this branch — they are streamed through the app instead.
 */

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';

// Disallow direct execution of PHP files other than the front controller.
if (preg_match('#\.php$#i', $path) && $path !== '/index.php') {
    http_response_code(404);
    return true;
}

$candidate = realpath(__DIR__ . $path);
$publicDir = realpath(__DIR__);

if (
    $path !== '/'
    && $candidate !== false
    && is_file($candidate)
    && str_starts_with($candidate, $publicDir . DIRECTORY_SEPARATOR)
    && !preg_match('#\.php$#i', $candidate)
) {
    return false; // Let the built-in server serve the static asset.
}

require __DIR__ . '/index.php';
