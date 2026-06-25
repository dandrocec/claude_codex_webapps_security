<?php
declare(strict_types=1);

namespace PhotoBlog;

use finfo;
use RuntimeException;

final class UploadService
{
    private const MAX_BYTES = 4_000_000;
    private const MIME_EXT = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/gif' => 'gif',
        'image/webp' => 'webp',
    ];

    private string $dir;

    public function __construct()
    {
        $this->dir = dirname(__DIR__) . '/storage/uploads';
        if (!is_dir($this->dir)) {
            mkdir($this->dir, 0700, true);
        }
    }

    public function store(?array $file): string
    {
        if (!$file || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            throw new RuntimeException('Choose an image to upload.', 422);
        }
        if (($file['size'] ?? 0) < 1 || ($file['size'] ?? 0) > self::MAX_BYTES) {
            throw new RuntimeException('Images must be between 1 byte and 4 MB.', 413);
        }
        $tmp = (string)$file['tmp_name'];
        if (!is_uploaded_file($tmp)) {
            throw new RuntimeException('Invalid upload.', 422);
        }
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($tmp);
        if (!is_string($mime) || !isset(self::MIME_EXT[$mime])) {
            throw new RuntimeException('Only JPEG, PNG, GIF, and WebP images are allowed.', 422);
        }
        if (@getimagesize($tmp) === false) {
            throw new RuntimeException('Uploaded file is not a valid image.', 422);
        }
        $name = bin2hex(random_bytes(24)) . '.' . self::MIME_EXT[$mime];
        $target = $this->path($name);
        if (!move_uploaded_file($tmp, $target)) {
            throw new RuntimeException('Could not save upload.', 500);
        }
        chmod($target, 0600);
        return $name;
    }

    public function serve(string $name): void
    {
        if (!preg_match('/^[a-f0-9]{48}\.(jpg|png|gif|webp)$/', $name)) {
            throw new RuntimeException('Image not found.', 404);
        }
        $path = $this->path($name);
        if (!is_file($path)) {
            throw new RuntimeException('Image not found.', 404);
        }
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($path);
        if (!is_string($mime) || !isset(self::MIME_EXT[$mime])) {
            throw new RuntimeException('Image not found.', 404);
        }
        header('Content-Type: ' . $mime);
        header('Content-Length: ' . (string)filesize($path));
        header('Cache-Control: public, max-age=31536000, immutable');
        readfile($path);
    }

    public function delete(string $name): void
    {
        if (!preg_match('/^[a-f0-9]{48}\.(jpg|png|gif|webp)$/', $name)) {
            return;
        }
        $path = $this->path($name);
        if (is_file($path)) {
            unlink($path);
        }
    }

    private function path(string $name): string
    {
        $base = realpath($this->dir);
        if ($base === false) {
            throw new RuntimeException('Upload directory is unavailable.', 500);
        }
        $path = $base . DIRECTORY_SEPARATOR . $name;
        $parent = realpath(dirname($path));
        if ($parent !== $base) {
            throw new RuntimeException('Invalid upload path.', 400);
        }
        return $path;
    }
}
