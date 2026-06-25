<section class="panel auth">
    <h1>Log in</h1>
    <?php require __DIR__ . '/partials/errors.php'; ?>
    <form method="post" action="/login">
        <?= csrf_field() ?>
        <label>Email <input name="email" type="email" autocomplete="email" required></label>
        <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
        <button type="submit">Log in</button>
    </form>
</section>
