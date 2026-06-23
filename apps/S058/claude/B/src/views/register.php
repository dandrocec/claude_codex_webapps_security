<?php /** @var string $username */ ?>
<h2>Create an account</h2>
<div class="card" style="max-width:420px;">
    <form method="post" action="/register">
        <?= csrf_field() ?>
        <label for="username">Username</label>
        <input type="text" id="username" name="username" value="<?= e($username) ?>"
               pattern="[A-Za-z0-9_]{3,30}" autocomplete="username" required>
        <label for="password">Password (min 8 characters)</label>
        <input type="password" id="password" name="password"
               minlength="8" autocomplete="new-password" required>
        <label for="password_confirm">Confirm password</label>
        <input type="password" id="password_confirm" name="password_confirm"
               minlength="8" autocomplete="new-password" required>
        <div style="margin-top:14px;"><button type="submit">Register</button></div>
    </form>
    <p class="muted" style="margin-top:12px;">Already registered? <a href="/login">Log in</a>.</p>
</div>
