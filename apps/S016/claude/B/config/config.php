<?php
declare(strict_types=1);

/**
 * Central configuration.
 *
 * Secrets and environment-specific settings are read from environment
 * variables — never hardcoded. See .env.example for the full list.
 */

/**
 * Tiny .env loader (no external dependency required to run).
 * Real environment variables always win over .env file values.
 */
function load_dotenv(string $path): void
{
    if (!is_readable($path)) {
        return;
    }
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') {
            continue;
        }
        if (!str_contains($line, '=')) {
            continue;
        }
        [$key, $value] = explode('=', $line, 2);
        $key = trim($key);
        $value = trim($value);
        // Strip optional surrounding quotes.
        if (strlen($value) >= 2
            && ($value[0] === '"' || $value[0] === "'")
            && $value[strlen($value) - 1] === $value[0]) {
            $value = substr($value, 1, -1);
        }
        if (getenv($key) === false && $key !== '') {
            putenv("$key=$value");
            $_ENV[$key] = $value;
        }
    }
}

function env(string $key, ?string $default = null): ?string
{
    $value = getenv($key);
    return $value === false ? $default : $value;
}

load_dotenv(dirname(__DIR__) . '/.env');

return [
    // 'production' disables verbose errors; 'development' shows them.
    'app_env'      => env('APP_ENV', 'production'),

    // Application secret (used to sign/identify the CSRF + session layer).
    // MUST be set in production. Generate with: php -r "echo bin2hex(random_bytes(32));"
    'app_secret'   => env('APP_SECRET', ''),

    // Send the Secure cookie flag only over HTTPS. Auto-detected, but can be
    // forced on/off via COOKIE_SECURE (true/false) when behind a TLS proxy.
    'cookie_secure' => (function (): bool {
        $forced = env('COOKIE_SECURE');
        if ($forced !== null) {
            return filter_var($forced, FILTER_VALIDATE_BOOLEAN);
        }
        return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    })(),

    // Absolute path to the vote storage file (kept outside the web root).
    'storage_file' => env('STORAGE_FILE', dirname(__DIR__) . '/data/votes.json'),

    // The single poll. Option keys are stable IDs; labels are display text.
    'poll' => [
        'question' => 'Which programming language do you enjoy most?',
        'options'  => [
            'php'    => 'PHP',
            'python' => 'Python',
            'js'     => 'JavaScript',
        ],
    ],
];
