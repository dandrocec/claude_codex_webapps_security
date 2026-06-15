<?php
/** @var string $content  Rendered page body (already HTML-escaped where needed). */
$pageTitle = $title ?? 'Guestbook';
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e($pageTitle) ?></title>
    <link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<header class="site-header">
    <a class="brand" href="/">📖 Guestbook</a>
    <nav class="nav">
        <?php if (\App\Auth::check()): ?>
            <span class="nav-user">Hi, <?= e(\App\Auth::username()) ?><?= \App\Auth::isAdmin() ? ' (admin)' : '' ?></span>
            <form class="inline" method="post" action="/logout">
                <?= \App\Csrf::field() ?>
                <button type="submit" class="link-btn">Log out</button>
            </form>
        <?php else: ?>
            <a href="/login">Log in</a>
            <a href="/register">Register</a>
        <?php endif; ?>
    </nav>
</header>

<main class="container">
    <?= $content ?>
</main>

<footer class="site-footer">
    <p>A secure PHP guestbook · messages shown newest first</p>
</footer>
</body>
</html>
