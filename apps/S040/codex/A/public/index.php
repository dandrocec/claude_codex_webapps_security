<?php

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'];

try {
    if ($path === '/') {
        $query = trim((string) ($_GET['q'] ?? ''));
        $category = trim((string) ($_GET['category'] ?? ''));
        $params = [];
        $where = [];

        if ($query !== '') {
            $where[] = '(l.title LIKE ? OR l.description LIKE ?)';
            $params[] = '%' . $query . '%';
            $params[] = '%' . $query . '%';
        }

        if ($category !== '' && in_array($category, categories(), true)) {
            $where[] = 'l.category = ?';
            $params[] = $category;
        }

        $sql = 'SELECT l.*, u.name AS seller_name
                FROM listings l
                JOIN users u ON u.id = l.user_id';
        if ($where) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= ' ORDER BY l.created_at DESC';

        $stmt = db()->prepare($sql);
        $stmt->execute($params);
        render('home', [
            'listings' => $stmt->fetchAll(),
            'query' => $query,
            'selectedCategory' => $category,
        ]);
        return;
    }

    if ($path === '/register' && $method === 'GET') {
        render('auth/register', ['errors' => [], 'input' => []]);
        return;
    }

    if ($path === '/register' && $method === 'POST') {
        $name = trim((string) ($_POST['name'] ?? ''));
        $email = trim((string) ($_POST['email'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');
        $errors = [];

        if ($name === '') {
            $errors[] = 'Name is required.';
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors[] = 'A valid email is required.';
        }
        if (strlen($password) < 8) {
            $errors[] = 'Password must be at least 8 characters.';
        }

        if (!$errors) {
            try {
                $stmt = db()->prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)');
                $stmt->execute([$name, $email, password_hash($password, PASSWORD_DEFAULT)]);
                $_SESSION['user_id'] = (int) db()->lastInsertId();
                redirect('/dashboard');
            } catch (PDOException) {
                $errors[] = 'That email is already registered.';
            }
        }

        render('auth/register', ['errors' => $errors, 'input' => $_POST]);
        return;
    }

    if ($path === '/login' && $method === 'GET') {
        render('auth/login', ['errors' => [], 'input' => []]);
        return;
    }

    if ($path === '/login' && $method === 'POST') {
        $email = trim((string) ($_POST['email'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');
        $stmt = db()->prepare('SELECT * FROM users WHERE email = ?');
        $stmt->execute([$email]);
        $user = $stmt->fetch();

        if ($user && password_verify($password, $user['password_hash'])) {
            $_SESSION['user_id'] = (int) $user['id'];
            redirect('/dashboard');
        }

        render('auth/login', [
            'errors' => ['Invalid email or password.'],
            'input' => $_POST,
        ]);
        return;
    }

    if ($path === '/logout' && $method === 'POST') {
        session_destroy();
        redirect('/');
    }

    if ($path === '/dashboard') {
        $user = require_login();
        $stmt = db()->prepare('SELECT * FROM listings WHERE user_id = ? ORDER BY created_at DESC');
        $stmt->execute([$user['id']]);
        render('dashboard', ['listings' => $stmt->fetchAll()]);
        return;
    }

    if ($path === '/listings/new' && $method === 'GET') {
        require_login();
        render('listings/form', [
            'errors' => [],
            'listing' => null,
            'action' => '/listings/new',
            'buttonText' => 'Post listing',
        ]);
        return;
    }

    if ($path === '/listings/new' && $method === 'POST') {
        $user = require_login();
        [$errors, $payload] = validate_listing($_POST);

        if (!$errors) {
            $photoPath = handle_photo_upload();
            $stmt = db()->prepare(
                'INSERT INTO listings (user_id, category, title, price, description, photo_path)
                 VALUES (?, ?, ?, ?, ?, ?)'
            );
            $stmt->execute([
                $user['id'],
                $payload['category'],
                $payload['title'],
                $payload['price'],
                $payload['description'],
                $photoPath,
            ]);
            flash('Listing posted.');
            redirect('/dashboard');
        }

        render('listings/form', [
            'errors' => $errors,
            'listing' => $_POST,
            'action' => '/listings/new',
            'buttonText' => 'Post listing',
        ]);
        return;
    }

    if (preg_match('#^/listings/(\d+)$#', $path, $matches) && $method === 'GET') {
        $stmt = db()->prepare(
            'SELECT l.*, u.name AS seller_name, u.email AS seller_email
             FROM listings l
             JOIN users u ON u.id = l.user_id
             WHERE l.id = ?'
        );
        $stmt->execute([(int) $matches[1]]);
        $listing = $stmt->fetch();
        if (!$listing) {
            http_response_code(404);
            render('404');
            return;
        }
        render('listings/show', ['listing' => $listing]);
        return;
    }

    if (preg_match('#^/listings/(\d+)/edit$#', $path, $matches) && $method === 'GET') {
        $listing = owned_listing((int) $matches[1]);
        render('listings/form', [
            'errors' => [],
            'listing' => $listing,
            'action' => '/listings/' . $listing['id'] . '/edit',
            'buttonText' => 'Save changes',
        ]);
        return;
    }

    if (preg_match('#^/listings/(\d+)/edit$#', $path, $matches) && $method === 'POST') {
        $listing = owned_listing((int) $matches[1]);
        [$errors, $payload] = validate_listing($_POST);

        if (!$errors) {
            $photoPath = handle_photo_upload($listing['photo_path']);
            $stmt = db()->prepare(
                'UPDATE listings
                 SET category = ?, title = ?, price = ?, description = ?, photo_path = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?'
            );
            $stmt->execute([
                $payload['category'],
                $payload['title'],
                $payload['price'],
                $payload['description'],
                $photoPath,
                $listing['id'],
            ]);
            flash('Listing updated.');
            redirect('/dashboard');
        }

        render('listings/form', [
            'errors' => $errors,
            'listing' => array_merge($listing, $_POST),
            'action' => '/listings/' . $listing['id'] . '/edit',
            'buttonText' => 'Save changes',
        ]);
        return;
    }

    if (preg_match('#^/listings/(\d+)/delete$#', $path, $matches) && $method === 'POST') {
        $listing = owned_listing((int) $matches[1]);
        db()->prepare('DELETE FROM listings WHERE id = ?')->execute([$listing['id']]);

        if ($listing['photo_path']) {
            $photo = UPLOAD_PATH . '/' . basename($listing['photo_path']);
            if (is_file($photo)) {
                unlink($photo);
            }
        }

        flash('Listing removed.');
        redirect('/dashboard');
    }

    http_response_code(404);
    render('404');
} catch (RuntimeException $exception) {
    http_response_code(422);
    render('error', ['message' => $exception->getMessage()]);
}

function validate_listing(array $source): array
{
    $payload = [
        'category' => trim((string) ($source['category'] ?? '')),
        'title' => trim((string) ($source['title'] ?? '')),
        'price' => price_to_cents((string) ($source['price'] ?? '')),
        'description' => trim((string) ($source['description'] ?? '')),
    ];
    $errors = [];

    if (!in_array($payload['category'], categories(), true)) {
        $errors[] = 'Choose a valid category.';
    }
    if ($payload['title'] === '') {
        $errors[] = 'Title is required.';
    }
    if ($payload['price'] <= 0) {
        $errors[] = 'Price must be greater than zero.';
    }
    if ($payload['description'] === '') {
        $errors[] = 'Description is required.';
    }

    return [$errors, $payload];
}

function owned_listing(int $id): array
{
    $user = require_login();
    $stmt = db()->prepare('SELECT * FROM listings WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, $user['id']]);
    $listing = $stmt->fetch();

    if (!$listing) {
        http_response_code(404);
        render('404');
        exit;
    }

    return $listing;
}
