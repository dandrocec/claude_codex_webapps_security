<?php
// Standalone smoke test: verifies bootstrap/DB/seed and thumbnail generation
// without needing the web server. Run: php smoke_test.php
declare(strict_types=1);

require __DIR__ . '/src/bootstrap.php';
require __DIR__ . '/src/images.php';

echo "PHP " . PHP_VERSION . "\n";

// 1. DB + schema + seeded admin
$pdo = db();
$cols = $pdo->query("SELECT name FROM sqlite_master WHERE type='table'")->fetchAll(PDO::FETCH_COLUMN);
echo "Tables: " . implode(', ', $cols) . "\n";
$admin = $pdo->query("SELECT username FROM users")->fetchColumn();
echo "Seeded user: $admin\n";
$stmt = $pdo->prepare('SELECT password_hash FROM users WHERE username=?');
$stmt->execute(['admin']);
echo "Password 'admin123' verifies: " . (password_verify('admin123', $stmt->fetchColumn()) ? 'yes' : 'NO') . "\n";

// 2. Generate a source PNG, make a thumbnail through the real code path
$srcPath = sys_get_temp_dir() . '/gallery_src.png';
$im = imagecreatetruecolor(800, 600);
imagefilledrectangle($im, 0, 0, 800, 600, imagecolorallocate($im, 30, 120, 220));
imagepng($im, $srcPath);
imagedestroy($im);

$thumbPath = THUMB_DIR . '/_smoke_thumb.jpg';
make_thumbnail($srcPath, 'image/png', $thumbPath);
$info = getimagesize($thumbPath);
echo "Thumbnail created: {$info[0]}x{$info[1]} {$info['mime']} (longest edge should be <=" . THUMB_MAX . ")\n";

// cleanup test artifacts
unlink($srcPath);
unlink($thumbPath);
echo "OK\n";
