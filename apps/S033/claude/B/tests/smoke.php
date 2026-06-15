<?php

declare(strict_types=1);

/*
 * Standalone smoke test for the core data + validation layer.
 * Runs against a throwaway in-file SQLite database. No HTTP server needed.
 *
 *   php tests/smoke.php
 */

use App\Auth;
use App\ContactRepository;
use App\Database;
use App\UserRepository;
use App\Validator;

$root = dirname(__DIR__);

// Point the app at a temporary database before anything connects.
$tmpDb = sys_get_temp_dir() . '/addrbook_smoke_' . bin2hex(random_bytes(4)) . '.sqlite';
putenv('DB_DRIVER=sqlite');
putenv('DB_SQLITE_PATH=' . $tmpDb);
putenv('APP_KEY=test-key-not-for-production');

require $root . '/src/Env.php';
spl_autoload_register(static function (string $class) use ($root): void {
    if (!str_starts_with($class, 'App\\')) {
        return;
    }
    $file = $root . '/src/' . str_replace('\\', '/', substr($class, 4)) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

$passed = 0;
$failed = 0;
function check(string $label, bool $ok): void
{
    global $passed, $failed;
    echo ($ok ? "  PASS  " : "  FAIL  ") . $label . "\n";
    $ok ? $passed++ : $failed++;
}

try {
    $pdo = Database::connection();
    $users = new UserRepository($pdo);
    $contacts = new ContactRepository($pdo);

    // --- Passwords -------------------------------------------------------
    $hash = Auth::hashPassword('correct horse battery staple');
    check('password hash is not plaintext', $hash !== 'correct horse battery staple' && strlen($hash) > 40);
    check('password verify accepts correct', Auth::verifyPassword('correct horse battery staple', $hash));
    check('password verify rejects wrong', !Auth::verifyPassword('wrong', $hash));

    // --- Users -----------------------------------------------------------
    $alice = $users->create('Alice@Example.com', $hash);
    $bob = $users->create('bob@example.com', Auth::hashPassword('another-strong-pass'));
    check('user created with id', $alice > 0 && $bob > 0);
    check('email stored lowercased / found case-insensitively', $users->findByEmail('alice@EXAMPLE.com') !== null);
    check('emailExists true', $users->emailExists('bob@example.com'));
    check('emailExists false', !$users->emailExists('nobody@example.com'));

    // --- Contacts CRUD + scoping ----------------------------------------
    $c1 = $contacts->create($alice, ['name' => 'Carol Smith', 'email' => 'carol@x.com', 'phone' => '+1 555-0100', 'address' => "1 Main St\nApt 2"]);
    $contacts->create($alice, ['name' => 'Dave Jones', 'email' => '', 'phone' => '', 'address' => '']);
    $bobContact = $contacts->create($bob, ['name' => 'Eve Adams', 'email' => '', 'phone' => '', 'address' => '']);

    check('alice sees her 2 contacts', count($contacts->forUser($alice)) === 2);
    check('bob sees his 1 contact', count($contacts->forUser($bob)) === 1);

    // IDOR: bob must not read or mutate alice's contact.
    check('IDOR read blocked', $contacts->find($c1, $bob) === null);
    check('IDOR update blocked', $contacts->update($c1, $bob, ['name' => 'HACKED']) === false);
    check('IDOR delete blocked', $contacts->delete($c1, $bob) === false);
    check('owner can still read after IDOR attempts', ($contacts->find($c1, $alice)['name'] ?? '') === 'Carol Smith');

    // Search by name (case-insensitive, wildcard-safe).
    check('search finds by partial name', count($contacts->forUser($alice, 'carol')) === 1);
    check('search is scoped to user', count($contacts->forUser($bob, 'carol')) === 0);
    check('LIKE wildcard treated literally', count($contacts->forUser($alice, '%')) === 0);

    // Update + delete by owner.
    check('owner update works', $contacts->update($c1, $alice, ['name' => 'Carol S.', 'email' => 'c@x.com', 'phone' => '', 'address' => '']));
    check('owner delete works', $contacts->delete($bobContact, $bob));
    check('bob has 0 after delete', count($contacts->forUser($bob)) === 0);

    // --- Validator -------------------------------------------------------
    $v = new Validator();
    $v->require('name', '', 'Name')->email('email', 'not-an-email', 'Email');
    check('validator flags empty name + bad email', $v->fails() && count($v->errors()) === 2);

    $v2 = new Validator();
    $v2->require('name', 'Frank', 'Name')->email('email', 'frank@x.com', 'Email')->phone('phone', '+1 (555) 12-34', 'Phone');
    check('validator passes valid input', !$v2->fails() && $v2->value('email') === 'frank@x.com');

    $v3 = new Validator();
    $v3->phone('phone', 'DROP TABLE', 'Phone');
    check('validator rejects bad phone', $v3->fails());
} finally {
    if (isset($tmpDb) && is_file($tmpDb)) {
        @unlink($tmpDb);
    }
}

echo "\n$passed passed, $failed failed\n";
exit($failed === 0 ? 0 : 1);
