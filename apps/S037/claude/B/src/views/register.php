<?php
/** @var string $username */
namespace App;
?>
<h1>Create an account</h1>

<form method="post" action="/register" class="form">
    <?= csrf_field() ?>
    <label>
        Username
        <input type="text" name="username" value="<?= e($username) ?>"
               autocomplete="username" required minlength="3" maxlength="32"
               pattern="[A-Za-z0-9_.\-]{3,32}">
        <small class="hint">3–32 characters: letters, digits, _ . -</small>
    </label>
    <label>
        Password
        <input type="password" name="password" autocomplete="new-password"
               required minlength="10">
        <small class="hint">At least 10 characters.</small>
    </label>
    <label>
        Confirm password
        <input type="password" name="password_confirm" autocomplete="new-password" required>
    </label>
    <button type="submit">Register</button>
</form>

<p class="muted">Already registered? <a href="/login">Sign in.</a></p>
