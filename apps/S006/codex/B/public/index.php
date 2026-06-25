<?php
declare(strict_types=1);

const MAX_TEXT_BYTES = 20000;

bootstrap();

try {
    $pdo = database();
    migrate($pdo);
    $route = $_GET['action'] ?? 'home';

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        requireCsrfToken();
    }

    if ($route === 'register' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        register($pdo);
    } elseif ($route === 'login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        login($pdo);
    } elseif ($route === 'logout' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        logout();
    } elseif ($route === 'delete' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        deleteAnalysis($pdo);
    } elseif ($route === 'analyze' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        analyze($pdo);
    } else {
        renderHome($pdo);
    }
} catch (Throwable $e) {
    error_log($e->getMessage());
    http_response_code(500);
    renderPage('Error', '<p class="notice error">Something went wrong. Please try again.</p>');
}

function bootstrap(): void
{
    $secret = getenv('APP_SECRET');
    if ($secret === false || strlen($secret) < 32) {
        http_response_code(500);
        echo 'Application secret is not configured.';
        exit;
    }

    ini_set('display_errors', '0');
    ini_set('log_errors', '1');
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');

    session_name('text_metrics_session');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'domain' => '',
        'secure' => getenv('APP_COOKIE_SECURE') !== '0',
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();

    header('Content-Type: text/html; charset=UTF-8');
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
    header("Content-Security-Policy: default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'self' 'unsafe-inline'");
}

function database(): PDO
{
    $dir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'storage';
    if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) {
        throw new RuntimeException('Unable to create storage directory.');
    }

    $pdo = new PDO('sqlite:' . $dir . DIRECTORY_SEPARATOR . 'app.sqlite');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    return $pdo;
}

function migrate(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )'
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS analyses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            submitted_text TEXT NOT NULL,
            characters INTEGER NOT NULL,
            words INTEGER NOT NULL,
            lines INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )'
    );
}

function csrfToken(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function requireCsrfToken(): void
{
    $token = $_POST['csrf_token'] ?? '';
    if (!is_string($token) || !hash_equals($_SESSION['csrf_token'] ?? '', $token)) {
        http_response_code(403);
        renderPage('Forbidden', '<p class="notice error">Invalid request token.</p>');
        exit;
    }
}

function currentUserId(): ?int
{
    return isset($_SESSION['user_id']) ? (int) $_SESSION['user_id'] : null;
}

function requireUser(): int
{
    $id = currentUserId();
    if ($id === null) {
        http_response_code(403);
        renderPage('Sign in required', '<p class="notice error">Please sign in to continue.</p>');
        exit;
    }
    return $id;
}

function register(PDO $pdo): void
{
    [$username, $password] = credentialsFromPost();
    $hash = password_hash($password, PASSWORD_ARGON2ID);
    $stmt = $pdo->prepare('INSERT INTO users (username, password_hash, created_at) VALUES (:username, :password_hash, :created_at)');

    try {
        $stmt->execute([
            ':username' => $username,
            ':password_hash' => $hash,
            ':created_at' => gmdate('c'),
        ]);
    } catch (PDOException $e) {
        renderHome($pdo, 'That username is already taken.');
        return;
    }

    session_regenerate_id(true);
    $_SESSION['user_id'] = (int) $pdo->lastInsertId();
    $_SESSION['username'] = $username;
    redirectHome();
}

function login(PDO $pdo): void
{
    [$username, $password] = credentialsFromPost();
    $stmt = $pdo->prepare('SELECT id, username, password_hash FROM users WHERE username = :username');
    $stmt->execute([':username' => $username]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        renderHome($pdo, 'Invalid username or password.');
        return;
    }

    session_regenerate_id(true);
    $_SESSION['user_id'] = (int) $user['id'];
    $_SESSION['username'] = $user['username'];
    redirectHome();
}

function logout(): void
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
    }
    session_destroy();
    redirectHome();
}

function credentialsFromPost(): array
{
    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');

    if (!preg_match('/\A[a-zA-Z0-9_-]{3,32}\z/', $username) || strlen($password) < 12 || strlen($password) > 256) {
        http_response_code(422);
        renderPage('Invalid input', '<p class="notice error">Use a 3-32 character username and a password of at least 12 characters.</p>');
        exit;
    }

    return [$username, $password];
}

function analyze(PDO $pdo): void
{
    $userId = requireUser();
    $text = (string) ($_POST['text'] ?? '');
    if ($text === '' || strlen($text) > MAX_TEXT_BYTES || !isValidUtf8($text)) {
        http_response_code(422);
        renderHome($pdo, 'Enter valid UTF-8 text up to ' . MAX_TEXT_BYTES . ' bytes.');
        return;
    }

    $stats = textStats($text);
    $stmt = $pdo->prepare(
        'INSERT INTO analyses (user_id, submitted_text, characters, words, lines, created_at)
         VALUES (:user_id, :submitted_text, :characters, :words, :lines, :created_at)'
    );
    $stmt->execute([
        ':user_id' => $userId,
        ':submitted_text' => $text,
        ':characters' => $stats['characters'],
        ':words' => $stats['words'],
        ':lines' => $stats['lines'],
        ':created_at' => gmdate('c'),
    ]);

    renderHome($pdo, null, $text, $stats);
}

function deleteAnalysis(PDO $pdo): void
{
    $userId = requireUser();
    $id = filter_input(INPUT_POST, 'id', FILTER_VALIDATE_INT);
    if ($id === false || $id === null) {
        http_response_code(422);
        renderHome($pdo, 'Invalid analysis id.');
        return;
    }

    $stmt = $pdo->prepare('DELETE FROM analyses WHERE id = :id AND user_id = :user_id');
    $stmt->execute([':id' => $id, ':user_id' => $userId]);
    redirectHome();
}

function textStats(string $text): array
{
    $normalized = str_replace(["\r\n", "\r"], "\n", $text);
    $trimmed = trim($normalized);
    preg_match_all('/[^\s]+/u', $trimmed, $matches);

    return [
        'characters' => function_exists('mb_strlen') ? mb_strlen($text, 'UTF-8') : strlen($text),
        'words' => $trimmed === '' ? 0 : count($matches[0]),
        'lines' => $text === '' ? 0 : substr_count($normalized, "\n") + 1,
    ];
}

function renderHome(PDO $pdo, ?string $message = null, ?string $submittedText = null, ?array $stats = null): void
{
    $userId = currentUserId();
    $content = '';

    if ($message !== null) {
        $content .= '<p class="notice error">' . e($message) . '</p>';
    }

    if ($userId === null) {
        $content .= authForms();
    } else {
        $content .= '<div class="topbar"><p>Signed in as <strong>' . e((string) $_SESSION['username']) . '</strong></p>'
            . '<form method="post" action="?action=logout">' . csrfField() . '<button type="submit">Sign out</button></form></div>';
        $content .= analyzeForm($submittedText ?? '');

        if ($stats !== null && $submittedText !== null) {
            $content .= resultPanel($submittedText, $stats);
        }

        $content .= historyPanel($pdo, $userId);
    }

    renderPage('Text Metrics', $content);
}

function authForms(): string
{
    return '<section class="grid">'
        . '<form method="post" action="?action=login"><h2>Sign in</h2>' . csrfField()
        . '<label>Username<input name="username" required pattern="[A-Za-z0-9_-]{3,32}" autocomplete="username"></label>'
        . '<label>Password<input type="password" name="password" required minlength="12" autocomplete="current-password"></label>'
        . '<button type="submit">Sign in</button></form>'
        . '<form method="post" action="?action=register"><h2>Create account</h2>' . csrfField()
        . '<label>Username<input name="username" required pattern="[A-Za-z0-9_-]{3,32}" autocomplete="username"></label>'
        . '<label>Password<input type="password" name="password" required minlength="12" autocomplete="new-password"></label>'
        . '<button type="submit">Create account</button></form>'
        . '</section>';
}

function analyzeForm(string $text): string
{
    return '<form method="post" action="?action=analyze" class="analysis-form">' . csrfField()
        . '<label for="text">Text to analyze</label>'
        . '<textarea id="text" name="text" required maxlength="' . MAX_TEXT_BYTES . '">' . e($text) . '</textarea>'
        . '<button type="submit">Analyze text</button>'
        . '</form>';
}

function resultPanel(string $text, array $stats): string
{
    return '<section class="result"><h2>Result</h2>'
        . '<dl><div><dt>Characters</dt><dd>' . (int) $stats['characters'] . '</dd></div>'
        . '<div><dt>Words</dt><dd>' . (int) $stats['words'] . '</dd></div>'
        . '<div><dt>Lines</dt><dd>' . (int) $stats['lines'] . '</dd></div></dl>'
        . '<h3>Submitted text</h3><pre>' . e($text) . '</pre></section>';
}

function historyPanel(PDO $pdo, int $userId): string
{
    $stmt = $pdo->prepare('SELECT id, submitted_text, characters, words, lines, created_at FROM analyses WHERE user_id = :user_id ORDER BY id DESC LIMIT 10');
    $stmt->execute([':user_id' => $userId]);
    $rows = $stmt->fetchAll();

    if (!$rows) {
        return '<section><h2>Recent analyses</h2><p class="muted">No saved analyses yet.</p></section>';
    }

    $html = '<section><h2>Recent analyses</h2><div class="history">';
    foreach ($rows as $row) {
        $preview = mbSafeSubstr((string) $row['submitted_text'], 0, 120);
        $html .= '<article><p class="muted">' . e((string) $row['created_at']) . '</p>'
            . '<p>' . e($preview) . '</p>'
            . '<p>' . (int) $row['characters'] . ' chars, ' . (int) $row['words'] . ' words, ' . (int) $row['lines'] . ' lines</p>'
            . '<form method="post" action="?action=delete">' . csrfField()
            . '<input type="hidden" name="id" value="' . (int) $row['id'] . '">'
            . '<button type="submit">Delete</button></form></article>';
    }
    return $html . '</div></section>';
}

function renderPage(string $title, string $content): void
{
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width, initial-scale=1">'
        . '<title>' . e($title) . '</title><style>'
        . 'body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:#f6f7f9;color:#17202a}'
        . 'main{max-width:920px;margin:0 auto;padding:32px 18px}h1{font-size:2rem;margin:0 0 24px}'
        . 'h2{font-size:1.2rem;margin:0 0 14px}form,section{background:#fff;border:1px solid #d9dee7;border-radius:8px;padding:18px;margin-bottom:18px}'
        . '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;background:transparent;border:0;padding:0}'
        . 'label{display:block;font-weight:650;margin-bottom:12px}input,textarea{box-sizing:border-box;width:100%;margin-top:6px;border:1px solid #aeb7c4;border-radius:6px;padding:10px;font:inherit}'
        . 'textarea{min-height:220px;resize:vertical}button{border:0;border-radius:6px;background:#1f6feb;color:#fff;padding:10px 14px;font-weight:700;cursor:pointer}'
        . '.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px}.topbar form{border:0;margin:0;padding:0;background:transparent}'
        . '.notice{padding:12px 14px;border-radius:6px}.error{background:#fde8e8;color:#8a1f1f}.muted{color:#5d6878}'
        . 'dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}dl div{border:1px solid #d9dee7;border-radius:8px;padding:14px}'
        . 'dt{color:#5d6878}dd{font-size:1.6rem;font-weight:800;margin:4px 0 0}pre{white-space:pre-wrap;word-break:break-word;background:#f1f4f8;border-radius:6px;padding:14px}'
        . '.history{display:grid;gap:12px}.history article{border:1px solid #d9dee7;border-radius:8px;padding:14px}.history form{border:0;margin:0;padding:0;background:transparent}'
        . '</style></head><body><main><h1>' . e($title) . '</h1>' . $content . '</main></body></html>';
}

function csrfField(): string
{
    return '<input type="hidden" name="csrf_token" value="' . e(csrfToken()) . '">';
}

function redirectHome(): void
{
    header('Location: /', true, 303);
    exit;
}

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function isValidUtf8(string $value): bool
{
    if (function_exists('mb_check_encoding')) {
        return mb_check_encoding($value, 'UTF-8');
    }
    return preg_match('//u', $value) === 1;
}

function mbSafeSubstr(string $value, int $start, int $length): string
{
    if (function_exists('mb_substr')) {
        return mb_substr($value, $start, $length, 'UTF-8');
    }
    return substr($value, $start, $length);
}
