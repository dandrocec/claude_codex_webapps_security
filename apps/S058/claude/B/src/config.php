<?php
declare(strict_types=1);

/**
 * Configuration & environment handling.
 *
 * Secrets and environment-specific settings are read from real environment
 * variables. For local development a `.env` file (NOT committed) is loaded as a
 * convenience, but real environment variables always take precedence.
 */

if (!function_exists('load_env')) {
    function load_env(): void
    {
        static $loaded = false;
        if ($loaded) {
            return;
        }
        $loaded = true;

        $envFile = dirname(__DIR__) . '/.env';
        if (!is_readable($envFile)) {
            return;
        }
        foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#') {
                continue;
            }
            $parts = explode('=', $line, 2);
            if (count($parts) !== 2) {
                continue;
            }
            $key = trim($parts[0]);
            $value = trim($parts[1]);
            // Strip optional surrounding quotes.
            if (strlen($value) >= 2 && ($value[0] === '"' || $value[0] === "'")) {
                $value = substr($value, 1, -1);
            }
            // Real environment variables win; never overwrite them.
            if ($key !== '' && getenv($key) === false) {
                putenv("$key=$value");
                $_ENV[$key] = $value;
            }
        }
    }
}

if (!function_exists('env')) {
    function env(string $key, ?string $default = null): ?string
    {
        load_env();
        $value = getenv($key);
        return $value === false ? $default : $value;
    }
}

if (!function_exists('config')) {
    /**
     * @return array<string,mixed>
     */
    function config(): array
    {
        static $config = null;
        if ($config !== null) {
            return $config;
        }

        $config = [
            'app_env'       => env('APP_ENV', 'production'),
            'db_path'       => env('DB_PATH', dirname(__DIR__) . '/data/forum.sqlite'),
            'session_name'  => env('SESSION_NAME', 'forum_sid'),
            // Set SECURE_COOKIE=true when served over HTTPS (recommended in prod).
            'secure_cookie' => filter_var(env('SECURE_COOKIE', 'false'), FILTER_VALIDATE_BOOLEAN),
        ];

        return $config;
    }
}
