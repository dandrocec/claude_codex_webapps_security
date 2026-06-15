<?php
/** @var string $username */
namespace App;
?>
<h1>Sign in</h1>

<form method="post" action="/login" class="form">
    <?= csrf_field() ?>
    <label>
        Username
        <input type="text" name="username" value="<?= e($username) ?>"
               autocomplete="username" required maxlength="32">
    </label>
    <label>
        Password
        <input type="password" name="password" autocomplete="current-password" required>
    </label>
    <button type="submit">Sign in</button>
</form>

<p class="muted">No account? <a href="/register">Register here.</a></p>
