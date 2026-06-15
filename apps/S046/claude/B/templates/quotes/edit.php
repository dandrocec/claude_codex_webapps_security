<?php
/** @var array $quote */
$text   = old('text', (string) $quote['text']);
$author = old('author', (string) $quote['author']);
?>
<section class="page-head">
    <h1>Edit quote</h1>
    <p class="muted">Saving will send the quote back for review before it reappears publicly.</p>
</section>

<form class="form" method="post" action="/quotes/<?= (int) $quote['id'] ?>/edit">
    <?= \App\Csrf::field() ?>

    <label for="text">Quote</label>
    <textarea id="text" name="text" rows="5" maxlength="<?= \App\Quote::MAX_TEXT ?>"
              required><?= e($text) ?></textarea>

    <label for="author">Author</label>
    <input type="text" id="author" name="author" maxlength="<?= \App\Quote::MAX_AUTHOR ?>"
           value="<?= e($author) ?>" required>

    <div class="form-actions">
        <button type="submit">Save changes</button>
        <a class="cancel" href="/dashboard">Cancel</a>
    </div>
</form>
