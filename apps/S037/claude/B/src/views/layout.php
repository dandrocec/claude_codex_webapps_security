<?php
/** @var string $content  Rendered page body. */
/** @var array|null $user  Current user (or null). */
/** @var array $flashes  One-shot notices. */
namespace App;
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e(APP_NAME) ?></title>
    <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<header class="site-header">
    <a class="brand" href="/"><?= e(APP_NAME) ?></a>
    <nav>
        <a href="/">Gallery</a>
        <?php if ($user): ?>
            <a href="/upload">Upload</a>
            <span class="who">Hi, <?= e($user['username']) ?></span>
            <form class="inline" method="post" action="/logout">
                <?= csrf_field() ?>
                <button type="submit" class="link-btn">Sign out</button>
            </form>
        <?php else: ?>
            <a href="/login">Sign in</a>
            <a href="/register">Register</a>
        <?php endif; ?>
    </nav>
</header>

<main class="container">
    <?php foreach ($flashes as $flash): ?>
        <div class="flash flash-<?= e($flash['type']) ?>"><?= e($flash['message']) ?></div>
    <?php endforeach; ?>

    <?= $content /* already-escaped, view-generated HTML */ ?>
</main>

<footer class="site-footer">
    <small><?= e(APP_NAME) ?> — uploads are validated, randomly named and stored outside the web root.</small>
</footer>
</body>
</html>
