<?php /** @var string $title @var string $content */ ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= e($title ?? 'Address Book') ?> &middot; Address Book</title>
    <link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="topbar">
    <a class="brand" href="/contacts">📒 Address Book</a>
    <nav>
        <?php if ($u = current_user()): ?>
            <span class="who">Signed in as <strong><?= e($u['username']) ?></strong></span>
            <form method="post" action="/logout" class="inline">
                <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
                <button type="submit" class="link">Log out</button>
            </form>
        <?php else: ?>
            <a href="/login">Log in</a>
            <a href="/register">Register</a>
        <?php endif; ?>
    </nav>
</header>

<main class="container">
    <?php if ($msg = flash()): ?>
        <div class="flash"><?= e($msg) ?></div>
    <?php endif; ?>

    <?= $content ?>
</main>
</body>
</html>
