<?php
/** @var string $content  Rendered view body. */
/** @var array $flashes   One-shot flash messages. */
/** @var array|null $user Currently logged-in user. */
?><!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= isset($title) ? e($title) . ' · ' : '' ?>Photo Blog</title>
    <link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="topbar">
    <a class="brand" href="/">📸 Photo Blog</a>
    <nav>
        <?php if ($user): ?>
            <a href="/posts/new">New post</a>
            <span class="who">@<?= e($user['username']) ?></span>
            <form method="post" action="/logout" class="inline">
                <?= csrf_field() ?>
                <button type="submit" class="linkbtn">Log out</button>
            </form>
        <?php else: ?>
            <a href="/login">Log in</a>
            <a href="/register">Register</a>
        <?php endif; ?>
    </nav>
</header>

<main class="container">
    <?php foreach ($flashes as $msg): ?>
        <div class="flash"><?= e($msg) ?></div>
    <?php endforeach; ?>

    <?= $content /* already-escaped HTML built by the view */ ?>
</main>

<footer class="footer">
    <small>Photo Blog — a small, security-hardened demo app.</small>
</footer>
</body>
</html>
