<?php
declare(strict_types=1);

/**
 * Initialise the database schema. Safe to run repeatedly (idempotent).
 *
 *   php bin/init-db.php
 */

require dirname(__DIR__) . '/src/bootstrap.php';

use App\Database;

$schema = file_get_contents(APP_ROOT . '/schema.sql');
if ($schema === false) {
    fwrite(STDERR, "Could not read schema.sql\n");
    exit(1);
}

Database::connection()->exec($schema);

fwrite(STDOUT, "Database initialised successfully.\n");
fwrite(STDOUT, "Create an admin user with:  php bin/make-admin.php <username>\n");
