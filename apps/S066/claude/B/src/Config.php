<?php

declare(strict_types=1);

namespace App;

/**
 * Centralised configuration. All values originate from the environment
 * (real env vars take precedence over the optional .env file). No secrets
 * are hard-coded here.
 */
final class Config
{
    /** @var array<string,string> */
    private static array $cache = [];

    private static bool $loaded = false;

    public static function basePath(string $append = ''): string
    {
        $base = \dirname(__DIR__);
        return $append === '' ? $base : $base . DIRECTORY_SEPARATOR . ltrim($append, '/\\');
    }

    /**
     * Parse the project .env file once (if present) without overriding real
     * environment variables. Intentionally minimal so the app runs without any
     * Composer dependencies installed.
     */
    public static function loadEnv(): void
    {
        if (self::$loaded) {
            return;
        }
        self::$loaded = true;

        $file = self::basePath('.env');
        if (!is_file($file) || !is_readable($file)) {
            return;
        }

        $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#') {
                continue;
            }
            $pos = strpos($line, '=');
            if ($pos === false) {
                continue;
            }
            $key = trim(substr($line, 0, $pos));
            $val = trim(substr($line, $pos + 1));

            // Strip optional surrounding quotes.
            if (strlen($val) >= 2) {
                $first = $val[0];
                $last = $val[strlen($val) - 1];
                if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
                    $val = substr($val, 1, -1);
                }
            }

            // Do not override a real environment variable.
            if ($key !== '' && getenv($key) === false) {
                self::$cache[$key] = $val;
            }
        }
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        self::loadEnv();

        $env = getenv($key);
        if ($env !== false && $env !== '') {
            return $env;
        }
        if (array_key_exists($key, self::$cache) && self::$cache[$key] !== '') {
            return self::$cache[$key];
        }
        return $default;
    }

    public static function bool(string $key, bool $default = false): bool
    {
        $val = self::get($key);
        if ($val === null) {
            return $default;
        }
        return in_array(strtolower($val), ['1', 'true', 'yes', 'on'], true);
    }

    public static function int(string $key, int $default): int
    {
        $val = self::get($key);
        if ($val === null || !is_numeric($val)) {
            return $default;
        }
        return (int) $val;
    }

    public static function isProduction(): bool
    {
        return strtolower((string) self::get('APP_ENV', 'local')) === 'production';
    }

    public static function debug(): bool
    {
        return self::bool('APP_DEBUG', false);
    }

    public static function appKey(): string
    {
        // Used only as an optional pepper / keyed-hash secret. Falls back to a
        // per-install derived value so the app never crashes if unset, but a
        // strong APP_KEY should always be configured.
        $key = self::get('APP_KEY');
        if ($key === null || strlen($key) < 16) {
            return hash('sha256', 'insecure-default|' . self::basePath());
        }
        return $key;
    }

    public static function dbPath(): string
    {
        return self::resolvePath((string) self::get('DB_PATH', 'storage/app.sqlite'));
    }

    public static function uploadDir(): string
    {
        return self::resolvePath((string) self::get('UPLOAD_DIR', 'storage/uploads'));
    }

    public static function maxUploadBytes(): int
    {
        return self::int('MAX_UPLOAD_BYTES', 5 * 1024 * 1024);
    }

    /**
     * Decide whether session cookies should carry the Secure flag.
     * Explicit SESSION_SECURE=true wins; otherwise auto-detect HTTPS.
     */
    public static function secureCookies(): bool
    {
        $explicit = self::get('SESSION_SECURE');
        if ($explicit !== null) {
            return in_array(strtolower($explicit), ['1', 'true', 'yes', 'on'], true);
        }
        return self::requestIsHttps();
    }

    public static function requestIsHttps(): bool
    {
        if (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') {
            return true;
        }
        if (($_SERVER['SERVER_PORT'] ?? null) == 443) {
            return true;
        }
        if (strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https') {
            return true;
        }
        return false;
    }

    private static function resolvePath(string $path): string
    {
        $isAbsolute = preg_match('#^([a-zA-Z]:[\\\\/]|[\\\\/])#', $path) === 1;
        return $isAbsolute ? $path : self::basePath($path);
    }
}
