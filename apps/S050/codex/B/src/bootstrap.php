<?php
declare(strict_types=1);

spl_autoload_register(function (string $class): void {
    $prefix = 'PhotoBlog\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    $file = __DIR__ . '/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

if (getenv('APP_KEY') === false || strlen((string)getenv('APP_KEY')) < 32) {
    http_response_code(500);
    echo 'Application is not configured. Set APP_KEY to a long random secret.';
    exit;
}

$secureCookie = filter_var(getenv('SESSION_SECURE') ?: 'true', FILTER_VALIDATE_BOOL);
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'domain' => '',
    'secure' => $secureCookie,
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_name('photoblog_session');
session_start();

PhotoBlog\Security::headers();
PhotoBlog\Database::migrate();
