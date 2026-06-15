<?php

declare(strict_types=1);

namespace App;

/**
 * Response- and session-hardening helpers.
 */
final class Security
{
    /**
     * Send security headers on every response (OWASP A05).
     */
    public static function sendHeaders(): void
    {
        if (headers_sent()) {
            return;
        }

        // Strict CSP: no inline scripts, no external resources. The page uses a
        // <style> block, so style-src allows 'unsafe-inline' for styles only.
        header(
            "Content-Security-Policy: default-src 'none'; "
            . "style-src 'unsafe-inline'; "
            . "form-action 'self'; "
            . "base-uri 'none'; "
            . "frame-ancestors 'none'"
        );
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: no-referrer');
        header('Cross-Origin-Opener-Policy: same-origin');
        header('Cross-Origin-Resource-Policy: same-origin');
        header('Permissions-Policy: geolocation=(), microphone=(), camera=()');

        // Advertise HTTPS-only when the request arrived over TLS.
        if (self::isHttps()) {
            header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
        }

        // Remove the version-leaking default header where possible.
        header_remove('X-Powered-By');
    }

    /**
     * Start a session with hardened cookie attributes (OWASP A05/A07):
     * HttpOnly, SameSite=Strict, and Secure when served over HTTPS.
     */
    public static function startSecureSession(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }

        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'domain' => '',
            'secure' => self::isHttps(),
            'httponly' => true,
            'samesite' => 'Strict',
        ]);

        // Reject client-supplied session IDs (session fixation hardening).
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');

        session_name('TEXTAPPSESSID');
        session_start();
    }

    public static function isHttps(): bool
    {
        if (($_SERVER['HTTPS'] ?? '') !== '' && strtolower((string) $_SERVER['HTTPS']) !== 'off') {
            return true;
        }
        // Honour a reverse proxy that terminates TLS.
        return strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
    }
}
