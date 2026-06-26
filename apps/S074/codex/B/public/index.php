<?php

declare(strict_types=1);

use Marketplace\App;
use Marketplace\Auth;
use Marketplace\Cart;
use Marketplace\Config;
use Marketplace\Csrf;
use Marketplace\Database;
use Marketplace\Http;
use Marketplace\Repository;
use Marketplace\View;

require dirname(__DIR__) . '/vendor/autoload.php';

$config = Config::fromEnvironment(dirname(__DIR__));

ini_set('display_errors', $config->isLocal ? '1' : '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

set_exception_handler(static function (Throwable $exception) use ($config): void {
    error_log($exception->getMessage());
    http_response_code(500);
    echo $config->isLocal
        ? '<h1>Application error</h1><p>Check the PHP error log for details.</p>'
        : '<h1>Something went wrong</h1>';
});

Http::sendSecurityHeaders();
Http::startSecureSession($config);

$pdo = Database::connect($config);
Database::migrate($pdo);

$repository = new Repository($pdo);
$auth = new Auth($repository);
$csrf = new Csrf($config);
$cart = new Cart();
$view = new View(dirname(__DIR__) . '/templates', $csrf, $auth, $cart);
$app = new App($repository, $auth, $csrf, $cart, $view);
$app->dispatch();
