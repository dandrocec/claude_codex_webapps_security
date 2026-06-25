<?php
declare(strict_types=1);

namespace PhotoBlog;

use RuntimeException;

final class Security
{
    public static function headers(): void
    {
        header('X-Frame-Options: DENY');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
        header("Content-Security-Policy: default-src 'self'; img-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    }

    public static function csrfToken(): string
    {
        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }
        return hash_hmac('sha256', $_SESSION['csrf_token'], (string)getenv('APP_KEY'));
    }

    public static function verifyCsrf(): void
    {
        $sent = (string)($_POST['csrf_token'] ?? '');
        if (!hash_equals(self::csrfToken(), $sent)) {
            throw new RuntimeException('Invalid security token.', 403);
        }
    }

    public static function e(mixed $value): string
    {
        return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
