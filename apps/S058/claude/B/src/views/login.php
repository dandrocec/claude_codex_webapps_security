<?php /** @var string $username */ ?>
<h2>Log in</h2>
<div class="card" style="max-width:420px;">
    <form method="post" action="/login">
        <?= csrf_field() ?>
        <label for="username">Username</label>
        <input type="text" id="username" name="username" value="<?= e($username) ?>"
               autocomplete="username" required>
        <label for="password">Password</label>
        <input type="password" id="password" name="password"
               autocomplete="current-password" required>
        <div style="margin-top:14px;"><button type="submit">Log in</button></div>
    </form>
    <p class="muted" style="margin-top:12px;">No account? <a href="/register">Register</a>.</p>
</div>
