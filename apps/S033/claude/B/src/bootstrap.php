<?php

declare(strict_types=1);

use App\Env;
use App\Security;
use App\View;

/*
 * Application bootstrap: autoloading, environment, error handling, session,
 * and security headers. Required by the front controller before any routing.
 */

$root = dirname(__DIR__);

// --- Autoloading -----------------------------------------------------------
// Prefer Composer's autoloader when present; otherwise fall back to a small
// PSR-4 loader so the app runs without `composer install` (it has no runtime
// third-party dependencies).
$composer = $root . '/vendor/autoload.php';
if (is_file($composer)) {
    require $composer;
} else {
    spl_autoload_register(static function (string $class) use ($root): void {
        $prefix = 'App\\';
        if (!str_starts_with($class, $prefix)) {
            return;
        }
        $relative = substr($class, strlen($prefix));
        $file = $root . '/src/' . str_replace('\\', '/', $relative) . '.php';
        if (is_file($file)) {
            require $file;
        }
    });
}

// --- Environment -----------------------------------------------------------
Env::load($root . '/.env');

$appEnv = strtolower((string) Env::get('APP_ENV', 'production'));
$isProduction = $appEnv !== 'development' && $appEnv !== 'dev' && $appEnv !== 'local';

// Require a secret key. Refuse to run insecurely without one.
if ((string) Env::get('APP_KEY', '') === '') {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Configuration error: APP_KEY is not set. Copy .env.example to .env and set APP_KEY.\n";
    exit;
}

// --- Error handling --------------------------------------------------------
// Never leak internals to the client. Log everything; show a generic page.
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

$logDir = $root . '/storage';
if (!is_dir($logDir)) {
    @mkdir($logDir, 0775, true);
}
ini_set('error_log', $logDir . '/php-error.log');

$renderFatal = static function () use ($isProduction): void {
    if (headers_sent()) {
        return;
    }
    http_response_code(500);
    try {
        echo View::render('error', [
            'title' => 'Something went wrong',
            'heading' => 'Something went wrong',
            'message' => $isProduction
                ? 'An unexpected error occurred. Please try again later.'
                : 'An unexpected error occurred. Check storage/php-error.log for details.',
        ], 500);
    } catch (\Throwable) {
        header('Content-Type: text/plain; charset=utf-8');
        echo "An unexpected error occurred.\n";
    }
};

set_exception_handler(static function (\Throwable $e) use ($renderFatal): void {
    error_log('[uncaught] ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    $renderFatal();
});

register_shutdown_function(static function () use ($renderFatal): void {
    $err = error_get_last();
    if ($err !== null && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        error_log('[fatal] ' . $err['message'] . ' in ' . $err['file'] . ':' . $err['line']);
        $renderFatal();
    }
});

// --- Session & headers -----------------------------------------------------
Security::startSession();
Security::sendSecurityHeaders();
