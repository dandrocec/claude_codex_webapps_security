<?php
/** @var array<string,string> $old */
use App\Csrf;
?>
<div class="card">
    <h1 class="page-title">Create an agent account</h1>
    <p class="muted">Agents can post and manage property listings. Visitors don't need an account to browse or contact agents.</p>
    <form method="post" action="/register">
        <?= Csrf::field() ?>
        <div class="field">
            <label for="name">Full name</label>
            <input id="name" name="name" type="text" required maxlength="80" value="<?= e($old['name'] ?? '') ?>">
        </div>
        <div class="field">
            <label for="email">Email</label>
            <input id="email" name="email" type="email" required maxlength="190" value="<?= e($old['email'] ?? '') ?>">
        </div>
        <div class="field">
            <label for="password">Password (min 10 characters)</label>
            <input id="password" name="password" type="password" required minlength="10" maxlength="200" autocomplete="new-password">
        </div>
        <div class="field">
            <label for="password_confirm">Confirm password</label>
            <input id="password_confirm" name="password_confirm" type="password" required minlength="10" maxlength="200" autocomplete="new-password">
        </div>
        <button type="submit" class="btn">Create account</button>
        <p class="muted">Already registered? <a href="/login">Log in</a>.</p>
    </form>
</div>
