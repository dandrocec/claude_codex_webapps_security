<?php
declare(strict_types=1);

/**
 * Router script for the PHP built-in web server.
 *   php -S 127.0.0.1:5058 router.php
 *
 * Serves real files from /public if they exist, otherwise hands the request
 * to the front controller.
 */

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
$file = __DIR__ . '/public' . $uri;

if ($uri !== '/' && is_file($file)) {
    return false; // Let the built-in server serve the static asset.
}

require __DIR__ . '/public/index.php';
