<?php

declare(strict_types=1);

namespace App;

/**
 * Synchronizer-token CSRF protection (OWASP A01). The token lives in the
 * caller's own session and is compared in constant time.
 */
final class Csrf
{
    private const SESSION_KEY = '_csrf_token';

    /**
     * Return the current session CSRF token, generating one if absent.
     * The token is seeded from a CSPRNG; the optional APP_KEY env secret is
     * mixed in so secrets are never hardcoded.
     */
    public static function token(): string
    {
        if (empty($_SESSION[self::SESSION_KEY]) || !is_string($_SESSION[self::SESSION_KEY])) {
            $appKey = (string) (getenv('APP_KEY') ?: '');
            $random = random_bytes(32);
            $_SESSION[self::SESSION_KEY] = hash_hmac('sha256', $random, $appKey !== '' ? $appKey : bin2hex($random));
        }

        return $_SESSION[self::SESSION_KEY];
    }

    /**
     * Constant-time validation of a submitted token against the session token.
     */
    public static function validate(string $submitted): bool
    {
        $stored = $_SESSION[self::SESSION_KEY] ?? '';
        if (!is_string($stored) || $stored === '' || $submitted === '') {
            return false;
        }

        return hash_equals($stored, $submitted);
    }
}
