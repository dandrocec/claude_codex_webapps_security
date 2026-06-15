<?php

declare(strict_types=1);

/**
 * Application bootstrap: environment, error handling, security headers,
 * secure session, autoloading and one-time setup. Required by the front
 * controller before any request handling.
 */

const APP_ROOT = __DIR__ . '/..';

require __DIR__ . '/helpers.php';

/* ---------------------------------------------------------------------------
 * Minimal .env loader (no Composer dependency required to run the app).
 * Real environment variables always take precedence over the .env file.
 * ------------------------------------------------------------------------- */
(static function (): void {
    $file = APP_ROOT . '/.env';
    if (!is_file($file)) {
        return;
    }
    foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
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
        if (getenv($key) === false && !isset($_ENV[$key])) {
            $_ENV[$key] = $value;
            putenv("$key=$value");
        }
    }
})();

/* ---------------------------------------------------------------------------
 * Class autoloading (PSR-4 for the App\ namespace) without requiring Composer.
 * ------------------------------------------------------------------------- */
spl_autoload_register(static function (string $class): void {
    $prefix = 'App\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    $path = __DIR__ . '/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($path)) {
        require $path;
    }
});

/* ---------------------------------------------------------------------------
 * Error handling: never leak stack traces or internal errors to clients.
 * ------------------------------------------------------------------------- */
$isDev = env('APP_ENV', 'production') === 'development';

error_reporting(E_ALL);
ini_set('display_errors', $isDev ? '1' : '0');
ini_set('log_errors', '1');

set_exception_handler(static function (\Throwable $e) use ($isDev): void {
    error_log('[guestbook] ' . $e);
    http_response_code(500);
    header('Content-Type: text/html; charset=utf-8');
    if ($isDev) {
        echo '<pre>' . htmlspecialchars((string) $e, ENT_QUOTES, 'UTF-8') . '</pre>';
    } else {
        echo '<h1>500 — Something went wrong</h1><p>Please try again later.</p>';
    }
    exit;
});

set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false;
    }
    throw new \ErrorException($message, 0, $severity, $file, $line);
});

/* ---------------------------------------------------------------------------
 * Security headers applied to every response.
 * ------------------------------------------------------------------------- */
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Cross-Origin-Opener-Policy: same-origin');
header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
// Strict CSP: no inline scripts, no external resources. Styles are served from
// our own /assets/app.css file, so 'self' is sufficient.
header(
    "Content-Security-Policy: default-src 'self'; "
    . "script-src 'self'; style-src 'self'; img-src 'self'; "
    . "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
);
if (filter_var(env('SESSION_SECURE', 'false'), FILTER_VALIDATE_BOOL)) {
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
}
header_remove('X-Powered-By');

/* ---------------------------------------------------------------------------
 * Secure session cookie configuration. Must run before session_start().
 * ------------------------------------------------------------------------- */
$secureCookie = filter_var(env('SESSION_SECURE', 'false'), FILTER_VALIDATE_BOOL);

session_name('GBSESSID');
session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'domain'   => '',
    'secure'   => $secureCookie,
    'httponly' => true,
    'samesite' => 'Lax',
]);
ini_set('session.use_strict_mode', '1');
ini_set('session.use_only_cookies', '1');
session_start();

/* ---------------------------------------------------------------------------
 * Fail fast if the app secret is missing/insecure in production.
 * ------------------------------------------------------------------------- */
$appKey = env('APP_KEY');
if (!$isDev && (!$appKey || $appKey === 'change-me-to-a-long-random-string')) {
    throw new \RuntimeException('APP_KEY is not configured. Set it in your environment or .env file.');
}

/* ---------------------------------------------------------------------------
 * Connect to the DB (runs migrations) and optionally seed an admin account.
 * ------------------------------------------------------------------------- */
\App\Database::connection();

(static function (): void {
    $user = env('ADMIN_USERNAME');
    $pass = env('ADMIN_PASSWORD');
    if (!$user || !$pass) {
        return;
    }
    $pdo = \App\Database::connection();
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM users WHERE username = :u');
    $stmt->execute([':u' => $user]);
    if ((int) $stmt->fetchColumn() === 0) {
        \App\Auth::register($user, $pass, true);
    }
})();
