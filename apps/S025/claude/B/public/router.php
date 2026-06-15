<?php

declare(strict_types=1);

/*
 * Router for the PHP built-in web server.
 *   php -S 127.0.0.1:5025 -t public public/router.php
 *
 * Existing static files (e.g. /assets/style.css) are served directly;
 * everything else is dispatched to the front controller.
 */

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$file = __DIR__ . $path;

if ($path !== '/' && is_file($file)) {
    return false; // let the built-in server serve the static file
}

require __DIR__ . '/index.php';
