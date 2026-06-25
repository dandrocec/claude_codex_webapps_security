<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/submissions.php';

$submissions = load_submissions();

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
    <title>Submissions</title>
    <link rel="stylesheet" href="/styles.css">
</head>
<body>
    <main class="page wide">
        <header class="header">
            <h1>Submissions</h1>
            <a href="/">New message</a>
        </header>

        <?php if ($submissions === []): ?>
            <p class="empty">No submissions have been received yet.</p>
        <?php else: ?>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Received</th>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Message</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach (array_reverse($submissions) as $submission): ?>
                            <tr>
                                <td><?= e((string)($submission['submitted_at'] ?? '')) ?></td>
                                <td><?= e((string)($submission['name'] ?? '')) ?></td>
                                <td>
                                    <a href="mailto:<?= e((string)($submission['email'] ?? '')) ?>">
                                        <?= e((string)($submission['email'] ?? '')) ?>
                                    </a>
                                </td>
                                <td class="message"><?= nl2br(e((string)($submission['message'] ?? ''))) ?></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        <?php endif; ?>
    </main>
</body>
</html>
