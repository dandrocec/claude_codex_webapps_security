<?php

declare(strict_types=1);

namespace App;

/**
 * Tiny template renderer. Templates are plain PHP files in /views and are
 * wrapped in the shared layout. Output encoding is the template's job via
 * Security::e(); this class only provides the seam.
 */
final class View
{
    private const VIEW_DIR = __DIR__ . '/../views';

    /** @param array<string, mixed> $data */
    public static function render(string $template, array $data = [], int $status = 200): string
    {
        http_response_code($status);

        $content = self::capture($template, $data);

        $layoutData = $data + [
            '__content' => $content,
            'title' => $data['title'] ?? 'Address Book',
        ];

        return self::capture('layout', $layoutData);
    }

    /** @param array<string, mixed> $data */
    private static function capture(string $template, array $data): string
    {
        $file = self::VIEW_DIR . '/' . $template . '.php';
        if (!is_file($file)) {
            throw new \RuntimeException('View not found: ' . $template);
        }

        $e = static fn (?string $v): string => Security::e($v);

        extract($data, EXTR_SKIP);
        ob_start();
        require $file;

        return (string) ob_get_clean();
    }
}
