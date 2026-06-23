<?php
/** @var string $content  Rendered page body */
/** @var array|null $user  Current user */
/** @var array $flashes */
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= isset($title) ? e($title) . ' · ' : '' ?>Marketplace</title>
    <style>
        :root { --accent:#4f46e5; --accent-dark:#4338ca; --bg:#f5f6fa; --line:#e3e5ee; --text:#1f2330; --muted:#6b7280; }
        * { box-sizing: border-box; }
        body { margin:0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
               background:var(--bg); color:var(--text); line-height:1.5; }
        a { color:var(--accent); text-decoration:none; }
        a:hover { text-decoration:underline; }
        header.nav { background:#fff; border-bottom:1px solid var(--line); position:sticky; top:0; z-index:10; }
        .nav-inner { max-width:1040px; margin:0 auto; display:flex; align-items:center; gap:18px;
                     padding:14px 20px; flex-wrap:wrap; }
        .brand { font-weight:700; font-size:1.2rem; color:var(--text); }
        .brand span { color:var(--accent); }
        .nav-links { display:flex; gap:16px; align-items:center; margin-left:auto; flex-wrap:wrap; }
        .pill { background:var(--accent); color:#fff; border-radius:999px; padding:2px 9px; font-size:.78rem; }
        .role-tag { font-size:.75rem; color:var(--muted); border:1px solid var(--line); padding:2px 8px; border-radius:6px; }
        main { max-width:1040px; margin:24px auto; padding:0 20px; }
        .flash { padding:11px 15px; border-radius:8px; margin-bottom:14px; font-size:.95rem; }
        .flash.success { background:#e7f8ef; color:#0f7a44; border:1px solid #b7e6cd; }
        .flash.error   { background:#fdecec; color:#b42318; border:1px solid #f5c2bd; }
        .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:18px; }
        .card { background:#fff; border:1px solid var(--line); border-radius:12px; padding:16px; }
        .card h3 { margin:0 0 6px; font-size:1.05rem; }
        .price { font-weight:700; font-size:1.1rem; }
        .muted { color:var(--muted); font-size:.88rem; }
        .btn { display:inline-block; background:var(--accent); color:#fff; border:0; border-radius:8px;
               padding:9px 16px; font-size:.92rem; cursor:pointer; }
        .btn:hover { background:var(--accent-dark); text-decoration:none; }
        .btn.secondary { background:#fff; color:var(--text); border:1px solid var(--line); }
        .btn.danger { background:#dc2626; }
        .btn.small { padding:5px 11px; font-size:.82rem; }
        table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:12px; overflow:hidden; }
        th, td { text-align:left; padding:11px 14px; border-bottom:1px solid var(--line); font-size:.92rem; }
        th { background:#fafbff; font-size:.78rem; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); }
        tr:last-child td { border-bottom:0; }
        form.inline { display:inline; }
        input, textarea, select { width:100%; padding:9px 11px; border:1px solid var(--line);
               border-radius:8px; font:inherit; background:#fff; }
        label { display:block; font-size:.85rem; font-weight:600; margin:12px 0 5px; }
        .panel { background:#fff; border:1px solid var(--line); border-radius:12px; padding:22px; }
        .narrow { max-width:430px; margin:0 auto; }
        h1 { font-size:1.6rem; margin-top:0; }
        .errlist { background:#fdecec; border:1px solid #f5c2bd; color:#b42318; border-radius:8px; padding:10px 14px; }
        .errlist li { margin-left:4px; }
        .field-err { color:#b42318; font-size:.82rem; margin-top:4px; }
        .toolbar { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:18px; flex-wrap:wrap; }
        .demo-box { background:#fff; border:1px dashed var(--line); border-radius:10px; padding:12px 16px;
                    font-size:.85rem; color:var(--muted); margin-top:18px; }
        .demo-box code { background:#f0f1f7; padding:1px 5px; border-radius:4px; }
    </style>
</head>
<body>
<header class="nav">
    <div class="nav-inner">
        <a class="brand" href="/">Multi<span>Mart</span></a>
        <nav class="nav-links">
            <a href="/">Shop</a>
            <?php if ($user && $user['role'] === 'vendor'): ?>
                <a href="/vendor/products">My Products</a>
                <a href="/vendor/orders">My Orders</a>
            <?php elseif ($user && $user['role'] === 'buyer'): ?>
                <a href="/orders">My Orders</a>
            <?php endif; ?>
            <?php if (!$user || $user['role'] === 'buyer'): ?>
                <a href="/cart">Cart <span class="pill"><?= cart_count() ?></span></a>
            <?php endif; ?>
            <?php if ($user): ?>
                <span class="role-tag"><?= e($user['role']) ?>: <?= e($user['shop_name'] ?: $user['name']) ?></span>
                <form class="inline" method="post" action="/logout">
                    <?= csrf_field() ?>
                    <button class="btn secondary small" type="submit">Log out</button>
                </form>
            <?php else: ?>
                <a href="/login">Log in</a>
                <a class="btn small" href="/register">Sign up</a>
            <?php endif; ?>
        </nav>
    </div>
</header>
<main>
    <?php foreach ($flashes as $f): ?>
        <div class="flash <?= e($f['type']) ?>"><?= e($f['message']) ?></div>
    <?php endforeach; ?>
    <?= $content ?>
</main>
</body>
</html>
