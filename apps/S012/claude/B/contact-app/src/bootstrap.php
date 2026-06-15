<?php
declare(strict_types=1);

/*
 * bootstrap.php
 * Central setup: error handling, environment, secure session, security
 * headers, CSRF, output encoding and a minimal HTML layout.
 *
 * Included by every page in /public. The web server's document root MUST be
 * the /public directory so that /src and /data are never web-accessible.
 */

// ---------------------------------------------------------------------------
// Error handling — never leak internals to the client (OWASP A05/A09).
// ---------------------------------------------------------------------------
error_reporting(E_ALL);
ini_set('display_errors', '0');      // do not render errors/stack traces
ini_set('display_startup_errors', '0');
ini_set('log_errors', '1');          // log them instead

// ---------------------------------------------------------------------------
// Minimal environment loader. Secrets/config are read from the environment
// (OWASP A05) — optionally seeded from a local, untracked .env file.
// ---------------------------------------------------------------------------
(function (): void {
    $envFile = dirname(__DIR__) . '/.env';
    if (!is_file($envFile) || !is_readable($envFile)) {
        return;
    }
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
            continue;
        }
        [$key, $value] = explode('=', $line, 2);
        $key = trim($key);
        $value = trim($value, " \t\"'");
        if ($key !== '' && getenv($key) === false) {
            putenv("$key=$value");
            $_ENV[$key] = $value;
        }
    }
})();

/** Read a config value from the environment with a default. */
function env(string $key, ?string $default = null): ?string
{
    $value = getenv($key);
    return $value === false ? $default : $value;
}

// ---------------------------------------------------------------------------
// Application paths.
// ---------------------------------------------------------------------------
const APP_ROOT = __DIR__ . '/..';
define('DATA_FILE', env('DATA_FILE', APP_ROOT . '/data/submissions.jsonl'));

// ---------------------------------------------------------------------------
// Secure session cookies (OWASP A07).
//   - HttpOnly  : JS cannot read the cookie
//   - SameSite  : Lax mitigates CSRF on top of the token check
//   - Secure    : sent only over HTTPS. Auto-enabled when the request is
//                 HTTPS; force it in production via COOKIE_SECURE=1.
// ---------------------------------------------------------------------------
$isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
$cookieSecure = env('COOKIE_SECURE') !== null
    ? filter_var(env('COOKIE_SECURE'), FILTER_VALIDATE_BOOLEAN)
    : $isHttps;

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'domain'   => '',
        'secure'   => $cookieSecure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_name(env('SESSION_NAME', 'CONTACTSESSID'));
    session_start();
}

// ---------------------------------------------------------------------------
// Security headers (OWASP A05). A strict CSP keeps us safe even if an output
// encoding mistake slips through: no inline scripts, no framing, locked base.
// ---------------------------------------------------------------------------
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
header("Content-Security-Policy: default-src 'self'; style-src 'self'; "
    . "img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
if ($isHttps) {
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
}

// ---------------------------------------------------------------------------
// Uncaught errors/exceptions -> generic 500, details only to the log.
// ---------------------------------------------------------------------------
set_exception_handler(function (Throwable $e): void {
    error_log('Unhandled exception: ' . $e);
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: text/html; charset=utf-8');
    }
    echo '<!doctype html><meta charset="utf-8"><title>Error</title>'
        . '<h1>Something went wrong</h1>'
        . '<p>The request could not be processed. Please try again later.</p>';
    exit;
});
set_error_handler(function (int $severity, string $message, string $file, int $line): bool {
    throw new ErrorException($message, 0, $severity, $file, $line);
});

// ---------------------------------------------------------------------------
// Output encoding helper — context-aware HTML escaping (OWASP A03 / XSS).
// ---------------------------------------------------------------------------
function e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
}

// ---------------------------------------------------------------------------
// CSRF protection (OWASP A01). Synchronizer-token pattern.
// ---------------------------------------------------------------------------
function csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

/** Validate the CSRF token on a state-changing request; abort with 400 if bad. */
function csrf_check(): void
{
    $sent = (string) ($_POST['csrf_token'] ?? '');
    $known = (string) ($_SESSION['csrf_token'] ?? '');
    if ($known === '' || !hash_equals($known, $sent)) {
        http_response_code(400);
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><meta charset="utf-8"><title>Bad request</title>'
            . '<h1>Invalid or missing CSRF token</h1>'
            . '<p>Your session may have expired. Please reload the form and try again.</p>';
        exit;
    }
}

// ---------------------------------------------------------------------------
// Tiny HTML layout helpers (keep markup DRY; everything dynamic goes via e()).
// ---------------------------------------------------------------------------
function layout_header(string $title): void
{
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html>' . "\n";
    echo '<html lang="en"><head><meta charset="utf-8">';
    echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
    echo '<title>' . e($title) . '</title>';
    echo '<link rel="stylesheet" href="style.css">';
    echo '</head><body><main class="container">';
}

function layout_footer(): void
{
    echo '<footer><a href="index.php">New message</a> &middot; '
        . '<a href="submissions.php">View submissions</a></footer>';
    echo '</main></body></html>';
}

require __DIR__ . '/Storage.php';

/** Shared storage instance. */
function storage(): Storage
{
    static $storage = null;
    if ($storage === null) {
        $storage = new Storage((string) DATA_FILE);
    }
    return $storage;
}
