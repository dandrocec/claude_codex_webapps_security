<?php
/** @var array $quote */
/** @var array $errors */
?>
<h1>Edit quote</h1>

<?php foreach ($errors as $error): ?>
    <div class="error"><?= e($error) ?></div>
<?php endforeach; ?>

<form method="post" action="?page=edit&id=<?= (int) $quote['id'] ?>" class="card-form">
    <?= csrf_field() ?>
    <label>Quote
        <textarea name="text" rows="4" required><?= e($quote['text']) ?></textarea>
    </label>
    <label>Author
        <input type="text" name="author" value="<?= e($quote['author']) ?>" required>
    </label>
    <button type="submit">Save changes</button>
    <a class="clear" href="?page=mine">Cancel</a>
</form>

<p class="hint">Saving an edit sends the quote back to the review queue.</p>
