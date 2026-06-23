<?php

declare(strict_types=1);

namespace App;

use PDO;

/**
 * Authentication & password handling.
 *
 *  - Passwords are hashed with a strong, salted algorithm. We prefer Argon2id
 *    when the build supports it and fall back to bcrypt (PASSWORD_DEFAULT).
 *  - Lookups use prepared statements (no SQL injection).
 *  - On login the session id is regenerated to prevent fixation.
 */
final class Auth
{
    public const ROLE_BUYER  = 'buyer';
    public const ROLE_VENDOR = 'vendor';

    private static function algo(): string
    {
        return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
    }

    /**
     * Apply a server-side "pepper" (kept in APP_SECRET / the environment, never
     * in the database) before hashing. This is defence-in-depth: even with a
     * full DB dump an attacker still lacks the pepper. We HMAC first so the
     * value handed to password_hash is a fixed 64-char hex string, sidestepping
     * bcrypt's 72-byte truncation. If APP_SECRET is unset the key is empty and
     * the scheme degrades gracefully to a plain salted hash.
     */
    private static function pepper(string $password): string
    {
        $key = Env::get('APP_SECRET', '') ?? '';
        return hash_hmac('sha256', $password, $key);
    }

    public static function hash(string $password): string
    {
        return password_hash(self::pepper($password), self::algo());
    }

    /**
     * @return array{id:int,email:string,name:string,role:string}|null
     */
    public static function attempt(string $email, string $password): ?array
    {
        $pdo = Database::connection();
        $stmt = $pdo->prepare('SELECT id, email, name, role, password_hash FROM users WHERE email = :email');
        $stmt->execute([':email' => $email]);
        $row = $stmt->fetch();

        // Always run a hash verification (even on unknown user) to reduce timing
        // oracles that reveal which emails are registered.
        $hash = is_array($row) ? (string) $row['password_hash'] : '$2y$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
        if (!password_verify(self::pepper($password), $hash) || !is_array($row)) {
            return null;
        }

        // Transparently upgrade the hash if the algorithm/params have changed.
        if (password_needs_rehash($hash, self::algo())) {
            $upd = $pdo->prepare('UPDATE users SET password_hash = :h WHERE id = :id');
            $upd->execute([':h' => self::hash($password), ':id' => $row['id']]);
        }

        return [
            'id'    => (int) $row['id'],
            'email' => (string) $row['email'],
            'name'  => (string) $row['name'],
            'role'  => (string) $row['role'],
        ];
    }

    /** @param array{id:int,email:string,name:string,role:string} $user */
    public static function login(array $user): void
    {
        Session::regenerate();
        Session::set('user', $user);
    }

    public static function logout(): void
    {
        Session::destroy();
    }

    /** @return array{id:int,email:string,name:string,role:string}|null */
    public static function user(): ?array
    {
        $user = Session::get('user');
        return is_array($user) ? $user : null;
    }

    public static function id(): ?int
    {
        $user = self::user();
        return $user['id'] ?? null;
    }

    public static function check(): bool
    {
        return self::user() !== null;
    }

    public static function role(): ?string
    {
        return self::user()['role'] ?? null;
    }

    public static function isVendor(): bool
    {
        return self::role() === self::ROLE_VENDOR;
    }

    public static function isBuyer(): bool
    {
        return self::role() === self::ROLE_BUYER;
    }
}
