<?php

declare(strict_types=1);

function e(?string $value): string
{
    return htmlspecialchars($value ?? '', ENT_QUOTES, 'UTF-8');
}

function excerpt(string $value, int $length = 90): string
{
    $value = trim(preg_replace('/\s+/', ' ', $value) ?? '');

    if (strlen($value) <= $length) {
        return $value;
    }

    return rtrim(substr($value, 0, max(0, $length - 3))) . '...';
}

function redirect(string $path): never
{
    header('Location: ' . $path);
    exit;
}

function flash(?string $message = null, string $type = 'success'): ?array
{
    if ($message !== null) {
        $_SESSION['flash'] = ['message' => $message, 'type' => $type];
        return null;
    }

    $flash = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);

    return $flash;
}

function render(string $view, array $data = []): void
{
    extract($data, EXTR_SKIP);
    $title = $title ?? APP_NAME;
    $currentUser = currentUser();
    $flash = flash();

    require __DIR__ . '/../views/layout.php';
}

function old(string $key, string $fallback = ''): string
{
    return $_SESSION['old'][$key] ?? $fallback;
}

function rememberOld(array $values): void
{
    $_SESSION['old'] = $values;
}

function clearOld(): void
{
    unset($_SESSION['old']);
}
