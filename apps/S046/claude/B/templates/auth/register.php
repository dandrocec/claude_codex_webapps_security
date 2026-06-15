<section class="page-head">
    <h1>Create account</h1>
    <p class="muted">Pick a username (3–50 chars) and a password (at least 8 chars).</p>
</section>

<form class="form narrow" method="post" action="/register">
    <?= \App\Csrf::field() ?>

    <label for="username">Username</label>
    <input type="text" id="username" name="username" value="<?= e(old('username')) ?>"
           autocomplete="username" minlength="3" maxlength="50" required>

    <label for="password">Password</label>
    <input type="password" id="password" name="password" autocomplete="new-password"
           minlength="8" maxlength="200" required>

    <div class="form-actions">
        <button type="submit">Create account</button>
        <a class="cancel" href="/login">I already have an account</a>
    </div>
</form>
