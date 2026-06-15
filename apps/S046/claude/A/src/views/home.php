<?php
/** @var array $quotes */
/** @var array $authors */
/** @var string $authorFilter */
?>
<h1>Browse quotes</h1>

<form class="filter" method="get">
    <input type="hidden" name="page" value="home">
    <label for="author">Filter by author</label>
    <select name="author" id="author" onchange="this.form.submit()">
        <option value="">All authors</option>
        <?php foreach ($authors as $author): ?>
            <option value="<?= e($author) ?>" <?= $author === $authorFilter ? 'selected' : '' ?>>
                <?= e($author) ?>
            </option>
        <?php endforeach; ?>
    </select>
    <noscript><button type="submit">Filter</button></noscript>
    <?php if ($authorFilter !== ''): ?>
        <a class="clear" href="?page=home">Clear filter</a>
    <?php endif; ?>
</form>

<?php if (!$quotes): ?>
    <p class="empty">No approved quotes<?= $authorFilter !== '' ? ' by ' . e($authorFilter) : '' ?> yet.</p>
<?php else: ?>
    <ul class="quote-list">
        <?php foreach ($quotes as $q): ?>
            <li class="quote-card">
                <blockquote><?= nl2br(e($q['text'])) ?></blockquote>
                <p class="byline">— <?= e($q['author']) ?>
                    <span class="submitter">(submitted by @<?= e($q['username']) ?>)</span>
                </p>
            </li>
        <?php endforeach; ?>
    </ul>
<?php endif; ?>
