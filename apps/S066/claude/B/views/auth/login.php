<?php
/** @var array<string,string> $old */
use App\Csrf;
?>
<div class="card">
    <h1 class="page-title">Log in</h1>
    <form method="post" action="/login">
        <?= Csrf::field() ?>
        <div class="field">
            <label for="email">Email</label>
            <input id="email" name="email" type="email" required maxlength="190" value="<?= e($old['email'] ?? '') ?>" autocomplete="username">
        </div>
        <div class="field">
            <label for="password">Password</label>
            <input id="password" name="password" type="password" required maxlength="200" autocomplete="current-password">
        </div>
        <button type="submit" class="btn">Log in</button>
        <p class="muted">No account yet? <a href="/register">Sign up as an agent</a>.</p>
    </form>
</div>
