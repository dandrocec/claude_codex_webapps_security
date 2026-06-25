<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

$errors = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();

    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');

    if (authenticate($username, $password)) {
        login_user($username);
        set_flash('success', 'Logged in.');
        redirect('/');
    }

    $errors[] = 'Invalid username or password.';
}
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Log In - Image Gallery</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/">Image Gallery</a>
    <nav><a href="/register.php">Register</a></nav>
  </header>

  <main class="auth-page">
    <form class="panel" method="post">
      <h1>Log In</h1>
      <?php foreach ($errors as $error): ?>
        <div class="flash error"><?= h($error) ?></div>
      <?php endforeach; ?>
      <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
      <label>
        Username
        <input name="username" autocomplete="username" required value="<?= h((string) ($_POST['username'] ?? '')) ?>">
      </label>
      <label>
        Password
        <input name="password" type="password" autocomplete="current-password" required>
      </label>
      <button type="submit">Log in</button>
    </form>
  </main>
</body>
</html>
