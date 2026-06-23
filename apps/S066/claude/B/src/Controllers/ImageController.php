<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Listings;
use App\Session;
use App\Uploads;

/**
 * Serves uploaded photos that are stored OUTSIDE the web root. Files are looked
 * up by database id; the on-disk name is never taken from the request, and the
 * resolved path is confined to the upload directory.
 */
final class ImageController
{
    public function show(): void
    {
        $id = (int) ($_GET['id'] ?? 0);
        $photo = $id > 0 ? Listings::findPhoto($id) : null;
        if ($photo === null) {
            $this->notFound();
        }

        $path = Uploads::pathFor((string) $photo['filename']);
        if ($path === null || !is_file($path)) {
            $this->notFound();
        }

        $mime = (string) $photo['mime'];
        $allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!in_array($mime, $allowed, true)) {
            $mime = 'application/octet-stream';
        }

        // Security headers; never let the browser sniff/execute this content.
        header('Content-Type: ' . $mime);
        header('X-Content-Type-Options: nosniff');
        header('Content-Disposition: inline');
        header('Content-Security-Policy: default-src \'none\'; sandbox');
        header('Cache-Control: private, max-age=86400');
        header('Content-Length: ' . (string) filesize($path));

        // Stream the file.
        $fp = fopen($path, 'rb');
        if ($fp !== false) {
            fpassthru($fp);
            fclose($fp);
        }
        exit;
    }

    private function notFound(): never
    {
        http_response_code(404);
        Session::sendSecurityHeaders();
        header('Content-Type: text/plain; charset=UTF-8');
        echo 'Image not found.';
        exit;
    }
}
