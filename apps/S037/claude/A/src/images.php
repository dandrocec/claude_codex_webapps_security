<?php
declare(strict_types=1);

/**
 * Image helpers: validating uploads and generating thumbnails with GD.
 */

// Allowed upload MIME types mapped to a canonical file extension.
const ALLOWED_IMAGE_TYPES = [
    'image/jpeg' => 'jpg',
    'image/png'  => 'png',
    'image/gif'  => 'gif',
    'image/webp' => 'webp',
];

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB
const THUMB_MAX = 320;                     // longest thumbnail edge, px

/**
 * Validate an uploaded file array (from $_FILES). Returns the detected MIME
 * type on success, or throws RuntimeException with a user-friendly message.
 */
function validate_upload(array $file): string
{
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        throw new RuntimeException('No file was uploaded or the upload failed.');
    }
    if (!is_uploaded_file($file['tmp_name'])) {
        throw new RuntimeException('Invalid upload.');
    }
    if ($file['size'] > MAX_UPLOAD_BYTES) {
        throw new RuntimeException('Image is too large (max 8 MB).');
    }

    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = $finfo->file($file['tmp_name']) ?: '';
    if (!isset(ALLOWED_IMAGE_TYPES[$mime])) {
        throw new RuntimeException('Unsupported file type. Use JPEG, PNG, GIF, or WebP.');
    }
    return $mime;
}

/** Load a GD image resource from a file, based on its MIME type. */
function load_image(string $path, string $mime): \GdImage
{
    $img = match ($mime) {
        'image/jpeg' => imagecreatefromjpeg($path),
        'image/png'  => imagecreatefrompng($path),
        'image/gif'  => imagecreatefromgif($path),
        'image/webp' => imagecreatefromwebp($path),
        default      => false,
    };
    if (!$img instanceof \GdImage) {
        throw new RuntimeException('Could not read the image data.');
    }
    return $img;
}

/**
 * Create a thumbnail (longest edge = THUMB_MAX) as a JPEG at $destPath.
 * Preserves aspect ratio; flattens transparency onto white.
 */
function make_thumbnail(string $srcPath, string $mime, string $destPath): void
{
    $src = load_image($srcPath, $mime);
    $w = imagesx($src);
    $h = imagesy($src);

    $scale = min(THUMB_MAX / $w, THUMB_MAX / $h, 1.0);
    $tw = max(1, (int) round($w * $scale));
    $th = max(1, (int) round($h * $scale));

    $thumb = imagecreatetruecolor($tw, $th);
    $white = imagecolorallocate($thumb, 255, 255, 255);
    imagefilledrectangle($thumb, 0, 0, $tw, $th, $white);
    imagecopyresampled($thumb, $src, 0, 0, 0, 0, $tw, $th, $w, $h);

    imagejpeg($thumb, $destPath, 82);

    imagedestroy($src);
    imagedestroy($thumb);
}
