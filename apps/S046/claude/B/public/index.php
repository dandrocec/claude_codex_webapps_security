<?php
declare(strict_types=1);

/**
 * Front controller. The PHP built-in server and Apache both route every
 * request that is not a real file here (see .htaccess / README).
 */

require dirname(__DIR__) . '/src/bootstrap.php';

use App\Controllers\AdminController;
use App\Controllers\AuthController;
use App\Controllers\QuoteController;

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$uri    = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$path   = '/' . trim(rawurldecode($uri), '/');
if ($path === '/') {
    $path = '/';
}

/**
 * Route table: [method, pattern, handler]. Patterns may capture {id}.
 */
$routes = [
    ['GET',  '/',                   [QuoteController::class, 'index']],
    ['GET',  '/register',           [AuthController::class,  'showRegister']],
    ['POST', '/register',           [AuthController::class,  'register']],
    ['GET',  '/login',              [AuthController::class,  'showLogin']],
    ['POST', '/login',              [AuthController::class,  'login']],
    ['POST', '/logout',             [AuthController::class,  'logout']],
    ['GET',  '/dashboard',          [QuoteController::class, 'dashboard']],
    ['GET',  '/quotes/new',         [QuoteController::class, 'create']],
    ['POST', '/quotes',             [QuoteController::class, 'store']],
    ['GET',  '/quotes/{id}/edit',   [QuoteController::class, 'edit']],
    ['POST', '/quotes/{id}/edit',   [QuoteController::class, 'update']],
    ['GET',  '/admin',              [AdminController::class, 'index']],
    ['POST', '/admin/{id}/approve', [AdminController::class, 'approve']],
    ['POST', '/admin/{id}/reject',  [AdminController::class, 'reject']],
];

$matchedPathButNotMethod = false;

foreach ($routes as [$routeMethod, $pattern, $handler]) {
    $regex = '#^' . preg_replace('#\{id\}#', '(?P<id>\d+)', $pattern) . '$#';
    if (!preg_match($regex, $path, $m)) {
        continue;
    }
    if ($routeMethod !== $method) {
        $matchedPathButNotMethod = true;
        continue;
    }

    if (isset($m['id'])) {
        $_GET['id'] = $m['id'];
    }

    [$class, $action] = $handler;
    (new $class())->{$action}();
    return;
}

if ($matchedPathButNotMethod) {
    http_response_code(405);
    header('Allow: GET, POST');
    view('errors/404', ['title' => 'Method not allowed']);
    return;
}

http_response_code(404);
view('errors/404', ['title' => 'Not found']);
