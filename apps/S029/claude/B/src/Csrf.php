<?php

declare(strict_types=1);

namespace App;

/**
 * Synchronizer-token CSRF protection. A random token is stored in the session
 * and must accompany every state-changing (POST) request.
 */
final class Csrf
{
    private const SESSION_KEY = '_csrf_token';

    public static function token(): string
    {
        if (empty($_SESSION[self::SESSION_KEY])) {
            $_SESSION[self::SESSION_KEY] = bin2hex(random_bytes(32));
        }
        return $_SESSION[self::SESSION_KEY];
    }

    /**
     * Hidden input markup for embedding in forms.
     */
    public static function field(): string
    {
        return '<input type="hidden" name="csrf_token" value="' . e(self::token()) . '">';
    }

    /**
     * Constant-time comparison of the submitted token against the session token.
     */
    public static function validate(?string $submitted): bool
    {
        $expected = $_SESSION[self::SESSION_KEY] ?? '';
        return is_string($submitted)
            && $expected !== ''
            && hash_equals($expected, $submitted);
    }
}
