<?php
declare(strict_types=1);

namespace PhotoBlog;

use RuntimeException;

final class Http
{
    public static function string(string $key, int $min, int $max): string
    {
        $value = trim((string)($_POST[$key] ?? ''));
        $length = mb_strlen($value);
        if ($length < $min || $length > $max) {
            throw new RuntimeException("Invalid {$key} length.", 422);
        }
        return preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value) ?? '';
    }

    public static function redirect(string $path): never
    {
        header('Location: ' . $path, true, 303);
        exit;
    }
}
