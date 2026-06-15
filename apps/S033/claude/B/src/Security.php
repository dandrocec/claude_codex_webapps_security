<?php

declare(strict_types=1);

namespace App;

/**
 * Cross-cutting security helpers: secure session start, security headers,
 * CSRF token generation/verification, and context-aware output encoding.
 */
final class Security
{
    /**
     * Starts a session configured with hardened cookie flags.
     */
    public static function startSession(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }

        $secure = Env::bool('SESSION_SECURE', false);

        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'domain' => '',
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Strict',
        ]);

        session_name('ADDRBOOKSESSID');
        session_start();

        // Bind the session to a rotating fingerprint and rotate the id
        // periodically to limit fixation / hijacking windows.
        if (!isset($_SESSION['__created'])) {
            $_SESSION['__created'] = time();
        } elseif (time() - (int) $_SESSION['__created'] > 1800) {
            session_regenerate_id(true);
            $_SESSION['__created'] = time();
        }
    }

    public static function sendSecurityHeaders(): void
    {
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: no-referrer');
        header('Cross-Origin-Opener-Policy: same-origin');
        header(
            "Content-Security-Policy: default-src 'self'; "
            . "img-src 'self' data:; "
            . "style-src 'self'; "
            . "script-src 'self'; "
            . "form-action 'self'; "
            . "base-uri 'self'; "
            . "frame-ancestors 'none'"
        );
        header('Permissions-Policy: geolocation=(), microphone=(), camera=()');

        if (Env::bool('SESSION_SECURE', false)) {
            header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
        }

        // Do not advertise the PHP version.
        header_remove('X-Powered-By');
    }

    public static function csrfToken(): string
    {
        if (empty($_SESSION['csrf_token']) || !is_string($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }

        return $_SESSION['csrf_token'];
    }

    public static function verifyCsrf(?string $token): bool
    {
        $stored = $_SESSION['csrf_token'] ?? null;

        return is_string($stored)
            && is_string($token)
            && $token !== ''
            && hash_equals($stored, $token);
    }

    /**
     * Context-aware HTML output encoding. Use for any user-controlled value
     * rendered into HTML text or attribute context.
     */
    public static function e(?string $value): string
    {
        return htmlspecialchars($value ?? '', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
