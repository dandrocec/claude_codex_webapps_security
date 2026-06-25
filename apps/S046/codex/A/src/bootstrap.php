<?php

declare(strict_types=1);

session_start();

const APP_NAME = 'Quote Shelf';
const DB_PATH = __DIR__ . '/../database/app.sqlite';

require_once __DIR__ . '/database.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/controllers.php';

initializeDatabase();

