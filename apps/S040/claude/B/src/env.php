<?php
declare(strict_types=1);

/**
 * Minimal .env loader (no external dependency).
 * Lines are KEY=VALUE; quotes optional; # starts a comment.
 * Real OS environment variables always take precedence over the file.
 */
function env_load(string $path): void
{
    if (!is_readable($path)) {
        return;
    }
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
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

        // Strip surrounding quotes if present.
        if (strlen($val) >= 2
            && (($val[0] === '"' && substr($val, -1) === '"')
                || ($val[0] === "'" && substr($val, -1) === "'"))) {
            $val = substr($val, 1, -1);
        }

        // Do not override variables already present in the real environment.
        if (getenv($key) === false && !isset($_ENV[$key])) {
            putenv("$key=$val");
            $_ENV[$key] = $val;
        }
    }
}

function env(string $key, ?string $default = null): ?string
{
    $val = $_ENV[$key] ?? getenv($key);
    if ($val === false || $val === null || $val === '') {
        return $default;
    }
    return (string) $val;
}
