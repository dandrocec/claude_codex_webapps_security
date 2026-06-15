<?php
/** @var string|null $error */
/** @var string $username */
?>
<h1>Register</h1>
<?php if ($error !== null): ?>
    <div class="error"><?= e($error) ?></div>
<?php endif; ?>
<form method="post" action="/register">
    <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>">
    <label for="username">Username</label>
    <input type="text" id="username" name="username" value="<?= e($username) ?>" maxlength="50" autofocus required>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" minlength="6" required>
    <p><button class="btn" type="submit">Create account</button></p>
</form>
<p class="muted">Already registered? <a href="/login">Log in</a>.</p>
