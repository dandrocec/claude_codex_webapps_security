<?php
declare(strict_types=1);

/**
 * Front controller. All requests are dispatched from here.
 */

require_once dirname(__DIR__) . '/src/bootstrap.php';
require_once dirname(__DIR__) . '/src/controllers.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = rtrim(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/', '/');
if ($path === '') {
    $path = '/';
}

$routes = [
    'GET'  => [
        '/'         => 'home_controller',
        '/board'    => 'board_controller',
        '/thread'   => 'thread_controller',
        '/login'    => 'login_form_controller',
        '/register' => 'register_form_controller',
    ],
    'POST' => [
        '/login'         => 'login_controller',
        '/logout'        => 'logout_controller',
        '/register'      => 'register_controller',
        '/threads'       => 'thread_create_controller',
        '/replies'       => 'reply_create_controller',
        '/posts/delete'  => 'post_delete_controller',
    ],
];

$handler = $routes[$method][$path] ?? null;

if ($handler === null) {
    // Distinguish 405 from 404 for known paths.
    $knownPath = false;
    foreach ($routes as $map) {
        if (isset($map[$path])) {
            $knownPath = true;
            break;
        }
    }
    abort($knownPath ? 405 : 404, $knownPath ? 'Method not allowed.' : 'Page not found.');
}

$handler();
