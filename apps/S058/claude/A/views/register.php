<?php /** @var string|null $error */ ?>
<?php /** @var string $username */ ?>
<?php $title = 'Register'; ?>

<h1>Create an account</h1>

<?php if ($error): ?><p class="alert"><?= e($error) ?></p><?php endif; ?>

<form method="post" action="/register" class="form narrow">
    <?= csrf_field() ?>
    <label>Username
        <input type="text" name="username" value="<?= e($username) ?>" minlength="3" maxlength="30" required autofocus>
        <small class="muted">3–30 characters: letters, numbers, underscores.</small>
    </label>
    <label>Password
        <input type="password" name="password" minlength="6" required>
        <small class="muted">At least 6 characters.</small>
    </label>
    <button type="submit" class="btn">Register</button>
</form>

<p class="muted">Already have an account? <a href="/login">Log in</a>.</p>
