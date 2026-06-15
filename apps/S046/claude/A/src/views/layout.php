<?php
/** @var string $contentView path to the inner view */
/** @var string $title */
use App\Auth;

$flashes = take_flashes();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= e($title ?? 'Quotes') ?></title>
    <link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="site-header">
    <a class="brand" href="?page=home">❝ Quotes</a>
    <nav>
        <a href="?page=home">Browse</a>
        <?php if (Auth::check()): ?>
            <a href="?page=submit">Submit</a>
            <a href="?page=mine">My quotes</a>
            <?php if (Auth::isAdmin()): ?>
                <a href="?page=admin">Review</a>
            <?php endif; ?>
            <span class="who">@<?= e(Auth::username()) ?></span>
            <a href="?page=logout">Log out</a>
        <?php else: ?>
            <a href="?page=login">Log in</a>
            <a href="?page=register">Register</a>
        <?php endif; ?>
    </nav>
</header>

<main class="container">
    <?php foreach ($flashes as $message): ?>
        <div class="flash"><?= e($message) ?></div>
    <?php endforeach; ?>

    <?php require $contentView; ?>
</main>

<footer class="site-footer">
    <p>A tiny PHP + SQLite demo app.</p>
</footer>
</body>
</html>
