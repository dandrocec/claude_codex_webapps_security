<?php
/** @var array $errors @var array $old */
$title = 'Register';
$errors = $errors ?? [];
$old = $old ?? [];
?>
<section class="card narrow">
    <h1>Create an account</h1>

    <form method="post" action="/register" class="stack" novalidate>
        <?= \App\Csrf::field() ?>

        <label for="username">Username</label>
        <input type="text" id="username" name="username" required autocomplete="username"
               minlength="3" maxlength="30" pattern="[A-Za-z0-9_]+"
               value="<?= e($old['username'] ?? '') ?>">
        <?php if (isset($errors['username'])): ?>
            <span class="field-error"><?= e($errors['username']) ?></span>
        <?php endif; ?>

        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autocomplete="new-password" minlength="8">
        <?php if (isset($errors['password'])): ?>
            <span class="field-error"><?= e($errors['password']) ?></span>
        <?php endif; ?>

        <label for="password_confirm">Confirm password</label>
        <input type="password" id="password_confirm" name="password_confirm" required autocomplete="new-password" minlength="8">
        <?php if (isset($errors['password_confirm'])): ?>
            <span class="field-error"><?= e($errors['password_confirm']) ?></span>
        <?php endif; ?>

        <button type="submit" class="btn">Register</button>
        <p class="hint">Already have an account? <a href="/login">Log in</a>.</p>
    </form>
</section>
