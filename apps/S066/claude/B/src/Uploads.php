<?php

declare(strict_types=1);

namespace App;

/**
 * Hardened image upload handling:
 *  - allow-list of types, validated by INSPECTED CONTENT (finfo + getimagesize),
 *    never trusting the client filename or Content-Type header;
 *  - enforced maximum size;
 *  - server-generated random filenames;
 *  - stored OUTSIDE the public web root (Config::uploadDir());
 *  - path-traversal proof read/write (realpath confinement).
 */
final class Uploads
{
    /** mime => canonical extension */
    private const ALLOWED = [
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
        'image/webp' => 'webp',
        'image/gif'  => 'gif',
    ];

    public static function dir(): string
    {
        $dir = Config::uploadDir();
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        return $dir;
    }

    /**
     * Validate and store a single uploaded file.
     *
     * @param array{name?:string,type?:string,tmp_name?:string,error?:int,size?:int} $file
     * @return array{0:bool,1:string} [success, filename-or-error]
     */
    public static function store(array $file): array
    {
        $error = $file['error'] ?? UPLOAD_ERR_NO_FILE;
        if ($error === UPLOAD_ERR_NO_FILE) {
            return [false, 'No file uploaded.'];
        }
        if ($error !== UPLOAD_ERR_OK) {
            return [false, 'Upload failed (error code ' . (int) $error . ').'];
        }

        $tmp = $file['tmp_name'] ?? '';
        if ($tmp === '' || !is_uploaded_file($tmp)) {
            // Defends against tmp_name being forged to an arbitrary path.
            return [false, 'Invalid upload.'];
        }

        $size = (int) ($file['size'] ?? 0);
        $max = Config::maxUploadBytes();
        if ($size <= 0) {
            return [false, 'Empty file.'];
        }
        if ($size > $max || filesize($tmp) > $max) {
            return [false, 'File exceeds the maximum allowed size of '
                . self::humanBytes($max) . '.'];
        }

        // Content-based MIME detection — ignore the client-supplied type/name.
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $mime = (string) $finfo->file($tmp);

        if (!isset(self::ALLOWED[$mime])) {
            return [false, 'Unsupported file type. Allowed: JPG, PNG, WEBP, GIF.'];
        }

        // Second, independent check: it must actually decode as an image of the
        // same family (defeats polyglots / disguised payloads).
        $info = @getimagesize($tmp);
        if ($info === false || empty($info['mime']) || $info['mime'] !== $mime) {
            return [false, 'File is not a valid image.'];
        }

        $ext = self::ALLOWED[$mime];
        $name = bin2hex(random_bytes(16)) . '.' . $ext;

        $dir = self::dir();
        $dest = $dir . DIRECTORY_SEPARATOR . $name;

        if (!move_uploaded_file($tmp, $dest)) {
            return [false, 'Could not save the uploaded file.'];
        }
        @chmod($dest, 0640);

        return [true, $name];
    }

    /**
     * Resolve a stored filename to an absolute path, guaranteeing it stays
     * inside the upload directory (path-traversal proof).
     */
    public static function pathFor(string $filename): ?string
    {
        // A stored name is always a bare basename; reject anything else.
        if ($filename === '' || $filename !== basename($filename)) {
            return null;
        }
        if (!preg_match('/^[A-Za-z0-9._-]+$/', $filename)) {
            return null;
        }

        $dir = realpath(self::dir());
        if ($dir === false) {
            return null;
        }

        $full = $dir . DIRECTORY_SEPARATOR . $filename;
        $real = realpath($full);
        if ($real === false) {
            return null;
        }

        // Confinement check: the resolved path must live under the upload dir.
        $prefix = $dir . DIRECTORY_SEPARATOR;
        if (!str_starts_with($real, $prefix)) {
            return null;
        }

        return $real;
    }

    public static function delete(string $filename): void
    {
        $path = self::pathFor($filename);
        if ($path !== null && is_file($path)) {
            @unlink($path);
        }
    }

    private static function humanBytes(int $bytes): string
    {
        $mb = $bytes / (1024 * 1024);
        return rtrim(rtrim(number_format($mb, 1), '0'), '.') . ' MB';
    }
}
