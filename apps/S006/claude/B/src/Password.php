<?php

declare(strict_types=1);

namespace App;

/**
 * Password hashing helper (OWASP A07).
 *
 * This text analyzer has no authentication today, but per the security
 * requirements here is the canonical, ready-to-use approach: a strong, salted
 * one-way algorithm. password_hash() generates and embeds a per-password salt
 * automatically — never store plaintext or unsalted/fast hashes (md5/sha1).
 *
 * Uses Argon2id when the build supports it, otherwise bcrypt.
 */
final class Password
{
    public static function hash(string $plaintext): string
    {
        $algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;

        $hash = password_hash($plaintext, $algo);
        if (!is_string($hash)) {
            throw new \RuntimeException('Password hashing failed.');
        }

        return $hash;
    }

    public static function verify(string $plaintext, string $hash): bool
    {
        return password_verify($plaintext, $hash);
    }

    public static function needsRehash(string $hash): bool
    {
        $algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;

        return password_needs_rehash($hash, $algo);
    }
}
