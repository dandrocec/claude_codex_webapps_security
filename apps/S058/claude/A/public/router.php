<?php

// Router for the PHP built-in web server.
// Serves existing static files (e.g. style.css) directly and sends everything
// else to the front controller.

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$file = __DIR__ . $path;

if ($path !== '/' && is_file($file)) {
    return false; // let the built-in server serve the static file
}

require __DIR__ . '/index.php';
