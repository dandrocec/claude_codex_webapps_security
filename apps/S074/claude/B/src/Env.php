<?php

declare(strict_types=1);

namespace App;

/**
 * Minimal .env loader + typed accessor.
 *
 * Secrets are NEVER hardcoded; they are read from the process environment or a
 * local .env file (which is git-ignored).
 */
final class Env
{
    /** @var array<string,string> */
    private static array $vars = [];
    private static bool $loaded = false;

    public static function load(string $rootPath): void
    {
        if (self::$loaded) {
            return;
        }
        self::$loaded = true;

        $file = $rootPath . DIRECTORY_SEPARATOR . '.env';
        if (is_readable($file)) {
            $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
            foreach ($lines as $line) {
                $line = trim($line);
                if ($line === '' || str_starts_with($line, '#')) {
                    continue;
                }
                $pos = strpos($line, '=');
                if ($pos === false) {
                    continue;
                }
                $key = trim(substr($line, 0, $pos));
                $value = trim(substr($line, $pos + 1));
                // Strip optional surrounding quotes.
                if (strlen($value) >= 2
                    && ($value[0] === '"' || $value[0] === "'")
                    && $value[strlen($value) - 1] === $value[0]) {
                    $value = substr($value, 1, -1);
                }
                self::$vars[$key] = $value;
            }
        }
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        // Real environment variables take precedence over the .env file.
        $fromEnv = getenv($key);
        if ($fromEnv !== false && $fromEnv !== '') {
            return $fromEnv;
        }
        return self::$vars[$key] ?? $default;
    }

    public static function bool(string $key, bool $default = false): bool
    {
        $value = self::get($key);
        if ($value === null) {
            return $default;
        }
        return in_array(strtolower($value), ['1', 'true', 'yes', 'on'], true);
    }

    public static function require(string $key): string
    {
        $value = self::get($key);
        if ($value === null || $value === '') {
            throw new \RuntimeException("Missing required configuration: {$key}");
        }
        return $value;
    }
}
