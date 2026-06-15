<?php
declare(strict_types=1);

/**
 * Self-contained smoke test (no web server needed). Uses a temporary SQLite
 * database and exercises the core data/security paths. Run:
 *
 *   php bin/smoke-test.php
 */

putenv('DB_DSN=sqlite::memory:');
$_SERVER['DB_DSN'] = 'sqlite::memory:';
putenv('APP_ENV=development');
$_SERVER['APP_ENV'] = 'development';

require dirname(__DIR__) . '/src/bootstrap.php';

use App\Auth;
use App\Database;
use App\Quote;

$pass = 0;
$failMsgs = [];
function check(bool $cond, string $label): void {
    global $pass, $failMsgs;
    if ($cond) { $pass++; echo "  ok  - $label\n"; }
    else { $failMsgs[] = $label; echo "FAIL  - $label\n"; }
}

// Build schema in the in-memory DB.
Database::connection()->exec(file_get_contents(APP_ROOT . '/schema.sql'));

echo "Auth & hashing\n";
[$ok, $err] = Auth::register('alice', 'supersecret');
check($ok, 'register valid user (' . ($err ?? 'no error') . ')');

[$ok2,] = Auth::register('al', 'supersecret');
check(!$ok2, 'reject too-short username');

[$ok3,] = Auth::register('bob', 'short');
check(!$ok3, 'reject too-short password');

[$ok4,] = Auth::register('alice', 'supersecret');
check(!$ok4, 'reject duplicate username');

$row = Database::connection()->query("SELECT password_hash FROM users WHERE username='alice'")->fetch();
check(is_array($row) && $row['password_hash'] !== 'supersecret', 'password stored as hash, not plaintext');
check(is_array($row) && password_verify('supersecret', $row['password_hash']), 'hash verifies with password_verify');

check(Auth::attempt('alice', 'supersecret'), 'login with correct credentials');
check(isset($_SESSION['user_id']), 'session user_id set after login');
$aliceId = (int) $_SESSION['user_id'];

echo "Quote validation\n";
[, $errs] = Quote::validate(['text' => '', 'author' => '']);
check(isset($errs['text'], $errs['author']), 'empty text+author rejected');

[$data,] = Quote::validate(['text' => "  hi\nthere  ", 'author' => '  Mark   Twain ']);
check($data['author'] === 'Mark Twain', 'author whitespace normalised');

[, $errLong] = Quote::validate(['text' => str_repeat('x', Quote::MAX_TEXT + 1), 'author' => 'X']);
check(isset($errLong['text']), 'over-long text rejected');

echo "Quote lifecycle & access control\n";
$qid = Quote::create($aliceId, 'Be excellent.', 'Bill');
check($qid > 0, 'create quote');
check(Quote::approved() === [], 'unapproved quote hidden from public list');

// Register a second user (bob) and ensure IDOR protection.
Auth::register('bob2', 'supersecret');
Auth::attempt('bob2', 'supersecret');
$bobId = (int) $_SESSION['user_id'];
check(!Quote::updateOwned($qid, $bobId, 'hacked', 'mallory'), 'IDOR: non-owner cannot update quote');
$still = Quote::find($qid);
check($still['text'] === 'Be excellent.', 'quote text unchanged after IDOR attempt');

check(Quote::updateOwned($qid, $aliceId, 'Be excellent to each other.', 'Bill & Ted'), 'owner can update own quote');

// Approve and verify it appears + filtering works.
Quote::setApproved($qid, true);
$pub = Quote::approved();
check(count($pub) === 1 && $pub[0]['author'] === 'Bill & Ted', 'approved quote appears publicly');
check(count(Quote::approved('Bill & Ted')) === 1, 'filter by matching author returns it');
check(Quote::approved('Nobody') === [], 'filter by unknown author returns nothing');
check(in_array('Bill & Ted', Quote::approvedAuthors(), true), 'approvedAuthors lists the author');

echo "\n";
if ($failMsgs === []) {
    echo "ALL $pass CHECKS PASSED\n";
    exit(0);
}
echo count($failMsgs) . " CHECK(S) FAILED\n";
exit(1);
