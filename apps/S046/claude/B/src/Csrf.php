<?php
declare(strict_types=1);

namespace App;

/**
 * CSRF protection using the synchronizer-token pattern.
 * A per-session token is required on every state-changing (POST) request.
 */
final class Csrf
{
    private const SESSION_KEY = '__csrf_token';

    public static function token(): string
    {
        if (empty($_SESSION[self::SESSION_KEY]) || !is_string($_SESSION[self::SESSION_KEY])) {
            $_SESSION[self::SESSION_KEY] = bin2hex(random_bytes(32));
        }
        return $_SESSION[self::SESSION_KEY];
    }

    /** Render a hidden form field carrying the token. */
    public static function field(): string
    {
        return '<input type="hidden" name="_csrf" value="' . e(self::token()) . '">';
    }

    /** Constant-time validation of a submitted token. */
    public static function validate(?string $submitted): bool
    {
        $expected = $_SESSION[self::SESSION_KEY] ?? '';
        return is_string($submitted)
            && $submitted !== ''
            && is_string($expected)
            && $expected !== ''
            && hash_equals($expected, $submitted);
    }

    /** Abort the request with 419 if the token is missing/invalid. */
    public static function check(): void
    {
        if (strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
            return;
        }
        $token = $_POST['_csrf'] ?? null;
        if (!self::validate(is_string($token) ? $token : null)) {
            http_response_code(419);
            header('Content-Type: text/html; charset=utf-8');
            echo '<!doctype html><meta charset="utf-8"><title>Expired</title>'
                . '<h1>Session expired</h1><p>Your form session expired or was invalid. '
                . 'Please go back and try again.</p>';
            exit;
        }
    }
}
