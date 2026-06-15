<?php
/** @var array $errors @var array $old */
$title = 'Log in';
$errors = $errors ?? [];
$old = $old ?? [];
?>
<section class="card narrow">
    <h1>Log in</h1>

    <?php if (isset($errors['form'])): ?>
        <p class="flash error"><?= e($errors['form']) ?></p>
    <?php endif; ?>

    <form method="post" action="/login" class="stack" novalidate>
        <?= \App\Csrf::field() ?>

        <label for="username">Username</label>
        <input type="text" id="username" name="username" required autocomplete="username"
               value="<?= e($old['username'] ?? '') ?>">

        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autocomplete="current-password">

        <button type="submit" class="btn">Log in</button>
        <p class="hint">No account? <a href="/register">Register here</a>.</p>
    </form>
</section>
