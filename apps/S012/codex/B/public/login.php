<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

$error = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrf_verify($_POST['csrf_token'] ?? '')) {
        http_response_code(403);
        render_error('The form expired. Please go back and try again.');
    }

    if (admin_verify_password((string) ($_POST['password'] ?? ''))) {
        session_regenerate_id(true);
        $_SESSION['admin_id'] = 'local-admin';
        header('Location: /submissions.php', true, 303);
        exit;
    }

    $error = 'Invalid password.';
}

render_header('Admin login');
?>
<main class="shell">
  <h1>Admin login</h1>
  <form method="post" class="panel" novalidate>
    <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>">
    <?php if ($error !== null): ?>
      <p class="error"><?= e($error) ?></p>
    <?php endif; ?>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" required autocomplete="current-password">
    <button type="submit">Sign in</button>
  </form>
</main>
<?php render_footer(); ?>
