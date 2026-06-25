<?php
declare(strict_types=1);

define('BASE_PATH', dirname(__DIR__));

set_exception_handler(function (Throwable $e): void {
    error_log($e);
    http_response_code(500);
    echo 'An internal error occurred.';
});

set_error_handler(function (int $severity, string $message, string $file, int $line): bool {
    throw new ErrorException($message, 0, $severity, $file, $line);
});

$isLocal = getenv('APP_ENV') === 'local';
ini_set('display_errors', '0');
ini_set('log_errors', '1');

function env_bool(string $name, bool $default): bool
{
    $value = getenv($name);
    if ($value === false) {
        return $default;
    }

    return filter_var($value, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? $default;
}

function secure_headers(): void
{
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
    header("Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}

secure_headers();

session_name('secure_quotes_session');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'domain' => '',
    'secure' => env_bool('SESSION_SECURE_COOKIE', !$isLocal),
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dbPath = getenv('DATABASE_PATH') ?: BASE_PATH . '/storage/app.sqlite';
    $dir = dirname($dbPath);
    if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) {
        throw new RuntimeException('Unable to create database directory.');
    }

    $pdo = new PDO('sqlite:' . $dbPath, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    migrate($pdo);

    return $pdo;
}

function migrate(PDO $pdo): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS quotes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            quote_text TEXT NOT NULL,
            author TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    ");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_quotes_status_author ON quotes(status, author)');
}

function e(?string $value): string
{
    return htmlspecialchars($value ?? '', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function current_user(): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }

    $stmt = db()->prepare('SELECT id, email, is_admin FROM users WHERE id = :id');
    $stmt->execute(['id' => (int) $_SESSION['user_id']]);
    $user = $stmt->fetch();

    return $user ?: null;
}

function require_login(): array
{
    $user = current_user();
    if ($user === null) {
        redirect('/login');
    }

    return $user;
}

function require_admin(): array
{
    $user = require_login();
    if ((int) $user['is_admin'] !== 1) {
        http_response_code(403);
        render('Forbidden', '<p>You do not have access to this page.</p>');
        exit;
    }

    return $user;
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }

    return $_SESSION['csrf_token'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="csrf_token" value="' . e(csrf_token()) . '">';
}

function verify_csrf(): void
{
    $token = $_POST['csrf_token'] ?? '';
    if (!is_string($token) || !hash_equals(csrf_token(), $token)) {
        http_response_code(419);
        render('Invalid request', '<p>Your session token was invalid. Please go back and try again.</p>');
        exit;
    }
}

function redirect(string $path): never
{
    header('Location: ' . $path, true, 303);
    exit;
}

function flash(?string $message = null): ?string
{
    if ($message !== null) {
        $_SESSION['flash'] = $message;
        return null;
    }

    $message = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);

    return $message;
}

function input_string(string $key, int $min, int $max): string
{
    $value = $_POST[$key] ?? '';
    if (!is_string($value)) {
        throw new InvalidArgumentException('Invalid input.');
    }

    $value = trim(preg_replace('/\s+/u', ' ', $value) ?? '');
    $length = strlen($value);
    if ($length < $min || $length > $max) {
        throw new InvalidArgumentException('Invalid input length.');
    }

    return $value;
}

function render(string $title, string $content): void
{
    $user = current_user();
    $flash = flash();
    http_response_code(http_response_code() ?: 200);
    ?>
    <!doctype html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title><?= e($title) ?> | Secure Quotes</title>
        <style>
            :root { color-scheme: light; font-family: Arial, sans-serif; }
            body { margin: 0; background: #f6f7f9; color: #17202a; }
            header { background: #1f2937; color: white; padding: 1rem max(1rem, calc((100vw - 980px) / 2)); }
            nav { display: flex; gap: .8rem; align-items: center; flex-wrap: wrap; }
            nav a, nav button { color: white; background: transparent; border: 0; font: inherit; text-decoration: none; cursor: pointer; padding: .25rem 0; }
            nav a:hover, nav button:hover { text-decoration: underline; }
            main { max-width: 980px; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
            .flash { background: #e8f4ff; border: 1px solid #93c5fd; padding: .8rem; margin-bottom: 1rem; }
            .card { background: white; border: 1px solid #d7dde5; border-radius: 6px; padding: 1rem; margin-bottom: 1rem; }
            label { display: block; font-weight: 700; margin: .8rem 0 .3rem; }
            input, textarea, select { width: 100%; box-sizing: border-box; padding: .65rem; border: 1px solid #aeb7c2; border-radius: 4px; font: inherit; }
            textarea { min-height: 130px; resize: vertical; }
            button, .button { display: inline-block; background: #2563eb; color: white; border: 0; border-radius: 4px; padding: .65rem .9rem; font: inherit; text-decoration: none; cursor: pointer; }
            .button.secondary, button.secondary { background: #4b5563; }
            .button.danger, button.danger { background: #b91c1c; }
            .actions { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; margin-top: 1rem; }
            .quote { border-left: 4px solid #2563eb; padding-left: 1rem; }
            .muted { color: #5f6b7a; }
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; }
        </style>
    </head>
    <body>
        <header>
            <nav>
                <strong>Secure Quotes</strong>
                <a href="/">Public quotes</a>
                <?php if ($user): ?>
                    <a href="/dashboard">My quotes</a>
                    <a href="/quotes/new">Submit quote</a>
                    <?php if ((int) $user['is_admin'] === 1): ?>
                        <a href="/admin">Review</a>
                    <?php endif; ?>
                    <form method="post" action="/logout" style="margin:0">
                        <?= csrf_field() ?>
                        <button type="submit">Log out</button>
                    </form>
                <?php else: ?>
                    <a href="/login">Log in</a>
                    <a href="/register">Register</a>
                <?php endif; ?>
            </nav>
        </header>
        <main>
            <?php if ($flash): ?><div class="flash"><?= e($flash) ?></div><?php endif; ?>
            <h1><?= e($title) ?></h1>
            <?= $content ?>
        </main>
    </body>
    </html>
    <?php
}

function route(): string
{
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    return is_string($path) ? rtrim($path, '/') ?: '/' : '/';
}

function method(): string
{
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

try {
    $route = route();
    $method = method();

    if ($route === '/' && $method === 'GET') {
        $author = trim((string) ($_GET['author'] ?? ''));
        if ($author !== '' && strlen($author) <= 120) {
            $stmt = db()->prepare("SELECT quote_text, author, created_at FROM quotes WHERE status = 'approved' AND author LIKE :author ORDER BY created_at DESC");
            $stmt->execute(['author' => '%' . $author . '%']);
        } else {
            $author = '';
            $stmt = db()->query("SELECT quote_text, author, created_at FROM quotes WHERE status = 'approved' ORDER BY created_at DESC");
        }
        $quotes = $stmt->fetchAll();
        ob_start();
        ?>
        <form method="get" class="card">
            <label for="author">Filter by author</label>
            <input id="author" name="author" maxlength="120" value="<?= e($author) ?>">
            <div class="actions">
                <button type="submit">Filter</button>
                <a class="button secondary" href="/">Clear</a>
            </div>
        </form>
        <?php if (!$quotes): ?>
            <p class="muted">No approved quotes found.</p>
        <?php endif; ?>
        <div class="grid">
            <?php foreach ($quotes as $quote): ?>
                <article class="card quote">
                    <p>&ldquo;<?= e($quote['quote_text']) ?>&rdquo;</p>
                    <p><strong><?= e($quote['author']) ?></strong></p>
                </article>
            <?php endforeach; ?>
        </div>
        <?php
        render('Approved quotes', ob_get_clean());
        exit;
    }

    if ($route === '/register' && $method === 'GET') {
        render('Register', '<form method="post" class="card">' . csrf_field() . '
            <label for="email">Email</label><input id="email" name="email" type="email" maxlength="254" required>
            <label for="password">Password</label><input id="password" name="password" type="password" minlength="12" maxlength="256" required>
            <div class="actions"><button type="submit">Create account</button></div>
        </form>');
        exit;
    }

    if ($route === '/register' && $method === 'POST') {
        verify_csrf();
        $email = filter_var(trim((string) ($_POST['email'] ?? '')), FILTER_VALIDATE_EMAIL);
        $password = (string) ($_POST['password'] ?? '');
        if (!$email || strlen($email) > 254 || strlen($password) < 12 || strlen($password) > 256) {
            flash('Use a valid email and a password of at least 12 characters.');
            redirect('/register');
        }

        $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
        $isAdmin = strtolower($email) === strtolower((string) getenv('ADMIN_EMAIL')) ? 1 : 0;
        try {
            $stmt = db()->prepare('INSERT INTO users (email, password_hash, is_admin) VALUES (:email, :hash, :is_admin)');
            $stmt->execute(['email' => strtolower($email), 'hash' => $hash, 'is_admin' => $isAdmin]);
        } catch (PDOException) {
            flash('That email address cannot be registered.');
            redirect('/register');
        }
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) db()->lastInsertId();
        flash('Account created.');
        redirect('/dashboard');
    }

    if ($route === '/login' && $method === 'GET') {
        render('Log in', '<form method="post" class="card">' . csrf_field() . '
            <label for="email">Email</label><input id="email" name="email" type="email" maxlength="254" required>
            <label for="password">Password</label><input id="password" name="password" type="password" maxlength="256" required>
            <div class="actions"><button type="submit">Log in</button></div>
        </form>');
        exit;
    }

    if ($route === '/login' && $method === 'POST') {
        verify_csrf();
        $email = strtolower(trim((string) ($_POST['email'] ?? '')));
        $password = (string) ($_POST['password'] ?? '');
        $stmt = db()->prepare('SELECT id, password_hash FROM users WHERE email = :email');
        $stmt->execute(['email' => $email]);
        $user = $stmt->fetch();
        if (!$user || !password_verify($password, $user['password_hash'])) {
            flash('Invalid email or password.');
            redirect('/login');
        }
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $user['id'];
        flash('Logged in.');
        redirect('/dashboard');
    }

    if ($route === '/logout' && $method === 'POST') {
        verify_csrf();
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
        }
        session_destroy();
        redirect('/');
    }

    if ($route === '/dashboard' && $method === 'GET') {
        $user = require_login();
        $stmt = db()->prepare('SELECT id, quote_text, author, status, updated_at FROM quotes WHERE user_id = :user_id ORDER BY updated_at DESC');
        $stmt->execute(['user_id' => (int) $user['id']]);
        $quotes = $stmt->fetchAll();
        ob_start();
        ?>
        <p><a class="button" href="/quotes/new">Submit a quote</a></p>
        <?php if (!$quotes): ?><p class="muted">You have not submitted any quotes yet.</p><?php endif; ?>
        <?php foreach ($quotes as $quote): ?>
            <article class="card">
                <p>&ldquo;<?= e($quote['quote_text']) ?>&rdquo;</p>
                <p><strong><?= e($quote['author']) ?></strong> <span class="muted">Status: <?= e($quote['status']) ?></span></p>
                <a class="button secondary" href="/quotes/<?= (int) $quote['id'] ?>/edit">Edit</a>
            </article>
        <?php endforeach; ?>
        <?php
        render('My quotes', ob_get_clean());
        exit;
    }

    if ($route === '/quotes/new' && $method === 'GET') {
        require_login();
        render('Submit quote', '<form method="post" class="card">' . csrf_field() . '
            <label for="quote_text">Quote text</label><textarea id="quote_text" name="quote_text" minlength="3" maxlength="1000" required></textarea>
            <label for="author">Author</label><input id="author" name="author" maxlength="120" required>
            <div class="actions"><button type="submit">Submit for approval</button></div>
        </form>');
        exit;
    }

    if ($route === '/quotes/new' && $method === 'POST') {
        verify_csrf();
        $user = require_login();
        try {
            $quoteText = input_string('quote_text', 3, 1000);
            $author = input_string('author', 1, 120);
        } catch (InvalidArgumentException) {
            flash('Please provide quote text and author within the allowed lengths.');
            redirect('/quotes/new');
        }
        $stmt = db()->prepare('INSERT INTO quotes (user_id, quote_text, author) VALUES (:user_id, :quote_text, :author)');
        $stmt->execute(['user_id' => (int) $user['id'], 'quote_text' => $quoteText, 'author' => $author]);
        flash('Quote submitted for approval.');
        redirect('/dashboard');
    }

    if (preg_match('#^/quotes/(\d+)/edit$#', $route, $matches) && $method === 'GET') {
        $user = require_login();
        $stmt = db()->prepare('SELECT id, quote_text, author FROM quotes WHERE id = :id AND user_id = :user_id');
        $stmt->execute(['id' => (int) $matches[1], 'user_id' => (int) $user['id']]);
        $quote = $stmt->fetch();
        if (!$quote) {
            http_response_code(404);
            render('Not found', '<p>Quote not found.</p>');
            exit;
        }
        ob_start();
        ?>
        <form method="post" class="card">
            <?= csrf_field() ?>
            <label for="quote_text">Quote text</label>
            <textarea id="quote_text" name="quote_text" minlength="3" maxlength="1000" required><?= e($quote['quote_text']) ?></textarea>
            <label for="author">Author</label>
            <input id="author" name="author" maxlength="120" value="<?= e($quote['author']) ?>" required>
            <div class="actions"><button type="submit">Save changes</button></div>
        </form>
        <?php
        render('Edit quote', ob_get_clean());
        exit;
    }

    if (preg_match('#^/quotes/(\d+)/edit$#', $route, $matches) && $method === 'POST') {
        verify_csrf();
        $user = require_login();
        try {
            $quoteText = input_string('quote_text', 3, 1000);
            $author = input_string('author', 1, 120);
        } catch (InvalidArgumentException) {
            flash('Please provide quote text and author within the allowed lengths.');
            redirect('/quotes/' . (int) $matches[1] . '/edit');
        }
        $stmt = db()->prepare("UPDATE quotes SET quote_text = :quote_text, author = :author, status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = :id AND user_id = :user_id");
        $stmt->execute(['quote_text' => $quoteText, 'author' => $author, 'id' => (int) $matches[1], 'user_id' => (int) $user['id']]);
        if ($stmt->rowCount() < 1) {
            http_response_code(404);
            render('Not found', '<p>Quote not found.</p>');
            exit;
        }
        flash('Quote updated and returned to pending review.');
        redirect('/dashboard');
    }

    if ($route === '/admin' && $method === 'GET') {
        require_admin();
        $quotes = db()->query("SELECT q.id, q.quote_text, q.author, q.status, u.email FROM quotes q JOIN users u ON u.id = q.user_id ORDER BY q.created_at DESC")->fetchAll();
        ob_start();
        ?>
        <?php if (!$quotes): ?><p class="muted">No quotes to review.</p><?php endif; ?>
        <?php foreach ($quotes as $quote): ?>
            <article class="card">
                <p>&ldquo;<?= e($quote['quote_text']) ?>&rdquo;</p>
                <p><strong><?= e($quote['author']) ?></strong></p>
                <p class="muted">Submitted by <?= e($quote['email']) ?>. Status: <?= e($quote['status']) ?></p>
                <form method="post" action="/admin/quotes/<?= (int) $quote['id'] ?>/status" class="actions">
                    <?= csrf_field() ?>
                    <button name="status" value="approved" type="submit">Approve</button>
                    <button name="status" value="rejected" type="submit" class="danger">Reject</button>
                </form>
            </article>
        <?php endforeach; ?>
        <?php
        render('Review quotes', ob_get_clean());
        exit;
    }

    if (preg_match('#^/admin/quotes/(\d+)/status$#', $route, $matches) && $method === 'POST') {
        verify_csrf();
        require_admin();
        $status = (string) ($_POST['status'] ?? '');
        if (!in_array($status, ['approved', 'rejected'], true)) {
            http_response_code(400);
            render('Bad request', '<p>Invalid status.</p>');
            exit;
        }
        $stmt = db()->prepare('UPDATE quotes SET status = :status, updated_at = CURRENT_TIMESTAMP WHERE id = :id');
        $stmt->execute(['status' => $status, 'id' => (int) $matches[1]]);
        flash('Quote status updated.');
        redirect('/admin');
    }

    http_response_code(404);
    render('Not found', '<p>The requested page was not found.</p>');
} catch (Throwable $e) {
    error_log($e);
    http_response_code(500);
    render('Error', '<p>An internal error occurred.</p>');
}
