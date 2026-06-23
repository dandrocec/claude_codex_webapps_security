<?php

declare(strict_types=1);

/**
 * Seeds the database with a demo agent and a few listings so the site isn't
 * empty on first run. Safe to run multiple times (skips if the demo agent
 * already exists). Usage:  php bin/seed.php
 */

require \dirname(__DIR__) . '/src/bootstrap.php';

use App\Auth;
use App\Database;
use App\Listings;

$pdo = Database::pdo();

$demoEmail = 'agent@example.com';
$demoPassword = 'DemoAgent123!';

$stmt = $pdo->prepare('SELECT id FROM users WHERE email = :e');
$stmt->execute([':e' => $demoEmail]);
$existing = $stmt->fetchColumn();

if ($existing !== false) {
    fwrite(STDOUT, "Demo data already present (agent {$demoEmail}).\n");
    exit(0);
}

[$ok, $err] = Auth::register('Demo Agent', $demoEmail, $demoPassword);
if (!$ok) {
    fwrite(STDERR, "Failed to create demo agent: {$err}\n");
    exit(1);
}

$stmt = $pdo->prepare('SELECT id FROM users WHERE email = :e');
$stmt->execute([':e' => $demoEmail]);
$agentId = (int) $stmt->fetchColumn();

$samples = [
    ['Sunny 2-bed apartment near the park', 'Bright corner unit with balcony, recently renovated kitchen and hardwood floors.', 285000, 'Portland, OR', 2, 1, 78],
    ['Family home with large garden', 'Spacious 4-bedroom house, double garage, quiet cul-de-sac, great school district.', 540000, 'Austin, TX', 4, 3, 210],
    ['Downtown studio loft', 'Open-plan loft with high ceilings and city views. Walk to everything.', 199000, 'Chicago, IL', 0, 1, 45],
    ['Coastal cottage', 'Charming 3-bed cottage a short walk from the beach. Sold furnished.', 410000, 'San Diego, CA', 3, 2, 120],
    ['Modern townhouse', 'Energy-efficient townhouse with rooftop terrace and EV charging.', 365000, 'Denver, CO', 3, 2, 145],
];

foreach ($samples as $s) {
    Listings::create($agentId, [
        'title'       => $s[0],
        'description' => $s[1],
        'price'       => $s[2],
        'location'    => $s[3],
        'bedrooms'    => $s[4],
        'bathrooms'   => $s[5],
        'area_sqm'    => $s[6],
    ]);
}

fwrite(STDOUT, "Seeded " . count($samples) . " listings.\n");
fwrite(STDOUT, "Demo login:  {$demoEmail}  /  {$demoPassword}\n");
