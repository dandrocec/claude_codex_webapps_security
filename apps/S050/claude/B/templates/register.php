<?php
/** @var string $username */
/** @var array $errors */
$errors = $errors ?? [];
?>
<h1>Create an account</h1>

<?php foreach ($errors as $err): ?>
    <div class="error"><?= e($err) ?></div>
<?php endforeach; ?>

<form method="post" action="/register" class="stack" autocomplete="on">
    <?= csrf_field() ?>
    <label>Username
        <input type="text" name="username" value="<?= e($username) ?>"
               required pattern="[A-Za-z0-9_]{3,30}" maxlength="30" autofocus autocomplete="username">
        <small class="hint">3–30 characters: letters, numbers, or underscores.</small>
    </label>
    <label>Password
        <input type="password" name="password" required minlength="8" maxlength="200" autocomplete="new-password">
        <small class="hint">At least 8 characters.</small>
    </label>
    <label>Confirm password
        <input type="password" name="password_confirm" required minlength="8" maxlength="200" autocomplete="new-password">
    </label>
    <button type="submit">Register</button>
</form>

<p class="muted">Already have an account? <a href="/login">Log in.</a></p>
