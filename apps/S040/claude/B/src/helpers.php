<?php
declare(strict_types=1);

/**
 * Context-aware output encoding for HTML text/attributes.
 * Use e() on EVERY dynamic value rendered into a template.
 */
function e(?string $value): string
{
    return htmlspecialchars($value ?? '', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Issue an HTTP redirect and stop. */
function redirect(string $path): never
{
    header('Location: ' . $path);
    exit;
}

/** Read a trimmed string from POST. */
function post(string $key, string $default = ''): string
{
    $v = $_POST[$key] ?? $default;
    return is_string($v) ? trim($v) : $default;
}

/** Read a trimmed string from the query string. */
function query(string $key, string $default = ''): string
{
    $v = $_GET[$key] ?? $default;
    return is_string($v) ? trim($v) : $default;
}

/** Flash messages survive exactly one redirect. */
function flash(string $message, string $type = 'info'): void
{
    $_SESSION['_flash'][] = ['type' => $type, 'message' => $message];
}

function take_flashes(): array
{
    $f = $_SESSION['_flash'] ?? [];
    unset($_SESSION['_flash']);
    return $f;
}

/** Format integer cents as a currency string. */
function money(int $cents): string
{
    return '$' . number_format($cents / 100, 2);
}

/**
 * Render a view template inside the main layout.
 * $data values are available as variables to the template; escape on output.
 */
function view(string $template, array $data = [], ?string $title = null): void
{
    $data['_title'] = $title ?? 'Classifieds';
    extract($data, EXTR_SKIP);
    ob_start();
    require BASE_PATH . '/templates/' . $template . '.php';
    $content = ob_get_clean();
    require BASE_PATH . '/templates/layout.php';
}
