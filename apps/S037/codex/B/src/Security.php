<?php

declare(strict_types=1);

namespace Gallery;

final class Security
{
    public static function sendHeaders(): void
    {
        header('X-Frame-Options: DENY');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        header("Permissions-Policy: camera=(), microphone=(), geolocation=()");
        header("Content-Security-Policy: default-src 'self'; img-src 'self'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    }

    public static function startSession(): void
    {
        self::appSecret();
        $secure = self::secureCookieSetting();
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'domain' => '',
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
        session_name('gallery_session');
        session_start();
    }

    public static function csrfToken(): string
    {
        if (empty($_SESSION['csrf_seed'])) {
            $_SESSION['csrf_seed'] = bin2hex(random_bytes(32));
        }
        return hash_hmac('sha256', (string)$_SESSION['csrf_seed'], self::appSecret());
    }

    public static function csrfField(): string
    {
        return '<input type="hidden" name="csrf_token" value="' . self::e(self::csrfToken()) . '">';
    }

    public static function requireCsrf(): void
    {
        $token = $_POST['csrf_token'] ?? '';
        if (!is_string($token) || !hash_equals(self::csrfToken(), $token)) {
            throw new ValidationException('Invalid request token.');
        }
    }

    public static function cleanUsername(mixed $value): string
    {
        $username = trim((string)$value);
        if (preg_match('/\A[a-zA-Z0-9_-]{3,32}\z/', $username) !== 1) {
            throw new ValidationException('Username must be 3-32 characters and contain only letters, numbers, underscores, or hyphens.');
        }
        return $username;
    }

    public static function cleanPassword(mixed $value): string
    {
        $password = (string)$value;
        if (strlen($password) < 10 || strlen($password) > 256) {
            throw new ValidationException('Password must be between 10 and 256 characters.');
        }
        return $password;
    }

    public static function cleanCaption(mixed $value): string
    {
        $caption = trim((string)$value);
        if ($caption === '' || mb_strlen($caption) > 180) {
            throw new ValidationException('Caption must be 1-180 characters.');
        }
        return $caption;
    }

    public static function e(mixed $value): string
    {
        return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    private static function secureCookieSetting(): bool
    {
        $override = getenv('APP_SECURE_COOKIES');
        if ($override !== false) {
            return $override !== '0';
        }
        if (getenv('APP_ENV') === 'local') {
            return false;
        }
        return true;
    }

    private static function appSecret(): string
    {
        $secret = getenv('APP_SECRET');
        if (!is_string($secret) || strlen($secret) < 32) {
            throw new \RuntimeException('APP_SECRET must be set to at least 32 characters.');
        }
        return $secret;
    }
}

final class ValidationException extends \RuntimeException
{
}
