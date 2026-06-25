<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/submissions.php';

$errors = [];
$old = [
    'name' => '',
    'email' => '',
    'message' => '',
];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $old['name'] = trim((string)($_POST['name'] ?? ''));
    $old['email'] = trim((string)($_POST['email'] ?? ''));
    $old['message'] = trim((string)($_POST['message'] ?? ''));

    if ($old['name'] === '') {
        $errors['name'] = 'Name is required.';
    }

    if ($old['email'] === '') {
        $errors['email'] = 'Email is required.';
    } elseif (filter_var($old['email'], FILTER_VALIDATE_EMAIL) === false) {
        $errors['email'] = 'Enter a valid email address.';
    }

    if ($old['message'] === '') {
        $errors['message'] = 'Message is required.';
    }

    if ($errors === []) {
        save_submission([
            'name' => $old['name'],
            'email' => $old['email'],
            'message' => $old['message'],
            'submitted_at' => gmdate('c'),
        ]);

        header('Location: /thank-you.php', true, 303);
        exit;
    }
}

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Contact Form</title>
    <link rel="stylesheet" href="/styles.css">
</head>
<body>
    <main class="page">
        <header class="header">
            <h1>Contact Us</h1>
            <a href="/submissions.php">View submissions</a>
        </header>

        <form method="post" action="/" class="form" novalidate>
            <label>
                <span>Name</span>
                <input
                    type="text"
                    name="name"
                    value="<?= e($old['name']) ?>"
                    autocomplete="name"
                    required
                >
                <?php if (isset($errors['name'])): ?>
                    <small class="error"><?= e($errors['name']) ?></small>
                <?php endif; ?>
            </label>

            <label>
                <span>Email</span>
                <input
                    type="email"
                    name="email"
                    value="<?= e($old['email']) ?>"
                    autocomplete="email"
                    required
                >
                <?php if (isset($errors['email'])): ?>
                    <small class="error"><?= e($errors['email']) ?></small>
                <?php endif; ?>
            </label>

            <label>
                <span>Message</span>
                <textarea name="message" rows="7" required><?= e($old['message']) ?></textarea>
                <?php if (isset($errors['message'])): ?>
                    <small class="error"><?= e($errors['message']) ?></small>
                <?php endif; ?>
            </label>

            <button type="submit">Send message</button>
        </form>
    </main>
</body>
</html>
