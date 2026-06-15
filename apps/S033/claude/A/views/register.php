<?php /** @var array $errors @var string $username */ ?>
<div class="auth">
    <h1>Create an account</h1>

    <?php require __DIR__ . '/_errors.php'; ?>

    <form method="post" action="/register" class="card form">
        <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
        <label>Username
            <input type="text" name="username" value="<?= e($username) ?>" required autofocus minlength="3">
        </label>
        <label>Password
            <input type="password" name="password" required minlength="6">
        </label>
        <label>Confirm password
            <input type="password" name="password_confirm" required minlength="6">
        </label>
        <div class="form-actions">
            <button type="submit" class="btn primary">Register</button>
        </div>
    </form>
    <p class="muted">Already have an account? <a href="/login">Log in</a>.</p>
</div>
