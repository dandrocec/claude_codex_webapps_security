<?php /** @var array $board */ ?>
<?php /** @var string|null $error */ ?>
<?php /** @var string $title */ ?>
<?php /** @var string $body */ ?>
<?php $pageTitle = $title; $title = 'New thread'; ?>

<nav class="breadcrumb">
    <a href="/">Boards</a> ›
    <a href="/board/<?= (int) $board['id'] ?>"><?= e($board['name']) ?></a> › New thread
</nav>

<h1>New thread in <?= e($board['name']) ?></h1>

<?php if ($error): ?><p class="alert"><?= e($error) ?></p><?php endif; ?>

<form method="post" action="/board/<?= (int) $board['id'] ?>/new" class="form">
    <?= csrf_field() ?>
    <label>Title
        <input type="text" name="title" value="<?= e($pageTitle) ?>" maxlength="200" required autofocus>
    </label>
    <label>Body
        <textarea name="body" rows="8" required><?= e($body) ?></textarea>
    </label>
    <button type="submit" class="btn">Create thread</button>
</form>
