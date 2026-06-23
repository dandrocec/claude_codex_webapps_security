<?php
declare(strict_types=1);

/**
 * Promote (or demote) a user's role from the command line.
 *
 *   php bin/promote.php <username> [moderator|user]
 *
 * Defaults to "moderator". This avoids shipping any hardcoded privileged
 * credentials: register normally through the web UI, then promote here.
 */

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "This script can only be run from the command line.\n");
    exit(1);
}

require_once __DIR__ . '/../src/config.php';
require_once __DIR__ . '/../src/db.php';

$username = $argv[1] ?? null;
$role = $argv[2] ?? 'moderator';

if ($username === null || !in_array($role, ['moderator', 'user'], true)) {
    fwrite(STDERR, "Usage: php bin/promote.php <username> [moderator|user]\n");
    exit(1);
}

$stmt = db()->prepare('UPDATE users SET role = :role WHERE username = :u');
$stmt->execute([':role' => $role, ':u' => $username]);

if ($stmt->rowCount() === 0) {
    fwrite(STDERR, "No user found with username '{$username}'.\n");
    exit(1);
}

echo "User '{$username}' is now a {$role}.\n";
