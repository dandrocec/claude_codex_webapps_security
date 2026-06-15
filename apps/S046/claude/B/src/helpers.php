<?php
declare(strict_types=1);

/**
 * Global helper functions.
 */

if (!function_exists('e')) {
    /**
     * Context-aware HTML escaping for output encoding (XSS prevention).
     * Use everywhere user-controlled data is rendered into HTML.
     */
    function e(?string $value): string
    {
        return htmlspecialchars($value ?? '', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}

if (!function_exists('redirect')) {
    function redirect(string $path): never
    {
        // Only allow internal redirects to avoid open-redirect issues.
        if (!str_starts_with($path, '/')) {
            $path = '/';
        }
        header('Location: ' . $path, true, 302);
        exit;
    }
}

if (!function_exists('old')) {
    /**
     * Retrieve (and clear) form input flashed after a validation failure.
     */
    function old(string $key, string $default = ''): string
    {
        $val = $_SESSION['__old'][$key] ?? $default;
        return is_string($val) ? $val : $default;
    }
}

if (!function_exists('flash')) {
    function flash(string $key, ?string $message = null): ?string
    {
        if ($message !== null) {
            $_SESSION['__flash'][$key] = $message;
            return null;
        }
        $val = $_SESSION['__flash'][$key] ?? null;
        unset($_SESSION['__flash'][$key]);
        return $val;
    }
}

if (!function_exists('view')) {
    /**
     * Render a template with the given data. Templates use e() for output
     * encoding; data is extracted into local scope.
     */
    function view(string $template, array $data = []): void
    {
        $file = APP_ROOT . '/templates/' . $template . '.php';
        if (!is_file($file)) {
            throw new RuntimeException('View not found: ' . $template);
        }
        extract($data, EXTR_SKIP);
        $__content_template = $file;
        require APP_ROOT . '/templates/layout.php';
    }
}
