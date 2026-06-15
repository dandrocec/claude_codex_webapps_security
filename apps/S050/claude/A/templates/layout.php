<?php
/** @var string $content  Rendered page body. */
/** @var string $title    Page title. */
$user = current_user();
$flash = take_flash();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e($title ?? 'Photo Blog') ?> · Photo Blog</title>
    <style>
        :root { --bg:#fafafa; --card:#fff; --line:#e4e4e7; --ink:#18181b; --muted:#71717a; --accent:#2563eb; }
        * { box-sizing: border-box; }
        body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
               background: var(--bg); color: var(--ink); }
        header { background: var(--card); border-bottom: 1px solid var(--line); }
        .bar { max-width: 720px; margin: 0 auto; padding: 14px 16px;
               display: flex; align-items: center; gap: 16px; }
        .bar a.brand { font-weight: 700; font-size: 18px; text-decoration: none; color: var(--ink); }
        .bar .spacer { flex: 1; }
        .bar a, .bar form { color: var(--accent); text-decoration: none; }
        main { max-width: 720px; margin: 0 auto; padding: 16px; }
        .flash { background:#ecfdf5; border:1px solid #a7f3d0; color:#065f46;
                 padding:10px 14px; border-radius:8px; margin-bottom:16px; }
        .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px;
                margin-bottom: 20px; overflow: hidden; }
        .card img { display:block; width:100%; height:auto; background:#f1f1f4; }
        .card .body { padding: 12px 14px; }
        .card .meta { color: var(--muted); font-size: 13px; margin-bottom: 6px; }
        .card .caption { white-space: pre-wrap; margin: 0; }
        .card .actions { margin-top: 10px; display:flex; gap:12px; font-size: 14px; }
        .btn { display:inline-block; background: var(--accent); color:#fff; border:0;
               padding:9px 16px; border-radius:8px; font-size:15px; cursor:pointer; text-decoration:none; }
        .btn.secondary { background:#f4f4f5; color: var(--ink); border:1px solid var(--line); }
        .btn.danger { background:#fee2e2; color:#991b1b; border:1px solid #fecaca; }
        form.inline { display:inline; }
        label { display:block; font-weight:600; margin: 14px 0 6px; }
        input[type=text], input[type=password], input[type=file], textarea {
            width:100%; padding:10px; border:1px solid var(--line); border-radius:8px; font:inherit; }
        textarea { min-height: 90px; resize: vertical; }
        .error { background:#fef2f2; border:1px solid #fecaca; color:#991b1b;
                 padding:10px 14px; border-radius:8px; margin-bottom:16px; }
        .empty { color: var(--muted); text-align:center; padding: 48px 0; }
        .muted { color: var(--muted); }
    </style>
</head>
<body>
    <header>
        <nav class="bar">
            <a class="brand" href="/">📷 Photo Blog</a>
            <span class="spacer"></span>
            <?php if ($user !== null): ?>
                <a href="/posts/new">New post</a>
                <span class="muted"><?= e($user['username']) ?></span>
                <form class="inline" method="post" action="/logout">
                    <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>">
                    <button class="btn secondary" type="submit">Log out</button>
                </form>
            <?php else: ?>
                <a href="/login">Log in</a>
                <a href="/register">Register</a>
            <?php endif; ?>
        </nav>
    </header>
    <main>
        <?php if ($flash !== null): ?>
            <div class="flash"><?= e($flash) ?></div>
        <?php endif; ?>
        <?= $content ?>
    </main>
</body>
</html>
