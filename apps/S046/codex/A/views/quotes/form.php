<?php
$isEdit = (bool) $quote;
$quoteText = old('quote_text', $quote['quote_text'] ?? '');
$author = old('author', $quote['author'] ?? '');
?>

<section class="auth-panel wide">
    <h1><?= $isEdit ? 'Edit quote' : 'Submit quote' ?></h1>
    <form method="post" action="<?= $isEdit ? '/quotes/' . (int) $quote['id'] . '/edit' : '/quotes/new' ?>">
        <label for="quote_text">Quote text</label>
        <textarea id="quote_text" name="quote_text" rows="7" required><?= e($quoteText) ?></textarea>

        <label for="author">Author</label>
        <input id="author" name="author" value="<?= e($author) ?>" required>

        <?php if ($currentUser['is_admin'] && $isEdit): ?>
            <label class="check">
                <input type="checkbox" name="approved" value="1" <?= $quote['approved'] ? 'checked' : '' ?>>
                Approved
            </label>
        <?php endif; ?>

        <button class="button" type="submit"><?= $isEdit ? 'Save changes' : 'Submit for approval' ?></button>
    </form>
</section>
