<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

$errors = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();

    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');

    if (!preg_match('/^[A-Za-z0-9_]{3,32}$/', $username)) {
        $errors[] = 'Use 3 to 32 letters, numbers, or underscores for the username.';
    }

    if (strlen($password) < 8) {
        $errors[] = 'Use a password with at least 8 characters.';
    }

    if (!$errors) {
        try {
            create_user($username, $password);
            login_user($username);
            set_flash('success', 'Account created.');
            redirect('/');
        } catch (RuntimeException $e) {
            $errors[] = $e->getMessage();
        }
    }
}
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Register - Image Gallery</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/">Image Gallery</a>
    <nav><a href="/login.php">Log in</a></nav>
  </header>

  <main class="auth-page">
    <form class="panel" method="post">
      <h1>Create Account</h1>
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
        <input name="password" type="password" autocomplete="new-password" required>
      </label>
      <button type="submit">Register</button>
    </form>
  </main>
</body>
</html>
