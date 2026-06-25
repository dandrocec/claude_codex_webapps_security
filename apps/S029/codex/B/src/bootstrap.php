<?php

declare(strict_types=1);

use Guestbook\App;
use Guestbook\Security;

require dirname(__DIR__) . '/vendor/autoload.php';

$envFile = dirname(__DIR__) . '/.env';
if (is_file($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        if (str_starts_with(trim($line), '#') || !str_contains($line, '=')) {
            continue;
        }
        [$key, $value] = array_map('trim', explode('=', $line, 2));
        if (getenv($key) === false) {
            putenv($key . '=' . $value);
            $_ENV[$key] = $value;
        }
    }
}

ini_set('display_errors', '0');
error_reporting(E_ALL);

set_exception_handler(static function (Throwable $exception): void {
    error_log($exception->getMessage());
    http_response_code(500);
    echo 'An internal error occurred.';
});

$secureCookie = App::env('SESSION_SECURE', '1') === '1';
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'domain' => '',
    'secure' => $secureCookie,
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_name('secure_guestbook_session');
session_start();

Security::headers();
