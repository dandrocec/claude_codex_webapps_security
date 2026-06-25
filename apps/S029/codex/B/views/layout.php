<?php

use Guestbook\Auth;
use Guestbook\Csrf;
use Guestbook\Security;

$csrf = Csrf::token();
$e = [Security::class, 'escape'];
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Secure Guestbook</title>
    <style>
        :root { color-scheme: light; --ink: #17202a; --muted: #5f6b7a; --line: #d9e0e7; --accent: #1f766f; --danger: #a63232; --panel: #f7f9fb; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, sans-serif; color: var(--ink); background: #ffffff; }
        header { border-bottom: 1px solid var(--line); background: var(--panel); }
        main, .bar { width: min(960px, calc(100% - 32px)); margin: 0 auto; }
        .bar { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 20px 0; }
        h1 { margin: 0; font-size: 1.55rem; }
        h2 { margin: 0 0 14px; font-size: 1.1rem; }
        main { padding: 28px 0 44px; display: grid; grid-template-columns: minmax(0, 340px) minmax(0, 1fr); gap: 24px; align-items: start; }
        section, article { border: 1px solid var(--line); border-radius: 8px; padding: 18px; background: #fff; }
        form { display: grid; gap: 12px; }
        label { display: grid; gap: 5px; color: var(--muted); font-size: .93rem; }
        input, textarea { width: 100%; border: 1px solid #b9c3cf; border-radius: 6px; padding: 10px 11px; font: inherit; color: var(--ink); }
        textarea { min-height: 128px; resize: vertical; }
        button { border: 0; border-radius: 6px; padding: 10px 14px; font: inherit; font-weight: 650; color: #fff; background: var(--accent); cursor: pointer; }
        button.secondary { color: var(--accent); background: transparent; border: 1px solid var(--accent); }
        button.danger { background: var(--danger); padding: 7px 10px; font-size: .9rem; }
        .stack { display: grid; gap: 16px; }
        .auth { display: grid; gap: 16px; }
        .auth-tabs { display: grid; gap: 16px; }
        .message-list { display: grid; gap: 14px; }
        .meta { display: flex; flex-wrap: wrap; gap: 8px 12px; color: var(--muted); font-size: .9rem; margin-bottom: 10px; }
        .body { white-space: pre-wrap; line-height: 1.5; overflow-wrap: anywhere; }
        .notice { border: 1px solid #efc2c2; color: #7d2222; background: #fff7f7; border-radius: 8px; padding: 12px; margin-bottom: 16px; }
        .empty { color: var(--muted); background: var(--panel); }
        .top-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .signed-in { color: var(--muted); font-size: .92rem; }
        @media (max-width: 760px) {
            main { grid-template-columns: 1fr; }
            .bar { align-items: flex-start; flex-direction: column; }
        }
    </style>
</head>
<body>
    <header>
        <div class="bar">
            <h1>Guestbook</h1>
            <?php if ($user): ?>
                <div class="top-actions">
                    <span class="signed-in"><?= $e($user['email']) ?></span>
                    <form method="post" action="/?action=logout">
                        <input type="hidden" name="csrf_token" value="<?= $e($csrf) ?>">
                        <button class="secondary" type="submit">Sign out</button>
                    </form>
                </div>
            <?php endif; ?>
        </div>
    </header>

    <main>
        <div class="stack">
            <?php if ($errors): ?>
                <div class="notice" role="alert"><?= $e($errors[0]) ?></div>
            <?php endif; ?>

            <?php if ($user): ?>
                <section>
                    <h2>Leave a message</h2>
                    <form method="post" action="/?action=message">
                        <input type="hidden" name="csrf_token" value="<?= $e($csrf) ?>">
                        <label>
                            Name
                            <input name="display_name" maxlength="80" required value="<?= $e($old['display_name'] ?? '') ?>">
                        </label>
                        <label>
                            Message
                            <textarea name="message" maxlength="1000" required><?= $e($old['message'] ?? '') ?></textarea>
                        </label>
                        <button type="submit">Post message</button>
                    </form>
                </section>
            <?php else: ?>
                <section class="auth">
                    <div class="auth-tabs">
                        <div>
                            <h2>Create account</h2>
                            <form method="post" action="/?action=register">
                                <input type="hidden" name="csrf_token" value="<?= $e($csrf) ?>">
                                <label>Email <input type="email" name="email" maxlength="254" required autocomplete="email"></label>
                                <label>Password <input type="password" name="password" minlength="12" maxlength="128" required autocomplete="new-password"></label>
                                <button type="submit">Register</button>
                            </form>
                        </div>
                        <div>
                            <h2>Sign in</h2>
                            <form method="post" action="/?action=login">
                                <input type="hidden" name="csrf_token" value="<?= $e($csrf) ?>">
                                <label>Email <input type="email" name="email" maxlength="254" required autocomplete="email"></label>
                                <label>Password <input type="password" name="password" minlength="12" maxlength="128" required autocomplete="current-password"></label>
                                <button type="submit">Sign in</button>
                            </form>
                        </div>
                    </div>
                </section>
            <?php endif; ?>
        </div>

        <section>
            <h2>Messages</h2>
            <div class="message-list">
                <?php if (!$messages): ?>
                    <article class="empty">No messages yet.</article>
                <?php endif; ?>

                <?php foreach ($messages as $message): ?>
                    <article>
                        <div class="meta">
                            <strong><?= $e($message['display_name']) ?></strong>
                            <span><?= $e((new DateTimeImmutable($message['created_at']))->format('Y-m-d H:i')) ?> UTC</span>
                        </div>
                        <div class="body"><?= $e($message['body']) ?></div>
                        <?php if (Auth::userId() === (int) $message['user_id']): ?>
                            <form method="post" action="/?action=delete" style="margin-top: 12px;">
                                <input type="hidden" name="csrf_token" value="<?= $e($csrf) ?>">
                                <input type="hidden" name="message_id" value="<?= $e($message['id']) ?>">
                                <button class="danger" type="submit">Delete</button>
                            </form>
                        <?php endif; ?>
                    </article>
                <?php endforeach; ?>
            </div>
        </section>
    </main>
</body>
</html>
