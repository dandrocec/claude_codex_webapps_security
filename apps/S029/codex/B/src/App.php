<?php

declare(strict_types=1);

namespace Guestbook;

final class App
{
    public static function env(string $key, ?string $default = null): ?string
    {
        $value = getenv($key);
        return $value === false ? $default : $value;
    }

    public static function isDevelopment(): bool
    {
        return self::env('APP_ENV', 'production') === 'development';
    }

    public static function secret(): string
    {
        $secret = self::env('APP_SECRET');
        if ($secret === null || strlen($secret) < 24 || $secret === 'replace-with-a-long-random-secret') {
            throw new \RuntimeException('APP_SECRET must be set to a long random value.');
        }
        return $secret;
    }
}
