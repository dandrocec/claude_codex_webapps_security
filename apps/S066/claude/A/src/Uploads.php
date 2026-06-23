<?php

declare(strict_types=1);

namespace App;

/**
 * Validates and stores uploaded listing photos under public/uploads.
 */
final class Uploads
{
    private const ALLOWED = [
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
        'image/gif'  => 'gif',
        'image/webp' => 'webp',
    ];

    private const MAX_BYTES = 5 * 1024 * 1024; // 5 MB per file

    public static function dir(): string
    {
        $dir = dirname(__DIR__) . '/public/uploads';
        if (!is_dir($dir)) {
            mkdir($dir, 0777, true);
        }
        return $dir;
    }

    /**
     * Store files from a $_FILES multi-upload field. Returns saved filenames.
     *
     * @return string[]
     */
    public static function storeMany(array $files): array
    {
        $saved = [];
        if (!isset($files['tmp_name']) || !is_array($files['tmp_name'])) {
            return $saved;
        }

        $finfo = new \finfo(FILEINFO_MIME_TYPE);

        foreach ($files['tmp_name'] as $i => $tmp) {
            if (($files['error'][$i] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
                continue;
            }
            if (($files['size'][$i] ?? 0) > self::MAX_BYTES || !is_uploaded_file($tmp)) {
                continue;
            }

            $mime = $finfo->file($tmp);
            if (!isset(self::ALLOWED[$mime])) {
                continue;
            }

            $ext = self::ALLOWED[$mime];
            $name = bin2hex(random_bytes(16)) . '.' . $ext;
            $dest = self::dir() . '/' . $name;

            if (move_uploaded_file($tmp, $dest)) {
                $saved[] = $name;
            }
        }

        return $saved;
    }
}
