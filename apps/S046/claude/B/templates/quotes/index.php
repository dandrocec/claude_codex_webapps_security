<?php
/** @var array $quotes */
/** @var array $authors */
/** @var string $filter */
?>
<section class="page-head">
    <h1>Quotes</h1>
    <p class="muted">Browse approved quotes. Filter by author below.</p>
</section>

<form class="filter" method="get" action="/">
    <label for="author">Author</label>
    <select id="author" name="author">
        <option value="">All authors</option>
        <?php foreach ($authors as $a): ?>
            <option value="<?= e($a) ?>"<?= $a === $filter ? ' selected' : '' ?>>
                <?= e($a) ?>
            </option>
        <?php endforeach; ?>
    </select>
    <button type="submit">Filter</button>
    <?php if ($filter !== ''): ?>
        <a class="clear" href="/">Clear</a>
    <?php endif; ?>
</form>

<?php if ($quotes === []): ?>
    <p class="empty">No approved quotes<?= $filter !== '' ? ' for ' . e($filter) : '' ?> yet.</p>
<?php else: ?>
    <ul class="quote-list">
        <?php foreach ($quotes as $q): ?>
            <li class="quote">
                <blockquote><?= nl2br(e((string) $q['text'])) ?></blockquote>
                <p class="byline">&mdash; <?= e((string) $q['author']) ?>
                    <span class="muted">(submitted by <?= e((string) $q['submitter']) ?>)</span>
                </p>
            </li>
        <?php endforeach; ?>
    </ul>
<?php endif; ?>
