<?php /** @var array $errors @var string $username */ ?>
<div class="auth">
    <h1>Log in</h1>

    <?php require __DIR__ . '/_errors.php'; ?>

    <form method="post" action="/login" class="card form">
        <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
        <label>Username
            <input type="text" name="username" value="<?= e($username) ?>" required autofocus>
        </label>
        <label>Password
            <input type="password" name="password" required>
        </label>
        <div class="form-actions">
            <button type="submit" class="btn primary">Log in</button>
        </div>
    </form>
    <p class="muted">No account? <a href="/register">Register here</a>.</p>
</div>
