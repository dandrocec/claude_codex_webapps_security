<?php

declare(strict_types=1);

namespace App;

/**
 * Synchroniser-token CSRF protection (OWASP A01). A per-session secret token is
 * embedded in every state-changing form and verified with a constant-time
 * comparison on POST.
 */
final class Csrf
{
    private const KEY = '__csrf_token';

    public static function token(): string
    {
        $token = Session::get(self::KEY);
        if (!is_string($token) || $token === '') {
            $token = bin2hex(random_bytes(32));
            Session::set(self::KEY, $token);
        }
        return $token;
    }

    public static function verify(?string $candidate): bool
    {
        $token = Session::get(self::KEY);
        return is_string($token)
            && is_string($candidate)
            && $candidate !== ''
            && hash_equals($token, $candidate);
    }

    /** Hidden input markup for inclusion in forms. */
    public static function field(): string
    {
        return '<input type="hidden" name="csrf_token" value="' . htmlspecialchars(self::token(), ENT_QUOTES, 'UTF-8') . '">';
    }
}
