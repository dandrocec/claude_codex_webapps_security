<?php
/** @var array $errors */
/** @var string $text */
/** @var string $author */
?>
<h1>Submit a quote</h1>

<?php foreach ($errors as $error): ?>
    <div class="error"><?= e($error) ?></div>
<?php endforeach; ?>

<form method="post" action="?page=submit" class="card-form">
    <?= csrf_field() ?>
    <label>Quote
        <textarea name="text" rows="4" required><?= e($text) ?></textarea>
    </label>
    <label>Author
        <input type="text" name="author" value="<?= e($author) ?>" required>
    </label>
    <button type="submit">Submit for review</button>
</form>

<p class="hint">Submitted quotes appear on the public page once an admin approves them.</p>
