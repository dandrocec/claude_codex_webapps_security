<?php
declare(strict_types=1);

/**
 * Front controller. Also acts as the router script for PHP's built-in server:
 * existing static files (uploaded photos, CSS) are served directly.
 */

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

// When run via `php -S`, let the built-in server serve real files itself.
if (PHP_SAPI === 'cli-server') {
    $file = __DIR__ . $uri;
    if ($uri !== '/' && is_file($file)) {
        return false;
    }
}

require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/controllers/listings.php';
require dirname(__DIR__) . '/src/controllers/account.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path   = rtrim($uri, '/') ?: '/';

/*
 * Routing table: [METHOD, path] => handler.
 */
$routes = [
    'GET /'             => 'home',
    'GET /item'         => 'show_listing',
    'GET /search'       => 'home',          // search is the home view with ?q=
    'GET /register'     => 'register_form',
    'POST /register'    => 'register_submit',
    'GET /login'        => 'login_form',
    'POST /login'       => 'login_submit',
    'POST /logout'      => 'logout',
    'GET /sell'         => 'create_form',
    'POST /sell'        => 'create_submit',
    'GET /my-listings'  => 'my_listings',
    'GET /edit'         => 'edit_form',
    'POST /edit'        => 'edit_submit',
    'POST /delete'      => 'delete_submit',
];

$key = $method . ' ' . $path;

if (isset($routes[$key])) {
    ($routes[$key])();
} else {
    http_response_code(404);
    view('error', ['message' => 'The page you requested was not found.'], 'Not found');
}
