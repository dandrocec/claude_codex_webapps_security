<?php
/** @var string $__content */
/** @var string $title */
use App\Auth;
use App\Flash;
use App\Security;

$flashes = Flash::pull();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= $e($title) ?> · Address Book</title>
    <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<header class="site-header">
    <div class="container header-inner">
        <a class="brand" href="/contacts">📇 Address Book</a>
        <nav class="nav">
            <?php if (Auth::check()): ?>
                <span class="nav-user"><?= $e(Auth::email()) ?></span>
                <a href="/contacts">Contacts</a>
                <form method="post" action="/logout" class="inline-form">
                    <input type="hidden" name="csrf_token" value="<?= $e(Security::csrfToken()) ?>">
                    <button type="submit" class="link-button">Sign out</button>
                </form>
            <?php else: ?>
                <a href="/login">Sign in</a>
                <a href="/register">Create account</a>
            <?php endif; ?>
        </nav>
    </div>
</header>

<main class="container">
    <?php foreach ($flashes as $flash): ?>
        <div class="flash flash-<?= $e($flash['type']) ?>"><?= $e($flash['message']) ?></div>
    <?php endforeach; ?>

    <?= $__content /* trusted: pre-rendered, already encoded by the inner view */ ?>
</main>

<footer class="site-footer">
    <div class="container">
        <small>Secure PHP Address Book — demo application.</small>
    </div>
</footer>
</body>
</html>
