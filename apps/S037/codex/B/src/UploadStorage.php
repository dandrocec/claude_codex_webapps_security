<?php

declare(strict_types=1);

namespace Gallery;

final class UploadStorage
{
    private const ALLOWED = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
        'image/gif' => 'gif',
    ];

    public function __construct(private string $directory)
    {
        if (!is_dir($this->directory)) {
            mkdir($this->directory, 0700, true);
        }
    }

    public static function maxBytes(): int
    {
        $configured = (int)(getenv('MAX_UPLOAD_BYTES') ?: 5242880);
        return max(1, min($configured, 10485760));
    }

    public function store(?array $file): array
    {
        if (!$file || !isset($file['error'], $file['tmp_name'], $file['size']) || $file['error'] !== UPLOAD_ERR_OK) {
            throw new ValidationException('Upload failed.');
        }
        if ((int)$file['size'] < 1 || (int)$file['size'] > self::maxBytes()) {
            throw new ValidationException('Image is too large.');
        }
        if (!is_uploaded_file($file['tmp_name'])) {
            throw new ValidationException('Invalid upload.');
        }

        $mime = $this->inspectedMime($file['tmp_name']);
        if (!isset(self::ALLOWED[$mime])) {
            throw new ValidationException('Unsupported image type.');
        }
        $info = @getimagesize($file['tmp_name']);
        if ($info === false || ($info['mime'] ?? '') !== $mime) {
            throw new ValidationException('Invalid image content.');
        }

        $publicId = bin2hex(random_bytes(32));
        $filename = $publicId . '.' . self::ALLOWED[$mime];
        $thumbFilename = $publicId . '.thumb.jpg';
        $target = $this->safePath($filename);
        if (!move_uploaded_file($file['tmp_name'], $target)) {
            throw new ValidationException('Could not save upload.');
        }
        chmod($target, 0600);
        $this->createThumbnail($target, $this->safePath($thumbFilename), $mime);

        return [
            'public_id' => $publicId,
            'filename' => $filename,
            'thumb_filename' => $thumbFilename,
            'mime_type' => $mime,
        ];
    }

    public function send(string $filename, string $mime): void
    {
        $path = $this->safePath($filename);
        if (!is_file($path)) {
            http_response_code(404);
            return;
        }
        header('Content-Type: ' . $mime);
        header('Content-Length: ' . (string)filesize($path));
        header('Cache-Control: private, max-age=3600');
        readfile($path);
    }

    public function delete(string $filename, string $thumbFilename): void
    {
        foreach ([$filename, $thumbFilename] as $name) {
            $path = $this->safePath($name);
            if (is_file($path)) {
                unlink($path);
            }
        }
    }

    private function inspectedMime(string $path): string
    {
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        return (string)$finfo->file($path);
    }

    private function safePath(string $filename): string
    {
        if (preg_match('/\A[a-f0-9]{64}(?:\.thumb)?\.(?:jpg|png|webp|gif)\z/', $filename) !== 1) {
            throw new ValidationException('Invalid file path.');
        }
        $base = realpath($this->directory) ?: $this->directory;
        $path = $base . DIRECTORY_SEPARATOR . $filename;
        $dir = realpath(dirname($path)) ?: $base;
        if ($dir !== $base) {
            throw new ValidationException('Invalid file path.');
        }
        return $path;
    }

    private function createThumbnail(string $source, string $target, string $mime): void
    {
        $image = match ($mime) {
            'image/jpeg' => imagecreatefromjpeg($source),
            'image/png' => imagecreatefrompng($source),
            'image/webp' => imagecreatefromwebp($source),
            'image/gif' => imagecreatefromgif($source),
            default => false,
        };
        if (!$image) {
            throw new ValidationException('Could not process image.');
        }

        $width = imagesx($image);
        $height = imagesy($image);
        $max = 360;
        $scale = min($max / max(1, $width), $max / max(1, $height), 1);
        $thumbWidth = max(1, (int)floor($width * $scale));
        $thumbHeight = max(1, (int)floor($height * $scale));
        $thumb = imagecreatetruecolor($thumbWidth, $thumbHeight);
        imagecopyresampled($thumb, $image, 0, 0, 0, 0, $thumbWidth, $thumbHeight, $width, $height);
        imagejpeg($thumb, $target, 82);
        chmod($target, 0600);
        imagedestroy($image);
        imagedestroy($thumb);
    }
}
