<?php

declare(strict_types=1);

namespace App;

/**
 * Small view/request helpers used across controllers and templates.
 */
final class Helpers
{
    /** Escape a value for safe HTML output. */
    public static function e(mixed $value): string
    {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    }

    /** Format an integer price as a currency string. */
    public static function money(int $amount): string
    {
        return '$' . number_format($amount);
    }

    /** Redirect to a path and stop execution. */
    public static function redirect(string $path): never
    {
        header('Location: ' . $path);
        exit;
    }

    /** Render a view file with the shared layout. */
    public static function view(string $name, array $data = []): void
    {
        extract($data, EXTR_SKIP);
        $viewFile = dirname(__DIR__) . '/views/' . $name . '.php';

        ob_start();
        require $viewFile;
        $content = ob_get_clean();

        $title = $data['title'] ?? 'RealEstate';
        require dirname(__DIR__) . '/views/layout.php';
    }

    /** One-time flash message stored in the session. */
    public static function flash(?string $message = null): ?string
    {
        if ($message !== null) {
            $_SESSION['flash'] = $message;
            return null;
        }
        $msg = $_SESSION['flash'] ?? null;
        unset($_SESSION['flash']);
        return $msg;
    }
}
