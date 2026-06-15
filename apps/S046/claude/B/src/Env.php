<?php
declare(strict_types=1);

namespace App;

/**
 * Minimal .env loader. Secrets are read from the environment so that no
 * credentials are hardcoded in the source tree.
 */
final class Env
{
    private static array $vars = [];
    private static bool $loaded = false;

    public static function load(string $path): void
    {
        if (self::$loaded) {
            return;
        }
        self::$loaded = true;

        // Real environment variables always take precedence.
        foreach ($_SERVER as $k => $v) {
            if (is_string($v)) {
                self::$vars[$k] = $v;
            }
        }
        foreach ($_ENV as $k => $v) {
            if (is_string($v)) {
                self::$vars[$k] = $v;
            }
        }

        if (!is_file($path) || !is_readable($path)) {
            return;
        }

        foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
                continue;
            }
            [$key, $value] = explode('=', $line, 2);
            $key = trim($key);
            $value = trim($value);
            // Strip optional surrounding quotes.
            if (strlen($value) >= 2
                && (($value[0] === '"' && substr($value, -1) === '"')
                 || ($value[0] === "'" && substr($value, -1) === "'"))) {
                $value = substr($value, 1, -1);
            }
            // Do not override values supplied by the real environment.
            if (!array_key_exists($key, self::$vars)) {
                self::$vars[$key] = $value;
            }
        }
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        return self::$vars[$key] ?? $default;
    }

    public static function bool(string $key, bool $default = false): bool
    {
        $v = self::$vars[$key] ?? null;
        if ($v === null) {
            return $default;
        }
        return in_array(strtolower($v), ['1', 'true', 'yes', 'on'], true);
    }
}
