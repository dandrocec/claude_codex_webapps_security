<?php

declare(strict_types=1);

function env_string(string $name, ?string $fallback = null): string
{
    $value = getenv($name);
    if ($value === false || trim($value) === '') {
        if ($fallback !== null) {
            return $fallback;
        }
        throw new RuntimeException($name . ' is required.');
    }

    return $value;
}

function app_secret(): string
{
    return env_string('APP_SECRET');
}

function admin_password(): string
{
    return env_string('ADMIN_PASSWORD');
}

function database_path(): string
{
    return getenv('DATABASE_PATH') ?: dirname(__DIR__) . '/storage/app.sqlite';
}

function session_cookie_secure(): bool
{
    $configured = getenv('SESSION_COOKIE_SECURE');
    if ($configured !== false) {
        return in_array(strtolower($configured), ['1', 'true', 'yes', 'on'], true);
    }

    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}
