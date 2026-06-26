<?php
declare(strict_types=1);

session_start();

const BASE_PATH = __DIR__ . '/..';
const DB_PATH = BASE_PATH . '/data/app.sqlite';
const UPLOAD_DIR = __DIR__ . '/uploads';

ensureStorage();
$db = db();
initializeDatabase($db);

$errors = [];
$notice = flash('notice');
$route = $_GET['route'] ?? 'home';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    [$route, $errors] = handlePost($db, $route);
}

$currentAgent = currentAgent($db);
$protectedRoutes = ['dashboard', 'new_listing', 'edit_listing'];
if ($_SERVER['REQUEST_METHOD'] === 'GET' && in_array($route, $protectedRoutes, true) && !$currentAgent) {
    redirect('?route=login');
}

function ensureStorage(): void
{
    foreach ([BASE_PATH . '/data', UPLOAD_DIR] as $dir) {
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
    }
}

function db(): PDO
{
    $pdo = new PDO('sqlite:' . DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA foreign_keys = ON');
    return $pdo;
}

function initializeDatabase(PDO $db): void
{
    $db->exec("
        CREATE TABLE IF NOT EXISTS agents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            phone TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS listings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            price INTEGER NOT NULL,
            city TEXT NOT NULL,
            address TEXT NOT NULL,
            bedrooms INTEGER NOT NULL,
            bathrooms INTEGER NOT NULL,
            sqft INTEGER NOT NULL,
            description TEXT NOT NULL,
            photo_path TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS inquiries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            listing_id INTEGER NOT NULL,
            agent_id INTEGER NOT NULL,
            visitor_name TEXT NOT NULL,
            visitor_email TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
            FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
        );
    ");
}

function handlePost(PDO $db, string $route): array
{
    $action = $_POST['action'] ?? '';
    $errors = [];

    if ($action === 'register') {
        $name = trim($_POST['name'] ?? '');
        $email = strtolower(trim($_POST['email'] ?? ''));
        $phone = trim($_POST['phone'] ?? '');
        $password = (string)($_POST['password'] ?? '');

        if ($name === '' || $email === '' || $phone === '' || strlen($password) < 8) {
            return ['register', ['All fields are required and the password must be at least 8 characters.']];
        }

        try {
            $stmt = $db->prepare('INSERT INTO agents (name, email, phone, password_hash) VALUES (?, ?, ?, ?)');
            $stmt->execute([$name, $email, $phone, password_hash($password, PASSWORD_DEFAULT)]);
            $_SESSION['agent_id'] = (int)$db->lastInsertId();
            setFlash('notice', 'Your agent account is ready.');
            redirect('?route=dashboard');
        } catch (PDOException) {
            return ['register', ['That email is already registered.']];
        }
    }

    if ($action === 'login') {
        $email = strtolower(trim($_POST['email'] ?? ''));
        $password = (string)($_POST['password'] ?? '');
        $stmt = $db->prepare('SELECT * FROM agents WHERE email = ?');
        $stmt->execute([$email]);
        $agent = $stmt->fetch();

        if ($agent && password_verify($password, $agent['password_hash'])) {
            $_SESSION['agent_id'] = (int)$agent['id'];
            setFlash('notice', 'Signed in successfully.');
            redirect('?route=dashboard');
        }

        return ['login', ['Invalid email or password.']];
    }

    if ($action === 'logout') {
        session_destroy();
        redirect('?route=home');
    }

    if ($action === 'save_listing') {
        requireAgent($db);
        $agentId = (int)$_SESSION['agent_id'];
        $listingId = isset($_POST['listing_id']) ? (int)$_POST['listing_id'] : 0;
        $data = listingFormData();
        $errors = validateListing($data);

        if ($errors) {
            return [$listingId ? 'edit_listing' : 'new_listing', $errors];
        }

        $existing = null;
        if ($listingId) {
            $existing = findOwnedListing($db, $listingId, $agentId);
            if (!$existing) {
                return ['dashboard', ['Listing not found.']];
            }
        }

        $photoPath = uploadPhoto($existing['photo_path'] ?? null, $errors);
        if ($errors) {
            return [$listingId ? 'edit_listing' : 'new_listing', $errors];
        }

        if ($listingId) {
            $stmt = $db->prepare('
                UPDATE listings SET title = ?, price = ?, city = ?, address = ?, bedrooms = ?,
                bathrooms = ?, sqft = ?, description = ?, photo_path = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND agent_id = ?
            ');
            $stmt->execute([
                $data['title'], $data['price'], $data['city'], $data['address'], $data['bedrooms'],
                $data['bathrooms'], $data['sqft'], $data['description'], $photoPath, $listingId, $agentId
            ]);
            setFlash('notice', 'Listing updated.');
        } else {
            $stmt = $db->prepare('
                INSERT INTO listings
                (agent_id, title, price, city, address, bedrooms, bathrooms, sqft, description, photo_path)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ');
            $stmt->execute([
                $agentId, $data['title'], $data['price'], $data['city'], $data['address'],
                $data['bedrooms'], $data['bathrooms'], $data['sqft'], $data['description'], $photoPath
            ]);
            setFlash('notice', 'Listing published.');
        }

        redirect('?route=dashboard');
    }

    if ($action === 'delete_listing') {
        requireAgent($db);
        $agentId = (int)$_SESSION['agent_id'];
        $listingId = (int)($_POST['listing_id'] ?? 0);
        $listing = findOwnedListing($db, $listingId, $agentId);
        if ($listing) {
            deletePhoto($listing['photo_path']);
            $stmt = $db->prepare('DELETE FROM listings WHERE id = ? AND agent_id = ?');
            $stmt->execute([$listingId, $agentId]);
            setFlash('notice', 'Listing deleted.');
        }
        redirect('?route=dashboard');
    }

    if ($action === 'contact_agent') {
        $listingId = (int)($_POST['listing_id'] ?? 0);
        $listing = findListing($db, $listingId);
        if (!$listing) {
            return ['home', ['Listing not found.']];
        }

        $name = trim($_POST['visitor_name'] ?? '');
        $email = strtolower(trim($_POST['visitor_email'] ?? ''));
        $message = trim($_POST['message'] ?? '');

        if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || $message === '') {
            return ['listing', ['Please provide your name, a valid email, and a message.']];
        }

        $stmt = $db->prepare('
            INSERT INTO inquiries (listing_id, agent_id, visitor_name, visitor_email, message)
            VALUES (?, ?, ?, ?, ?)
        ');
        $stmt->execute([$listingId, (int)$listing['agent_id'], $name, $email, $message]);
        setFlash('notice', 'Your message was sent to the agent.');
        redirect('?route=listing&id=' . $listingId);
    }

    return [$route, $errors];
}

function listingFormData(): array
{
    return [
        'title' => trim($_POST['title'] ?? ''),
        'price' => (int)($_POST['price'] ?? 0),
        'city' => trim($_POST['city'] ?? ''),
        'address' => trim($_POST['address'] ?? ''),
        'bedrooms' => (int)($_POST['bedrooms'] ?? 0),
        'bathrooms' => (int)($_POST['bathrooms'] ?? 0),
        'sqft' => (int)($_POST['sqft'] ?? 0),
        'description' => trim($_POST['description'] ?? ''),
    ];
}

function validateListing(array $data): array
{
    $errors = [];
    foreach (['title', 'city', 'address', 'description'] as $field) {
        if ($data[$field] === '') {
            $errors[] = ucfirst($field) . ' is required.';
        }
    }
    foreach (['price', 'bedrooms', 'bathrooms', 'sqft'] as $field) {
        if ($data[$field] < 1) {
            $errors[] = ucfirst($field) . ' must be greater than zero.';
        }
    }
    return $errors;
}

function uploadPhoto(?string $existingPath, array &$errors): ?string
{
    if (!isset($_FILES['photo']) || $_FILES['photo']['error'] === UPLOAD_ERR_NO_FILE) {
        return $existingPath;
    }

    if ($_FILES['photo']['error'] !== UPLOAD_ERR_OK) {
        $errors[] = 'Photo upload failed.';
        return $existingPath;
    }

    if ($_FILES['photo']['size'] > 3 * 1024 * 1024) {
        $errors[] = 'Photo must be 3 MB or smaller.';
        return $existingPath;
    }

    $tmp = $_FILES['photo']['tmp_name'];
    $imageInfo = @getimagesize($tmp);
    $mime = $imageInfo['mime'] ?? '';
    $extensions = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];

    if (!isset($extensions[$mime])) {
        $errors[] = 'Photo must be a JPG, PNG, or WebP image.';
        return $existingPath;
    }

    $filename = bin2hex(random_bytes(16)) . '.' . $extensions[$mime];
    $target = UPLOAD_DIR . '/' . $filename;

    if (!move_uploaded_file($tmp, $target)) {
        $errors[] = 'Could not save uploaded photo.';
        return $existingPath;
    }

    deletePhoto($existingPath);
    return 'uploads/' . $filename;
}

function deletePhoto(?string $path): void
{
    if ($path && str_starts_with($path, 'uploads/')) {
        $fullPath = __DIR__ . '/' . $path;
        if (is_file($fullPath)) {
            unlink($fullPath);
        }
    }
}

function currentAgent(PDO $db): ?array
{
    if (empty($_SESSION['agent_id'])) {
        return null;
    }
    $stmt = $db->prepare('SELECT * FROM agents WHERE id = ?');
    $stmt->execute([(int)$_SESSION['agent_id']]);
    return $stmt->fetch() ?: null;
}

function requireAgent(PDO $db): void
{
    if (!currentAgent($db)) {
        redirect('?route=login');
    }
}

function findOwnedListing(PDO $db, int $listingId, int $agentId): ?array
{
    $stmt = $db->prepare('SELECT * FROM listings WHERE id = ? AND agent_id = ?');
    $stmt->execute([$listingId, $agentId]);
    return $stmt->fetch() ?: null;
}

function findListing(PDO $db, int $listingId): ?array
{
    $stmt = $db->prepare('
        SELECT listings.*, agents.name AS agent_name, agents.email AS agent_email, agents.phone AS agent_phone
        FROM listings
        JOIN agents ON agents.id = listings.agent_id
        WHERE listings.id = ?
    ');
    $stmt->execute([$listingId]);
    return $stmt->fetch() ?: null;
}

function searchListings(PDO $db): array
{
    $where = [];
    $params = [];

    $location = trim($_GET['location'] ?? '');
    $minPrice = (int)($_GET['min_price'] ?? 0);
    $maxPrice = (int)($_GET['max_price'] ?? 0);

    if ($location !== '') {
        $where[] = '(city LIKE ? OR address LIKE ?)';
        $params[] = '%' . $location . '%';
        $params[] = '%' . $location . '%';
    }
    if ($minPrice > 0) {
        $where[] = 'price >= ?';
        $params[] = $minPrice;
    }
    if ($maxPrice > 0) {
        $where[] = 'price <= ?';
        $params[] = $maxPrice;
    }

    $sql = '
        SELECT listings.*, agents.name AS agent_name
        FROM listings
        JOIN agents ON agents.id = listings.agent_id
    ';
    if ($where) {
        $sql .= ' WHERE ' . implode(' AND ', $where);
    }
    $sql .= ' ORDER BY listings.created_at DESC';

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchAll();
}

function agentListings(PDO $db, int $agentId): array
{
    $stmt = $db->prepare('SELECT * FROM listings WHERE agent_id = ? ORDER BY updated_at DESC');
    $stmt->execute([$agentId]);
    return $stmt->fetchAll();
}

function agentInquiries(PDO $db, int $agentId): array
{
    $stmt = $db->prepare('
        SELECT inquiries.*, listings.title AS listing_title
        FROM inquiries
        JOIN listings ON listings.id = inquiries.listing_id
        WHERE inquiries.agent_id = ?
        ORDER BY inquiries.created_at DESC
    ');
    $stmt->execute([$agentId]);
    return $stmt->fetchAll();
}

function setFlash(string $key, string $message): void
{
    $_SESSION['flash'][$key] = $message;
}

function flash(string $key): ?string
{
    if (!isset($_SESSION['flash'][$key])) {
        return null;
    }
    $message = $_SESSION['flash'][$key];
    unset($_SESSION['flash'][$key]);
    return $message;
}

function redirect(string $url): never
{
    header('Location: ' . $url);
    exit;
}

function e(mixed $value): string
{
    return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8');
}

function money(mixed $value): string
{
    return '$' . number_format((int)$value);
}

function excerpt(string $value, int $limit = 130): string
{
    $clean = trim(preg_replace('/\s+/', ' ', $value) ?? $value);
    if (strlen($clean) <= $limit) {
        return $clean;
    }
    return rtrim(substr($clean, 0, $limit - 3)) . '...';
}

function old(string $key, mixed $default = ''): string
{
    return e($_POST[$key] ?? $default);
}

function renderHeader(?array $currentAgent, ?string $notice, array $errors): void
{
    ?>
    <!doctype html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>EstateDesk</title>
        <link rel="stylesheet" href="/style.css">
    </head>
    <body>
        <header class="site-header">
            <a class="brand" href="?route=home">EstateDesk</a>
            <nav>
                <a href="?route=home">Search</a>
                <?php if ($currentAgent): ?>
                    <a href="?route=dashboard">Dashboard</a>
                    <form method="post" class="inline">
                        <input type="hidden" name="action" value="logout">
                        <button type="submit" class="link-button">Sign out</button>
                    </form>
                <?php else: ?>
                    <a href="?route=login">Agent sign in</a>
                    <a class="button compact" href="?route=register">Register</a>
                <?php endif; ?>
            </nav>
        </header>
        <main>
            <?php if ($notice): ?><div class="notice"><?= e($notice) ?></div><?php endif; ?>
            <?php if ($errors): ?>
                <div class="errors">
                    <?php foreach ($errors as $error): ?><p><?= e($error) ?></p><?php endforeach; ?>
                </div>
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

function listingCard(array $listing): void
{
    ?>
    <article class="listing-card">
        <a href="?route=listing&id=<?= (int)$listing['id'] ?>" class="photo-link">
            <?php if ($listing['photo_path']): ?>
                <img src="/<?= e($listing['photo_path']) ?>" alt="<?= e($listing['title']) ?>">
            <?php else: ?>
                <div class="placeholder">No photo</div>
            <?php endif; ?>
        </a>
        <div class="listing-body">
            <p class="price"><?= money($listing['price']) ?></p>
            <h3><a href="?route=listing&id=<?= (int)$listing['id'] ?>"><?= e($listing['title']) ?></a></h3>
            <p class="muted"><?= e($listing['city']) ?> · <?= (int)$listing['bedrooms'] ?> bd · <?= (int)$listing['bathrooms'] ?> ba · <?= (int)$listing['sqft'] ?> sqft</p>
            <p><?= e(excerpt($listing['description'])) ?></p>
            <p class="muted">Agent: <?= e($listing['agent_name'] ?? '') ?></p>
        </div>
    </article>
    <?php
}

function renderListingForm(array $listing = []): void
{
    $isEdit = isset($listing['id']);
    ?>
    <form method="post" enctype="multipart/form-data" class="panel form-grid">
        <input type="hidden" name="action" value="save_listing">
        <?php if ($isEdit): ?><input type="hidden" name="listing_id" value="<?= (int)$listing['id'] ?>"><?php endif; ?>

        <label>Title
            <input name="title" value="<?= old('title', $listing['title'] ?? '') ?>" required>
        </label>
        <label>Price
            <input name="price" type="number" min="1" value="<?= old('price', $listing['price'] ?? '') ?>" required>
        </label>
        <label>City
            <input name="city" value="<?= old('city', $listing['city'] ?? '') ?>" required>
        </label>
        <label>Address
            <input name="address" value="<?= old('address', $listing['address'] ?? '') ?>" required>
        </label>
        <label>Bedrooms
            <input name="bedrooms" type="number" min="1" value="<?= old('bedrooms', $listing['bedrooms'] ?? '') ?>" required>
        </label>
        <label>Bathrooms
            <input name="bathrooms" type="number" min="1" value="<?= old('bathrooms', $listing['bathrooms'] ?? '') ?>" required>
        </label>
        <label>Square feet
            <input name="sqft" type="number" min="1" value="<?= old('sqft', $listing['sqft'] ?? '') ?>" required>
        </label>
        <label>Photo
            <input name="photo" type="file" accept="image/jpeg,image/png,image/webp">
        </label>
        <label class="wide">Description
            <textarea name="description" rows="6" required><?= old('description', $listing['description'] ?? '') ?></textarea>
        </label>
        <div class="wide actions">
            <button type="submit"><?= $isEdit ? 'Update listing' : 'Publish listing' ?></button>
            <a class="button secondary" href="?route=dashboard">Cancel</a>
        </div>
    </form>
    <?php
}

renderHeader($currentAgent, $notice, $errors);

if ($route === 'home') {
    $listings = searchListings($db);
    ?>
    <section class="hero">
        <div>
            <p class="eyebrow">Real estate search</p>
            <h1>Find homes by price and location.</h1>
        </div>
        <form method="get" class="search-bar">
            <input type="hidden" name="route" value="home">
            <label>Location
                <input name="location" placeholder="City or address" value="<?= e($_GET['location'] ?? '') ?>">
            </label>
            <label>Min price
                <input name="min_price" type="number" min="0" value="<?= e($_GET['min_price'] ?? '') ?>">
            </label>
            <label>Max price
                <input name="max_price" type="number" min="0" value="<?= e($_GET['max_price'] ?? '') ?>">
            </label>
            <button type="submit">Search</button>
        </form>
    </section>

    <section class="section-head">
        <h2><?= count($listings) ?> listings available</h2>
        <?php if ($currentAgent): ?><a class="button" href="?route=new_listing">Add listing</a><?php endif; ?>
    </section>

    <section class="listing-grid">
        <?php if (!$listings): ?>
            <p class="empty">No listings match your search.</p>
        <?php endif; ?>
        <?php foreach ($listings as $listing): listingCard($listing); endforeach; ?>
    </section>
    <?php
} elseif ($route === 'listing') {
    $listing = findListing($db, (int)($_GET['id'] ?? $_POST['listing_id'] ?? 0));
    if (!$listing) {
        echo '<p class="empty">Listing not found.</p>';
    } else {
        ?>
        <section class="detail-layout">
            <div>
                <?php if ($listing['photo_path']): ?>
                    <img class="detail-photo" src="/<?= e($listing['photo_path']) ?>" alt="<?= e($listing['title']) ?>">
                <?php else: ?>
                    <div class="detail-photo placeholder">No photo</div>
                <?php endif; ?>
                <div class="panel">
                    <p class="price"><?= money($listing['price']) ?></p>
                    <h1><?= e($listing['title']) ?></h1>
                    <p class="muted"><?= e($listing['address']) ?>, <?= e($listing['city']) ?></p>
                    <div class="stats">
                        <span><?= (int)$listing['bedrooms'] ?> beds</span>
                        <span><?= (int)$listing['bathrooms'] ?> baths</span>
                        <span><?= (int)$listing['sqft'] ?> sqft</span>
                    </div>
                    <p><?= nl2br(e($listing['description'])) ?></p>
                </div>
            </div>
            <aside class="panel">
                <h2>Contact <?= e($listing['agent_name']) ?></h2>
                <p class="muted"><?= e($listing['agent_phone']) ?> · <?= e($listing['agent_email']) ?></p>
                <form method="post" class="stacked-form">
                    <input type="hidden" name="action" value="contact_agent">
                    <input type="hidden" name="listing_id" value="<?= (int)$listing['id'] ?>">
                    <label>Your name
                        <input name="visitor_name" value="<?= old('visitor_name') ?>" required>
                    </label>
                    <label>Your email
                        <input name="visitor_email" type="email" value="<?= old('visitor_email') ?>" required>
                    </label>
                    <label>Message
                        <textarea name="message" rows="5" required><?= old('message', 'I would like more information about this property.') ?></textarea>
                    </label>
                    <button type="submit">Send message</button>
                </form>
            </aside>
        </section>
        <?php
    }
} elseif ($route === 'register') {
    ?>
    <section class="auth-panel">
        <h1>Create an agent account</h1>
        <form method="post" class="stacked-form">
            <input type="hidden" name="action" value="register">
            <label>Name <input name="name" value="<?= old('name') ?>" required></label>
            <label>Email <input name="email" type="email" value="<?= old('email') ?>" required></label>
            <label>Phone <input name="phone" value="<?= old('phone') ?>" required></label>
            <label>Password <input name="password" type="password" minlength="8" required></label>
            <button type="submit">Register</button>
        </form>
    </section>
    <?php
} elseif ($route === 'login') {
    ?>
    <section class="auth-panel">
        <h1>Agent sign in</h1>
        <form method="post" class="stacked-form">
            <input type="hidden" name="action" value="login">
            <label>Email <input name="email" type="email" value="<?= old('email') ?>" required></label>
            <label>Password <input name="password" type="password" required></label>
            <button type="submit">Sign in</button>
        </form>
    </section>
    <?php
} elseif ($route === 'dashboard') {
    requireAgent($db);
    $currentAgent = currentAgent($db);
    $listings = agentListings($db, (int)$currentAgent['id']);
    $inquiries = agentInquiries($db, (int)$currentAgent['id']);
    ?>
    <section class="section-head">
        <div>
            <p class="eyebrow">Agent dashboard</p>
            <h1><?= e($currentAgent['name']) ?></h1>
        </div>
        <a class="button" href="?route=new_listing">Add listing</a>
    </section>

    <section class="dashboard-grid">
        <div class="panel">
            <h2>Your listings</h2>
            <?php if (!$listings): ?><p class="empty">You have not posted any listings yet.</p><?php endif; ?>
            <?php foreach ($listings as $listing): ?>
                <div class="manager-row">
                    <div>
                        <strong><?= e($listing['title']) ?></strong>
                        <p class="muted"><?= money($listing['price']) ?> · <?= e($listing['city']) ?></p>
                    </div>
                    <div class="row-actions">
                        <a class="button secondary compact" href="?route=edit_listing&id=<?= (int)$listing['id'] ?>">Edit</a>
                        <form method="post">
                            <input type="hidden" name="action" value="delete_listing">
                            <input type="hidden" name="listing_id" value="<?= (int)$listing['id'] ?>">
                            <button class="danger compact" type="submit">Delete</button>
                        </form>
                    </div>
                </div>
            <?php endforeach; ?>
        </div>
        <div class="panel">
            <h2>Contact messages</h2>
            <?php if (!$inquiries): ?><p class="empty">No messages yet.</p><?php endif; ?>
            <?php foreach ($inquiries as $inquiry): ?>
                <article class="inquiry">
                    <strong><?= e($inquiry['visitor_name']) ?></strong>
                    <a href="mailto:<?= e($inquiry['visitor_email']) ?>"><?= e($inquiry['visitor_email']) ?></a>
                    <p class="muted"><?= e($inquiry['listing_title']) ?> · <?= e($inquiry['created_at']) ?></p>
                    <p><?= nl2br(e($inquiry['message'])) ?></p>
                </article>
            <?php endforeach; ?>
        </div>
    </section>
    <?php
} elseif ($route === 'new_listing') {
    requireAgent($db);
    echo '<section class="section-head"><h1>New listing</h1></section>';
    renderListingForm();
} elseif ($route === 'edit_listing') {
    requireAgent($db);
    $listing = findOwnedListing($db, (int)($_GET['id'] ?? $_POST['listing_id'] ?? 0), (int)$_SESSION['agent_id']);
    if (!$listing) {
        echo '<p class="empty">Listing not found.</p>';
    } else {
        echo '<section class="section-head"><h1>Edit listing</h1></section>';
        renderListingForm($listing);
    }
} else {
    echo '<p class="empty">Page not found.</p>';
}

renderFooter();
