<?php
/** @var array $old */
/** @var array $errors */
?>
<div class="form-wrap narrow">
    <h1>Create an account</h1>
    <form action="/register" method="post" novalidate>
        <?= csrf_field() ?>
        <label>
            Display name
            <input type="text" name="display_name" maxlength="80" required
                   value="<?= e($old['display_name'] ?? '') ?>">
            <?php if (!empty($errors['display_name'])): ?><span class="err"><?= e($errors['display_name']) ?></span><?php endif; ?>
        </label>
        <label>
            Email
            <input type="email" name="email" autocomplete="username" required
                   value="<?= e($old['email'] ?? '') ?>">
            <?php if (!empty($errors['email'])): ?><span class="err"><?= e($errors['email']) ?></span><?php endif; ?>
        </label>
        <label>
            Password (min 10 characters)
            <input type="password" name="password" autocomplete="new-password" required>
            <?php if (!empty($errors['password'])): ?><span class="err"><?= e($errors['password']) ?></span><?php endif; ?>
        </label>
        <label>
            Confirm password
            <input type="password" name="password_confirm" autocomplete="new-password" required>
            <?php if (!empty($errors['password_confirm'])): ?><span class="err"><?= e($errors['password_confirm']) ?></span><?php endif; ?>
        </label>
        <div class="actions">
            <button type="submit" class="btn btn-primary">Sign up</button>
        </div>
    </form>
    <p class="muted">Already registered? <a href="/login">Log in</a>.</p>
</div>
