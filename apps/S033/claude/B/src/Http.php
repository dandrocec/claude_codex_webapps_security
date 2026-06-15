<?php

declare(strict_types=1);

namespace App;

/**
 * Small HTTP helpers shared by controllers.
 */
final class Http
{
    public static function redirect(string $path): never
    {
        // Only allow same-app relative redirects to avoid open redirects.
        if ($path === '' || $path[0] !== '/') {
            $path = '/';
        }
        header('Location: ' . $path, true, 303);
        exit;
    }

    public static function requireAuth(): int
    {
        if (!Auth::check()) {
            Flash::set('error', 'Please sign in to continue.');
            self::redirect('/login');
        }

        return (int) Auth::id();
    }

    /**
     * Returns the validated CSRF token from a POST body or aborts with 419.
     */
    public static function assertCsrf(array $post): void
    {
        $token = isset($post['csrf_token']) && is_string($post['csrf_token'])
            ? $post['csrf_token']
            : null;

        if (!Security::verifyCsrf($token)) {
            http_response_code(419);
            header('Content-Type: text/html; charset=utf-8');
            echo View::render('error', [
                'title' => 'Session expired',
                'heading' => 'Session expired',
                'message' => 'Your form session expired or the request could not be verified. Please go back and try again.',
            ], 419);
            exit;
        }
    }

    public static function intParam(array $source, string $key): ?int
    {
        if (!isset($source[$key])) {
            return null;
        }
        $value = filter_var($source[$key], FILTER_VALIDATE_INT);

        return $value === false ? null : (int) $value;
    }
}
