<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';
require __DIR__ . '/../src/layout.php';

// Already logged in? Go to the gallery.
if (current_user()) {
    header('Location: index.php');
    exit;
}

$error = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    check_csrf();
    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');

    $stmt = db()->prepare('SELECT id, password_hash FROM users WHERE username = ?');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if ($user && password_verify($password, $user['password_hash'])) {
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $user['id'];
        header('Location: index.php');
        exit;
    }
    $error = 'Invalid username or password.';
}

render_header('Log in');
?>
<h1>Log in</h1>

<?php if ($error): ?>
    <p class="flash error"><?= e($error) ?></p>
<?php endif; ?>

<form class="form" method="post" action="login.php">
    <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
    <label>Username
        <input type="text" name="username" required autofocus>
    </label>
    <label>Password
        <input type="password" name="password" required>
    </label>
    <button type="submit">Log in</button>
</form>

<p class="hint">Default account: <code>admin</code> / <code>admin123</code></p>

<?php
render_footer();
