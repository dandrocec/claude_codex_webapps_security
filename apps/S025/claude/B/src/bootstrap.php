<?php

declare(strict_types=1);

/*
 * Application bootstrap: error handling, environment, secure session,
 * and security headers. Required once from the front controller.
 */

require_once __DIR__ . '/env.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/Database.php';

loadEnv(dirname(__DIR__) . '/.env');

$debug = env('APP_DEBUG', 'false') === 'true';

// Never leak stack traces or internal errors to clients.
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

set_exception_handler(function (Throwable $e) use ($debug): void {
    error_log('[uncaught] ' . $e);
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: text/html; charset=UTF-8');
    }
    if ($debug) {
        echo '<h1>500 Internal Server Error</h1><pre>'
            . htmlspecialchars((string) $e, ENT_QUOTES, 'UTF-8') . '</pre>';
    } else {
        echo '<h1>500 Internal Server Error</h1><p>Something went wrong. Please try again later.</p>';
    }
    exit;
});

set_error_handler(function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

/* ---- Secure session ---------------------------------------------------- */

$secure = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
    || env('FORCE_HTTPS', 'false') === 'true';

session_name('NLSESSID');
session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'domain'   => '',
    'secure'   => $secure,   // Secure flag only over HTTPS
    'httponly' => true,      // not readable from JavaScript
    'samesite' => 'Lax',     // CSRF defence-in-depth
]);
session_start();

/* ---- Security headers --------------------------------------------------- */

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Cross-Origin-Opener-Policy: same-origin');
header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
header(
    "Content-Security-Policy: default-src 'self'; img-src 'self' data:; "
    . "style-src 'self'; script-src 'none'; object-src 'none'; "
    . "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
);
if ($secure) {
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
}
