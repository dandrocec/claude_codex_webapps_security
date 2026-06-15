<?php

declare(strict_types=1);

namespace App;

/**
 * Minimal .env loader. Reads KEY=VALUE pairs from a .env file (if present)
 * and exposes them. Real environment variables always take precedence so
 * secrets can be injected by the host without a file on disk.
 */
final class Env
{
    /** @var array<string, string> */
    private static array $vars = [];

    private static bool $loaded = false;

    public static function load(string $path): void
    {
        self::$loaded = true;

        if (!is_file($path) || !is_readable($path)) {
            return;
        }

        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if ($lines === false) {
            return;
        }

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
            if (strlen($value) >= 2) {
                $first = $value[0];
                $last = $value[strlen($value) - 1];
                if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
                    $value = substr($value, 1, -1);
                }
            }

            if ($key !== '') {
                self::$vars[$key] = $value;
            }
        }
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        // Real environment variables win over the .env file.
        $fromEnv = getenv($key);
        if ($fromEnv !== false && $fromEnv !== '') {
            return $fromEnv;
        }

        if (isset($_SERVER[$key]) && is_string($_SERVER[$key]) && $_SERVER[$key] !== '') {
            return $_SERVER[$key];
        }

        if (array_key_exists($key, self::$vars) && self::$vars[$key] !== '') {
            return self::$vars[$key];
        }

        return $default;
    }

    public static function bool(string $key, bool $default = false): bool
    {
        $value = self::get($key);
        if ($value === null) {
            return $default;
        }

        return in_array(strtolower($value), ['1', 'true', 'yes', 'on'], true);
    }
}
