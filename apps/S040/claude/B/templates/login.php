<?php
/** @var array $old */
/** @var ?string $error */
?>
<div class="form-wrap narrow">
    <h1>Log in</h1>
    <?php if ($error): ?><div class="flash flash-error"><?= e($error) ?></div><?php endif; ?>
    <form action="/login" method="post" novalidate>
        <?= csrf_field() ?>
        <label>
            Email
            <input type="email" name="email" autocomplete="username" required
                   value="<?= e($old['email'] ?? '') ?>">
        </label>
        <label>
            Password
            <input type="password" name="password" autocomplete="current-password" required>
        </label>
        <div class="actions">
            <button type="submit" class="btn btn-primary">Log in</button>
        </div>
    </form>
    <p class="muted">No account? <a href="/register">Create one</a>.</p>
</div>
