<?php

declare(strict_types=1);

namespace Gallery;

final class Http
{
    public static function redirect(string $path): never
    {
        header('Location: ' . $path, true, 303);
        exit;
    }

    public static function flash(string $message, string $type): void
    {
        $_SESSION['flash'] = ['message' => $message, 'type' => $type];
    }

    public static function consumeFlash(): ?array
    {
        $flash = $_SESSION['flash'] ?? null;
        unset($_SESSION['flash']);
        return is_array($flash) ? $flash : null;
    }

    public static function safeLocalPath(string $candidate): string
    {
        $parts = parse_url($candidate);
        if ($parts === false) {
            return '/';
        }
        $path = $parts['path'] ?? '/';
        if (!is_string($path) || !str_starts_with($path, '/')) {
            return '/';
        }
        $query = isset($parts['query']) && is_string($parts['query']) ? '?' . $parts['query'] : '';
        return $path . $query;
    }
}
