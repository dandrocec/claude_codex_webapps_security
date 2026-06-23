<?php

declare(strict_types=1);

namespace App;

/**
 * Thin wrapper around the current HTTP request.
 */
final class Request
{
    public static function method(): string
    {
        return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    }

    public static function path(): string
    {
        $uri = $_SERVER['REQUEST_URI'] ?? '/';
        $path = parse_url($uri, PHP_URL_PATH);
        $path = is_string($path) ? $path : '/';
        $path = rtrim($path, '/');
        return $path === '' ? '/' : $path;
    }

    public static function isPost(): bool
    {
        return self::method() === 'POST';
    }

    /** @return array<string,mixed> */
    public static function post(): array
    {
        return is_array($_POST) ? $_POST : [];
    }

    public static function query(string $key, ?string $default = null): ?string
    {
        $value = $_GET[$key] ?? null;
        return is_scalar($value) ? (string) $value : $default;
    }

    public static function postValue(string $key, ?string $default = null): ?string
    {
        $value = $_POST[$key] ?? null;
        return is_scalar($value) ? (string) $value : $default;
    }
}
