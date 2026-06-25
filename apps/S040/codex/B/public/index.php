<?php

declare(strict_types=1);

use App\App;
use App\Security;

require dirname(__DIR__) . '/vendor/autoload.php';

$root = dirname(__DIR__);
if (file_exists($root . '/.env')) {
    Dotenv\Dotenv::createImmutable($root)->safeLoad();
}

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

set_exception_handler(function (Throwable $e): void {
    error_log($e);
    http_response_code(500);
    echo 'Internal server error';
});

Security::sendHeaders();
Security::startSession();

$app = new App($root);
$app->run();
