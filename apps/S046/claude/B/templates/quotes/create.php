<?php /** @var array $user */ ?>
<section class="page-head">
    <h1>Submit a quote</h1>
    <p class="muted">Your quote will be reviewed before it appears publicly.</p>
</section>

<form class="form" method="post" action="/quotes">
    <?= \App\Csrf::field() ?>

    <label for="text">Quote</label>
    <textarea id="text" name="text" rows="5" maxlength="<?= \App\Quote::MAX_TEXT ?>"
              required><?= e(old('text')) ?></textarea>

    <label for="author">Author</label>
    <input type="text" id="author" name="author" maxlength="<?= \App\Quote::MAX_AUTHOR ?>"
           value="<?= e(old('author')) ?>" required>

    <div class="form-actions">
        <button type="submit">Submit quote</button>
        <a class="cancel" href="/dashboard">Cancel</a>
    </div>
</form>
