<?php
declare(strict_types=1);

session_start();

$root = dirname(__DIR__);
$dataDir = $root . DIRECTORY_SEPARATOR . 'data';
$dbPath = $dataDir . DIRECTORY_SEPARATOR . 'address_book.sqlite';

if (!is_dir($dataDir)) {
    mkdir($dataDir, 0775, true);
}

$pdo = new PDO('sqlite:' . $dbPath);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

$pdo->exec("
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        address TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_contacts_user_name ON contacts(user_id, name);
");

function current_user_id(): ?int
{
    return isset($_SESSION['user_id']) ? (int) $_SESSION['user_id'] : null;
}

function redirect_to(string $path): never
{
    header('Location: ' . $path);
    exit;
}

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function flash(?string $message = null, string $type = 'success'): ?array
{
    if ($message !== null) {
        $_SESSION['flash'] = ['message' => $message, 'type' => $type];
        return null;
    }

    $flash = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);
    return $flash;
}

function require_login(): int
{
    $userId = current_user_id();
    if ($userId === null) {
        redirect_to('/?action=login');
    }
    return $userId;
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function verify_csrf(): void
{
    $token = $_POST['csrf_token'] ?? '';
    if (!is_string($token) || !hash_equals(csrf_token(), $token)) {
        http_response_code(400);
        exit('Invalid form token.');
    }
}

function contact_for_user(PDO $pdo, int $contactId, int $userId): ?array
{
    $stmt = $pdo->prepare('SELECT * FROM contacts WHERE id = :id AND user_id = :user_id');
    $stmt->execute(['id' => $contactId, 'user_id' => $userId]);
    $contact = $stmt->fetch();
    return $contact ?: null;
}

function render_header(string $title, ?array $user): void
{
    $flash = flash();
    ?>
    <!doctype html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title><?= e($title) ?> · Address Book</title>
        <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
    <header class="topbar">
        <a class="brand" href="/">Address Book</a>
        <nav>
            <?php if ($user): ?>
                <span class="signed-in">Signed in as <?= e($user['username']) ?></span>
                <form method="post" action="/?action=logout" class="inline">
                    <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>">
                    <button type="submit" class="link-button">Log out</button>
                </form>
            <?php else: ?>
                <a href="/?action=login">Log in</a>
                <a href="/?action=register">Register</a>
            <?php endif; ?>
        </nav>
    </header>
    <main class="shell">
        <?php if ($flash): ?>
            <div class="flash <?= e($flash['type']) ?>"><?= e($flash['message']) ?></div>
        <?php endif; ?>
    <?php
}

function render_footer(): void
{
    ?>
    </main>
    </body>
    </html>
    <?php
}

function current_user(PDO $pdo): ?array
{
    $userId = current_user_id();
    if ($userId === null) {
        return null;
    }

    $stmt = $pdo->prepare('SELECT id, username FROM users WHERE id = :id');
    $stmt->execute(['id' => $userId]);
    $user = $stmt->fetch();
    return $user ?: null;
}

function render_auth_form(string $mode, array $errors = [], string $username = ''): void
{
    $isRegister = $mode === 'register';
    ?>
    <section class="auth-panel">
        <h1><?= $isRegister ? 'Create Account' : 'Log In' ?></h1>
        <?php foreach ($errors as $error): ?>
            <p class="error"><?= e($error) ?></p>
        <?php endforeach; ?>
        <form method="post" action="/?action=<?= $isRegister ? 'register' : 'login' ?>" class="form-stack">
            <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>">
            <label>
                Username
                <input name="username" value="<?= e($username) ?>" required maxlength="80" autocomplete="username">
            </label>
            <label>
                Password
                <input type="password" name="password" required minlength="6" autocomplete="<?= $isRegister ? 'new-password' : 'current-password' ?>">
            </label>
            <button type="submit"><?= $isRegister ? 'Register' : 'Log In' ?></button>
        </form>
        <p class="muted">
            <?= $isRegister ? 'Already have an account?' : 'Need an account?' ?>
            <a href="/?action=<?= $isRegister ? 'login' : 'register' ?>"><?= $isRegister ? 'Log in' : 'Register' ?></a>
        </p>
    </section>
    <?php
}

function render_contact_form(string $mode, array $contact = [], array $errors = []): void
{
    $isEdit = $mode === 'edit';
    $action = $isEdit ? '/?action=edit&id=' . (int) $contact['id'] : '/?action=create';
    ?>
    <section class="panel">
        <div class="section-heading">
            <h1><?= $isEdit ? 'Edit Contact' : 'New Contact' ?></h1>
            <a href="/" class="secondary-button">Back</a>
        </div>
        <?php foreach ($errors as $error): ?>
            <p class="error"><?= e($error) ?></p>
        <?php endforeach; ?>
        <form method="post" action="<?= e($action) ?>" class="form-grid">
            <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>">
            <label>
                Name
                <input name="name" value="<?= e((string) ($contact['name'] ?? '')) ?>" required maxlength="120">
            </label>
            <label>
                Email
                <input type="email" name="email" value="<?= e((string) ($contact['email'] ?? '')) ?>" required maxlength="160">
            </label>
            <label>
                Phone
                <input name="phone" value="<?= e((string) ($contact['phone'] ?? '')) ?>" required maxlength="60">
            </label>
            <label class="wide">
                Address
                <textarea name="address" required maxlength="500"><?= e((string) ($contact['address'] ?? '')) ?></textarea>
            </label>
            <div class="wide actions">
                <button type="submit"><?= $isEdit ? 'Save Changes' : 'Add Contact' ?></button>
                <a href="/" class="secondary-button">Cancel</a>
            </div>
        </form>
    </section>
    <?php
}

function clean_contact_input(): array
{
    return [
        'name' => trim((string) ($_POST['name'] ?? '')),
        'email' => trim((string) ($_POST['email'] ?? '')),
        'phone' => trim((string) ($_POST['phone'] ?? '')),
        'address' => trim((string) ($_POST['address'] ?? '')),
    ];
}

function validate_contact(array $contact): array
{
    $errors = [];
    if ($contact['name'] === '') {
        $errors[] = 'Name is required.';
    }
    if ($contact['email'] === '' || !filter_var($contact['email'], FILTER_VALIDATE_EMAIL)) {
        $errors[] = 'A valid email is required.';
    }
    if ($contact['phone'] === '') {
        $errors[] = 'Phone is required.';
    }
    if ($contact['address'] === '') {
        $errors[] = 'Address is required.';
    }
    return $errors;
}

$action = (string) ($_GET['action'] ?? 'home');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$user = current_user($pdo);

if ($action === 'logout' && $method === 'POST') {
    verify_csrf();
    session_regenerate_id(true);
    $_SESSION = [];
    session_destroy();
    redirect_to('/?action=login');
}

if ($action === 'register') {
    if ($method === 'POST') {
        verify_csrf();
        $username = trim((string) ($_POST['username'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');
        $errors = [];

        if ($username === '' || strlen($username) > 80) {
            $errors[] = 'Username is required and must be 80 characters or fewer.';
        }
        if (strlen($password) < 6) {
            $errors[] = 'Password must be at least 6 characters.';
        }

        if (!$errors) {
            try {
                $stmt = $pdo->prepare('INSERT INTO users (username, password_hash) VALUES (:username, :password_hash)');
                $stmt->execute([
                    'username' => $username,
                    'password_hash' => password_hash($password, PASSWORD_DEFAULT),
                ]);
                $_SESSION['user_id'] = (int) $pdo->lastInsertId();
                session_regenerate_id(true);
                flash('Account created.');
                redirect_to('/');
            } catch (PDOException $exception) {
                $errors[] = 'That username is already taken.';
            }
        }

        render_header('Register', null);
        render_auth_form('register', $errors, $username);
        render_footer();
        exit;
    }

    render_header('Register', $user);
    render_auth_form('register');
    render_footer();
    exit;
}

if ($action === 'login') {
    if ($method === 'POST') {
        verify_csrf();
        $username = trim((string) ($_POST['username'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');
        $errors = ['Invalid username or password.'];

        $stmt = $pdo->prepare('SELECT * FROM users WHERE username = :username');
        $stmt->execute(['username' => $username]);
        $foundUser = $stmt->fetch();

        if ($foundUser && password_verify($password, $foundUser['password_hash'])) {
            $_SESSION['user_id'] = (int) $foundUser['id'];
            session_regenerate_id(true);
            flash('Welcome back.');
            redirect_to('/');
        }

        render_header('Log In', null);
        render_auth_form('login', $errors, $username);
        render_footer();
        exit;
    }

    render_header('Log In', $user);
    render_auth_form('login');
    render_footer();
    exit;
}

if ($action === 'create') {
    $userId = require_login();
    if ($method === 'POST') {
        verify_csrf();
        $contact = clean_contact_input();
        $errors = validate_contact($contact);

        if (!$errors) {
            $stmt = $pdo->prepare('
                INSERT INTO contacts (user_id, name, email, phone, address)
                VALUES (:user_id, :name, :email, :phone, :address)
            ');
            $stmt->execute([
                'user_id' => $userId,
                'name' => $contact['name'],
                'email' => $contact['email'],
                'phone' => $contact['phone'],
                'address' => $contact['address'],
            ]);
            flash('Contact added.');
            redirect_to('/');
        }

        render_header('New Contact', $user);
        render_contact_form('create', $contact, $errors);
        render_footer();
        exit;
    }

    render_header('New Contact', $user);
    render_contact_form('create');
    render_footer();
    exit;
}

if ($action === 'edit') {
    $userId = require_login();
    $contactId = (int) ($_GET['id'] ?? 0);
    $contact = contact_for_user($pdo, $contactId, $userId);

    if (!$contact) {
        http_response_code(404);
        render_header('Not Found', $user);
        echo '<section class="panel"><h1>Contact Not Found</h1><p>This contact does not exist or is not yours.</p><a href="/" class="secondary-button">Back</a></section>';
        render_footer();
        exit;
    }

    if ($method === 'POST') {
        verify_csrf();
        $submitted = clean_contact_input();
        $errors = validate_contact($submitted);

        if (!$errors) {
            $stmt = $pdo->prepare('
                UPDATE contacts
                SET name = :name, email = :email, phone = :phone, address = :address, updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND user_id = :user_id
            ');
            $stmt->execute([
                'name' => $submitted['name'],
                'email' => $submitted['email'],
                'phone' => $submitted['phone'],
                'address' => $submitted['address'],
                'id' => $contactId,
                'user_id' => $userId,
            ]);
            flash('Contact updated.');
            redirect_to('/');
        }

        render_header('Edit Contact', $user);
        render_contact_form('edit', array_merge($contact, $submitted), $errors);
        render_footer();
        exit;
    }

    render_header('Edit Contact', $user);
    render_contact_form('edit', $contact);
    render_footer();
    exit;
}

if ($action === 'delete' && $method === 'POST') {
    $userId = require_login();
    verify_csrf();
    $contactId = (int) ($_POST['id'] ?? 0);
    $stmt = $pdo->prepare('DELETE FROM contacts WHERE id = :id AND user_id = :user_id');
    $stmt->execute(['id' => $contactId, 'user_id' => $userId]);
    flash('Contact deleted.');
    redirect_to('/');
}

$userId = require_login();
$query = trim((string) ($_GET['q'] ?? ''));

if ($query !== '') {
    $stmt = $pdo->prepare('
        SELECT * FROM contacts
        WHERE user_id = :user_id AND name LIKE :query
        ORDER BY lower(name), id DESC
    ');
    $stmt->execute(['user_id' => $userId, 'query' => '%' . $query . '%']);
} else {
    $stmt = $pdo->prepare('SELECT * FROM contacts WHERE user_id = :user_id ORDER BY lower(name), id DESC');
    $stmt->execute(['user_id' => $userId]);
}

$contacts = $stmt->fetchAll();

render_header('Contacts', $user);
?>
<section class="panel">
    <div class="section-heading">
        <h1>Contacts</h1>
        <a href="/?action=create" class="primary-link">Add Contact</a>
    </div>

    <form method="get" action="/" class="search-row">
        <input name="q" value="<?= e($query) ?>" placeholder="Search by name">
        <button type="submit">Search</button>
        <?php if ($query !== ''): ?>
            <a href="/" class="secondary-button">Clear</a>
        <?php endif; ?>
    </form>

    <?php if (!$contacts): ?>
        <div class="empty-state">
            <h2>No contacts found</h2>
            <p><?= $query !== '' ? 'Try a different name.' : 'Add your first contact to get started.' ?></p>
        </div>
    <?php else: ?>
        <div class="contact-list">
            <?php foreach ($contacts as $contact): ?>
                <article class="contact-card">
                    <div>
                        <h2><?= e($contact['name']) ?></h2>
                        <p><strong>Email:</strong> <a href="mailto:<?= e($contact['email']) ?>"><?= e($contact['email']) ?></a></p>
                        <p><strong>Phone:</strong> <?= e($contact['phone']) ?></p>
                        <p><strong>Address:</strong> <?= nl2br(e($contact['address'])) ?></p>
                    </div>
                    <div class="card-actions">
                        <a href="/?action=edit&id=<?= (int) $contact['id'] ?>" class="secondary-button">Edit</a>
                        <form method="post" action="/?action=delete" onsubmit="return confirm('Delete this contact?');">
                            <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>">
                            <input type="hidden" name="id" value="<?= (int) $contact['id'] ?>">
                            <button type="submit" class="danger">Delete</button>
                        </form>
                    </div>
                </article>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>
</section>
<?php
render_footer();
