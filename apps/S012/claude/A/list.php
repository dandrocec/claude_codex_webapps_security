<?php
// Lists all submissions received so far, newest first.
require __DIR__ . '/storage.php';

$submissions = load_submissions();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Submissions</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <main class="card card--wide">
        <h1>Submissions</h1>
        <p class="subtitle"><?= count($submissions) ?> message<?= count($submissions) === 1 ? '' : 's' ?> received.</p>

        <?php if (!$submissions): ?>
            <p class="empty">No submissions yet. <a href="index.php">Be the first &rarr;</a></p>
        <?php else: ?>
            <ul class="submissions">
                <?php foreach ($submissions as $s): ?>
                    <li class="submission">
                        <div class="submission__head">
                            <span class="submission__name"><?= htmlspecialchars($s['name'] ?? '', ENT_QUOTES, 'UTF-8') ?></span>
                            <a class="submission__email" href="mailto:<?= htmlspecialchars($s['email'] ?? '', ENT_QUOTES, 'UTF-8') ?>"><?= htmlspecialchars($s['email'] ?? '', ENT_QUOTES, 'UTF-8') ?></a>
                            <time class="submission__time"><?= htmlspecialchars($s['created_at'] ?? '', ENT_QUOTES, 'UTF-8') ?></time>
                        </div>
                        <p class="submission__message"><?= nl2br(htmlspecialchars($s['message'] ?? '', ENT_QUOTES, 'UTF-8')) ?></p>
                    </li>
                <?php endforeach; ?>
            </ul>
        <?php endif; ?>

        <p class="links"><a href="index.php">&larr; Back to contact form</a></p>
    </main>
</body>
</html>
