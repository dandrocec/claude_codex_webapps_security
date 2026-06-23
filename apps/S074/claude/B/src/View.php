<?php

declare(strict_types=1);

namespace App;

/**
 * Tiny template renderer. Views are plain PHP files; all dynamic output must be
 * passed through e() for context-aware HTML encoding (OWASP A03 - XSS).
 */
final class View
{
    private static string $viewPath = '';

    public static function setViewPath(string $path): void
    {
        self::$viewPath = rtrim($path, '/\\');
    }

    /** @param array<string,mixed> $data */
    public static function render(string $template, array $data = [], int $status = 200): string
    {
        http_response_code($status);

        $data['flashes'] = Session::takeFlashes();
        $data['currentUser'] = Auth::user();
        $data['cartCount'] = Cart::count();

        $content = self::capture($template, $data);
        $data['content'] = $content;

        return self::capture('layout', $data);
    }

    /** @param array<string,mixed> $data */
    private static function capture(string $template, array $data): string
    {
        $file = self::$viewPath . DIRECTORY_SEPARATOR . $template . '.php';
        if (!is_file($file)) {
            throw new \RuntimeException("View not found: {$template}");
        }
        extract($data, EXTR_SKIP);
        ob_start();
        require $file;
        return (string) ob_get_clean();
    }
}

/**
 * Global output-encoding helper used by every view. ENT_QUOTES encodes both
 * single and double quotes so the helper is safe in attribute contexts too.
 */
function e(mixed $value): string
{
    return htmlspecialchars((string) ($value ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Format integer cents as a currency string. */
function money(int $cents): string
{
    return '$' . number_format($cents / 100, 2);
}
