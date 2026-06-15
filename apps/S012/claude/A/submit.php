<?php
// Handles the form POST: validates, persists, and shows a thank-you page.
require __DIR__ . '/storage.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: index.php');
    exit;
}

$name    = trim($_POST['name'] ?? '');
$email   = trim($_POST['email'] ?? '');
$message = trim($_POST['message'] ?? '');

// Validate, and on failure bounce back to the form preserving the entered values.
$errors = [];
if ($name === '')    { $errors[] = 'a name'; }
if ($message === '') { $errors[] = 'a message'; }
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) { $errors[] = 'a valid email'; }

if ($errors) {
    $query = http_build_query([
        'error'   => 'Please provide ' . implode(', ', $errors) . '.',
        'name'    => $name,
        'email'   => $email,
        'message' => $message,
    ]);
    header('Location: index.php?' . $query);
    exit;
}

save_submission([
    'name'    => $name,
    'email'   => $email,
    'message' => $message,
]);
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Thank You</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <main class="card">
        <h1>Thank you, <?= htmlspecialchars($name, ENT_QUOTES, 'UTF-8') ?>!</h1>
        <p class="subtitle">Your message has been received. We'll reply to
            <strong><?= htmlspecialchars($email, ENT_QUOTES, 'UTF-8') ?></strong> soon.</p>

        <p class="links">
            <a href="index.php">&larr; Send another message</a>
            &nbsp;&middot;&nbsp;
            <a href="list.php">View all submissions &rarr;</a>
        </p>
    </main>
</body>
</html>
