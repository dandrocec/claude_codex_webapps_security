<?php
/** @var string $content */
/** @var string $_title */
$me = current_user();
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e($_title) ?> · Classifieds</title>
    <link rel="stylesheet" href="/css/app.css">
</head>
<body>
<header class="site-header">
    <div class="container header-inner">
        <a class="brand" href="/">🛒 Classifieds</a>
        <form class="search" action="/search" method="get" role="search">
            <input type="search" name="q" placeholder="Search listings…"
                   value="<?= e($_GET['q'] ?? '') ?>" maxlength="100" aria-label="Search">
            <button type="submit">Search</button>
        </form>
        <nav class="nav">
            <?php if ($me): ?>
                <a href="/sell">+ Sell</a>
                <a href="/my-listings">My listings</a>
                <span class="who">Hi, <?= e($me['display_name']) ?></span>
                <form action="/logout" method="post" class="inline">
                    <?= csrf_field() ?>
                    <button type="submit" class="linklike">Log out</button>
                </form>
            <?php else: ?>
                <a href="/login">Log in</a>
                <a href="/register" class="btn-sm">Sign up</a>
            <?php endif; ?>
        </nav>
    </div>
</header>

<main class="container">
    <?php foreach (take_flashes() as $f): ?>
        <div class="flash flash-<?= e($f['type']) ?>"><?= e($f['message']) ?></div>
    <?php endforeach; ?>

    <?= $content ?>
</main>

<footer class="site-footer">
    <div class="container">
        <small>Demo classifieds app — built with PHP &amp; PDO.</small>
    </div>
</footer>
<script src="/js/app.js" defer></script>
</body>
</html>
