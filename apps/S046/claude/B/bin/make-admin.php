<?php
declare(strict_types=1);

/**
 * Grant admin (moderation) rights to an existing user.
 *
 *   php bin/make-admin.php <username>
 *
 * Register the account through the web UI first, then run this to promote it.
 */

require dirname(__DIR__) . '/src/bootstrap.php';

use App\Database;

$username = $argv[1] ?? null;
if ($username === null || trim($username) === '') {
    fwrite(STDERR, "Usage: php bin/make-admin.php <username>\n");
    exit(1);
}

$pdo  = Database::connection();
$stmt = $pdo->prepare('UPDATE users SET is_admin = 1 WHERE username = :u');
$stmt->execute([':u' => trim($username)]);

if ($stmt->rowCount() === 0) {
    fwrite(STDERR, "No user named '{$username}' found. Register the account first.\n");
    exit(1);
}

fwrite(STDOUT, "User '{$username}' is now an admin.\n");
