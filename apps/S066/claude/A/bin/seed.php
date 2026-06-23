<?php

declare(strict_types=1);

/*
 * Optional demo data seeder.
 *   php bin/seed.php
 * Creates a sample agent and a few listings. Safe to run once on a fresh DB.
 */

require __DIR__ . '/../src/Database.php';
require __DIR__ . '/../src/Auth.php';
require __DIR__ . '/../src/Helpers.php';
require __DIR__ . '/../src/Listings.php';

use App\Auth;
use App\Database;
use App\Listings;

$pdo = Database::pdo();

$email = 'agent@example.com';
$exists = $pdo->prepare('SELECT id FROM agents WHERE email = ?');
$exists->execute([$email]);
$agentId = $exists->fetchColumn();

if (!$agentId) {
    $agentId = Auth::register('Sample Agent', $email, '+1 555 0100', 'password');
    echo "Created agent: {$email} / password\n";
} else {
    echo "Agent {$email} already exists.\n";
}

$samples = [
    ['title' => 'Sunny 2-Bed Apartment Downtown', 'description' => "Bright corner unit with floor-to-ceiling windows, hardwood floors, and a modern kitchen. Walking distance to cafes and transit.", 'price' => 320000, 'location' => 'Austin, TX', 'address' => '120 Main St', 'bedrooms' => 2, 'bathrooms' => 1, 'area_sqft' => 950, 'property_type' => 'Apartment'],
    ['title' => 'Family Home with Garden', 'description' => "Spacious 4-bedroom house on a quiet street. Large backyard, double garage, and a renovated kitchen. Great schools nearby.", 'price' => 615000, 'location' => 'Denver, CO', 'address' => '88 Oak Avenue', 'bedrooms' => 4, 'bathrooms' => 3, 'area_sqft' => 2400, 'property_type' => 'House'],
    ['title' => 'Modern Studio Loft', 'description' => "Stylish open-plan studio in a converted warehouse. Exposed brick, high ceilings, and rooftop access.", 'price' => 189000, 'location' => 'Portland, OR', 'address' => '5 River Rd', 'bedrooms' => 1, 'bathrooms' => 1, 'area_sqft' => 600, 'property_type' => 'Condo'],
    ['title' => 'Lakeside Townhouse', 'description' => "Three-story townhouse with lake views, attached garage, and community pool access.", 'price' => 449000, 'location' => 'Austin, TX', 'address' => '22 Lakeview Ct', 'bedrooms' => 3, 'bathrooms' => 2, 'area_sqft' => 1800, 'property_type' => 'Townhouse'],
];

foreach ($samples as $s) {
    Listings::create((int) $agentId, $s);
    echo "  + {$s['title']}\n";
}

echo "Done. Visit http://127.0.0.1:5066/\n";
