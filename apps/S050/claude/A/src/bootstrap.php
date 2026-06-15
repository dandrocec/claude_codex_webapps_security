<?php

declare(strict_types=1);

/**
 * Bootstrap: autoloading + session.
 *
 * Uses Composer's autoloader when available, but falls back to a tiny PSR-4
 * autoloader so the app runs even if `composer install` was never executed.
 */

$vendorAutoload = dirname(__DIR__) . '/vendor/autoload.php';

if (is_file($vendorAutoload)) {
    require $vendorAutoload;
} else {
    spl_autoload_register(static function (string $class): void {
        $prefix = 'App\\';
        if (!str_starts_with($class, $prefix)) {
            return;
        }
        $relative = substr($class, strlen($prefix));
        $file = __DIR__ . '/' . str_replace('\\', '/', $relative) . '.php';
        if (is_file($file)) {
            require $file;
        }
    });

    require __DIR__ . '/helpers.php';
}

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}
