<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

session_regenerate_id(true);
unset($_SESSION['user_id']);
set_flash('success', 'Logged out.');
redirect('/');
