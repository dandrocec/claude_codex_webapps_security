<?php
declare(strict_types=1);

namespace Poll;

/**
 * Security helpers: secure session bootstrap, security headers,
 * CSRF token issue/verify, and context-aware output encoding.
 */
final class Security
{
    /**
     * Start a hardened session.
     *
     * - HttpOnly: cookie not exposed to JavaScript (mitigates XSS theft).
     * - Secure:   cookie only sent over HTTPS (when available).
     * - SameSite=Strict: cookie not sent on cross-site requests (CSRF defence-in-depth).
     */
    public static function startSession(bool $cookieSecure): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }

        // Do not accept session IDs supplied in the URL.
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');

        session_set_cookie_params([
            'lifetime' => 0,
            'path'     => '/',
            'secure'   => $cookieSecure,
            'httponly' => true,
            'samesite' => 'Strict',
        ]);

        session_name('POLLSESSID');
        session_start();

        // Rotate the session ID once per session to limit fixation risk.
        if (empty($_SESSION['__initialised'])) {
            session_regenerate_id(true);
            $_SESSION['__initialised'] = true;
        }
    }

    /**
     * Emit a conservative set of security response headers.
     */
    public static function sendSecurityHeaders(): void
    {
        // Lock down where resources may load from. The app uses only its own
        // inline-free styles, so a strict policy is possible.
        header("Content-Security-Policy: default-src 'self'; style-src 'self'; "
            . "img-src 'self'; object-src 'none'; base-uri 'self'; "
            . "form-action 'self'; frame-ancestors 'none'");
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: no-referrer');
        header('Cross-Origin-Opener-Policy: same-origin');
        header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
        // Remove the version-leaking default header where possible.
        header_remove('X-Powered-By');
    }

    /**
     * Return the current CSRF token, generating one if needed.
     */
    public static function csrfToken(): string
    {
        if (empty($_SESSION['csrf_token']) || !is_string($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['csrf_token'];
    }

    /**
     * Constant-time validation of a submitted CSRF token.
     */
    public static function checkCsrf(?string $submitted): bool
    {
        $expected = $_SESSION['csrf_token'] ?? '';
        return is_string($submitted)
            && $expected !== ''
            && hash_equals($expected, $submitted);
    }

    /**
     * Context-aware output encoding for HTML text/attribute contexts.
     */
    public static function e(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
    }
}
