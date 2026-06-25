<?php

declare(strict_types=1);

namespace Gallery;

use PDO;
use Throwable;

final class App
{
    public function __construct(
        private PDO $pdo,
        private Auth $auth,
        private UploadStorage $uploads
    ) {
    }

    public function handle(string $method, string $path): void
    {
        try {
            match ([$method, $path]) {
                ['GET', '/'] => $this->gallery(),
                ['GET', '/register'] => $this->registerForm(),
                ['POST', '/register'] => $this->register(),
                ['GET', '/login'] => $this->loginForm(),
                ['POST', '/login'] => $this->login(),
                ['POST', '/logout'] => $this->logout(),
                ['GET', '/upload'] => $this->uploadForm(),
                ['POST', '/upload'] => $this->upload(),
                default => $this->dynamicRoute($method, $path),
            };
        } catch (ValidationException $e) {
            Http::flash($e->getMessage(), 'error');
            Http::redirect(Http::safeLocalPath($_SERVER['HTTP_REFERER'] ?? '/'));
        } catch (Throwable $e) {
            error_log($e->getMessage());
            http_response_code(500);
            $this->layout('Error', '<p class="notice error">Something went wrong.</p>');
        }
    }

    private function dynamicRoute(string $method, string $path): void
    {
        if ($method === 'GET' && preg_match('#^/image/(\d+)$#', $path, $m) === 1) {
            $this->image((int)$m[1]);
            return;
        }

        if ($method === 'GET' && preg_match('#^/media/([a-f0-9]{64})/(thumb|full)$#', $path, $m) === 1) {
            $this->media($m[1], $m[2]);
            return;
        }

        if ($method === 'POST' && preg_match('#^/image/(\d+)/delete$#', $path, $m) === 1) {
            $this->deleteImage((int)$m[1]);
            return;
        }

        http_response_code(404);
        $this->layout('Not found', '<p class="notice error">Page not found.</p>');
    }

    private function gallery(): void
    {
        $stmt = $this->pdo->query('SELECT images.id, images.public_id, images.caption, images.created_at, users.username FROM images JOIN users ON users.id = images.user_id ORDER BY images.created_at DESC');
        $items = '';
        foreach ($stmt->fetchAll() as $image) {
            $caption = Security::e($image['caption']);
            $user = Security::e($image['username']);
            $href = '/image/' . (int)$image['id'];
            $thumb = '/media/' . Security::e($image['public_id']) . '/thumb';
            $items .= <<<HTML
<article class="card">
  <a href="{$href}"><img src="{$thumb}" alt="{$caption}"></a>
  <div class="card-body">
    <p>{$caption}</p>
    <small>Uploaded by {$user}</small>
  </div>
</article>
HTML;
        }

        $empty = $items === '' ? '<p class="empty">No images have been uploaded yet.</p>' : '';
        $this->layout('Gallery', '<section class="grid">' . $items . '</section>' . $empty);
    }

    private function image(int $id): void
    {
        $stmt = $this->pdo->prepare('SELECT images.*, users.username FROM images JOIN users ON users.id = images.user_id WHERE images.id = :id');
        $stmt->execute(['id' => $id]);
        $image = $stmt->fetch();
        if (!$image) {
            http_response_code(404);
            $this->layout('Not found', '<p class="notice error">Image not found.</p>');
            return;
        }

        $caption = Security::e($image['caption']);
        $user = Security::e($image['username']);
        $full = '/media/' . Security::e($image['public_id']) . '/full';
        $delete = '';
        if ($this->auth->userId() === (int)$image['user_id']) {
            $csrf = Security::csrfField();
            $delete = '<form method="post" action="/image/' . (int)$image['id'] . '/delete" class="inline-form">' . $csrf . '<button class="danger" type="submit">Delete</button></form>';
        }

        $body = <<<HTML
<article class="detail">
  <img src="{$full}" alt="{$caption}">
  <h1>{$caption}</h1>
  <p>Uploaded by {$user}</p>
  {$delete}
</article>
HTML;
        $this->layout($caption, $body);
    }

    private function registerForm(): void
    {
        $this->layout('Register', $this->authForm('/register', 'Create account', true));
    }

    private function register(): void
    {
        Security::requireCsrf();
        $username = Security::cleanUsername($_POST['username'] ?? '');
        $password = Security::cleanPassword($_POST['password'] ?? '');
        $this->auth->register($username, $password);
        Http::flash('Account created. You can now log in.', 'success');
        Http::redirect('/login');
    }

    private function loginForm(): void
    {
        $this->layout('Log in', $this->authForm('/login', 'Log in', false));
    }

    private function login(): void
    {
        Security::requireCsrf();
        $username = Security::cleanUsername($_POST['username'] ?? '');
        $password = Security::cleanPassword($_POST['password'] ?? '');
        if (!$this->auth->login($username, $password)) {
            throw new ValidationException('Invalid username or password.');
        }
        Http::redirect('/upload');
    }

    private function logout(): void
    {
        Security::requireCsrf();
        $this->auth->logout();
        Http::redirect('/');
    }

    private function uploadForm(): void
    {
        $this->auth->requireLogin();
        $max = UploadStorage::maxBytes();
        $body = <<<HTML
<form method="post" action="/upload" enctype="multipart/form-data" class="panel">
  <h1>Upload image</h1>
  {$this->field('caption', 'Caption')}
  <label>Image<input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" required></label>
  <p class="hint">JPEG, PNG, WebP, or GIF up to {$max} bytes.</p>
  <input type="hidden" name="csrf_token" value="{$this->csrf()}">
  <button type="submit">Upload</button>
</form>
HTML;
        $this->layout('Upload', $body);
    }

    private function upload(): void
    {
        $this->auth->requireLogin();
        Security::requireCsrf();
        $caption = Security::cleanCaption($_POST['caption'] ?? '');
        $stored = $this->uploads->store($_FILES['image'] ?? null);

        $stmt = $this->pdo->prepare('INSERT INTO images (user_id, public_id, caption, filename, thumb_filename, mime_type, created_at) VALUES (:user_id, :public_id, :caption, :filename, :thumb_filename, :mime_type, :created_at)');
        $stmt->execute([
            'user_id' => $this->auth->userId(),
            'public_id' => $stored['public_id'],
            'caption' => $caption,
            'filename' => $stored['filename'],
            'thumb_filename' => $stored['thumb_filename'],
            'mime_type' => $stored['mime_type'],
            'created_at' => gmdate('c'),
        ]);
        Http::redirect('/');
    }

    private function deleteImage(int $id): void
    {
        $this->auth->requireLogin();
        Security::requireCsrf();
        $stmt = $this->pdo->prepare('SELECT * FROM images WHERE id = :id AND user_id = :user_id');
        $stmt->execute(['id' => $id, 'user_id' => $this->auth->userId()]);
        $image = $stmt->fetch();
        if (!$image) {
            http_response_code(404);
            $this->layout('Not found', '<p class="notice error">Image not found.</p>');
            return;
        }

        $delete = $this->pdo->prepare('DELETE FROM images WHERE id = :id AND user_id = :user_id');
        $delete->execute(['id' => $id, 'user_id' => $this->auth->userId()]);
        $this->uploads->delete($image['filename'], $image['thumb_filename']);
        Http::redirect('/');
    }

    private function media(string $publicId, string $variant): void
    {
        $column = $variant === 'thumb' ? 'thumb_filename' : 'filename';
        $stmt = $this->pdo->prepare("SELECT {$column} AS stored_name, mime_type FROM images WHERE public_id = :public_id");
        $stmt->execute(['public_id' => $publicId]);
        $image = $stmt->fetch();
        if (!$image) {
            http_response_code(404);
            return;
        }
        $this->uploads->send($image['stored_name'], $variant === 'thumb' ? 'image/jpeg' : $image['mime_type']);
    }

    private function authForm(string $action, string $button, bool $register): string
    {
        $hint = $register ? '<p class="hint">Use 3-32 letters, numbers, underscores, or hyphens. Passwords must be at least 10 characters.</p>' : '';
        return <<<HTML
<form method="post" action="{$action}" class="panel">
  <h1>{$button}</h1>
  {$this->field('username', 'Username')}
  <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
  {$hint}
  <input type="hidden" name="csrf_token" value="{$this->csrf()}">
  <button type="submit">{$button}</button>
</form>
HTML;
    }

    private function layout(string $title, string $body): void
    {
        $safeTitle = Security::e($title);
        $user = $this->auth->user();
        $authLinks = $user
            ? '<a href="/upload">Upload</a><form method="post" action="/logout">' . Security::csrfField() . '<button type="submit">Logout ' . Security::e($user['username']) . '</button></form>'
            : '<a href="/login">Log in</a><a href="/register">Register</a>';
        $flash = Http::consumeFlash();
        $flashHtml = $flash ? '<p class="notice ' . Security::e($flash['type']) . '">' . Security::e($flash['message']) . '</p>' : '';

        echo <<<HTML
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{$safeTitle} - PHP Image Gallery</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <a class="brand" href="/">Image Gallery</a>
    <nav>{$authLinks}</nav>
  </header>
  <main>{$flashHtml}{$body}</main>
</body>
</html>
HTML;
    }

    private function field(string $name, string $label): string
    {
        $safeName = Security::e($name);
        $safeLabel = Security::e($label);
        return '<label>' . $safeLabel . '<input name="' . $safeName . '" type="text" required></label>';
    }

    private function csrf(): string
    {
        return Security::e(Security::csrfToken());
    }
}
