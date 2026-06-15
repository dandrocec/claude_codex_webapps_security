<?php
/** @var array $old */
/** @var array $errors */
$errors = $errors ?? [];
?>

<div class="auth-card">
    <h1>Create an account</h1>

    <?php if ($errors): ?>
        <div class="flash flash-error">
            <?php foreach ($errors as $error): ?>
                <p><?= e($error) ?></p>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>

    <form action="/register" method="post" class="form">
        <?= csrf_field() ?>
        <label>
            Username
            <input type="text" name="username" required minlength="3"
                   value="<?= e((string) ($old['username'] ?? '')) ?>">
        </label>
        <label>
            Email
            <input type="email" name="email" required value="<?= e((string) ($old['email'] ?? '')) ?>">
        </label>
        <label>
            Password
            <input type="password" name="password" required minlength="6">
        </label>
        <button type="submit" class="btn btn-primary">Register</button>
    </form>

    <p class="auth-alt">Already have an account? <a href="/login">Log in</a>.</p>
</div>
