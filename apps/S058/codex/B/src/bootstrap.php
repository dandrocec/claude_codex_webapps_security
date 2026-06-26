<?php

declare(strict_types=1);

spl_autoload_register(static function (string $class): void {
    $prefix = 'Forum\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }

    $relative = substr($class, strlen($prefix));
    $path = __DIR__ . '/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($path)) {
        require $path;
    }
});

set_exception_handler(static function (Throwable $e): void {
    error_log($e->getMessage());
    http_response_code(500);
    echo '<!doctype html><meta charset="utf-8"><title>Error</title><p>Something went wrong.</p>';
});
