<?php
/** @var string $username */
/** @var array $errors */
$errors = $errors ?? [];
?>
<h1>Log in</h1>

<?php foreach ($errors as $err): ?>
    <div class="error"><?= e($err) ?></div>
<?php endforeach; ?>

<form method="post" action="/login" class="stack" autocomplete="on">
    <?= csrf_field() ?>
    <label>Username
        <input type="text" name="username" value="<?= e($username) ?>"
               required maxlength="30" autofocus autocomplete="username">
    </label>
    <label>Password
        <input type="password" name="password" required autocomplete="current-password">
    </label>
    <button type="submit">Log in</button>
</form>

<p class="muted">No account? <a href="/register">Register here.</a></p>
