<?php
/** @var array $old */
/** @var array $errors */
$errors = $errors ?? [];
?>

<div class="auth-card">
    <h1>Log in</h1>

    <?php if ($errors): ?>
        <div class="flash flash-error">
            <?php foreach ($errors as $error): ?>
                <p><?= e($error) ?></p>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>

    <form action="/login" method="post" class="form">
        <?= csrf_field() ?>
        <label>
            Email
            <input type="email" name="email" required value="<?= e((string) ($old['email'] ?? '')) ?>">
        </label>
        <label>
            Password
            <input type="password" name="password" required>
        </label>
        <button type="submit" class="btn btn-primary">Log in</button>
    </form>

    <p class="auth-alt">No account yet? <a href="/register">Register here</a>.</p>
</div>
