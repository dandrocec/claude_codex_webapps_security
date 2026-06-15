<section class="page-head">
    <h1>Sign in</h1>
</section>

<form class="form narrow" method="post" action="/login">
    <?= \App\Csrf::field() ?>

    <label for="username">Username</label>
    <input type="text" id="username" name="username" value="<?= e(old('username')) ?>"
           autocomplete="username" required>

    <label for="password">Password</label>
    <input type="password" id="password" name="password" autocomplete="current-password" required>

    <div class="form-actions">
        <button type="submit">Sign in</button>
        <a class="cancel" href="/register">Create an account</a>
    </div>
</form>
