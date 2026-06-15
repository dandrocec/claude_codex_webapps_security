<?php
/** @var string $__content_template */
/** @var string $title */
use App\Auth;

$flashSuccess = flash('success');
$flashError   = flash('error');
$currentUser  = $currentUser ?? Auth::user();

// Clear flashed old-input after it has been made available to the view.
$__old = $_SESSION['__old'] ?? [];
unset($_SESSION['__old']);
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e(($title ?? 'Quotes')) ?> &middot; Quotes</title>
    <link rel="stylesheet" href="/css/app.css">
</head>
<body>
<header class="site-header">
    <a class="brand" href="/">Quotes</a>
    <nav class="nav">
        <a href="/">Browse</a>
        <?php if (Auth::check()): ?>
            <a href="/dashboard">My quotes</a>
            <a href="/quotes/new">Submit</a>
            <?php if (Auth::isAdmin()): ?>
                <a href="/admin">Moderation</a>
            <?php endif; ?>
            <form class="inline" method="post" action="/logout">
                <?= \App\Csrf::field() ?>
                <button type="submit" class="link-button">Sign out</button>
            </form>
        <?php else: ?>
            <a href="/login">Sign in</a>
            <a href="/register">Create account</a>
        <?php endif; ?>
    </nav>
</header>

<main class="container">
    <?php if ($flashSuccess !== null): ?>
        <div class="alert alert-success"><?= e($flashSuccess) ?></div>
    <?php endif; ?>
    <?php if ($flashError !== null): ?>
        <div class="alert alert-error"><?= e($flashError) ?></div>
    <?php endif; ?>

    <?php
    // Make old() input available within the included content template.
    $_SESSION['__old'] = $__old;
    require $__content_template;
    unset($_SESSION['__old']);
    ?>
</main>

<footer class="site-footer">
    <p>A small, security-focused PHP quotes app.</p>
</footer>
</body>
</html>
