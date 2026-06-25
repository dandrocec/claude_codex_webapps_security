<?php
declare(strict_types=1);

$dataDirectory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data';
$databasePath = $dataDirectory . DIRECTORY_SEPARATOR . 'guestbook.sqlite';

if (!is_dir($dataDirectory)) {
    mkdir($dataDirectory, 0775, true);
}

$pdo = new PDO('sqlite:' . $databasePath);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

$pdo->exec(
    'CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )'
);

$errors = [];
$oldName = '';
$oldMessage = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $oldName = trim((string)($_POST['name'] ?? ''));
    $oldMessage = trim((string)($_POST['message'] ?? ''));

    if ($oldName === '') {
        $errors[] = 'Name is required.';
    } elseif (mb_strlen($oldName) > 80) {
        $errors[] = 'Name must be 80 characters or fewer.';
    }

    if ($oldMessage === '') {
        $errors[] = 'Message is required.';
    } elseif (mb_strlen($oldMessage) > 1000) {
        $errors[] = 'Message must be 1000 characters or fewer.';
    }

    if ($errors === []) {
        $statement = $pdo->prepare(
            'INSERT INTO entries (name, message, created_at) VALUES (:name, :message, :created_at)'
        );
        $statement->execute([
            ':name' => $oldName,
            ':message' => $oldMessage,
            ':created_at' => gmdate('Y-m-d H:i:s'),
        ]);

        header('Location: /', true, 303);
        exit;
    }
}

$entries = $pdo
    ->query('SELECT name, message, created_at FROM entries ORDER BY datetime(created_at) DESC, id DESC')
    ->fetchAll();

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function displayDate(string $value): string
{
    $timestamp = strtotime($value . ' UTC');

    if ($timestamp === false) {
        return $value;
    }

    return date('M j, Y g:i A', $timestamp);
}
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Guestbook</title>
    <style>
        :root {
            color-scheme: light;
            --bg: #f6f4ef;
            --ink: #202124;
            --muted: #687076;
            --panel: #ffffff;
            --line: #d9dee3;
            --accent: #1f7a5c;
            --accent-dark: #155940;
            --danger: #b42318;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            min-height: 100vh;
            background: var(--bg);
            color: var(--ink);
            font-family: Arial, Helvetica, sans-serif;
            line-height: 1.5;
        }

        main {
            width: min(920px, calc(100% - 32px));
            margin: 0 auto;
            padding: 42px 0 56px;
        }

        header {
            margin-bottom: 28px;
        }

        h1 {
            margin: 0 0 8px;
            font-size: clamp(2rem, 6vw, 4rem);
            line-height: 1;
            letter-spacing: 0;
        }

        header p {
            max-width: 620px;
            margin: 0;
            color: var(--muted);
            font-size: 1.05rem;
        }

        .layout {
            display: grid;
            grid-template-columns: minmax(280px, 360px) 1fr;
            gap: 22px;
            align-items: start;
        }

        .panel,
        .entry {
            background: var(--panel);
            border: 1px solid var(--line);
            border-radius: 8px;
            box-shadow: 0 10px 28px rgba(32, 33, 36, 0.07);
        }

        .panel {
            padding: 20px;
            position: sticky;
            top: 18px;
        }

        h2 {
            margin: 0 0 16px;
            font-size: 1.15rem;
        }

        label {
            display: block;
            margin-bottom: 7px;
            font-weight: 700;
        }

        input,
        textarea {
            width: 100%;
            border: 1px solid #b9c1c8;
            border-radius: 6px;
            padding: 11px 12px;
            color: var(--ink);
            font: inherit;
            background: #fff;
        }

        textarea {
            min-height: 150px;
            resize: vertical;
        }

        .field {
            margin-bottom: 15px;
        }

        .errors {
            margin: 0 0 16px;
            padding: 10px 12px 10px 30px;
            border: 1px solid #f3b4ad;
            border-radius: 6px;
            background: #fff1ef;
            color: var(--danger);
        }

        button {
            width: 100%;
            min-height: 46px;
            border: 0;
            border-radius: 6px;
            background: var(--accent);
            color: #fff;
            font: inherit;
            font-weight: 700;
            cursor: pointer;
        }

        button:hover,
        button:focus {
            background: var(--accent-dark);
        }

        .entries {
            display: grid;
            gap: 14px;
        }

        .entry {
            padding: 18px;
        }

        .entry-header {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 10px;
        }

        .entry strong {
            overflow-wrap: anywhere;
        }

        time {
            flex: 0 0 auto;
            color: var(--muted);
            font-size: 0.9rem;
        }

        .message {
            margin: 0;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        }

        .empty {
            margin: 0;
            padding: 20px;
            border: 1px dashed #b9c1c8;
            border-radius: 8px;
            color: var(--muted);
            background: rgba(255, 255, 255, 0.55);
        }

        @media (max-width: 760px) {
            main {
                width: min(100% - 24px, 920px);
                padding-top: 28px;
            }

            .layout {
                grid-template-columns: 1fr;
            }

            .panel {
                position: static;
            }

            .entry-header {
                display: block;
            }

            time {
                display: block;
                margin-top: 3px;
            }
        }
    </style>
</head>
<body>
    <main>
        <header>
            <h1>Guestbook</h1>
            <p>Leave a note for the next visitor. Messages are saved in SQLite and listed newest-first.</p>
        </header>

        <div class="layout">
            <section class="panel" aria-labelledby="form-title">
                <h2 id="form-title">Sign the guestbook</h2>

                <?php if ($errors !== []): ?>
                    <ul class="errors">
                        <?php foreach ($errors as $error): ?>
                            <li><?= e($error) ?></li>
                        <?php endforeach; ?>
                    </ul>
                <?php endif; ?>

                <form method="post" action="/">
                    <div class="field">
                        <label for="name">Name</label>
                        <input
                            id="name"
                            name="name"
                            type="text"
                            maxlength="80"
                            value="<?= e($oldName) ?>"
                            required
                        >
                    </div>

                    <div class="field">
                        <label for="message">Message</label>
                        <textarea id="message" name="message" maxlength="1000" required><?= e($oldMessage) ?></textarea>
                    </div>

                    <button type="submit">Post message</button>
                </form>
            </section>

            <section aria-labelledby="entries-title">
                <h2 id="entries-title">Messages</h2>

                <div class="entries">
                    <?php if ($entries === []): ?>
                        <p class="empty">No messages yet.</p>
                    <?php endif; ?>

                    <?php foreach ($entries as $entry): ?>
                        <article class="entry">
                            <div class="entry-header">
                                <strong><?= e($entry['name']) ?></strong>
                                <time datetime="<?= e($entry['created_at']) ?>Z"><?= e(displayDate($entry['created_at'])) ?></time>
                            </div>
                            <p class="message"><?= e($entry['message']) ?></p>
                        </article>
                    <?php endforeach; ?>
                </div>
            </section>
        </div>
    </main>
</body>
</html>
