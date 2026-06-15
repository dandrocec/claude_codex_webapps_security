<?php

declare(strict_types=1);

/*
 * Generate a salted password hash for the admin account.
 * Usage: php bin/generate-admin-hash.php "your-strong-password"
 *
 * Copy the output into ADMIN_PASSWORD_HASH in your .env file.
 */

$password = $argv[1] ?? null;

if ($password === null || $password === '') {
    fwrite(STDERR, "Usage: php bin/generate-admin-hash.php \"<password>\"\n");
    exit(1);
}

// PASSWORD_DEFAULT is bcrypt today; PASSWORD_ARGON2ID if available.
$algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;

echo password_hash($password, $algo) . "\n";
