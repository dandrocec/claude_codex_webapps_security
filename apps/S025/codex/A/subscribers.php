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

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

ensureStorage($storageDir, $storageFile);
$subscribers = loadSubscribers($storageFile);
usort($subscribers, static fn (array $a, array $b): int => strcmp((string)($b['subscribed_at'] ?? ''), (string)($a['subscribed_at'] ?? '')));
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Subscribed Addresses</title>
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
            --thead: #edf3f8;
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
            padding: 24px;
        }

        main {
            width: min(100%, 900px);
            margin: 0 auto;
            background: var(--panel);
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: 32px;
            box-shadow: 0 18px 45px rgba(31, 41, 55, 0.08);
        }

        .header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 24px;
        }

        h1 {
            margin: 0 0 8px;
            font-size: 30px;
            line-height: 1.2;
        }

        p {
            margin: 0;
            color: var(--muted);
            line-height: 1.5;
        }

        .link-button {
            border-radius: 6px;
            background: var(--primary);
            color: #ffffff;
            font-weight: 700;
            padding: 12px 16px;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            white-space: nowrap;
        }

        .link-button:hover {
            background: var(--primary-dark);
        }

        .table-wrap {
            overflow-x: auto;
            border: 1px solid var(--line);
            border-radius: 8px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            min-width: 520px;
        }

        th,
        td {
            padding: 14px 16px;
            text-align: left;
            border-bottom: 1px solid var(--line);
        }

        th {
            background: var(--thead);
            font-size: 14px;
            color: #334155;
        }

        tr:last-child td {
            border-bottom: 0;
        }

        .empty {
            border: 1px dashed var(--line);
            border-radius: 8px;
            padding: 28px;
            text-align: center;
            color: var(--muted);
        }

        @media (max-width: 640px) {
            main {
                padding: 24px;
            }

            .header {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
<main>
    <div class="header">
        <div>
            <h1>Subscribed addresses</h1>
            <p><?= count($subscribers) ?> address<?= count($subscribers) === 1 ? '' : 'es' ?> stored locally.</p>
        </div>
        <a class="link-button" href="/">Add subscriber</a>
    </div>

    <?php if (count($subscribers) === 0): ?>
        <div class="empty">No subscribers yet.</div>
    <?php else: ?>
        <div class="table-wrap">
            <table>
                <thead>
                <tr>
                    <th>Email</th>
                    <th>Subscribed at</th>
                </tr>
                </thead>
                <tbody>
                <?php foreach ($subscribers as $subscriber): ?>
                    <tr>
                        <td><?= h((string)($subscriber['email'] ?? '')) ?></td>
                        <td><?= h((string)($subscriber['subscribed_at'] ?? '')) ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    <?php endif; ?>
</main>
</body>
</html>
