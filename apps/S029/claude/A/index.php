<?php
/**
 * Guestbook front controller.
 *
 * - GET  /  -> renders the form plus all messages, newest first.
 * - POST /  -> validates and stores a new message, then redirects (PRG)
 *              to avoid duplicate submissions on refresh.
 */

declare(strict_types=1);

require __DIR__ . '/db.php';

$errors = [];
$name = '';
$message = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $name = trim((string) ($_POST['name'] ?? ''));
    $message = trim((string) ($_POST['message'] ?? ''));

    if ($name === '') {
        $errors[] = 'Please enter your name.';
    } elseif (mb_strlen($name) > 100) {
        $errors[] = 'Name must be 100 characters or fewer.';
    }

    if ($message === '') {
        $errors[] = 'Please enter a message.';
    } elseif (mb_strlen($message) > 2000) {
        $errors[] = 'Message must be 2000 characters or fewer.';
    }

    if (!$errors) {
        $stmt = get_db()->prepare(
            'INSERT INTO messages (name, message) VALUES (:name, :message)'
        );
        $stmt->execute([':name' => $name, ':message' => $message]);

        // Post/Redirect/Get: reload as a fresh GET.
        header('Location: ' . $_SERVER['PHP_SELF'], true, 303);
        exit;
    }
}

$messages = get_db()
    ->query('SELECT name, message, created_at FROM messages ORDER BY id DESC')
    ->fetchAll();

/** Escape helper for safe HTML output. */
function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Guestbook</title>
    <style>
        :root { --accent: #4f46e5; }
        * { box-sizing: border-box; }
        body {
            font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
            max-width: 640px;
            margin: 2rem auto;
            padding: 0 1rem;
            color: #1f2937;
            background: #f9fafb;
        }
        h1 { margin-bottom: 0.25rem; }
        p.tagline { color: #6b7280; margin-top: 0; }
        form {
            background: #fff;
            padding: 1.25rem;
            border-radius: 10px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
            margin-bottom: 2rem;
        }
        label { display: block; font-weight: 600; margin-bottom: 0.25rem; }
        input, textarea {
            width: 100%;
            padding: 0.6rem;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            font: inherit;
            margin-bottom: 1rem;
        }
        textarea { resize: vertical; min-height: 90px; }
        button {
            background: var(--accent);
            color: #fff;
            border: 0;
            padding: 0.65rem 1.4rem;
            border-radius: 6px;
            font: inherit;
            font-weight: 600;
            cursor: pointer;
        }
        button:hover { background: #4338ca; }
        .errors {
            background: #fef2f2;
            border: 1px solid #fecaca;
            color: #b91c1c;
            padding: 0.75rem 1rem;
            border-radius: 6px;
            margin-bottom: 1rem;
        }
        .errors ul { margin: 0; padding-left: 1.2rem; }
        .entry {
            background: #fff;
            padding: 1rem 1.25rem;
            border-radius: 10px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.06);
            margin-bottom: 1rem;
        }
        .entry .meta { color: #6b7280; font-size: 0.85rem; margin-bottom: 0.4rem; }
        .entry .meta strong { color: var(--accent); font-size: 0.95rem; }
        .entry .body { white-space: pre-wrap; word-wrap: break-word; }
        .empty { color: #6b7280; text-align: center; padding: 2rem 0; }
    </style>
</head>
<body>
    <h1>📖 Guestbook</h1>
    <p class="tagline">Leave a message for everyone who visits.</p>

    <?php if ($errors): ?>
        <div class="errors">
            <ul>
                <?php foreach ($errors as $error): ?>
                    <li><?= e($error) ?></li>
                <?php endforeach; ?>
            </ul>
        </div>
    <?php endif; ?>

    <form method="post" action="<?= e($_SERVER['PHP_SELF']) ?>">
        <label for="name">Name</label>
        <input type="text" id="name" name="name" maxlength="100"
               value="<?= e($name) ?>" required>

        <label for="message">Message</label>
        <textarea id="message" name="message" maxlength="2000"
                  required><?= e($message) ?></textarea>

        <button type="submit">Sign guestbook</button>
    </form>

    <h2>Messages (<?= count($messages) ?>)</h2>

    <?php if (!$messages): ?>
        <p class="empty">No messages yet — be the first to sign!</p>
    <?php else: ?>
        <?php foreach ($messages as $row): ?>
            <div class="entry">
                <div class="meta">
                    <strong><?= e($row['name']) ?></strong>
                    &middot; <?= e($row['created_at']) ?> UTC
                </div>
                <div class="body"><?= e($row['message']) ?></div>
            </div>
        <?php endforeach; ?>
    <?php endif; ?>
</body>
</html>
