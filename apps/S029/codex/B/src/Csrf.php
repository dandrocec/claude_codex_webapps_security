<?php

declare(strict_types=1);

namespace Guestbook;

final class Csrf
{
    public static function token(): string
    {
        if (!isset($_SESSION['csrf_token']) || !is_string($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }

        return hash_hmac('sha256', $_SESSION['csrf_token'], App::secret());
    }

    public static function verify(?string $token): void
    {
        if (!is_string($token) || !hash_equals(self::token(), $token)) {
            throw new \RuntimeException('Invalid security token.');
        }
    }
}
