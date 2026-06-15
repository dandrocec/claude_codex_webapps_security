<?php
/** @var string $title */
/** @var string $content */
$currentUser = \App\Auth::user();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e($title) ?> &middot; PHP Classifieds</title>
    <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<header class="site-header">
    <div class="container header-inner">
        <a class="brand" href="/">🛒 PHP&nbsp;Classifieds</a>
        <nav class="nav">
            <?php if ($currentUser): ?>
                <a href="/sell" class="btn btn-primary">+ Post an item</a>
                <a href="/my">My listings</a>
                <span class="nav-user">Hi, <?= e($currentUser['username']) ?></span>
                <form action="/logout" method="post" class="inline-form">
                    <?= csrf_field() ?>
                    <button type="submit" class="link-button">Log out</button>
                </form>
            <?php else: ?>
                <a href="/login">Log in</a>
                <a href="/register" class="btn btn-primary">Register</a>
            <?php endif; ?>
        </nav>
    </div>
</header>

<main class="container">
    <?php foreach (take_flash() as $msg): ?>
        <div class="flash flash-<?= e($msg['type']) ?>"><?= e($msg['message']) ?></div>
    <?php endforeach; ?>

    <?= $content ?>
</main>

<footer class="site-footer">
    <div class="container">
        <p>A demo classifieds marketplace built with plain PHP, PDO &amp; SQLite.</p>
    </div>
</footer>
</body>
</html>
