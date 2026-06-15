<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

$path   = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'];

// Let the PHP built-in server serve existing static assets (e.g. style.css).
if (PHP_SAPI === 'cli-server' && $path !== '/' && is_file(__DIR__ . $path)) {
    return false;
}

$route = trim($path, '/');

switch ("$method $route") {
    case 'GET ':
    case 'GET contacts':
        contacts_index();
        break;

    case 'GET register':
        render('register', ['title' => 'Register', 'errors' => [], 'username' => '']);
        break;
    case 'POST register':
        register_submit();
        break;

    case 'GET login':
        render('login', ['title' => 'Log in', 'errors' => [], 'username' => '']);
        break;
    case 'POST login':
        login_submit();
        break;

    case 'POST logout':
        csrf_check();
        session_destroy();
        redirect('/login');

    case 'GET contacts/add':
        $c = ['id' => '', 'name' => '', 'email' => '', 'phone' => '', 'address' => ''];
        render('contact_form', ['title' => 'Add contact', 'contact' => $c, 'errors' => [], 'action' => '/contacts/add']);
        break;
    case 'POST contacts/add':
        contact_save(null);
        break;

    case 'GET contacts/edit':
        contact_edit_form();
        break;
    case 'POST contacts/edit':
        contact_save((int)($_POST['id'] ?? 0));
        break;

    case 'POST contacts/delete':
        contact_delete();
        break;

    default:
        http_response_code(404);
        render('404', ['title' => 'Not found']);
}

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

function contacts_index(): void
{
    $user = require_login();
    $search = trim($_GET['q'] ?? '');

    if ($search !== '') {
        $stmt = db()->prepare(
            'SELECT * FROM contacts WHERE user_id = ? AND name LIKE ? ORDER BY name COLLATE NOCASE'
        );
        $stmt->execute([$user['id'], '%' . $search . '%']);
    } else {
        $stmt = db()->prepare('SELECT * FROM contacts WHERE user_id = ? ORDER BY name COLLATE NOCASE');
        $stmt->execute([$user['id']]);
    }

    render('contacts', [
        'title'    => 'My contacts',
        'contacts' => $stmt->fetchAll(),
        'search'   => $search,
    ]);
}

function register_submit(): void
{
    csrf_check();
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';
    $confirm  = $_POST['password_confirm'] ?? '';
    $errors   = [];

    if (strlen($username) < 3) {
        $errors[] = 'Username must be at least 3 characters.';
    }
    if (strlen($password) < 6) {
        $errors[] = 'Password must be at least 6 characters.';
    }
    if ($password !== $confirm) {
        $errors[] = 'Passwords do not match.';
    }

    if (!$errors) {
        $exists = db()->prepare('SELECT 1 FROM users WHERE username = ?');
        $exists->execute([$username]);
        if ($exists->fetch()) {
            $errors[] = 'That username is already taken.';
        }
    }

    if ($errors) {
        render('register', ['title' => 'Register', 'errors' => $errors, 'username' => $username]);
        return;
    }

    $stmt = db()->prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
    $stmt->execute([$username, password_hash($password, PASSWORD_DEFAULT)]);
    $_SESSION['user_id'] = (int)db()->lastInsertId();
    flash('Welcome, ' . $username . '!');
    redirect('/contacts');
}

function login_submit(): void
{
    csrf_check();
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';

    $stmt = db()->prepare('SELECT * FROM users WHERE username = ?');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        render('login', [
            'title'    => 'Log in',
            'errors'   => ['Invalid username or password.'],
            'username' => $username,
        ]);
        return;
    }

    session_regenerate_id(true);
    $_SESSION['user_id'] = (int)$user['id'];
    redirect('/contacts');
}

/** Load a contact owned by the current user, or 404. */
function find_owned_contact(int $id, array $user): array
{
    $stmt = db()->prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, $user['id']]);
    $contact = $stmt->fetch();
    if (!$contact) {
        http_response_code(404);
        render('404', ['title' => 'Not found']);
        exit;
    }
    return $contact;
}

function contact_edit_form(): void
{
    $user = require_login();
    $contact = find_owned_contact((int)($_GET['id'] ?? 0), $user);
    render('contact_form', [
        'title'   => 'Edit contact',
        'contact' => $contact,
        'errors'  => [],
        'action'  => '/contacts/edit',
    ]);
}

function contact_save(?int $id): void
{
    $user = require_login();
    csrf_check();

    $contact = [
        'id'      => $id ?? '',
        'name'    => trim($_POST['name'] ?? ''),
        'email'   => trim($_POST['email'] ?? ''),
        'phone'   => trim($_POST['phone'] ?? ''),
        'address' => trim($_POST['address'] ?? ''),
    ];

    $errors = [];
    if ($contact['name'] === '') {
        $errors[] = 'Name is required.';
    }
    if ($contact['email'] !== '' && !filter_var($contact['email'], FILTER_VALIDATE_EMAIL)) {
        $errors[] = 'Please enter a valid email address.';
    }

    if ($errors) {
        $action = $id ? '/contacts/edit' : '/contacts/add';
        render('contact_form', [
            'title'   => $id ? 'Edit contact' : 'Add contact',
            'contact' => $contact,
            'errors'  => $errors,
            'action'  => $action,
        ]);
        return;
    }

    if ($id) {
        find_owned_contact($id, $user); // ensure ownership
        $stmt = db()->prepare(
            'UPDATE contacts SET name = ?, email = ?, phone = ?, address = ?
             WHERE id = ? AND user_id = ?'
        );
        $stmt->execute([
            $contact['name'], $contact['email'], $contact['phone'], $contact['address'],
            $id, $user['id'],
        ]);
        flash('Contact updated.');
    } else {
        $stmt = db()->prepare(
            'INSERT INTO contacts (user_id, name, email, phone, address) VALUES (?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $user['id'], $contact['name'], $contact['email'], $contact['phone'], $contact['address'],
        ]);
        flash('Contact added.');
    }

    redirect('/contacts');
}

function contact_delete(): void
{
    $user = require_login();
    csrf_check();
    $id = (int)($_POST['id'] ?? 0);
    $stmt = db()->prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, $user['id']]);
    flash('Contact deleted.');
    redirect('/contacts');
}
