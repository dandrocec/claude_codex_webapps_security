<?php

declare(strict_types=1);

namespace App;

/**
 * Minimal PSR-4-style autoloader for the App\ namespace plus global error
 * handling that prevents internal details (stack traces) from leaking to
 * clients (OWASP A09).
 */

spl_autoload_register(static function (string $class): void {
    $prefix = 'App\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    $path = __DIR__ . '/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($path)) {
        require $path;
    }
});

// Never render PHP errors/stack traces to the client. Log them instead.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

set_exception_handler(static function (\Throwable $e): void {
    error_log('Unhandled exception: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: text/plain; charset=UTF-8');
    }
    echo "An unexpected error occurred. Please try again later.\n";
});
