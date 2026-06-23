<?php

declare(strict_types=1);

namespace App;

/**
 * Helpers for redirects and access-control gates. Throwing HttpException unwinds
 * to the front controller which renders a safe error page (no stack traces).
 */
final class HttpException extends \RuntimeException
{
    public function __construct(public int $status, string $message)
    {
        parent::__construct($message);
    }
}

final class Http
{
    /** Issue a redirect and stop. Returns empty body for the dispatcher. */
    public static function redirect(string $path): string
    {
        // Only allow local, relative redirects to avoid open-redirect abuse.
        if (!str_starts_with($path, '/') || str_starts_with($path, '//')) {
            $path = '/';
        }
        header('Location: ' . $path, true, 302);
        return '';
    }

    public static function requireAuth(): void
    {
        if (!Auth::check()) {
            Session::flash('Please sign in to continue.', 'error');
            throw new HttpException(401, 'redirect:/login');
        }
    }

    public static function requireVendor(): void
    {
        self::requireAuth();
        if (!Auth::isVendor()) {
            throw new HttpException(403, 'You need a vendor account to access that area.');
        }
    }

    public static function requireBuyer(): void
    {
        self::requireAuth();
        if (!Auth::isBuyer()) {
            throw new HttpException(403, 'Only buyer accounts can do that.');
        }
    }
}
