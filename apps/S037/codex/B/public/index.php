<?php

declare(strict_types=1);

use Gallery\App;
use Gallery\Auth;
use Gallery\Database;
use Gallery\Http;
use Gallery\Security;
use Gallery\UploadStorage;

require_once __DIR__ . '/../src/App.php';
require_once __DIR__ . '/../src/Auth.php';
require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/Http.php';
require_once __DIR__ . '/../src/Security.php';
require_once __DIR__ . '/../src/UploadStorage.php';

$debug = getenv('APP_ENV') === 'development';
ini_set('display_errors', $debug ? '1' : '0');
error_reporting(E_ALL);

set_exception_handler(static function (Throwable $e) use ($debug): void {
    error_log($e->getMessage());
    http_response_code(500);
    echo $debug ? 'Internal error: ' . Security::e($e->getMessage()) : 'Internal server error';
});

Security::sendHeaders();
Security::startSession();

$pdo = Database::connect();
Database::migrate($pdo);

$app = new App(
    $pdo,
    new Auth($pdo),
    new UploadStorage((string)(getenv('UPLOAD_DIR') ?: (__DIR__ . '/../storage/uploads')))
);

$app->handle($_SERVER['REQUEST_METHOD'] ?? 'GET', parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
