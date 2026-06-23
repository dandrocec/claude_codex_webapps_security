<?php

declare(strict_types=1);

namespace App;

/**
 * Hardened session bootstrap and HTTP security headers.
 */
final class Session
{
    public static function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }

        $secure = Config::secureCookies();

        // Harden the session cookie: HttpOnly, SameSite=Lax, Secure (when HTTPS).
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
        ini_set('session.cookie_httponly', '1');
        ini_set('session.name', 'RESESSID');

        session_start();

        // Mitigate session fixation: rotate ID periodically.
        if (!isset($_SESSION['__created'])) {
            $_SESSION['__created'] = time();
        } elseif (time() - (int) $_SESSION['__created'] > 1800) {
            session_regenerate_id(true);
            $_SESSION['__created'] = time();
        }
    }

    /**
     * Emit security headers on every response.
     */
    public static function sendSecurityHeaders(): void
    {
        // Self-contained CSP: no inline event handlers; styles are in an
        // external stylesheet served by this app, scripts are not used.
        $csp = "default-src 'self'; "
            . "img-src 'self' data:; "
            . "style-src 'self'; "
            . "script-src 'self'; "
            . "form-action 'self'; "
            . "base-uri 'self'; "
            . "frame-ancestors 'none'; "
            . "object-src 'none'";

        header('Content-Security-Policy: ' . $csp);
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: no-referrer');
        header('Cross-Origin-Opener-Policy: same-origin');
        header('Cross-Origin-Resource-Policy: same-origin');
        header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
        header_remove('X-Powered-By');

        if (Config::requestIsHttps()) {
            header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
        }
    }

    public static function regenerate(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_regenerate_id(true);
            $_SESSION['__created'] = time();
        }
    }
}
