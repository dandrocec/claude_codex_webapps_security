<?php

declare(strict_types=1);

namespace App;

use PDO;

final class App
{
    private PDO $db;

    public function __construct(private readonly string $root)
    {
        $this->db = Database::connect($root);
    }

    public function run(): void
    {
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

        try {
            match (true) {
                $method === 'GET' && $path === '/' => $this->home(),
                $method === 'GET' && $path === '/listing' => $this->showListing(),
                $method === 'GET' && $path === '/login' => $this->loginForm(),
                $method === 'POST' && $path === '/login' => $this->login(),
                $method === 'GET' && $path === '/register' => $this->registerForm(),
                $method === 'POST' && $path === '/register' => $this->register(),
                $method === 'POST' && $path === '/logout' => $this->logout(),
                $method === 'GET' && $path === '/listing/new' => $this->newListingForm(),
                $method === 'POST' && $path === '/listing/new' => $this->createListing(),
                $method === 'GET' && $path === '/listing/edit' => $this->editListingForm(),
                $method === 'POST' && $path === '/listing/edit' => $this->updateListing(),
                $method === 'POST' && $path === '/listing/delete' => $this->deleteListing(),
                default => $this->notFound(),
            };
        } catch (HttpException $e) {
            http_response_code($e->status);
            View::render('error', ['message' => $e->safeMessage], $this->db);
        }
    }

    private function home(): void
    {
        $q = trim(Input::string('q', 80, INPUT_GET));
        $category = Input::int('category', INPUT_GET);
        $params = [];
        $where = ['l.deleted_at IS NULL'];

        if ($q !== '') {
            $where[] = '(l.title LIKE :q OR l.description LIKE :q)';
            $params[':q'] = '%' . $q . '%';
        }
        if ($category !== null) {
            $where[] = 'l.category_id = :category';
            $params[':category'] = $category;
        }

        $sql = 'SELECT l.*, c.name AS category_name, u.email AS seller_email
                FROM listings l
                JOIN categories c ON c.id = l.category_id
                JOIN users u ON u.id = l.user_id
                WHERE ' . implode(' AND ', $where) . '
                ORDER BY l.created_at DESC';
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);

        View::render('home', [
            'listings' => $stmt->fetchAll(),
            'q' => $q,
            'selectedCategory' => $category,
        ], $this->db);
    }

    private function showListing(): void
    {
        $id = Input::requiredInt('id', INPUT_GET);
        $stmt = $this->db->prepare(
            'SELECT l.*, c.name AS category_name, u.email AS seller_email
             FROM listings l
             JOIN categories c ON c.id = l.category_id
             JOIN users u ON u.id = l.user_id
             WHERE l.id = :id AND l.deleted_at IS NULL'
        );
        $stmt->execute([':id' => $id]);
        $listing = $stmt->fetch();
        if (!$listing) {
            throw new HttpException(404, 'Listing not found');
        }
        View::render('listing', ['listing' => $listing], $this->db);
    }

    private function registerForm(array $errors = []): void
    {
        View::render('register', ['errors' => $errors], $this->db);
    }

    private function register(): void
    {
        Security::verifyCsrf();
        $email = strtolower(trim(Input::string('email', 254)));
        $password = (string)($_POST['password'] ?? '');
        $errors = [];

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors[] = 'Enter a valid email address.';
        }
        if (strlen($password) < 12) {
            $errors[] = 'Password must be at least 12 characters.';
        }
        if ($errors) {
            $this->registerForm($errors);
            return;
        }

        $stmt = $this->db->prepare('INSERT INTO users (email, password_hash, created_at) VALUES (:email, :hash, :created)');
        try {
            $stmt->execute([
                ':email' => $email,
                ':hash' => password_hash($password, PASSWORD_ARGON2ID),
                ':created' => gmdate('c'),
            ]);
        } catch (\PDOException) {
            $this->registerForm(['That email address is already registered.']);
            return;
        }
        Security::login((int)$this->db->lastInsertId());
        Response::redirect('/');
    }

    private function loginForm(array $errors = []): void
    {
        View::render('login', ['errors' => $errors], $this->db);
    }

    private function login(): void
    {
        Security::verifyCsrf();
        $email = strtolower(trim(Input::string('email', 254)));
        $password = (string)($_POST['password'] ?? '');
        $stmt = $this->db->prepare('SELECT id, password_hash FROM users WHERE email = :email');
        $stmt->execute([':email' => $email]);
        $user = $stmt->fetch();

        if (!$user || !password_verify($password, $user['password_hash'])) {
            $this->loginForm(['Invalid email or password.']);
            return;
        }
        Security::login((int)$user['id']);
        Response::redirect('/');
    }

    private function logout(): void
    {
        Security::verifyCsrf();
        Security::logout();
        Response::redirect('/');
    }

    private function newListingForm(array $errors = []): void
    {
        Security::requireUser();
        View::render('listing_form', ['errors' => $errors, 'listing' => null], $this->db);
    }

    private function createListing(): void
    {
        Security::requireUser();
        Security::verifyCsrf();
        [$data, $errors] = $this->validatedListingInput();
        $photo = $this->handleUpload($errors);
        if ($errors) {
            View::render('listing_form', ['errors' => $errors, 'listing' => $data], $this->db);
            return;
        }

        $stmt = $this->db->prepare(
            'INSERT INTO listings (user_id, category_id, title, price_cents, description, photo_path, created_at, updated_at)
             VALUES (:user, :category, :title, :price, :description, :photo, :created, :updated)'
        );
        $now = gmdate('c');
        $stmt->execute([
            ':user' => Security::userId(),
            ':category' => $data['category_id'],
            ':title' => $data['title'],
            ':price' => $data['price_cents'],
            ':description' => $data['description'],
            ':photo' => $photo,
            ':created' => $now,
            ':updated' => $now,
        ]);
        Response::redirect('/listing?id=' . $this->db->lastInsertId());
    }

    private function editListingForm(array $errors = []): void
    {
        Security::requireUser();
        $listing = $this->ownedListing(Input::requiredInt('id', INPUT_GET));
        View::render('listing_form', ['errors' => $errors, 'listing' => $listing], $this->db);
    }

    private function updateListing(): void
    {
        Security::requireUser();
        Security::verifyCsrf();
        $id = Input::requiredInt('id');
        $listing = $this->ownedListing($id);
        [$data, $errors] = $this->validatedListingInput();
        $photo = $this->handleUpload($errors, true) ?: $listing['photo_path'];
        if ($errors) {
            $data['id'] = $id;
            $data['photo_path'] = $listing['photo_path'];
            View::render('listing_form', ['errors' => $errors, 'listing' => $data], $this->db);
            return;
        }

        $stmt = $this->db->prepare(
            'UPDATE listings
             SET category_id = :category, title = :title, price_cents = :price, description = :description,
                 photo_path = :photo, updated_at = :updated
             WHERE id = :id AND user_id = :user AND deleted_at IS NULL'
        );
        $stmt->execute([
            ':category' => $data['category_id'],
            ':title' => $data['title'],
            ':price' => $data['price_cents'],
            ':description' => $data['description'],
            ':photo' => $photo,
            ':updated' => gmdate('c'),
            ':id' => $id,
            ':user' => Security::userId(),
        ]);
        Response::redirect('/listing?id=' . $id);
    }

    private function deleteListing(): void
    {
        Security::requireUser();
        Security::verifyCsrf();
        $id = Input::requiredInt('id');
        $stmt = $this->db->prepare('UPDATE listings SET deleted_at = :deleted WHERE id = :id AND user_id = :user AND deleted_at IS NULL');
        $stmt->execute([':deleted' => gmdate('c'), ':id' => $id, ':user' => Security::userId()]);
        Response::redirect('/');
    }

    private function validatedListingInput(): array
    {
        $title = Input::string('title', 120);
        $description = Input::string('description', 3000);
        $category = Input::requiredInt('category_id');
        $price = filter_input(INPUT_POST, 'price', FILTER_VALIDATE_FLOAT);
        $errors = [];

        if ($title === '' || mb_strlen($title) > 120) {
            $errors[] = 'Title is required and must be 120 characters or less.';
        }
        if ($description === '' || mb_strlen($description) > 3000) {
            $errors[] = 'Description is required and must be 3000 characters or less.';
        }
        if ($price === false || $price === null || $price < 0 || $price > 100000000) {
            $errors[] = 'Enter a valid non-negative price.';
        }
        $catStmt = $this->db->prepare('SELECT COUNT(*) FROM categories WHERE id = :id');
        $catStmt->execute([':id' => $category]);
        if ($category === null || (int)$catStmt->fetchColumn() !== 1) {
            $errors[] = 'Choose a valid category.';
        }

        return [[
            'title' => $title,
            'description' => $description,
            'category_id' => $category,
            'price_cents' => (int)round(((float)$price) * 100),
        ], $errors];
    }

    private function handleUpload(array &$errors, bool $optional = false): ?string
    {
        if (!isset($_FILES['photo']) || $_FILES['photo']['error'] === UPLOAD_ERR_NO_FILE) {
            if (!$optional) {
                $errors[] = 'Photo is required.';
            }
            return null;
        }
        if ($_FILES['photo']['error'] !== UPLOAD_ERR_OK) {
            $errors[] = 'Photo upload failed.';
            return null;
        }
        if ($_FILES['photo']['size'] > 3 * 1024 * 1024) {
            $errors[] = 'Photo must be 3 MB or smaller.';
            return null;
        }

        $tmp = $_FILES['photo']['tmp_name'];
        $info = @getimagesize($tmp);
        $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
        if (!$info || !isset($allowed[$info['mime']])) {
            $errors[] = 'Photo must be a JPEG, PNG, or WebP image.';
            return null;
        }

        $dir = $this->root . '/public/uploads';
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        $name = bin2hex(random_bytes(16)) . '.' . $allowed[$info['mime']];
        if (!move_uploaded_file($tmp, $dir . '/' . $name)) {
            $errors[] = 'Photo could not be saved.';
            return null;
        }
        return '/uploads/' . $name;
    }

    private function ownedListing(int $id): array
    {
        $stmt = $this->db->prepare('SELECT * FROM listings WHERE id = :id AND user_id = :user AND deleted_at IS NULL');
        $stmt->execute([':id' => $id, ':user' => Security::userId()]);
        $listing = $stmt->fetch();
        if (!$listing) {
            throw new HttpException(404, 'Listing not found');
        }
        return $listing;
    }

    private function notFound(): void
    {
        throw new HttpException(404, 'Page not found');
    }
}
