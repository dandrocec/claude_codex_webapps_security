<?php
use PhotoBlog\Security;

$title = 'Photo Blog';
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?= Security::e($title) ?></title>
  <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/">Photo Blog</a>
    <nav>
      <?php if (!empty($user)): ?>
        <a href="/new">New post</a>
        <form action="/logout" method="post" class="inline">
          <input type="hidden" name="csrf_token" value="<?= Security::e(Security::csrfToken()) ?>">
          <button type="submit">Log out</button>
        </form>
      <?php else: ?>
        <a href="/login">Log in</a>
        <a href="/register">Register</a>
      <?php endif; ?>
    </nav>
  </header>
  <main class="container">
    <?php require __DIR__ . '/' . $template; ?>
  </main>
</body>
</html>
