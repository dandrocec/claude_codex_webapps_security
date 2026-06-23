<?php

declare(strict_types=1);

/**
 * Creates the database schema and (optionally) seeds demo data.
 *
 * Usage:
 *   php bin/init-db.php          # create schema + seed demo data if empty
 *   php bin/init-db.php --fresh  # delete the existing DB file first
 *   php bin/init-db.php --no-seed
 */

use App\Auth;
use App\Database;
use App\Env;

require dirname(__DIR__) . '/src/bootstrap.php';

$args    = $argv ?? [];
$fresh   = in_array('--fresh', $args, true);
$noSeed  = in_array('--no-seed', $args, true);

$dbPath = Env::get('DB_PATH', 'storage/marketplace.sqlite') ?? 'storage/marketplace.sqlite';
if (!preg_match('/^([A-Za-z]:[\\\\\\/]|[\\\\\\/])/', $dbPath)) {
    $dbPath = APP_ROOT . DIRECTORY_SEPARATOR . $dbPath;
}

if ($fresh && is_file($dbPath)) {
    unlink($dbPath);
    foreach (['-journal', '-wal', '-shm'] as $suffix) {
        if (is_file($dbPath . $suffix)) {
            unlink($dbPath . $suffix);
        }
    }
    fwrite(STDOUT, "Removed existing database.\n");
}

$pdo = Database::connection();

$schema = file_get_contents(APP_ROOT . '/database/schema.sql');
if ($schema === false) {
    fwrite(STDERR, "Could not read schema.sql\n");
    exit(1);
}
$pdo->exec($schema);
fwrite(STDOUT, "Schema ready.\n");

$count = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
if ($noSeed || $count > 0) {
    fwrite(STDOUT, $noSeed ? "Skipping seed (--no-seed).\n" : "Users already present; skipping seed.\n");
    exit(0);
}

/* ---- Seed demo data --------------------------------------------------------
 * Demo password for every seeded account: "Password123!"
 * Change these immediately in any real deployment.
 * -------------------------------------------------------------------------- */
$now = gmdate('c');
$demoPassword = 'Password123!';

$insertUser = $pdo->prepare(
    'INSERT INTO users (name, email, password_hash, role, created_at)
     VALUES (:name, :email, :hash, :role, :ts)'
);

$users = [
    ['Acme Tools',     'acme@vendor.test',  Auth::ROLE_VENDOR],
    ['Bloom & Co',     'bloom@vendor.test', Auth::ROLE_VENDOR],
    ['Dana Buyer',     'dana@buyer.test',   Auth::ROLE_BUYER],
];
$ids = [];
foreach ($users as [$name, $email, $role]) {
    $insertUser->execute([
        ':name'  => $name,
        ':email' => $email,
        ':hash'  => Auth::hash($demoPassword),
        ':role'  => $role,
        ':ts'    => $now,
    ]);
    $ids[$email] = (int) $pdo->lastInsertId();
}

$insertProduct = $pdo->prepare(
    'INSERT INTO products (vendor_id, name, description, price_cents, stock, created_at)
     VALUES (:vid, :name, :desc, :price, :stock, :ts)'
);

$products = [
    ['acme@vendor.test',  'Cordless Drill',   'Lightweight 18V cordless drill with two batteries.', 8999, 25],
    ['acme@vendor.test',  'Tape Measure 5m',  'Compact 5-metre tape measure with belt clip.',        799, 200],
    ['acme@vendor.test',  'Safety Goggles',   'Anti-fog impact-resistant safety goggles.',          1299, 150],
    ['bloom@vendor.test', 'Rose Bouquet',     'A dozen fresh long-stem red roses.',                 3499, 40],
    ['bloom@vendor.test', 'Succulent Trio',   'Three assorted potted succulents.',                  1899, 60],
    ['bloom@vendor.test', 'Watering Can 2L',  'Galvanised-steel 2-litre watering can.',             2299, 35],
];
foreach ($products as [$vendorEmail, $name, $desc, $price, $stock]) {
    $insertProduct->execute([
        ':vid'   => $ids[$vendorEmail],
        ':name'  => $name,
        ':desc'  => $desc,
        ':price' => $price,
        ':stock' => $stock,
        ':ts'    => $now,
    ]);
}

fwrite(STDOUT, "Seeded demo accounts and products.\n");
fwrite(STDOUT, "  Vendor:  acme@vendor.test  / {$demoPassword}\n");
fwrite(STDOUT, "  Vendor:  bloom@vendor.test / {$demoPassword}\n");
fwrite(STDOUT, "  Buyer:   dana@buyer.test   / {$demoPassword}\n");
