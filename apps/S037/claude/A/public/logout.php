<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

// Only act on POST with a valid CSRF token so logout can't be triggered via a link.
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    check_csrf();
    $_SESSION = [];
    session_destroy();
}

header('Location: index.php');
exit;
