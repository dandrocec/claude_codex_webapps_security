<?php
/** @var string $content */
/** @var string|null $title */
/** @var array<string,string[]> $flash */
use App\Auth;
use App\Csrf;
?><!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e($title ?? 'RealEstate') ?> · RealEstate</title>
    <link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<header class="site-header">
    <div class="container nav">
        <a class="brand" href="/">🏠 RealEstate</a>
        <nav>
            <a href="/">Browse</a>
            <?php if (Auth::check()): ?>
                <a href="/dashboard">Dashboard</a>
                <a href="/listing/new">New listing</a>
                <span class="who">Hi, <?= e(Auth::name()) ?></span>
                <form method="post" action="/logout" class="inline">
                    <?= Csrf::field() ?>
                    <button type="submit" class="link-btn">Log out</button>
                </form>
            <?php else: ?>
                <a href="/login">Log in</a>
                <a href="/register" class="btn btn-small">Agent sign-up</a>
            <?php endif; ?>
        </nav>
    </div>
</header>

<main class="container">
    <?php foreach (($flash ?? []) as $type => $messages): ?>
        <?php foreach ($messages as $message): ?>
            <div class="flash flash-<?= e($type) ?>"><?= e($message) ?></div>
        <?php endforeach; ?>
    <?php endforeach; ?>

    <?= $content /* already escaped within the view */ ?>
</main>

<footer class="site-footer">
    <div class="container">
        <p>Demo real-estate marketplace. Built with secure-by-default PHP.</p>
    </div>
</footer>
</body>
</html>
