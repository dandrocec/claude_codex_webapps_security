<?php

declare(strict_types=1);

/**
 * Router script for PHP's built-in web server.
 *
 *   php -S 0.0.0.0:5046 -t public public/router.php
 *
 * Serves existing static files (e.g. style.css) directly and routes
 * everything else through the front controller.
 */

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$file = __DIR__ . $path;

if ($path !== '/' && is_file($file)) {
    return false; // let the built-in server serve the static asset
}

require __DIR__ . '/index.php';
