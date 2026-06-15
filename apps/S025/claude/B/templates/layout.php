<?php /** @var string $title @var string $content @var bool $isAdmin */ ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e($title) ?> &middot; Newsletter</title>
    <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
    <header class="site-header">
        <a class="brand" href="/">📬 Newsletter</a>
        <nav>
            <?php if ($isAdmin): ?>
                <a href="/admin/subscribers">Subscribers</a>
                <form method="post" action="/admin/logout" class="inline">
                    <?= csrf_field() ?>
                    <button type="submit" class="linkbtn">Sign out</button>
                </form>
            <?php else: ?>
                <a href="/admin/login">Admin</a>
            <?php endif; ?>
        </nav>
    </header>
    <main class="container">
        <?= $content ?>
    </main>
    <footer class="site-footer">
        <small>Demo app &middot; built with security best practices.</small>
    </footer>
</body>
</html>
