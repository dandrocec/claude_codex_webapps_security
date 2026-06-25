<?php

declare(strict_types=1);

namespace App;

final class Security
{
    public static function sendHeaders(): void
    {
        header('X-Frame-Options: DENY');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: same-origin');
        header("Permissions-Policy: geolocation=(), microphone=(), camera=()");
        header("Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    }

    public static function startSession(): void
    {
        $secure = (($_SERVER['HTTPS'] ?? '') === 'on') || (($_ENV['APP_ENV'] ?? '') === 'production');
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'domain' => '',
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        session_name('classifieds_session');
        session_start();
        $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
    }

    public static function csrf(): string
    {
        return (string)($_SESSION['csrf'] ?? '');
    }

    public static function verifyCsrf(): void
    {
        $token = (string)($_POST['csrf'] ?? '');
        if ($token === '' || !hash_equals(self::csrf(), $token)) {
            throw new HttpException(403, 'Invalid security token');
        }
    }

    public static function login(int $userId): void
    {
        session_regenerate_id(true);
        $_SESSION['user_id'] = $userId;
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }

    public static function logout(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
        }
        session_destroy();
    }

    public static function userId(): ?int
    {
        return isset($_SESSION['user_id']) ? (int)$_SESSION['user_id'] : null;
    }

    public static function requireUser(): void
    {
        if (self::userId() === null) {
            Response::redirect('/login');
        }
    }
}
