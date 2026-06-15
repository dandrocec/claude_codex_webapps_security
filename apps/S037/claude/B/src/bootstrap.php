<?php

declare(strict_types=1);

namespace App;

/*
 * Application bootstrap: configuration, error handling, secure session,
 * security headers, and shared helpers. Required once per request before
 * any output is produced.
 */

if (defined('App\\BOOTSTRAPPED')) {
    return;
}
define('App\\BOOTSTRAPPED', true);

const ROOT_DIR = __DIR__ . '/..';

/* ------------------------------------------------------------------ *
 *  Configuration
 * ------------------------------------------------------------------ */

/**
 * Minimal .env loader. Real deployments should set real environment
 * variables; this exists only to make local setup pleasant. Values already
 * present in the environment always win.
 */
function load_env(string $file): void
{
    if (!is_readable($file)) {
        return;
    }
    foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
            continue;
        }
        [$key, $value] = explode('=', $line, 2);
        $key   = trim($key);
        $value = trim($value);
        // Strip surrounding quotes if present.
        if (strlen($value) >= 2 && ($value[0] === '"' || $value[0] === "'")) {
            $value = substr($value, 1, -1);
        }
        if (getenv($key) === false) {
            putenv("$key=$value");
            $_ENV[$key] = $value;
        }
    }
}

load_env(ROOT_DIR . '/.env');

/** Read a configuration value from the environment with an optional default. */
function config(string $key, ?string $default = null): ?string
{
    $value = getenv($key);
    if ($value === false || $value === '') {
        return $default;
    }
    return $value;
}

const APP_NAME = 'PHP Image Gallery';

// Upload constraints. Content-validated against the actual file bytes.
const ALLOWED_IMAGE_TYPES = [
    'image/jpeg' => 'jpg',
    'image/png'  => 'png',
    'image/gif'  => 'gif',
    'image/webp' => 'webp',
];

function max_upload_bytes(): int
{
    return max(1, (int) config('MAX_UPLOAD_BYTES', (string) (5 * 1024 * 1024)));
}

function upload_dir(): string
{
    $dir = config('UPLOAD_DIR', ROOT_DIR . '/storage/uploads');
    if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
        throw new \RuntimeException('Upload directory is not available.');
    }
    // Canonical absolute path; used later for path-traversal containment.
    return realpath($dir) ?: $dir;
}

function is_production(): bool
{
    return strtolower((string) config('APP_ENV', 'production')) === 'production';
}

/* ------------------------------------------------------------------ *
 *  Error handling — never leak internals to the client.
 * ------------------------------------------------------------------ */

error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

set_exception_handler(static function (\Throwable $e): void {
    error_log('[gallery] Uncaught ' . get_class($e) . ': ' . $e->getMessage()
        . ' in ' . $e->getFile() . ':' . $e->getLine());
    http_response_code(500);
    if (!headers_sent()) {
        header('Content-Type: text/html; charset=utf-8');
    }
    if (is_production()) {
        echo '<h1>500 — Something went wrong</h1><p>Please try again later.</p>';
    } else {
        echo '<h1>500 — Internal error (development)</h1><pre>'
            . htmlspecialchars((string) $e, ENT_QUOTES, 'UTF-8') . '</pre>';
    }
    exit;
});

set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false;
    }
    throw new \ErrorException($message, 0, $severity, $file, $line);
});

/* ------------------------------------------------------------------ *
 *  Security headers
 * ------------------------------------------------------------------ */

function send_security_headers(): void
{
    if (headers_sent()) {
        return;
    }
    // Conservative, self-only policy. No inline JS is used anywhere.
    header("Content-Security-Policy: default-src 'self'; img-src 'self'; "
        . "style-src 'self'; script-src 'self'; object-src 'none'; "
        . "base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header('Cross-Origin-Resource-Policy: same-origin');
    header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
    header_remove('X-Powered-By');
    if (request_is_https()) {
        header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    }
}

function request_is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
        || (($_SERVER['SERVER_PORT'] ?? null) == 443);
}

/* ------------------------------------------------------------------ *
 *  Secure session
 * ------------------------------------------------------------------ */

function start_secure_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    $secure = request_is_https() || config('FORCE_SECURE_COOKIE', '0') === '1';

    session_name('gallery_sid');
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

    // Mitigate session fixation: rotate the id once per session.
    if (empty($_SESSION['__initialised'])) {
        session_regenerate_id(true);
        $_SESSION['__initialised'] = true;
    }
}

/* ------------------------------------------------------------------ *
 *  Load shared helpers
 * ------------------------------------------------------------------ */

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/helpers.php';

send_security_headers();
start_secure_session();
