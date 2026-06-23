<?php

declare(strict_types=1);

namespace App;

/**
 * Synchroniser-token CSRF protection. A token is stored in the session and
 * must accompany every state-changing (POST) request.
 */
final class Csrf
{
    private const KEY = '__csrf_token';

    public static function token(): string
    {
        if (empty($_SESSION[self::KEY])) {
            $_SESSION[self::KEY] = bin2hex(random_bytes(32));
        }
        return $_SESSION[self::KEY];
    }

    /** Hidden form field markup. */
    public static function field(): string
    {
        $token = htmlspecialchars(self::token(), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        return '<input type="hidden" name="csrf_token" value="' . $token . '">';
    }

    public static function check(?string $submitted): bool
    {
        $stored = $_SESSION[self::KEY] ?? '';
        if (!is_string($submitted) || $submitted === '' || $stored === '') {
            return false;
        }
        return hash_equals($stored, $submitted);
    }

    /**
     * Validate the token for the current request or abort with 419.
     */
    public static function requireValid(): void
    {
        $submitted = $_POST['csrf_token'] ?? null;
        if (!self::check(is_string($submitted) ? $submitted : null)) {
            http_response_code(419);
            Session::sendSecurityHeaders();
            header('Content-Type: text/html; charset=UTF-8');
            echo '<!doctype html><meta charset="utf-8"><title>Request expired</title>'
                . '<h1>419 — Request could not be verified</h1>'
                . '<p>Your session token was missing or expired. Please go back and try again.</p>';
            exit;
        }
    }
}
