<?php /** @var string $content */ ?>
<?php /** @var array<string,mixed>|null $currentUser */ ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= isset($title) ? e($title) . ' · ' : '' ?>PHP Forum</title>
    <link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="site-header">
    <div class="container">
        <a class="brand" href="/">💬 PHP Forum</a>
        <nav class="nav">
            <?php if ($currentUser): ?>
                <span class="nav-user">
                    <?= e($currentUser['username']) ?>
                    <?php if ($currentUser['role'] === 'moderator'): ?>
                        <span class="badge">moderator</span>
                    <?php endif; ?>
                </span>
                <form method="post" action="/logout" class="inline">
                    <?= csrf_field() ?>
                    <button type="submit" class="link-button">Log out</button>
                </form>
            <?php else: ?>
                <a href="/login">Log in</a>
                <a href="/register" class="btn btn-small">Register</a>
            <?php endif; ?>
        </nav>
    </div>
</header>

<main class="container">
    <?= $content ?>
</main>

<footer class="site-footer">
    <div class="container">PHP Forum — a small example application.</div>
</footer>
</body>
</html>
