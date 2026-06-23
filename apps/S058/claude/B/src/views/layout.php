<?php
/** @var string $content @var string $pageTitle */
$user = current_user();
$flash = flash();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e($pageTitle) ?> · PHP Forum</title>
    <style>
        :root { --bg:#0f1115; --card:#1a1d24; --muted:#8b93a7; --fg:#e8eaf0; --accent:#5b8cff; --border:#2a2f3a; --danger:#ff6b6b; }
        * { box-sizing: border-box; }
        body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:var(--bg); color:var(--fg); line-height:1.5; }
        a { color:var(--accent); text-decoration:none; }
        a:hover { text-decoration:underline; }
        header.site { background:var(--card); border-bottom:1px solid var(--border); }
        .wrap { max-width:860px; margin:0 auto; padding:16px; }
        header.site .wrap { display:flex; align-items:center; justify-content:space-between; gap:12px; }
        header.site h1 { font-size:1.15rem; margin:0; }
        nav.user { display:flex; align-items:center; gap:12px; font-size:.9rem; }
        .card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:16px; margin:12px 0; }
        .muted { color:var(--muted); font-size:.85rem; }
        .flash { background:#1d2b1f; border:1px solid #2f5132; color:#bdf0c4; padding:10px 14px; border-radius:8px; margin:12px 0; }
        .crumbs { font-size:.85rem; margin:4px 0 0; }
        h2 { margin:.2rem 0; font-size:1.3rem; }
        .thread-row { display:flex; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid var(--border); }
        .thread-row:last-child { border-bottom:none; }
        .pill { background:#222838; color:var(--muted); border-radius:999px; padding:2px 10px; font-size:.8rem; white-space:nowrap; }
        label { display:block; font-size:.85rem; margin:10px 0 4px; color:var(--muted); }
        input[type=text], input[type=password], textarea, select {
            width:100%; padding:10px; background:#11141b; border:1px solid var(--border);
            border-radius:8px; color:var(--fg); font:inherit;
        }
        textarea { min-height:120px; resize:vertical; }
        button, .btn { background:var(--accent); color:#fff; border:none; padding:9px 16px; border-radius:8px; font:inherit; cursor:pointer; }
        button:hover { filter:brightness(1.08); }
        button.danger { background:transparent; color:var(--danger); border:1px solid var(--danger); padding:4px 10px; font-size:.8rem; }
        .post-body { white-space:pre-wrap; word-wrap:break-word; margin:8px 0 0; }
        .post-head { display:flex; justify-content:space-between; align-items:center; gap:8px; }
        .errors { color:var(--danger); font-size:.85rem; }
        .inline { display:inline; }
        footer { text-align:center; padding:20px; }
    </style>
</head>
<body>
    <header class="site">
        <div class="wrap">
            <h1><a href="/">PHP Forum</a></h1>
            <nav class="user">
                <?php if ($user): ?>
                    <span class="muted">
                        <?= e($user['username']) ?><?= $user['role'] === 'moderator' ? ' (mod)' : '' ?>
                    </span>
                    <form method="post" action="/logout" class="inline">
                        <?= csrf_field() ?>
                        <button type="submit">Log out</button>
                    </form>
                <?php else: ?>
                    <a href="/login">Log in</a>
                    <a href="/register">Register</a>
                <?php endif; ?>
            </nav>
        </div>
    </header>
    <main class="wrap">
        <?php if ($flash): ?>
            <div class="flash"><?= e($flash) ?></div>
        <?php endif; ?>
        <?= $content /* already-escaped HTML produced by the view */ ?>
    </main>
    <footer class="muted">PHP Forum — a security-focused demo.</footer>
</body>
</html>
