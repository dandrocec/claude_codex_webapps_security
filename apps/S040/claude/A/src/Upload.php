<?php

declare(strict_types=1);

namespace App;

/**
 * Validates and stores uploaded listing photos under public/uploads.
 */
final class Upload
{
    private const MAX_BYTES = 3 * 1024 * 1024; // 3 MB

    /** Map of allowed MIME types to file extensions. */
    private const ALLOWED = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/gif' => 'gif',
        'image/webp' => 'webp',
    ];

    /**
     * Handle a single $_FILES entry.
     *
     * @param array|null $file   A $_FILES['photo'] entry, or null if none.
     * @param array<int, string> $errors  Collects validation errors (by reference).
     * @return string|null  Stored filename, or null if no file was uploaded.
     */
    public static function store(?array $file, array &$errors): ?string
    {
        if ($file === null || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            return null;
        }

        if ($file['error'] !== UPLOAD_ERR_OK) {
            $errors[] = 'The photo failed to upload. Please try again.';
            return null;
        }

        if ($file['size'] > self::MAX_BYTES) {
            $errors[] = 'The photo must be 3 MB or smaller.';
            return null;
        }

        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $mime = (string) $finfo->file($file['tmp_name']);
        if (!isset(self::ALLOWED[$mime])) {
            $errors[] = 'Only JPG, PNG, GIF or WebP images are allowed.';
            return null;
        }

        $dir = dirname(__DIR__) . '/public/uploads';
        if (!is_dir($dir)) {
            mkdir($dir, 0777, true);
        }

        $name = bin2hex(random_bytes(16)) . '.' . self::ALLOWED[$mime];
        if (!move_uploaded_file($file['tmp_name'], $dir . '/' . $name)) {
            $errors[] = 'Could not save the uploaded photo.';
            return null;
        }

        return $name;
    }

    /** Remove a previously stored photo, if it exists. */
    public static function delete(?string $name): void
    {
        if (!$name) {
            return;
        }
        $path = dirname(__DIR__) . '/public/uploads/' . basename($name);
        if (is_file($path)) {
            @unlink($path);
        }
    }
}
