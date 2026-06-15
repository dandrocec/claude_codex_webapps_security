<?php

declare(strict_types=1);

namespace App;

/*
 * Request handlers. Each function corresponds to a route and is responsible
 * for its own authorisation, CSRF checks, validation and output.
 */

/* ----------------------------- Gallery ----------------------------- */

function show_gallery(): void
{
    $stmt = Database::connection()->query(
        'SELECT i.id, i.thumb_name, i.caption, i.created_at, u.username
           FROM images i
           JOIN users u ON u.id = i.user_id
          ORDER BY i.id DESC'
    );
    render('gallery', ['images' => $stmt->fetchAll()]);
}

function show_image_page(int $id): void
{
    $stmt = Database::connection()->prepare(
        'SELECT i.id, i.caption, i.created_at, i.user_id, u.username
           FROM images i
           JOIN users u ON u.id = i.user_id
          WHERE i.id = :id'
    );
    $stmt->execute([':id' => $id]);
    $image = $stmt->fetch();
    if (!$image) {
        abort(404, 'That image does not exist.');
    }
    $user = current_user();
    render('view', ['image' => $image, 'is_owner' => $user && (int) $user['id'] === (int) $image['user_id']]);
}

/* ----------------------- Serving binary images --------------------- */

function serve_binary(int $id, bool $thumb): void
{
    $stmt = Database::connection()->prepare(
        'SELECT stored_name, thumb_name, mime FROM images WHERE id = :id'
    );
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();
    if (!$row) {
        abort(404, 'Image not found.');
    }

    $name = $thumb ? $row['thumb_name'] : $row['stored_name'];
    $path = safe_upload_path($name);
    if ($path === null || !is_file($path)) {
        abort(404, 'Image not found.');
    }

    // Re-send minimal, safe headers for binary content.
    header('Content-Type: ' . $row['mime']);
    header('Content-Length: ' . (string) filesize($path));
    header('Content-Disposition: inline');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, max-age=86400');
    readfile($path);
}

/* ------------------------------ Auth ------------------------------- */

function show_register(): void
{
    if (current_user()) {
        redirect('/');
    }
    render('register', ['username' => '']);
}

function handle_register(): void
{
    require_csrf();
    if (current_user()) {
        redirect('/');
    }

    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');
    $confirm  = (string) ($_POST['password_confirm'] ?? '');

    $errors = [];
    if (!valid_username($username)) {
        $errors[] = 'Username must be 3–32 characters: letters, digits, _ . - only.';
    }
    if (strlen($password) < 10) {
        $errors[] = 'Password must be at least 10 characters long.';
    }
    if (strlen($password) > 1024) {
        $errors[] = 'Password is too long.';
    }
    if ($password !== $confirm) {
        $errors[] = 'Passwords do not match.';
    }

    if ($errors) {
        foreach ($errors as $msg) {
            flash($msg, 'error');
        }
        render('register', ['username' => $username]);
        return;
    }

    $hash = password_hash($password, PASSWORD_DEFAULT);
    try {
        $stmt = Database::connection()->prepare(
            'INSERT INTO users (username, password_hash) VALUES (:u, :h)'
        );
        $stmt->execute([':u' => $username, ':h' => $hash]);
    } catch (\PDOException $e) {
        // Unique constraint -> username taken. Don't reveal anything else.
        flash('That username is not available.', 'error');
        render('register', ['username' => $username]);
        return;
    }

    login_user((int) Database::connection()->lastInsertId());
    flash('Welcome! Your account was created.', 'success');
    redirect('/');
}

function show_login(): void
{
    if (current_user()) {
        redirect('/');
    }
    render('login', ['username' => '']);
}

function handle_login(): void
{
    require_csrf();

    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');

    $stmt = Database::connection()->prepare(
        'SELECT id, password_hash FROM users WHERE username = :u'
    );
    $stmt->execute([':u' => $username]);
    $user = $stmt->fetch();

    // Always run a hash verification to keep timing uniform whether or not
    // the user exists, and use a generic error message either way.
    $hash = $user['password_hash'] ?? '$2y$12$............................................';
    $ok = password_verify($password, $hash);

    if (!$user || !$ok) {
        flash('Invalid username or password.', 'error');
        render('login', ['username' => $username]);
        return;
    }

    login_user((int) $user['id']);
    flash('Signed in successfully.', 'success');
    redirect('/');
}

function handle_logout(): void
{
    require_csrf();
    logout_user();
    start_secure_session();
    flash('You have been signed out.', 'info');
    redirect('/');
}

/* ----------------------------- Upload ------------------------------ */

function show_upload(): void
{
    require_login();
    render('upload', []);
}

function handle_upload(): void
{
    $user = require_login();
    require_csrf();

    $caption = trim((string) ($_POST['caption'] ?? ''));
    if (mb_strlen($caption) > 500) {
        flash('Caption must be 500 characters or fewer.', 'error');
        render('upload', []);
        return;
    }

    $file = $_FILES['image'] ?? null;
    if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        flash('Please choose an image to upload.', 'error');
        render('upload', []);
        return;
    }
    if ($file['error'] !== UPLOAD_ERR_OK) {
        flash('Upload failed (the file may be too large). Please try again.', 'error');
        render('upload', []);
        return;
    }
    if (!is_uploaded_file($file['tmp_name'])) {
        abort(400, 'Invalid upload.');
    }
    if ($file['size'] > max_upload_bytes()) {
        flash('File is too large. Maximum size is ' . round(max_upload_bytes() / 1048576, 1) . ' MB.', 'error');
        render('upload', []);
        return;
    }

    // Validate by inspecting the actual bytes, not the client filename/type.
    $mime = sniff_allowed_image($file['tmp_name']);
    if ($mime === null) {
        flash('Unsupported file. Allowed types: JPEG, PNG, GIF, WebP.', 'error');
        render('upload', []);
        return;
    }

    $ext       = ALLOWED_IMAGE_TYPES[$mime];
    $random    = bin2hex(random_bytes(16));
    $storedName = $random . '.' . $ext;
    $thumbName  = $random . '_thumb.' . $ext;

    $dir       = upload_dir();
    $destPath  = $dir . DIRECTORY_SEPARATOR . $storedName;
    $thumbPath = $dir . DIRECTORY_SEPARATOR . $thumbName;

    if (!move_uploaded_file($file['tmp_name'], $destPath)) {
        abort(500, 'Could not store the uploaded file.');
    }
    // Never executable: store as read-only data.
    @chmod($destPath, 0644);

    if (!make_thumbnail($destPath, $mime, $thumbPath)) {
        @unlink($destPath);
        flash('That image could not be processed.', 'error');
        render('upload', []);
        return;
    }
    @chmod($thumbPath, 0644);

    $stmt = Database::connection()->prepare(
        'INSERT INTO images (user_id, stored_name, thumb_name, mime, caption)
         VALUES (:uid, :stored, :thumb, :mime, :caption)'
    );
    $stmt->execute([
        ':uid'     => $user['id'],
        ':stored'  => $storedName,
        ':thumb'   => $thumbName,
        ':mime'    => $mime,
        ':caption' => $caption,
    ]);

    flash('Image uploaded.', 'success');
    redirect('/view/' . Database::connection()->lastInsertId());
}

function handle_delete(): void
{
    $user = require_login();
    require_csrf();

    $id = (int) ($_POST['id'] ?? 0);
    $stmt = Database::connection()->prepare(
        'SELECT id, user_id, stored_name, thumb_name FROM images WHERE id = :id'
    );
    $stmt->execute([':id' => $id]);
    $image = $stmt->fetch();

    if (!$image) {
        abort(404, 'Image not found.');
    }
    // Access control: owners only (prevents IDOR).
    if ((int) $image['user_id'] !== (int) $user['id']) {
        abort(403, 'You can only delete your own images.');
    }

    $del = Database::connection()->prepare('DELETE FROM images WHERE id = :id AND user_id = :uid');
    $del->execute([':id' => $id, ':uid' => $user['id']]);

    foreach ([$image['stored_name'], $image['thumb_name']] as $name) {
        $path = safe_upload_path($name);
        if ($path !== null && is_file($path)) {
            @unlink($path);
        }
    }

    flash('Image deleted.', 'success');
    redirect('/');
}
