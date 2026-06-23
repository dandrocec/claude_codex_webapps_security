<?php /** @var string $email */ ?>
<div class="panel narrow">
    <h1>Log in</h1>
    <form method="post" action="/login">
        <?= csrf_field() ?>
        <label for="email">Email</label>
        <input id="email" name="email" type="email" value="<?= e($email ?? '') ?>" required autofocus>

        <label for="password">Password</label>
        <input id="password" name="password" type="password" required>

        <div style="margin-top:18px;">
            <button class="btn" type="submit">Log in</button>
        </div>
    </form>
    <p class="muted" style="margin-top:14px;">No account? <a href="/register">Sign up</a>.</p>

    <div class="demo-box">
        <strong>Demo accounts</strong> (password: <code>password</code>)<br>
        Vendor: <code>alice@shop.test</code> · Vendor: <code>bob@shop.test</code><br>
        Buyer: <code>carol@shop.test</code>
    </div>
</div>
