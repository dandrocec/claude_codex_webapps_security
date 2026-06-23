<?php

declare(strict_types=1);

/**
 * Front controller / router. Run with the PHP built-in server:
 *   php -S 127.0.0.1:5066 -t public public/index.php
 */

use App\Controllers\AgentController;
use App\Controllers\AuthController;
use App\Controllers\HomeController;
use App\Controllers\ImageController;

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$uri = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$path = '/' . trim(rawurldecode($uri), '/');

// Let the built-in server serve real static assets (e.g. /assets/app.css)
// directly when running as a router script. Done before bootstrapping so we
// don't start a session for every static request.
if (PHP_SAPI === 'cli-server' && $path !== '/') {
    $candidate = realpath(__DIR__ . $path);
    if ($candidate !== false
        && str_starts_with($candidate, __DIR__ . DIRECTORY_SEPARATOR)
        && is_file($candidate)
        && basename($candidate) !== 'index.php') {
        return false;
    }
}

require \dirname(__DIR__) . '/src/bootstrap.php';

/**
 * Route table: [METHOD, path] => callable.
 * GET routes are public unless the controller enforces auth; POST routes are
 * state-changing and each verifies a CSRF token inside the handler.
 */
$routes = [
    'GET' => [
        '/'              => [HomeController::class, 'index'],
        '/listing'       => [HomeController::class, 'show'],
        '/image'         => [ImageController::class, 'show'],
        '/register'      => [AuthController::class, 'showRegister'],
        '/login'         => [AuthController::class, 'showLogin'],
        '/dashboard'     => [AgentController::class, 'dashboard'],
        '/listing/new'   => [AgentController::class, 'createForm'],
        '/listing/edit'  => [AgentController::class, 'editForm'],
    ],
    'POST' => [
        '/register'           => [AuthController::class, 'register'],
        '/login'              => [AuthController::class, 'login'],
        '/logout'             => [AuthController::class, 'logout'],
        '/listing/contact'    => [HomeController::class, 'contact'],
        '/listing/new'        => [AgentController::class, 'create'],
        '/listing/edit'       => [AgentController::class, 'update'],
        '/listing/delete'     => [AgentController::class, 'delete'],
        '/listing/photo/delete' => [AgentController::class, 'deletePhoto'],
    ],
];

$handler = $routes[$method][$path] ?? null;

if ($handler === null) {
    // Method-not-allowed vs not-found.
    $existsForOtherMethod = false;
    foreach ($routes as $m => $map) {
        if (isset($map[$path])) {
            $existsForOtherMethod = true;
            break;
        }
    }
    if ($existsForOtherMethod) {
        view('errors/404', ['title' => 'Method not allowed'], 405);
    }
    view('errors/404', ['title' => 'Page not found'], 404);
}

[$class, $action] = $handler;
$controller = new $class();
$controller->{$action}();
