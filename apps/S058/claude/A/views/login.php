<?php /** @var string|null $error */ ?>
<?php /** @var string $username */ ?>
<?php $title = 'Log in'; ?>

<h1>Log in</h1>

<?php if ($error): ?><p class="alert"><?= e($error) ?></p><?php endif; ?>

<form method="post" action="/login" class="form narrow">
    <?= csrf_field() ?>
    <label>Username
        <input type="text" name="username" value="<?= e($username) ?>" required autofocus>
    </label>
    <label>Password
        <input type="password" name="password" required>
    </label>
    <button type="submit" class="btn">Log in</button>
</form>

<p class="muted">No account? <a href="/register">Register here</a>.</p>
