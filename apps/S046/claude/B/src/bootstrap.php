<?php
declare(strict_types=1);

/**
 * Application bootstrap.
 *
 * Responsibilities:
 *  - PSR-4-ish autoloading for the App\ namespace (no Composer required to run).
 *  - Load environment variables from .env (without leaking them to clients).
 *  - Configure secure sessions and security headers.
 *  - Install a safe error handler that never leaks internals to the browser.
 */

define('APP_ROOT', dirname(__DIR__));

/* ---------------------------------------------------------------------------
 * Autoloader (Composer's vendor/autoload.php is used if present, else fallback)
 * ------------------------------------------------------------------------- */
$composerAutoload = APP_ROOT . '/vendor/autoload.php';
if (is_file($composerAutoload)) {
    require $composerAutoload;
} else {
    spl_autoload_register(static function (string $class): void {
        $prefix = 'App\\';
        if (!str_starts_with($class, $prefix)) {
            return;
        }
        $relative = substr($class, strlen($prefix));
        $file = APP_ROOT . '/src/' . str_replace('\\', '/', $relative) . '.php';
        if (is_file($file)) {
            require $file;
        }
    });
    require __DIR__ . '/helpers.php';
}

/* ---------------------------------------------------------------------------
 * Environment variables
 * ------------------------------------------------------------------------- */
\App\Env::load(APP_ROOT . '/.env');

$appEnv = \App\Env::get('APP_ENV', 'production');
$isDev  = $appEnv === 'development';

/* ---------------------------------------------------------------------------
 * Error handling — never leak stack traces / internal details to the client.
 * ------------------------------------------------------------------------- */
error_reporting(E_ALL);
ini_set('display_errors', '0');           // never render errors into the response
ini_set('log_errors', '1');

set_exception_handler(static function (\Throwable $e) use ($isDev): void {
    error_log('[unhandled] ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: text/html; charset=utf-8');
    }
    $detail = $isDev ? '<pre>' . htmlspecialchars((string) $e, ENT_QUOTES, 'UTF-8') . '</pre>' : '';
    echo '<!doctype html><meta charset="utf-8"><title>Error</title>'
        . '<h1>Something went wrong</h1>'
        . '<p>The request could not be completed. Please try again later.</p>'
        . $detail;
    exit;
});

set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false;
    }
    throw new \ErrorException($message, 0, $severity, $file, $line);
});

/* ---------------------------------------------------------------------------
 * Security headers (applied to every response)
 * ------------------------------------------------------------------------- */
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Cross-Origin-Opener-Policy: same-origin');
header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
// Strict CSP: only same-origin resources, no inline/eval scripts.
header(
    "Content-Security-Policy: default-src 'self'; "
    . "script-src 'self'; style-src 'self'; img-src 'self' data:; "
    . "form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
);
if (\App\Env::bool('SESSION_SECURE', false)) {
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
}

/* ---------------------------------------------------------------------------
 * Secure session cookie configuration
 * ------------------------------------------------------------------------- */
$secureCookie = \App\Env::bool('SESSION_SECURE', false);
session_name('QUOTESID');
session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'domain'   => '',
    'secure'   => $secureCookie,   // only over HTTPS when enabled
    'httponly' => true,            // not readable by JavaScript
    'samesite' => 'Lax',           // CSRF hardening for top-level navigations
]);
ini_set('session.use_strict_mode', '1');
ini_set('session.use_only_cookies', '1');

session_start();

// Mitigate session fixation: rotate the id periodically per session.
if (!isset($_SESSION['__started'])) {
    session_regenerate_id(true);
    $_SESSION['__started'] = time();
}
