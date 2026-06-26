<?php

declare(strict_types=1);

use Forum\App;
use Forum\Auth;
use Forum\Csrf;
use Forum\Database;
use Forum\Security;
use Forum\Validation;

require __DIR__ . '/../src/bootstrap.php';

Security::applyHeaders();
Security::startSession();

$db = Database::connect();
$auth = new Auth($db);
$csrf = new Csrf();
$app = new App($db, $auth, $csrf);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

try {
    if ($method === 'GET') {
        match (true) {
            $path === '/' => $app->home(),
            $path === '/register' => $app->registerForm(),
            $path === '/login' => $app->loginForm(),
            preg_match('#^/board/(\d+)$#', $path, $m) === 1 => $app->board((int) $m[1]),
            preg_match('#^/thread/(\d+)$#', $path, $m) === 1 => $app->thread((int) $m[1]),
            preg_match('#^/thread/new/(\d+)$#', $path, $m) === 1 => $app->newThreadForm((int) $m[1]),
            default => $app->notFound(),
        };
        exit;
    }

    if ($method === 'POST') {
        $csrf->verify(Validation::string($_POST['csrf_token'] ?? '', 128));

        match ($path) {
            '/register' => $app->register(),
            '/login' => $app->login(),
            '/logout' => $app->logout(),
            '/thread/create' => $app->createThread(),
            '/reply/create' => $app->createReply(),
            '/post/delete' => $app->deletePost(),
            default => $app->notFound(),
        };
        exit;
    }

    $app->methodNotAllowed();
} catch (Throwable $e) {
    error_log($e->getMessage());
    http_response_code(500);
    echo App::render('Error', '<p>Something went wrong. Please try again later.</p>', $auth->user(), $csrf);
}
