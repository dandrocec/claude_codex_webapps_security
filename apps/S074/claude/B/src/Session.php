<?php

declare(strict_types=1);

namespace App;

/**
 * Session bootstrap with secure cookie attributes (OWASP A05/A07):
 *   - HttpOnly  : JavaScript cannot read the cookie (mitigates XSS theft).
 *   - SameSite  : Lax, mitigates CSRF on top-level cross-site requests.
 *   - Secure    : set when served over HTTPS (configurable via SESSION_SECURE).
 */
final class Session
{
    public static function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }

        $secure = Env::bool('SESSION_SECURE', false) || self::isHttps();

        session_name('mvsid');
        session_set_cookie_params([
            'lifetime' => 0,
            'path'     => '/',
            'domain'   => '',
            'secure'   => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);

        // Harden session id generation.
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');

        session_start();

        // Periodically rotate the session id to limit fixation windows.
        if (!isset($_SESSION['__created'])) {
            $_SESSION['__created'] = time();
        } elseif (time() - (int) $_SESSION['__created'] > 1800) {
            session_regenerate_id(true);
            $_SESSION['__created'] = time();
        }
    }

    public static function regenerate(): void
    {
        session_regenerate_id(true);
        $_SESSION['__created'] = time();
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        return $_SESSION[$key] ?? $default;
    }

    public static function set(string $key, mixed $value): void
    {
        $_SESSION[$key] = $value;
    }

    public static function forget(string $key): void
    {
        unset($_SESSION[$key]);
    }

    public static function flash(string $message, string $type = 'info'): void
    {
        $_SESSION['__flash'][] = ['type' => $type, 'message' => $message];
    }

    /** @return array<int,array{type:string,message:string}> */
    public static function takeFlashes(): array
    {
        $flashes = $_SESSION['__flash'] ?? [];
        unset($_SESSION['__flash']);
        return $flashes;
    }

    public static function destroy(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', [
                'expires'  => time() - 42000,
                'path'     => $params['path'],
                'domain'   => $params['domain'],
                'secure'   => $params['secure'],
                'httponly' => $params['httponly'],
                'samesite' => $params['samesite'] ?? 'Lax',
            ]);
        }
        session_destroy();
    }

    private static function isHttps(): bool
    {
        return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (($_SERVER['SERVER_PORT'] ?? null) == 443)
            || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    }
}
