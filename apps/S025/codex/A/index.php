<?php
declare(strict_types=1);

$storageDir = __DIR__ . DIRECTORY_SEPARATOR . 'storage';
$storageFile = $storageDir . DIRECTORY_SEPARATOR . 'subscribers.json';

function ensureStorage(string $storageDir, string $storageFile): void
{
    if (!is_dir($storageDir)) {
        mkdir($storageDir, 0775, true);
    }

    if (!file_exists($storageFile)) {
        file_put_contents($storageFile, json_encode([], JSON_PRETTY_PRINT));
    }
}

function loadSubscribers(string $storageFile): array
{
    $raw = file_get_contents($storageFile);
    $data = json_decode($raw === false ? '[]' : $raw, true);

    return is_array($data) ? $data : [];
}

function saveSubscribers(string $storageFile, array $subscribers): void
{
    file_put_contents($storageFile, json_encode(array_values($subscribers), JSON_PRETTY_PRINT), LOCK_EX);
}

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

ensureStorage($storageDir, $storageFile);

$submittedEmail = '';
$message = '';
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $submittedEmail = trim((string)($_POST['email'] ?? ''));

    if (!filter_var($submittedEmail, FILTER_VALIDATE_EMAIL)) {
        $error = 'Enter a valid email address.';
    } else {
        $subscribers = loadSubscribers($storageFile);
        $normalizedEmail = mb_strtolower($submittedEmail);
        $exists = false;

        foreach ($subscribers as $subscriber) {
            if (($subscriber['email'] ?? '') === $normalizedEmail) {
                $exists = true;
                break;
            }
        }

        if (!$exists) {
            $subscribers[] = [
                'email' => $normalizedEmail,
                'subscribed_at' => gmdate('c'),
            ];
            saveSubscribers($storageFile, $subscribers);
        }

        $message = $exists
            ? 'This address is already subscribed.'
            : 'Subscription confirmed for ' . $normalizedEmail . '.';
        $submittedEmail = '';
    }
}
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Email Subscription</title>
    <style>
        :root {
            color-scheme: light;
            --bg: #f4f7fb;
            --panel: #ffffff;
            --text: #1f2937;
            --muted: #64748b;
            --line: #d8e0ea;
            --primary: #136f63;
            --primary-dark: #0f574f;
            --success-bg: #e7f8ef;
            --success-text: #17643a;
            --error-bg: #fdecec;
            --error-text: #9f1d1d;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            min-height: 100vh;
            font-family: Arial, Helvetica, sans-serif;
            background: var(--bg);
            color: var(--text);
            display: grid;
            place-items: center;
            padding: 24px;
        }

        main {
            width: min(100%, 560px);
            background: var(--panel);
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: 32px;
            box-shadow: 0 18px 45px rgba(31, 41, 55, 0.08);
        }

        h1 {
            margin: 0 0 10px;
            font-size: 30px;
            line-height: 1.2;
        }

        p {
            margin: 0 0 24px;
            color: var(--muted);
            line-height: 1.5;
        }

        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 700;
        }

        .form-row {
            display: flex;
            gap: 10px;
        }

        input[type="email"] {
            flex: 1;
            min-width: 0;
            border: 1px solid var(--line);
            border-radius: 6px;
            padding: 12px 14px;
            font: inherit;
        }

        button,
        .link-button {
            border: 0;
            border-radius: 6px;
            background: var(--primary);
            color: #ffffff;
            font: inherit;
            font-weight: 700;
            padding: 12px 16px;
            cursor: pointer;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }

        button:hover,
        .link-button:hover {
            background: var(--primary-dark);
        }

        .notice {
            margin-bottom: 18px;
            border-radius: 6px;
            padding: 12px 14px;
            font-weight: 700;
        }

        .notice.success {
            background: var(--success-bg);
            color: var(--success-text);
        }

        .notice.error {
            background: var(--error-bg);
            color: var(--error-text);
        }

        .actions {
            margin-top: 24px;
            display: flex;
            justify-content: flex-start;
        }

        @media (max-width: 520px) {
            main {
                padding: 24px;
            }

            .form-row {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
<main>
    <h1>Subscribe for updates</h1>
    <p>Enter an email address to add it to the local subscriber list.</p>

    <?php if ($message !== ''): ?>
        <div class="notice success"><?= h($message) ?></div>
    <?php endif; ?>

    <?php if ($error !== ''): ?>
        <div class="notice error"><?= h($error) ?></div>
    <?php endif; ?>

    <form method="post" action="/">
        <label for="email">Email address</label>
        <div class="form-row">
            <input
                id="email"
                name="email"
                type="email"
                value="<?= h($submittedEmail) ?>"
                placeholder="name@example.com"
                required
            >
            <button type="submit">Subscribe</button>
        </div>
    </form>

    <div class="actions">
        <a class="link-button" href="/subscribers.php">View subscribers</a>
    </div>
</main>
</body>
</html>
