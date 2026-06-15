<?php

declare(strict_types=1);

/**
 * Application bootstrap: error handling, autoloading, session and header helpers.
 */

// Never display internal errors / stack traces to the client.
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

// Minimal PSR-4-ish autoloader for the App\ namespace.
spl_autoload_register(static function (string $class): void {
    $prefix = 'App\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    $file = __DIR__ . '/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

/**
 * Whether the connection is HTTPS. Honors a trusted reverse-proxy header only
 * when explicitly enabled via TRUST_PROXY=1.
 */
function is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
        return true;
    }
    if (getenv('TRUST_PROXY') === '1'
        && (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')) {
        return true;
    }
    return false;
}

/**
 * Start a session with hardened cookie attributes.
 */
function start_secure_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'httponly' => true,
        // Secure when served over HTTPS. Local plain-HTTP dev still works.
        'secure'   => is_https(),
        'samesite' => 'Strict',
    ]);

    // Application secret from the environment seeds the session name only;
    // never hardcode secrets in source.
    session_name('B64SESS');
    session_start();
}

/**
 * Emit security-related response headers.
 */
function send_security_headers(): void
{
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header('Cross-Origin-Opener-Policy: same-origin');
    header(
        "Content-Security-Policy: default-src 'none'; "
        . "style-src 'unsafe-inline'; "
        . "form-action 'self'; "
        . "base-uri 'none'; "
        . "frame-ancestors 'none'"
    );
    header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
    if (is_https()) {
        header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    }
}
