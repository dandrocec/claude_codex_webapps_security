<?php

declare(strict_types=1);

/**
 * Application bootstrap: autoloading, error handling, env, session.
 * Works with OR without `composer install` (provides a small PSR-4 autoloader
 * fallback for the App\ namespace).
 */

use App\Config;
use App\Session;

// --- Autoloading -----------------------------------------------------------
$composerAutoload = \dirname(__DIR__) . '/vendor/autoload.php';
if (is_file($composerAutoload)) {
    require $composerAutoload;
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

// --- Configuration ---------------------------------------------------------
Config::loadEnv();

// --- Error handling: never leak internals to the client --------------------
$debug = Config::debug();

error_reporting(E_ALL);
ini_set('display_errors', $debug ? '1' : '0');
ini_set('log_errors', '1');

set_exception_handler(static function (\Throwable $e) use ($debug): void {
    error_log('[realestate] Uncaught: ' . $e->getMessage() . ' @ '
        . $e->getFile() . ':' . $e->getLine());

    if (!headers_sent()) {
        http_response_code(500);
        Session::sendSecurityHeaders();
        header('Content-Type: text/html; charset=UTF-8');
    }

    if ($debug) {
        echo '<h1>500 — ' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8') . '</h1>';
        echo '<pre>' . htmlspecialchars($e->getTraceAsString(), ENT_QUOTES, 'UTF-8') . '</pre>';
    } else {
        echo '<!doctype html><meta charset="utf-8"><title>Server error</title>'
            . '<h1>500 — Something went wrong</h1>'
            . '<p>An unexpected error occurred. Please try again later.</p>';
    }
    exit;
});

set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false;
    }
    throw new \ErrorException($message, 0, $severity, $file, $line);
});

// --- Session + security headers -------------------------------------------
Session::start();
