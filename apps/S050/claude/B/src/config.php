<?php
declare(strict_types=1);

/**
 * Application configuration: environment loading, error handling,
 * security headers, and hardened session cookies.
 *
 * Secrets are read from the environment (optionally via a .env file);
 * nothing sensitive is hardcoded here.
 */

const APP_ROOT = __DIR__ . '/..';

/* ---------------------------------------------------------------------------
 * Minimal .env loader (no external dependency required to run locally).
 * Values already present in the real environment take precedence.
 * ------------------------------------------------------------------------- */
(function (): void {
    $envFile = APP_ROOT . '/.env';
    if (!is_readable($envFile)) {
        return;
    }
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
            continue;
        }
        [$key, $value] = explode('=', $line, 2);
        $key = trim($key);
        $value = trim($value);
        // Strip optional surrounding quotes.
        if (strlen($value) >= 2 && ($value[0] === '"' || $value[0] === "'")) {
            $value = substr($value, 1, -1);
        }
        if (getenv($key) === false) {
            putenv("$key=$value");
            $_ENV[$key] = $value;
        }
    }
})();

/** Read an environment variable with a default fallback. */
function env(string $key, ?string $default = null): ?string
{
    $value = getenv($key);
    return $value === false ? $default : $value;
}

/* ---------------------------------------------------------------------------
 * Core settings derived from the environment.
 * ------------------------------------------------------------------------- */
define('APP_ENV', env('APP_ENV', 'production'));
define('IS_PRODUCTION', APP_ENV !== 'development');

define('DB_PATH', rtrim(APP_ROOT, '/\\') . '/' . ltrim(env('DB_PATH', 'storage/database.sqlite'), '/\\'));
define('UPLOAD_DIR', rtrim(APP_ROOT, '/\\') . '/' . ltrim(env('UPLOAD_DIR', 'storage/uploads'), '/\\'));
define('MAX_UPLOAD_BYTES', max(1024, (int) env('MAX_UPLOAD_BYTES', '5242880')));

/**
 * Allow-list of accepted image types, keyed by the MIME type as detected
 * from the file's actual content (not the client-supplied Content-Type).
 * The value is the canonical extension used for server-generated names.
 */
const ALLOWED_IMAGE_TYPES = [
    'image/jpeg' => 'jpg',
    'image/png'  => 'png',
    'image/gif'  => 'gif',
    'image/webp' => 'webp',
];

/* ---------------------------------------------------------------------------
 * Error handling: never leak stack traces or internal details to clients.
 * ------------------------------------------------------------------------- */
ini_set('log_errors', '1');
ini_set('display_errors', IS_PRODUCTION ? '0' : '1');
error_reporting(E_ALL);

set_exception_handler(function (Throwable $e): void {
    error_log('[photoblog] Uncaught: ' . $e);
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: text/html; charset=utf-8');
    }
    echo '<!doctype html><meta charset="utf-8"><title>Server error</title>'
        . '<h1>Something went wrong</h1><p>Please try again later.</p>';
    exit;
});

/* ---------------------------------------------------------------------------
 * Security headers applied to every response.
 * ------------------------------------------------------------------------- */
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Cross-Origin-Resource-Policy: same-origin');
header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
header(
    "Content-Security-Policy: default-src 'none'; "
    . "img-src 'self'; style-src 'self'; script-src 'none'; "
    . "form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
);
// Remove the version-revealing default header where possible.
header_remove('X-Powered-By');

/* ---------------------------------------------------------------------------
 * Hardened session cookies: HttpOnly, SameSite=Lax, Secure when on HTTPS.
 * ------------------------------------------------------------------------- */
$httpsDetected = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
$secureCookie = env('SESSION_SECURE', '0') === '1' || $httpsDetected;

session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'httponly' => true,
    'secure'   => $secureCookie,
    'samesite' => 'Lax',
]);
session_name('photoblog_sid');
session_start();
