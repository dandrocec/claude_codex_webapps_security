<?php
declare(strict_types=1);

/**
 * Application bootstrap: wires up config, DB, helpers, error handling,
 * sessions and security headers. Included by the front controller.
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/helpers.php';

$isDev = config()['app_env'] === 'development';

// Never leak internal errors / stack traces to clients in production.
error_reporting(E_ALL);
ini_set('display_errors', $isDev ? '1' : '0');
ini_set('log_errors', '1');

set_exception_handler(static function (Throwable $e) use ($isDev): void {
    error_log('[forum] Uncaught: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) {
        http_response_code(500);
    }
    if (function_exists('render')) {
        $message = $isDev ? ($e->getMessage()) : 'An unexpected error occurred.';
        render('error', ['status' => 500, 'title' => 'Server Error', 'message' => $message], 'Server Error');
    } else {
        echo 'Internal Server Error';
    }
});

set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

start_session();
send_security_headers();
