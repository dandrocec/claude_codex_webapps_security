<?php
declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

define('BASE_PATH', dirname(__DIR__));

function env_value(string $name, ?string $default = null): ?string
{
    $value = getenv($name);
    return $value === false ? $default : $value;
}

function is_truthy_env(string $name, bool $default): bool
{
    $value = env_value($name);
    if ($value === null) {
        return $default;
    }
    return in_array(strtolower($value), ['1', 'true', 'yes', 'on'], true);
}

$secureCookies = is_truthy_env('SESSION_COOKIE_SECURE', true);
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'domain' => '',
    'secure' => $secureCookies,
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_name('address_book_session');
session_start();

header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
header("Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
if ($secureCookies) {
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $defaultPath = BASE_PATH . '/storage/address_book.sqlite';
    $dsn = env_value('DATABASE_DSN', 'sqlite:' . $defaultPath);
    $username = env_value('DATABASE_USER');
    $password = env_value('DATABASE_PASSWORD');

    if (str_starts_with($dsn, 'sqlite:')) {
        $path = substr($dsn, 7);
        $dir = dirname($path);
        if (!is_dir($dir)) {
            mkdir($dir, 0700, true);
        }
    }

    $pdo = new PDO($dsn, $username ?: null, $password ?: null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    migrate($pdo);
    return $pdo;
}

function migrate(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )'
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            address TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )'
    );
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_contacts_user_name ON contacts(user_id, name)');
}

function e(?string $value): string
{
    return htmlspecialchars($value ?? '', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
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
    if (!is_string($token) || !hash_equals($_SESSION['csrf_token'] ?? '', $token)) {
        http_response_code(403);
        render('Forbidden', '<p class="error">Invalid request token.</p>');
        exit;
    }
}

function current_user(): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }
    try {
        $stmt = db()->prepare('SELECT id, name, email FROM users WHERE id = :id');
        $stmt->execute(['id' => (int) $_SESSION['user_id']]);
        $user = $stmt->fetch();
        return $user ?: null;
    } catch (Throwable $e) {
        error_log($e->getMessage());
        return null;
    }
}

function require_user(): array
{
    $user = current_user();
    if (!$user) {
        redirect('?action=login');
    }
    return $user;
}

function redirect(string $to): never
{
    header('Location: ' . $to, true, 303);
    exit;
}

function render(string $title, string $body): void
{
    $user = current_user();
    $authLinks = $user
        ? '<span>' . e($user['name']) . '</span><form method="post" action="?action=logout">' . csrf_field() . '<button>Log out</button></form>'
        : '<a href="?action=login">Log in</a><a href="?action=register">Register</a>';

    echo '<!doctype html><html lang="en"><head><meta charset="utf-8">';
    echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
    echo '<title>' . e($title) . ' - Address Book</title>';
    echo '<style>
        :root{font-family:Arial,sans-serif;color:#1b1f23;background:#f5f7f8}
        body{margin:0}.wrap{max-width:960px;margin:0 auto;padding:24px}
        header{background:#fff;border-bottom:1px solid #d8dee4}.nav{display:flex;align-items:center;justify-content:space-between;gap:16px}
        .brand{font-weight:700;color:#111827;text-decoration:none}.links{display:flex;align-items:center;gap:12px}
        main{background:#fff;border:1px solid #d8dee4;border-radius:8px;margin-top:24px;padding:24px}
        form{display:grid;gap:12px}.inline{display:flex;gap:8px;align-items:center}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
        label{display:grid;gap:6px;font-weight:600}input,textarea{font:inherit;padding:10px;border:1px solid #afb8c1;border-radius:6px}
        textarea{min-height:96px;resize:vertical}button,.button{font:inherit;background:#1f6feb;color:#fff;border:0;border-radius:6px;padding:10px 14px;text-decoration:none;cursor:pointer}
        .button.secondary,button.secondary{background:#57606a}.danger{background:#cf222e}.muted{color:#57606a}.error{background:#ffebe9;color:#82071e;padding:12px;border-radius:6px}
        table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:10px;border-bottom:1px solid #d8dee4;text-align:left;vertical-align:top}
        .actions{display:flex;gap:8px;flex-wrap:wrap}@media(max-width:700px){.grid{grid-template-columns:1fr}.nav,.inline{align-items:stretch;flex-direction:column}table{font-size:14px}}
    </style></head><body><header><div class="wrap nav"><a class="brand" href="?action=contacts">Address Book</a><div class="links">' . $authLinks . '</div></div></header>';
    echo '<div class="wrap"><main><h1>' . e($title) . '</h1>' . $body . '</main></div></body></html>';
}

function clean_string(string $key, int $max): string
{
    $value = $_POST[$key] ?? '';
    $value = is_string($value) ? trim($value) : '';
    $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value) ?? '';
    return mb_substr($value, 0, $max, 'UTF-8');
}

function validate_contact(): array
{
    $data = [
        'name' => clean_string('name', 100),
        'email' => clean_string('email', 255),
        'phone' => clean_string('phone', 40),
        'address' => clean_string('address', 500),
    ];
    $errors = [];
    if ($data['name'] === '') {
        $errors[] = 'Name is required.';
    }
    if (!filter_var($data['email'], FILTER_VALIDATE_EMAIL)) {
        $errors[] = 'A valid email address is required.';
    }
    if ($data['phone'] === '' || !preg_match('/^[0-9+().\-\s]{3,40}$/', $data['phone'])) {
        $errors[] = 'A valid phone number is required.';
    }
    if ($data['address'] === '') {
        $errors[] = 'Address is required.';
    }
    return [$data, $errors];
}

function error_list(array $errors): string
{
    if ($errors === []) {
        return '';
    }
    return '<div class="error"><ul><li>' . implode('</li><li>', array_map('e', $errors)) . '</li></ul></div>';
}

function handle_register(string $method): void
{
    if ($method === 'POST') {
        verify_csrf();
        $name = clean_string('name', 100);
        $email = strtolower(clean_string('email', 255));
        $password = $_POST['password'] ?? '';
        $errors = [];
        if ($name === '') {
            $errors[] = 'Name is required.';
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors[] = 'A valid email address is required.';
        }
        if (!is_string($password) || strlen($password) < 12) {
            $errors[] = 'Password must be at least 12 characters.';
        }
        if ($errors === []) {
            try {
                $stmt = db()->prepare('INSERT INTO users (name, email, password_hash) VALUES (:name, :email, :password_hash)');
                $stmt->execute([
                    'name' => $name,
                    'email' => $email,
                    'password_hash' => password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]),
                ]);
                session_regenerate_id(true);
                $_SESSION['user_id'] = (int) db()->lastInsertId();
                redirect('?action=contacts');
            } catch (PDOException) {
                $errors[] = 'Unable to register with that email address.';
            }
        }
        render_register($errors, $name, $email);
        return;
    }
    render_register();
}

function render_register(array $errors = [], string $name = '', string $email = ''): void
{
    render('Register', error_list($errors) . '<form method="post" action="?action=register">' . csrf_field() .
        '<label>Name<input name="name" maxlength="100" required value="' . e($name) . '"></label>' .
        '<label>Email<input name="email" type="email" maxlength="255" required value="' . e($email) . '"></label>' .
        '<label>Password<input name="password" type="password" minlength="12" required></label>' .
        '<button>Create account</button></form>');
}

function handle_login(string $method): void
{
    if ($method === 'POST') {
        verify_csrf();
        $email = strtolower(clean_string('email', 255));
        $password = $_POST['password'] ?? '';
        $stmt = db()->prepare('SELECT id, password_hash FROM users WHERE email = :email');
        $stmt->execute(['email' => $email]);
        $user = $stmt->fetch();
        if ($user && is_string($password) && password_verify($password, $user['password_hash'])) {
            session_regenerate_id(true);
            $_SESSION['user_id'] = (int) $user['id'];
            redirect('?action=contacts');
        }
        render_login(['Invalid email or password.'], $email);
        return;
    }
    render_login();
}

function render_login(array $errors = [], string $email = ''): void
{
    render('Log in', error_list($errors) . '<form method="post" action="?action=login">' . csrf_field() .
        '<label>Email<input name="email" type="email" maxlength="255" required value="' . e($email) . '"></label>' .
        '<label>Password<input name="password" type="password" required></label>' .
        '<button>Log in</button></form>');
}

function handle_logout(string $method): void
{
    if ($method !== 'POST') {
        not_found();
    }
    verify_csrf();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires' => time() - 42000,
            'path' => $params['path'],
            'domain' => $params['domain'],
            'secure' => $params['secure'],
            'httponly' => $params['httponly'],
            'samesite' => $params['samesite'] ?? 'Lax',
        ]);
    }
    session_destroy();
    redirect('?action=login');
}

function handle_contacts(): void
{
    $user = require_user();
    $search = trim((string) ($_GET['q'] ?? ''));
    $search = mb_substr($search, 0, 100, 'UTF-8');
    $stmt = db()->prepare('SELECT id, name, email, phone, address FROM contacts WHERE user_id = :user_id AND name LIKE :search ORDER BY name COLLATE NOCASE');
    $stmt->execute(['user_id' => (int) $user['id'], 'search' => '%' . $search . '%']);
    $rows = $stmt->fetchAll();
    $body = '<form class="inline" method="get"><input type="hidden" name="action" value="contacts"><input name="q" maxlength="100" placeholder="Search by name" value="' . e($search) . '"><button>Search</button><a class="button secondary" href="?action=create">Add contact</a></form>';
    $body .= '<table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Address</th><th>Actions</th></tr></thead><tbody>';
    foreach ($rows as $row) {
        $body .= '<tr><td>' . e($row['name']) . '</td><td>' . e($row['email']) . '</td><td>' . e($row['phone']) . '</td><td>' . nl2br(e($row['address'])) . '</td><td class="actions"><a class="button secondary" href="?action=edit&id=' . (int) $row['id'] . '">Edit</a><form method="post" action="?action=delete&id=' . (int) $row['id'] . '">' . csrf_field() . '<button class="danger" onclick="return confirm(\'Delete this contact?\')">Delete</button></form></td></tr>';
    }
    if ($rows === []) {
        $body .= '<tr><td colspan="5" class="muted">No contacts found.</td></tr>';
    }
    $body .= '</tbody></table>';
    render('Contacts', $body);
}

function handle_create(string $method): void
{
    $user = require_user();
    $data = ['name' => '', 'email' => '', 'phone' => '', 'address' => ''];
    $errors = [];
    if ($method === 'POST') {
        verify_csrf();
        [$data, $errors] = validate_contact();
        if ($errors === []) {
            $stmt = db()->prepare('INSERT INTO contacts (user_id, name, email, phone, address) VALUES (:user_id, :name, :email, :phone, :address)');
            $stmt->execute(['user_id' => (int) $user['id']] + $data);
            redirect('?action=contacts');
        }
    }
    render_contact_form('Add Contact', '?action=create', $data, $errors);
}

function handle_edit(string $method): void
{
    $user = require_user();
    $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
    if (!$id) {
        not_found();
    }
    $stmt = db()->prepare('SELECT id, name, email, phone, address FROM contacts WHERE id = :id AND user_id = :user_id');
    $stmt->execute(['id' => $id, 'user_id' => (int) $user['id']]);
    $contact = $stmt->fetch();
    if (!$contact) {
        not_found();
    }
    $data = $contact;
    $errors = [];
    if ($method === 'POST') {
        verify_csrf();
        [$data, $errors] = validate_contact();
        if ($errors === []) {
            $stmt = db()->prepare('UPDATE contacts SET name = :name, email = :email, phone = :phone, address = :address, updated_at = CURRENT_TIMESTAMP WHERE id = :id AND user_id = :user_id');
            $stmt->execute($data + ['id' => $id, 'user_id' => (int) $user['id']]);
            redirect('?action=contacts');
        }
    }
    render_contact_form('Edit Contact', '?action=edit&id=' . (int) $id, $data, $errors);
}

function handle_delete(string $method): void
{
    $user = require_user();
    if ($method !== 'POST') {
        not_found();
    }
    verify_csrf();
    $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
    if ($id) {
        $stmt = db()->prepare('DELETE FROM contacts WHERE id = :id AND user_id = :user_id');
        $stmt->execute(['id' => $id, 'user_id' => (int) $user['id']]);
    }
    redirect('?action=contacts');
}

function render_contact_form(string $title, string $action, array $data, array $errors): void
{
    render($title, error_list($errors) . '<form method="post" action="' . e($action) . '">' . csrf_field() .
        '<div class="grid"><label>Name<input name="name" maxlength="100" required value="' . e($data['name'] ?? '') . '"></label>' .
        '<label>Email<input name="email" type="email" maxlength="255" required value="' . e($data['email'] ?? '') . '"></label>' .
        '<label>Phone<input name="phone" maxlength="40" required value="' . e($data['phone'] ?? '') . '"></label></div>' .
        '<label>Address<textarea name="address" maxlength="500" required>' . e($data['address'] ?? '') . '</textarea></label>' .
        '<div class="inline"><button>Save</button><a class="button secondary" href="?action=contacts">Cancel</a></div></form>');
}

function not_found(): void
{
    http_response_code(404);
    render('Not Found', '<p class="error">The requested page was not found.</p>');
    exit;
}
