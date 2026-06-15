<?php

declare(strict_types=1);

/**
 * Context-aware output encoding for HTML text/attribute contexts.
 * Always use this when echoing any value into a template to prevent XSS.
 */
function e(?string $value): string
{
    return htmlspecialchars($value ?? '', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/**
 * Read an environment variable with an optional default.
 */
function env(string $key, ?string $default = null): ?string
{
    $value = $_ENV[$key] ?? getenv($key);
    if ($value === false || $value === null || $value === '') {
        return $default;
    }
    return $value;
}

/**
 * Render a view file inside the shared layout and return the HTML string.
 * Variables are passed explicitly so templates never see request superglobals.
 */
function view(string $template, array $data = []): string
{
    $viewsPath = dirname(__DIR__) . '/views/';

    extract($data, EXTR_SKIP);

    ob_start();
    require $viewsPath . $template . '.php';
    $content = ob_get_clean();

    ob_start();
    require $viewsPath . 'layout.php';
    return ob_get_clean();
}

/**
 * Send a redirect response and stop. Only allows local (relative) paths to
 * avoid open-redirect issues.
 */
function redirect(string $path): never
{
    if ($path === '' || $path[0] !== '/') {
        $path = '/';
    }
    header('Location: ' . $path, true, 302);
    exit;
}
