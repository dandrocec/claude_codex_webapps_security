<?php

declare(strict_types=1);

use App\Controllers\AuthController;
use App\Controllers\ContactController;
use App\Http;
use App\View;

// Serve existing static files as-is when using the PHP built-in server.
// Do this before bootstrap so asset requests don't start a session.
if (PHP_SAPI === 'cli-server') {
    $requestPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';
    $file = realpath(__DIR__ . $requestPath);
    if ($file !== false && str_starts_with($file, __DIR__ . DIRECTORY_SEPARATOR) && is_file($file)) {
        return false;
    }
}

require dirname(__DIR__) . '/src/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = rtrim(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/', '/');
if ($path === '') {
    $path = '/';
}

$route = $method . ' ' . $path;

switch ($route) {
    case 'GET /':
        Http::redirect(\App\Auth::check() ? '/contacts' : '/login');
        break;

    case 'GET /register':
        (new AuthController())->showRegister();
        break;
    case 'POST /register':
        (new AuthController())->register($_POST);
        break;

    case 'GET /login':
        (new AuthController())->showLogin();
        break;
    case 'POST /login':
        (new AuthController())->login($_POST);
        break;

    case 'POST /logout':
        (new AuthController())->logout($_POST);
        break;

    case 'GET /contacts':
        (new ContactController())->index($_GET);
        break;
    case 'POST /contacts':
        (new ContactController())->store($_POST);
        break;

    case 'GET /contacts/new':
        (new ContactController())->create();
        break;

    case 'GET /contacts/edit':
        (new ContactController())->edit($_GET);
        break;
    case 'POST /contacts/update':
        (new ContactController())->update($_POST);
        break;

    case 'POST /contacts/delete':
        (new ContactController())->destroy($_POST);
        break;

    default:
        http_response_code(404);
        echo View::render('error', [
            'title' => 'Not found',
            'heading' => 'Page not found',
            'message' => 'The page you requested could not be found.',
        ], 404);
        break;
}
