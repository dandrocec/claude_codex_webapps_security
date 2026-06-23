<?php

declare(strict_types=1);

namespace App;

/**
 * Application bootstrap: autoloading, configuration, error handling and the
 * security baseline (headers, session, error suppression).
 */

define('APP_ROOT', dirname(__DIR__));

/* ----------------------------------------------------------------------------
 * PSR-4-ish autoloader for the App\ namespace (so the app runs without Composer).
 * -------------------------------------------------------------------------- */
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

// View.php defines helper functions (e(), money()) that are not autoloaded by class.
require __DIR__ . '/View.php';

Env::load(APP_ROOT);

/* ----------------------------------------------------------------------------
 * Error & exception handling — never leak internals to the client (OWASP A05).
 * -------------------------------------------------------------------------- */
$debug = Env::bool('APP_DEBUG', false);

ini_set('display_errors', $debug ? '1' : '0');
ini_set('display_startup_errors', $debug ? '1' : '0');
error_reporting(E_ALL);

$logDir = APP_ROOT . '/storage/logs';
if (!is_dir($logDir)) {
    @mkdir($logDir, 0775, true);
}
ini_set('log_errors', '1');
ini_set('error_log', $logDir . '/app.log');

/* ----------------------------------------------------------------------------
 * Security headers (OWASP A05). Applied to every response.
 * -------------------------------------------------------------------------- */
function send_security_headers(): void
{
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header('Cross-Origin-Opener-Policy: same-origin');
    header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
    // Strict CSP: no inline scripts; styles are served from our own stylesheet.
    header(
        "Content-Security-Policy: default-src 'self'; "
        . "img-src 'self' data:; "
        . "style-src 'self'; "
        . "script-src 'self'; "
        . "form-action 'self'; "
        . "base-uri 'self'; "
        . "frame-ancestors 'none'; "
        . "object-src 'none'"
    );
    header('X-XSS-Protection: 0');
    if ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')) {
        header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    }
    // Remove the version-leaking default.
    header_remove('X-Powered-By');
}

/**
 * Render a safe error page. In debug mode we additionally log the detail; we
 * never echo exception messages/stack traces for unexpected (500) errors.
 */
function render_error_page(int $status, string $clientMessage): void
{
    if (!headers_sent()) {
        http_response_code($status);
    }
    try {
        echo View::render('error', [
            'title'   => 'Error ' . $status,
            'status'  => $status,
            'message' => $clientMessage,
        ], $status);
    } catch (\Throwable $e) {
        echo '<!doctype html><meta charset="utf-8"><title>Error</title>'
            . '<h1>Error ' . (int) $status . '</h1><p>'
            . htmlspecialchars($clientMessage, ENT_QUOTES, 'UTF-8') . '</p>';
    }
}

set_exception_handler(static function (\Throwable $e) use ($debug): void {
    error_log('[unhandled] ' . $e::class . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    $message = $debug
        ? $e->getMessage()
        : 'Something went wrong while processing your request.';
    render_error_page(500, $message);
});

set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false;
    }
    throw new \ErrorException($message, 0, $severity, $file, $line);
});

View::setViewPath(APP_ROOT . '/views');
Session::start();
