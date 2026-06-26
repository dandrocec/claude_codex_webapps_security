<?php
declare(strict_types=1);

session_start();

const DB_DIR = __DIR__ . '/data';
const DB_PATH = DB_DIR . '/forum.sqlite';

if (!is_dir(DB_DIR)) {
    mkdir(DB_DIR, 0775, true);
}

$pdo = new PDO('sqlite:' . DB_PATH);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$pdo->exec('PRAGMA foreign_keys = ON');

initializeDatabase($pdo);

$flash = $_SESSION['flash'] ?? null;
unset($_SESSION['flash']);

$action = $_POST['action'] ?? $_GET['action'] ?? 'home';

try {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        verifyCsrf();

        match ($action) {
            'register' => register($pdo),
            'login' => login($pdo),
            'logout' => logout(),
            'new_thread' => createThread($pdo),
            'reply' => createReply($pdo),
            'delete_thread' => deleteThread($pdo),
            'delete_reply' => deleteReply($pdo),
            default => redirect('/'),
        };
    }
} catch (Throwable $error) {
    flash($error->getMessage(), 'error');
    redirect($_SERVER['HTTP_REFERER'] ?? '/');
}

$currentUser = currentUser($pdo);
$view = $_GET['view'] ?? 'home';

renderHeader($currentUser, $flash);

if ($view === 'board' && isset($_GET['id'])) {
    renderBoard($pdo, (int) $_GET['id'], $currentUser);
} elseif ($view === 'thread' && isset($_GET['id'])) {
    renderThread($pdo, (int) $_GET['id'], $currentUser);
} elseif ($view === 'login') {
    renderAuthForms();
} else {
    renderHome($pdo, $currentUser);
}

renderFooter();

function initializeDatabase(PDO $pdo): void
{
    $pdo->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS boards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS threads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            board_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at TEXT,
            FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS replies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            thread_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at TEXT,
            FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    SQL);

    $count = (int) $pdo->query('SELECT COUNT(*) FROM boards')->fetchColumn();
    if ($count === 0) {
        $stmt = $pdo->prepare('INSERT INTO boards (name, description) VALUES (?, ?)');
        $stmt->execute(['General Discussion', 'Introductions, announcements, and anything that does not fit elsewhere.']);
        $stmt->execute(['Help and Support', 'Ask questions and help other members solve problems.']);
        $stmt->execute(['Projects', 'Share what you are building and collect feedback.']);
    }
}

function register(PDO $pdo): void
{
    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');

    if (!preg_match('/^[A-Za-z0-9_]{3,24}$/', $username)) {
        throw new RuntimeException('Usernames must be 3-24 characters and use only letters, numbers, and underscores.');
    }

    if (strlen($password) < 8) {
        throw new RuntimeException('Passwords must be at least 8 characters.');
    }

    $role = ((int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn()) === 0 ? 'moderator' : 'user';
    $stmt = $pdo->prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
    $stmt->execute([$username, password_hash($password, PASSWORD_DEFAULT), $role]);

    $_SESSION['user_id'] = (int) $pdo->lastInsertId();
    flash($role === 'moderator' ? 'Account created. You are the first user, so you are a moderator.' : 'Account created.');
    redirect('/');
}

function login(PDO $pdo): void
{
    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');
    $stmt = $pdo->prepare('SELECT * FROM users WHERE username = ?');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        throw new RuntimeException('Invalid username or password.');
    }

    $_SESSION['user_id'] = (int) $user['id'];
    flash('Logged in.');
    redirect('/');
}

function logout(): void
{
    $_SESSION = [];
    session_destroy();
    session_start();
    flash('Logged out.');
    redirect('/');
}

function createThread(PDO $pdo): void
{
    $user = requireUser($pdo);
    $boardId = (int) ($_POST['board_id'] ?? 0);
    $title = trim((string) ($_POST['title'] ?? ''));
    $body = trim((string) ($_POST['body'] ?? ''));

    if ($boardId < 1 || $title === '' || $body === '') {
        throw new RuntimeException('Choose a board and enter a title and message.');
    }

    if (strlen($title) > 140) {
        throw new RuntimeException('Thread titles must be 140 characters or fewer.');
    }

    $stmt = $pdo->prepare('INSERT INTO threads (board_id, user_id, title, body) VALUES (?, ?, ?, ?)');
    $stmt->execute([$boardId, $user['id'], $title, $body]);
    flash('Thread posted.');
    redirect('/?view=thread&id=' . (int) $pdo->lastInsertId());
}

function createReply(PDO $pdo): void
{
    $user = requireUser($pdo);
    $threadId = (int) ($_POST['thread_id'] ?? 0);
    $body = trim((string) ($_POST['body'] ?? ''));

    if ($threadId < 1 || $body === '') {
        throw new RuntimeException('Enter a reply before posting.');
    }

    $stmt = $pdo->prepare('INSERT INTO replies (thread_id, user_id, body) VALUES (?, ?, ?)');
    $stmt->execute([$threadId, $user['id'], $body]);
    flash('Reply posted.');
    redirect('/?view=thread&id=' . $threadId);
}

function deleteThread(PDO $pdo): void
{
    requireModerator($pdo);
    $threadId = (int) ($_POST['thread_id'] ?? 0);
    $stmt = $pdo->prepare('UPDATE threads SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?');
    $stmt->execute([$threadId]);
    flash('Thread deleted.');
    redirect('/');
}

function deleteReply(PDO $pdo): void
{
    requireModerator($pdo);
    $replyId = (int) ($_POST['reply_id'] ?? 0);
    $threadId = (int) ($_POST['thread_id'] ?? 0);
    $stmt = $pdo->prepare('UPDATE replies SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?');
    $stmt->execute([$replyId]);
    flash('Reply deleted.');
    redirect('/?view=thread&id=' . $threadId);
}

function currentUser(PDO $pdo): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }

    $stmt = $pdo->prepare('SELECT id, username, role FROM users WHERE id = ?');
    $stmt->execute([(int) $_SESSION['user_id']]);
    return $stmt->fetch() ?: null;
}

function requireUser(PDO $pdo): array
{
    $user = currentUser($pdo);
    if (!$user) {
        throw new RuntimeException('You must be logged in.');
    }
    return $user;
}

function requireModerator(PDO $pdo): array
{
    $user = requireUser($pdo);
    if ($user['role'] !== 'moderator') {
        throw new RuntimeException('Only moderators can delete posts.');
    }
    return $user;
}

function csrfToken(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function verifyCsrf(): void
{
    if (!hash_equals($_SESSION['csrf'] ?? '', (string) ($_POST['csrf'] ?? ''))) {
        throw new RuntimeException('The form expired. Please try again.');
    }
}

function flash(string $message, string $type = 'success'): void
{
    $_SESSION['flash'] = ['message' => $message, 'type' => $type];
}

function redirect(string $url): never
{
    header('Location: ' . $url);
    exit;
}

function e(string|int|null $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

function formToken(): string
{
    return '<input type="hidden" name="csrf" value="' . e(csrfToken()) . '">';
}

function renderHeader(?array $currentUser, ?array $flash): void
{
    ?>
    <!doctype html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Forum</title>
        <style>
            :root {
                color-scheme: light;
                --bg: #f7f5ef;
                --panel: #ffffff;
                --ink: #202124;
                --muted: #656b73;
                --line: #dad7cf;
                --accent: #2d6cdf;
                --accent-dark: #1f4e9d;
                --danger: #b42318;
                --ok: #146c43;
            }
            * { box-sizing: border-box; }
            body {
                margin: 0;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                background: var(--bg);
                color: var(--ink);
                line-height: 1.5;
            }
            a { color: var(--accent-dark); text-decoration: none; }
            a:hover { text-decoration: underline; }
            .topbar {
                background: #243447;
                color: #fff;
                border-bottom: 4px solid #f2b84b;
            }
            .topbar-inner, .container {
                width: min(1120px, calc(100% - 32px));
                margin: 0 auto;
            }
            .topbar-inner {
                min-height: 68px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 16px;
            }
            .brand {
                color: #fff;
                font-size: 1.35rem;
                font-weight: 800;
                letter-spacing: 0;
            }
            .nav {
                display: flex;
                align-items: center;
                gap: 12px;
                flex-wrap: wrap;
            }
            .nav span { color: #dce5ee; }
            .container { padding: 28px 0 44px; }
            .flash {
                padding: 12px 14px;
                border: 1px solid;
                border-radius: 6px;
                margin-bottom: 18px;
                background: #fff;
            }
            .flash.success { color: var(--ok); border-color: #8fd1ad; }
            .flash.error { color: var(--danger); border-color: #f2a29b; }
            .grid {
                display: grid;
                grid-template-columns: 1fr 340px;
                gap: 22px;
                align-items: start;
            }
            .panel, .item {
                background: var(--panel);
                border: 1px solid var(--line);
                border-radius: 8px;
            }
            .panel { padding: 18px; }
            .item {
                padding: 16px;
                margin-bottom: 12px;
            }
            h1, h2, h3 { line-height: 1.2; margin: 0 0 12px; }
            h1 { font-size: clamp(1.8rem, 4vw, 2.8rem); }
            h2 { font-size: 1.35rem; }
            h3 { font-size: 1.08rem; }
            .muted { color: var(--muted); }
            .meta {
                color: var(--muted);
                font-size: .92rem;
                display: flex;
                flex-wrap: wrap;
                gap: 8px 14px;
            }
            .row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 14px;
            }
            .count {
                min-width: 92px;
                text-align: right;
                color: var(--muted);
                font-weight: 700;
            }
            form { margin: 0; }
            label {
                display: block;
                margin: 12px 0 6px;
                color: var(--muted);
                font-weight: 700;
                font-size: .9rem;
            }
            input, select, textarea {
                width: 100%;
                border: 1px solid #c6c9ce;
                border-radius: 6px;
                padding: 10px 11px;
                font: inherit;
                background: #fff;
                color: var(--ink);
            }
            textarea { min-height: 140px; resize: vertical; }
            button, .button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                border: 0;
                border-radius: 6px;
                padding: 9px 13px;
                background: var(--accent);
                color: #fff;
                font: inherit;
                font-weight: 750;
                cursor: pointer;
                text-decoration: none;
            }
            button:hover, .button:hover { background: var(--accent-dark); text-decoration: none; }
            .ghost {
                background: transparent;
                border: 1px solid rgba(255,255,255,.65);
                color: #fff;
            }
            .danger {
                background: var(--danger);
                padding: 7px 10px;
                font-size: .9rem;
            }
            .danger:hover { background: #7a1b14; }
            .post-body {
                white-space: pre-wrap;
                overflow-wrap: anywhere;
                margin: 10px 0 0;
            }
            .deleted {
                border-style: dashed;
                background: #fafafa;
                color: var(--muted);
            }
            .auth {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 18px;
            }
            @media (max-width: 820px) {
                .grid, .auth { grid-template-columns: 1fr; }
                .topbar-inner, .row { align-items: flex-start; flex-direction: column; }
                .count { text-align: left; min-width: 0; }
            }
        </style>
    </head>
    <body>
    <header class="topbar">
        <div class="topbar-inner">
            <a class="brand" href="/">Forum</a>
            <nav class="nav">
                <a class="ghost button" href="/">Boards</a>
                <?php if ($currentUser): ?>
                    <span><?= e($currentUser['username']) ?> · <?= e($currentUser['role']) ?></span>
                    <form method="post" action="/">
                        <?= formToken() ?>
                        <input type="hidden" name="action" value="logout">
                        <button class="ghost" type="submit">Log out</button>
                    </form>
                <?php else: ?>
                    <a class="ghost button" href="/?view=login">Log in</a>
                <?php endif; ?>
            </nav>
        </div>
    </header>
    <main class="container">
        <?php if ($flash): ?>
            <div class="flash <?= e($flash['type']) ?>"><?= e($flash['message']) ?></div>
        <?php endif; ?>
    <?php
}

function renderFooter(): void
{
    ?>
    </main>
    </body>
    </html>
    <?php
}

function renderHome(PDO $pdo, ?array $currentUser): void
{
    $boards = $pdo->query(<<<SQL
        SELECT
            b.*,
            COUNT(DISTINCT t.id) AS thread_count,
            COUNT(r.id) AS reply_count,
            MAX(COALESCE(r.created_at, t.created_at, b.created_at)) AS last_activity
        FROM boards b
        LEFT JOIN threads t ON t.board_id = b.id AND t.deleted_at IS NULL
        LEFT JOIN replies r ON r.thread_id = t.id AND r.deleted_at IS NULL
        GROUP BY b.id
        ORDER BY b.name
    SQL)->fetchAll();

    ?>
    <div class="grid">
        <section>
            <h1>Boards</h1>
            <p class="muted">Browse discussions, start a thread, or join an existing conversation.</p>
            <?php foreach ($boards as $board): ?>
                <article class="item">
                    <div class="row">
                        <div>
                            <h2><a href="/?view=board&id=<?= e($board['id']) ?>"><?= e($board['name']) ?></a></h2>
                            <p><?= e($board['description']) ?></p>
                            <div class="meta">
                                <span><?= e($board['thread_count']) ?> threads</span>
                                <span><?= e($board['reply_count']) ?> replies</span>
                                <span>Last activity <?= e($board['last_activity']) ?></span>
                            </div>
                        </div>
                    </div>
                </article>
            <?php endforeach; ?>
        </section>
        <aside class="panel">
            <?php renderThreadForm($pdo, $currentUser); ?>
        </aside>
    </div>
    <?php
}

function renderBoard(PDO $pdo, int $boardId, ?array $currentUser): void
{
    $stmt = $pdo->prepare('SELECT * FROM boards WHERE id = ?');
    $stmt->execute([$boardId]);
    $board = $stmt->fetch();

    if (!$board) {
        echo '<div class="panel">Board not found.</div>';
        return;
    }

    $stmt = $pdo->prepare(<<<SQL
        SELECT
            t.*,
            u.username,
            COUNT(r.id) AS reply_count,
            MAX(COALESCE(r.created_at, t.created_at)) AS last_activity
        FROM threads t
        JOIN users u ON u.id = t.user_id
        LEFT JOIN replies r ON r.thread_id = t.id AND r.deleted_at IS NULL
        WHERE t.board_id = ? AND t.deleted_at IS NULL
        GROUP BY t.id
        ORDER BY datetime(last_activity) DESC, datetime(t.created_at) DESC
    SQL);
    $stmt->execute([$boardId]);
    $threads = $stmt->fetchAll();

    ?>
    <div class="grid">
        <section>
            <h1><?= e($board['name']) ?></h1>
            <p class="muted"><?= e($board['description']) ?></p>
            <?php if (!$threads): ?>
                <article class="item">No threads yet.</article>
            <?php endif; ?>
            <?php foreach ($threads as $thread): ?>
                <article class="item">
                    <div class="row">
                        <div>
                            <h2><a href="/?view=thread&id=<?= e($thread['id']) ?>"><?= e($thread['title']) ?></a></h2>
                            <div class="meta">
                                <span>Started by <?= e($thread['username']) ?></span>
                                <span><?= e($thread['created_at']) ?></span>
                                <span>Last activity <?= e($thread['last_activity']) ?></span>
                            </div>
                        </div>
                        <div class="count"><?= e($thread['reply_count']) ?> replies</div>
                    </div>
                </article>
            <?php endforeach; ?>
        </section>
        <aside class="panel">
            <?php renderThreadForm($pdo, $currentUser, $boardId); ?>
        </aside>
    </div>
    <?php
}

function renderThread(PDO $pdo, int $threadId, ?array $currentUser): void
{
    $stmt = $pdo->prepare(<<<SQL
        SELECT t.*, u.username, b.name AS board_name
        FROM threads t
        JOIN users u ON u.id = t.user_id
        JOIN boards b ON b.id = t.board_id
        WHERE t.id = ?
    SQL);
    $stmt->execute([$threadId]);
    $thread = $stmt->fetch();

    if (!$thread || $thread['deleted_at']) {
        echo '<div class="panel">Thread not found.</div>';
        return;
    }

    $stmt = $pdo->prepare(<<<SQL
        SELECT r.*, u.username
        FROM replies r
        JOIN users u ON u.id = r.user_id
        WHERE r.thread_id = ?
        ORDER BY datetime(r.created_at) ASC
    SQL);
    $stmt->execute([$threadId]);
    $replies = $stmt->fetchAll();

    ?>
    <section>
        <p><a href="/?view=board&id=<?= e($thread['board_id']) ?>">&larr; <?= e($thread['board_name']) ?></a></p>
        <article class="item">
            <div class="row">
                <div>
                    <h1><?= e($thread['title']) ?></h1>
                    <div class="meta">
                        <span>Started by <?= e($thread['username']) ?></span>
                        <span><?= e($thread['created_at']) ?></span>
                    </div>
                </div>
                <?php if ($currentUser && $currentUser['role'] === 'moderator'): ?>
                    <form method="post" action="/">
                        <?= formToken() ?>
                        <input type="hidden" name="action" value="delete_thread">
                        <input type="hidden" name="thread_id" value="<?= e($thread['id']) ?>">
                        <button class="danger" type="submit">Delete thread</button>
                    </form>
                <?php endif; ?>
            </div>
            <div class="post-body"><?= e($thread['body']) ?></div>
        </article>

        <h2>Replies</h2>
        <?php if (!$replies): ?>
            <article class="item">No replies yet.</article>
        <?php endif; ?>
        <?php foreach ($replies as $reply): ?>
            <?php if ($reply['deleted_at']): ?>
                <article class="item deleted">Reply deleted by a moderator.</article>
            <?php else: ?>
                <article class="item">
                    <div class="row">
                        <div class="meta">
                            <span><?= e($reply['username']) ?></span>
                            <span><?= e($reply['created_at']) ?></span>
                        </div>
                        <?php if ($currentUser && $currentUser['role'] === 'moderator'): ?>
                            <form method="post" action="/">
                                <?= formToken() ?>
                                <input type="hidden" name="action" value="delete_reply">
                                <input type="hidden" name="reply_id" value="<?= e($reply['id']) ?>">
                                <input type="hidden" name="thread_id" value="<?= e($thread['id']) ?>">
                                <button class="danger" type="submit">Delete reply</button>
                            </form>
                        <?php endif; ?>
                    </div>
                    <div class="post-body"><?= e($reply['body']) ?></div>
                </article>
            <?php endif; ?>
        <?php endforeach; ?>

        <div class="panel">
            <?php if ($currentUser): ?>
                <h2>Post a reply</h2>
                <form method="post" action="/">
                    <?= formToken() ?>
                    <input type="hidden" name="action" value="reply">
                    <input type="hidden" name="thread_id" value="<?= e($thread['id']) ?>">
                    <label for="body">Message</label>
                    <textarea id="body" name="body" required></textarea>
                    <p><button type="submit">Reply</button></p>
                </form>
            <?php else: ?>
                <p><a href="/?view=login">Log in</a> to reply.</p>
            <?php endif; ?>
        </div>
    </section>
    <?php
}

function renderThreadForm(PDO $pdo, ?array $currentUser, ?int $selectedBoard = null): void
{
    if (!$currentUser) {
        echo '<h2>Start a thread</h2><p><a href="/?view=login">Log in</a> to create a thread.</p>';
        return;
    }

    $boards = $pdo->query('SELECT id, name FROM boards ORDER BY name')->fetchAll();
    ?>
    <h2>Start a thread</h2>
    <form method="post" action="/">
        <?= formToken() ?>
        <input type="hidden" name="action" value="new_thread">
        <label for="board_id">Board</label>
        <select id="board_id" name="board_id" required>
            <?php foreach ($boards as $board): ?>
                <option value="<?= e($board['id']) ?>" <?= $selectedBoard === (int) $board['id'] ? 'selected' : '' ?>>
                    <?= e($board['name']) ?>
                </option>
            <?php endforeach; ?>
        </select>
        <label for="title">Title</label>
        <input id="title" name="title" maxlength="140" required>
        <label for="thread-body">Message</label>
        <textarea id="thread-body" name="body" required></textarea>
        <p><button type="submit">Post thread</button></p>
    </form>
    <?php
}

function renderAuthForms(): void
{
    ?>
    <section class="auth">
        <div class="panel">
            <h1>Register</h1>
            <form method="post" action="/">
                <?= formToken() ?>
                <input type="hidden" name="action" value="register">
                <label for="register-username">Username</label>
                <input id="register-username" name="username" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" required>
                <label for="register-password">Password</label>
                <input id="register-password" name="password" type="password" minlength="8" required>
                <p><button type="submit">Create account</button></p>
            </form>
        </div>
        <div class="panel">
            <h1>Log in</h1>
            <form method="post" action="/">
                <?= formToken() ?>
                <input type="hidden" name="action" value="login">
                <label for="login-username">Username</label>
                <input id="login-username" name="username" required>
                <label for="login-password">Password</label>
                <input id="login-password" name="password" type="password" required>
                <p><button type="submit">Log in</button></p>
            </form>
        </div>
    </section>
    <?php
}
