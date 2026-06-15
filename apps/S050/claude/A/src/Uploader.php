<?php

declare(strict_types=1);

namespace App;

/**
 * Validates and stores an uploaded image into public/uploads.
 */
final class Uploader
{
    private const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

    /** Map of accepted MIME types to file extensions. */
    private const ALLOWED = [
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
        'image/gif'  => 'gif',
        'image/webp' => 'webp',
    ];

    /**
     * @param array<string, mixed> $file A single entry from $_FILES.
     * @return string The web-relative path (e.g. /uploads/abc.jpg).
     * @throws \RuntimeException on any validation failure.
     */
    public static function store(array $file): string
    {
        if (!isset($file['error']) || is_array($file['error'])) {
            throw new \RuntimeException('No image was uploaded.');
        }

        switch ($file['error']) {
            case UPLOAD_ERR_OK:
                break;
            case UPLOAD_ERR_NO_FILE:
                throw new \RuntimeException('Please choose an image to upload.');
            case UPLOAD_ERR_INI_SIZE:
            case UPLOAD_ERR_FORM_SIZE:
                throw new \RuntimeException('The image is too large.');
            default:
                throw new \RuntimeException('Image upload failed. Please try again.');
        }

        if ($file['size'] > self::MAX_BYTES) {
            throw new \RuntimeException('The image must be 5 MB or smaller.');
        }

        // Trust sniffed content type, not the client-supplied one.
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $mime = (string) $finfo->file($file['tmp_name']);

        if (!isset(self::ALLOWED[$mime])) {
            throw new \RuntimeException('Only JPEG, PNG, GIF, or WebP images are allowed.');
        }

        $ext = self::ALLOWED[$mime];
        $name = bin2hex(random_bytes(16)) . '.' . $ext;

        $uploadDir = dirname(__DIR__) . '/public/uploads';
        if (!is_dir($uploadDir)) {
            mkdir($uploadDir, 0775, true);
        }

        $destination = $uploadDir . '/' . $name;
        if (!move_uploaded_file($file['tmp_name'], $destination)) {
            throw new \RuntimeException('Could not save the uploaded image.');
        }

        return '/uploads/' . $name;
    }

    /** Remove a stored image given its web-relative path. */
    public static function remove(string $webPath): void
    {
        $name = basename($webPath);
        $full = dirname(__DIR__) . '/public/uploads/' . $name;
        if (is_file($full)) {
            @unlink($full);
        }
    }
}
