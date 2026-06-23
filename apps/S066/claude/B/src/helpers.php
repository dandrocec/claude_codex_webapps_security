<?php

declare(strict_types=1);

use App\Config;
use App\Session;

/**
 * Context-aware output encoding for HTML text/attribute context.
 * Use this on EVERY piece of dynamic data echoed into a template.
 */
function e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Send a redirect and stop. Only allows local (same-app) paths. */
function redirect(string $path, int $status = 302): never
{
    // Prevent open-redirect: force a single leading slash, strip scheme/host.
    if (!str_starts_with($path, '/') || str_starts_with($path, '//')) {
        $path = '/';
    }
    header('Location: ' . $path, true, $status);
    exit;
}

/** Flash message helpers (one-shot messages stored in session). */
function flash(string $type, string $message): void
{
    $_SESSION['__flash'][$type][] = $message;
}

/** @return array<string,string[]> */
function take_flash(): array
{
    $flash = $_SESSION['__flash'] ?? [];
    unset($_SESSION['__flash']);
    return is_array($flash) ? $flash : [];
}

/**
 * Render a view inside the layout and stop. All views receive $data keys as
 * variables. Output is buffered so headers can be sent first.
 *
 * @param array<string,mixed> $data
 */
function view(string $template, array $data = [], int $status = 200): never
{
    http_response_code($status);
    Session::sendSecurityHeaders();
    header('Content-Type: text/html; charset=UTF-8');

    $viewFile = Config::basePath('views/' . $template . '.php');
    if (!is_file($viewFile)) {
        throw new RuntimeException('View not found: ' . $template);
    }

    $flash = take_flash();
    extract($data, EXTR_SKIP);

    ob_start();
    require $viewFile;
    $content = ob_get_clean();

    require Config::basePath('views/layout.php');
    exit;
}

/** Trim + collapse a string input to a bounded length. */
function clean_text(mixed $value, int $maxLen = 255): string
{
    if (!is_string($value)) {
        return '';
    }
    $value = trim($value);
    // Strip control chars except newline/tab.
    $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value) ?? '';
    if (mb_strlen($value) > $maxLen) {
        $value = mb_substr($value, 0, $maxLen);
    }
    return $value;
}

function is_post(): bool
{
    return ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
}

/** Money formatter for display. */
function format_price(int $cents_or_units): string
{
    return '$' . number_format((float) $cents_or_units, 0, '.', ',');
}
