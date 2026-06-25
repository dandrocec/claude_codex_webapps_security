<section class="panel auth">
    <h1>Register</h1>
    <?php require __DIR__ . '/partials/errors.php'; ?>
    <form method="post" action="/register">
        <?= csrf_field() ?>
        <label>Email <input name="email" type="email" autocomplete="email" required></label>
        <label>Password <input name="password" type="password" autocomplete="new-password" minlength="12" required></label>
        <button type="submit">Create account</button>
    </form>
</section>
