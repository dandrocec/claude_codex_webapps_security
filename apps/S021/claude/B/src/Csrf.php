<?php

declare(strict_types=1);

namespace App;

/**
 * Synchronizer-token CSRF protection.
 *
 * A per-session secret token is generated once and validated on every
 * state-changing request using a constant-time comparison.
 */
final class Csrf
{
    private const SESSION_KEY = 'csrf_token';

    /**
     * Return the current session's CSRF token, creating one if needed.
     */
    public static function token(): string
    {
        if (empty($_SESSION[self::SESSION_KEY]) || !is_string($_SESSION[self::SESSION_KEY])) {
            $_SESSION[self::SESSION_KEY] = bin2hex(random_bytes(32));
        }
        return $_SESSION[self::SESSION_KEY];
    }

    /**
     * Validate a submitted token against the session token.
     */
    public static function validate(string $submitted): bool
    {
        $expected = $_SESSION[self::SESSION_KEY] ?? null;
        if (!is_string($expected) || $expected === '' || $submitted === '') {
            return false;
        }
        return hash_equals($expected, $submitted);
    }
}
