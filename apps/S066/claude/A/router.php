<?php

declare(strict_types=1);

/*
 * Router for the PHP built-in web server.
 *
 *   php -S 127.0.0.1:5066 -t public router.php
 *
 * Existing static files under public/ (CSS, uploaded photos) are served
 * directly; everything else is handled by the front controller.
 */

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$file = __DIR__ . '/public' . $path;

// Let the built-in server serve real static files as-is.
if ($path !== '/' && is_file($file)) {
    return false;
}

require __DIR__ . '/public/index.php';
