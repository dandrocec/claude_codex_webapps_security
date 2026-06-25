<section class="page-heading">
    <div>
        <h1>Approved Quotes</h1>
        <p>Browse published community submissions.</p>
    </div>
    <?php if ($currentUser): ?>
        <a class="button" href="/quotes/new">Submit a quote</a>
    <?php endif; ?>
</section>

<form class="filter" method="get" action="/">
    <label for="author">Filter by author</label>
    <select id="author" name="author" onchange="this.form.submit()">
        <option value="">All authors</option>
        <?php foreach ($authors as $author): ?>
            <option value="<?= e($author['author']) ?>" <?= $selectedAuthor === $author['author'] ? 'selected' : '' ?>>
                <?= e($author['author']) ?>
            </option>
        <?php endforeach; ?>
    </select>
    <button type="submit">Apply</button>
    <?php if ($selectedAuthor !== ''): ?>
        <a href="/">Clear</a>
    <?php endif; ?>
</form>

<?php if (!$quotes): ?>
    <div class="empty">No approved quotes found.</div>
<?php endif; ?>

<div class="quote-list">
    <?php foreach ($quotes as $quote): ?>
        <article class="quote-card">
            <blockquote><?= nl2br(e($quote['quote_text'])) ?></blockquote>
            <footer>
                <strong><?= e($quote['author']) ?></strong>
                <span>Submitted by <?= e($quote['submitter']) ?></span>
            </footer>
        </article>
    <?php endforeach; ?>
</div>
