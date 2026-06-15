<?php
declare(strict_types=1);

const UPLOAD_DIR = BASE_PATH . '/public/uploads';
const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // 4 MB
const ALLOWED_IMAGE_TYPES = [
    'image/jpeg' => 'jpg',
    'image/png'  => 'png',
    'image/gif'  => 'gif',
    'image/webp' => 'webp',
];

function all_categories(): array
{
    return db()->query('SELECT id, slug, name FROM categories ORDER BY name')->fetchAll();
}

function category_by_slug(string $slug): ?array
{
    $stmt = db()->prepare('SELECT id, slug, name FROM categories WHERE slug = ?');
    $stmt->execute([$slug]);
    return $stmt->fetch() ?: null;
}

/**
 * Home / browse / search. Filters by optional category slug and search term.
 */
function home(): void
{
    $q        = mb_substr(query('q'), 0, 100);
    $catSlug  = query('category');
    $category = $catSlug !== '' ? category_by_slug($catSlug) : null;

    $sql = 'SELECT l.id, l.title, l.price_cents, l.photo_path, l.created_at,
                   c.name AS category_name, c.slug AS category_slug,
                   u.display_name AS seller_name
            FROM listings l
            JOIN categories c ON c.id = l.category_id
            JOIN users u ON u.id = l.seller_id
            WHERE 1=1';
    $params = [];

    if ($category) {
        $sql .= ' AND l.category_id = ?';
        $params[] = $category['id'];
    }
    if ($q !== '') {
        // Parameterised LIKE; escape wildcards in user input.
        $needle = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
        $sql .= " AND (l.title LIKE ? ESCAPE '\\' OR l.description LIKE ? ESCAPE '\\')";
        $params[] = $needle;
        $params[] = $needle;
    }
    $sql .= ' ORDER BY l.created_at DESC, l.id DESC LIMIT 100';

    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    $listings = $stmt->fetchAll();

    view('home', [
        'listings'   => $listings,
        'categories' => all_categories(),
        'q'          => $q,
        'activeCat'  => $category,
    ], 'Browse listings');
}

function find_listing(int $id): ?array
{
    $stmt = db()->prepare(
        'SELECT l.*, c.name AS category_name, c.slug AS category_slug, u.display_name AS seller_name
         FROM listings l
         JOIN categories c ON c.id = l.category_id
         JOIN users u ON u.id = l.seller_id
         WHERE l.id = ?'
    );
    $stmt->execute([$id]);
    return $stmt->fetch() ?: null;
}

function show_listing(): void
{
    $id = filter_var(query('id'), FILTER_VALIDATE_INT);
    $listing = $id ? find_listing((int) $id) : null;
    if (!$listing) {
        http_response_code(404);
        view('error', ['message' => 'That listing does not exist or has been removed.'], 'Not found');
        return;
    }
    $user = current_user();
    $isOwner = $user && (int) $user['id'] === (int) $listing['seller_id'];
    view('item', ['listing' => $listing, 'isOwner' => $isOwner], $listing['title']);
}

function create_form(): void
{
    require_login();
    view('listing_form', [
        'mode' => 'create', 'old' => [], 'errors' => [],
        'categories' => all_categories(), 'listing' => null,
    ], 'Post an item for sale');
}

function create_submit(): void
{
    $user = require_login();
    require_csrf();

    [$data, $errors] = validate_listing_input();
    $photoPath = null;

    if (!$errors) {
        try {
            $photoPath = handle_photo_upload();
        } catch (RuntimeException $e) {
            $errors['photo'] = $e->getMessage();
        }
    }

    if ($errors) {
        view('listing_form', [
            'mode' => 'create', 'old' => $data, 'errors' => $errors,
            'categories' => all_categories(), 'listing' => null,
        ], 'Post an item for sale');
        return;
    }

    $stmt = db()->prepare(
        'INSERT INTO listings (seller_id, category_id, title, description, price_cents, photo_path)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $user['id'], $data['category_id'], $data['title'],
        $data['description'], $data['price_cents'], $photoPath,
    ]);

    flash('Your listing has been posted.', 'success');
    redirect('/item?id=' . db()->lastInsertId());
}

function edit_form(): void
{
    $user = require_login();
    $id = filter_var(query('id'), FILTER_VALIDATE_INT);
    $listing = $id ? find_listing((int) $id) : null;

    if (!$listing || (int) $listing['seller_id'] !== (int) $user['id']) {
        http_response_code(404); // do not reveal existence of others' resources
        view('error', ['message' => 'That listing does not exist or you do not have access to it.'], 'Not found');
        return;
    }

    view('listing_form', [
        'mode' => 'edit',
        'old' => [
            'title' => $listing['title'],
            'description' => $listing['description'],
            'price' => number_format($listing['price_cents'] / 100, 2, '.', ''),
            'category_id' => (string) $listing['category_id'],
        ],
        'errors' => [],
        'categories' => all_categories(),
        'listing' => $listing,
    ], 'Edit listing');
}

function edit_submit(): void
{
    $user = require_login();
    require_csrf();

    $id = filter_var(post('id'), FILTER_VALIDATE_INT);
    $listing = $id ? find_listing((int) $id) : null;

    // Access control: owner only (prevents IDOR).
    if (!$listing || (int) $listing['seller_id'] !== (int) $user['id']) {
        http_response_code(404);
        view('error', ['message' => 'That listing does not exist or you do not have access to it.'], 'Not found');
        return;
    }

    [$data, $errors] = validate_listing_input();
    $photoPath = $listing['photo_path'];
    $newPhoto = null;

    if (!$errors) {
        try {
            $newPhoto = handle_photo_upload();
        } catch (RuntimeException $e) {
            $errors['photo'] = $e->getMessage();
        }
    }

    if ($errors) {
        view('listing_form', [
            'mode' => 'edit', 'old' => $data + ['id' => $id], 'errors' => $errors,
            'categories' => all_categories(), 'listing' => $listing,
        ], 'Edit listing');
        return;
    }

    if ($newPhoto !== null) {
        $photoPath = $newPhoto;
    }

    $stmt = db()->prepare(
        'UPDATE listings
         SET category_id = ?, title = ?, description = ?, price_cents = ?, photo_path = ?,
             updated_at = ' . (env('DB_DRIVER', 'sqlite') === 'mysql' ? 'CURRENT_TIMESTAMP' : "datetime('now')") . '
         WHERE id = ? AND seller_id = ?'
    );
    $stmt->execute([
        $data['category_id'], $data['title'], $data['description'],
        $data['price_cents'], $photoPath, $listing['id'], $user['id'],
    ]);

    // Remove the old file if it was replaced.
    if ($newPhoto !== null && $listing['photo_path']) {
        delete_photo_file($listing['photo_path']);
    }

    flash('Listing updated.', 'success');
    redirect('/item?id=' . $listing['id']);
}

function delete_submit(): void
{
    $user = require_login();
    require_csrf();

    $id = filter_var(post('id'), FILTER_VALIDATE_INT);
    $listing = $id ? find_listing((int) $id) : null;

    if (!$listing || (int) $listing['seller_id'] !== (int) $user['id']) {
        http_response_code(404);
        view('error', ['message' => 'That listing does not exist or you do not have access to it.'], 'Not found');
        return;
    }

    // Scope the delete to the owner as defence in depth.
    $stmt = db()->prepare('DELETE FROM listings WHERE id = ? AND seller_id = ?');
    $stmt->execute([$listing['id'], $user['id']]);

    if ($listing['photo_path']) {
        delete_photo_file($listing['photo_path']);
    }

    flash('Listing removed.', 'success');
    redirect('/my-listings');
}

function my_listings(): void
{
    $user = require_login();
    $stmt = db()->prepare(
        'SELECT l.id, l.title, l.price_cents, l.photo_path, l.created_at, c.name AS category_name
         FROM listings l JOIN categories c ON c.id = l.category_id
         WHERE l.seller_id = ? ORDER BY l.created_at DESC, l.id DESC'
    );
    $stmt->execute([$user['id']]);
    view('my_listings', ['listings' => $stmt->fetchAll()], 'My listings');
}

/**
 * Validate and normalise listing fields. Returns [data, errors].
 */
function validate_listing_input(): array
{
    $title       = post('title');
    $description = post('description');
    $priceRaw    = post('price');
    $categoryId  = filter_var(post('category_id'), FILTER_VALIDATE_INT);

    $errors = [];
    if (mb_strlen($title) < 3 || mb_strlen($title) > 140) {
        $errors['title'] = 'Title must be 3–140 characters.';
    }
    if (mb_strlen($description) < 10 || mb_strlen($description) > 5000) {
        $errors['description'] = 'Description must be 10–5000 characters.';
    }

    $priceCents = 0;
    if (!is_numeric($priceRaw) || (float) $priceRaw < 0 || (float) $priceRaw > 1_000_000) {
        $errors['price'] = 'Enter a price between 0 and 1,000,000.';
    } else {
        $priceCents = (int) round(((float) $priceRaw) * 100);
    }

    if (!$categoryId) {
        $errors['category_id'] = 'Choose a category.';
    } else {
        $chk = db()->prepare('SELECT 1 FROM categories WHERE id = ?');
        $chk->execute([$categoryId]);
        if (!$chk->fetch()) {
            $errors['category_id'] = 'Choose a valid category.';
        }
    }

    return [[
        'title' => $title,
        'description' => $description,
        'price' => $priceRaw,
        'price_cents' => $priceCents,
        'category_id' => $categoryId ?: null,
    ], $errors];
}

/**
 * Validate and store an uploaded photo. Returns the stored relative path,
 * or null when no file was provided. Throws RuntimeException on invalid input.
 */
function handle_photo_upload(): ?string
{
    if (empty($_FILES['photo']) || ($_FILES['photo']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return null;
    }
    $f = $_FILES['photo'];
    if ($f['error'] !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Upload failed. Please try again.');
    }
    if ($f['size'] > MAX_PHOTO_BYTES) {
        throw new RuntimeException('Image must be 4 MB or smaller.');
    }
    if (!is_uploaded_file($f['tmp_name'])) {
        throw new RuntimeException('Invalid upload.');
    }

    // Determine the real MIME type from file contents, not the client header.
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime  = (string) $finfo->file($f['tmp_name']);
    if (!isset(ALLOWED_IMAGE_TYPES[$mime])) {
        throw new RuntimeException('Only JPEG, PNG, GIF or WebP images are allowed.');
    }
    // Confirm it is a real raster image.
    if (@getimagesize($f['tmp_name']) === false) {
        throw new RuntimeException('The uploaded file is not a valid image.');
    }

    $ext = ALLOWED_IMAGE_TYPES[$mime];
    $name = bin2hex(random_bytes(16)) . '.' . $ext;

    if (!is_dir(UPLOAD_DIR) && !mkdir(UPLOAD_DIR, 0775, true) && !is_dir(UPLOAD_DIR)) {
        throw new RuntimeException('Could not store the image.');
    }
    $dest = UPLOAD_DIR . '/' . $name;
    if (!move_uploaded_file($f['tmp_name'], $dest)) {
        throw new RuntimeException('Could not store the image.');
    }
    @chmod($dest, 0644);

    return 'uploads/' . $name;
}

/** Safely delete a stored photo, guarding against path traversal. */
function delete_photo_file(string $relPath): void
{
    if (!str_starts_with($relPath, 'uploads/')) {
        return;
    }
    $name = basename($relPath); // strip any path components
    $full = UPLOAD_DIR . '/' . $name;
    if (is_file($full)) {
        @unlink($full);
    }
}
