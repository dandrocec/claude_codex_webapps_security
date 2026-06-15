<?php
/** @var string|null $error */
/** @var string $username */
?>
<h1>Log in</h1>
<?php if ($error !== null): ?>
    <div class="error"><?= e($error) ?></div>
<?php endif; ?>
<form method="post" action="/login">
    <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>">
    <label for="username">Username</label>
    <input type="text" id="username" name="username" value="<?= e($username) ?>" autofocus required>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" required>
    <p><button class="btn" type="submit">Log in</button></p>
</form>
<p class="muted">No account? <a href="/register">Register</a>.</p>
