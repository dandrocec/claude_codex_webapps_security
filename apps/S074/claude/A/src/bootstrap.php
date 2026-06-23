<?php

declare(strict_types=1);

/**
 * Application bootstrap: sessions, error reporting and shared includes.
 */

error_reporting(E_ALL);
ini_set('display_errors', '1');

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_name('MARKETPLACE_SESSION');
    session_start();
}

require __DIR__ . '/db.php';
require __DIR__ . '/helpers.php';
require __DIR__ . '/controllers.php';
