<?php
declare(strict_types=1);

/**
 * Application bootstrap: environment, error handling, session, database.
 * Included once per request before any output is produced.
 */

define('BASE_PATH', dirname(__DIR__));

require __DIR__ . '/env.php';
require __DIR__ . '/helpers.php';
require __DIR__ . '/database.php';
require __DIR__ . '/csrf.php';
require __DIR__ . '/auth.php';

env_load(BASE_PATH . '/.env');

$isProduction = env('APP_ENV', 'production') === 'production';

/*
 * Error handling: never leak stack traces or internal details to clients.
 * Everything is logged server-side; clients see a generic message.
 */
error_reporting(E_ALL);
ini_set('display_errors', '0');           // never echo errors to the response
ini_set('log_errors', '1');

set_error_handler(function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

set_exception_handler(function (Throwable $e): void {
    error_log(sprintf('[%s] %s in %s:%d', get_class($e), $e->getMessage(), $e->getFile(), $e->getLine()));
    http_response_code(500);
    if (!headers_sent()) {
        header('Content-Type: text/html; charset=utf-8');
    }
    $detail = env('APP_ENV', 'production') !== 'production'
        ? '<pre>' . htmlspecialchars((string) $e, ENT_QUOTES, 'UTF-8') . '</pre>'
        : '';
    echo '<!doctype html><meta charset="utf-8"><title>Error</title>'
        . '<h1>Something went wrong</h1><p>An unexpected error occurred. Please try again later.</p>'
        . $detail;
    exit;
});

/*
 * Security headers applied to every response.
 */
function send_security_headers(): void
{
    if (headers_sent()) {
        return;
    }
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer-when-downgrade');
    header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
    header('Cross-Origin-Opener-Policy: same-origin');
    header('Cross-Origin-Resource-Policy: same-origin');
    // Self-only CSP; no inline scripts are used anywhere in the app.
    header(
        "Content-Security-Policy: default-src 'self'; "
        . "img-src 'self' data:; "
        . "style-src 'self'; "
        . "script-src 'self'; "
        . "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    );
    header_remove('X-Powered-By');
}

/*
 * Secure session cookie configuration. Must run before session_start().
 */
function start_secure_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $secure = filter_var(env('APP_HTTPS', 'false'), FILTER_VALIDATE_BOOLEAN)
        || (($_SERVER['HTTPS'] ?? '') === 'on');

    session_name('classifieds_sid');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'domain'   => '',
        'secure'   => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_start();

    // Mitigate fixation: rotate id periodically for authenticated sessions.
    if (!isset($_SESSION['_initiated'])) {
        session_regenerate_id(true);
        $_SESSION['_initiated'] = true;
    }
}

send_security_headers();
start_secure_session();
db();            // initialise connection + run migrations on first request
