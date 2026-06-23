<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Csrf;
use App\Listings;

final class HomeController
{
    public function index(): void
    {
        $filters = $this->readFilters();
        $results = Listings::search($filters);

        view('listings/index', [
            'title'    => 'Find your next property',
            'listings' => $results,
            'filters'  => $filters,
        ]);
    }

    public function show(): void
    {
        $id = (int) ($_GET['id'] ?? 0);
        $listing = $id > 0 ? Listings::find($id) : null;
        if ($listing === null) {
            view('errors/404', ['title' => 'Listing not found'], 404);
        }

        $photos = Listings::photos($id);

        view('listings/show', [
            'title'   => (string) $listing['title'],
            'listing' => $listing,
            'photos'  => $photos,
        ]);
    }

    public function contact(): void
    {
        Csrf::requireValid();

        $id = (int) ($_POST['listing_id'] ?? 0);
        $listing = $id > 0 ? Listings::find($id) : null;
        if ($listing === null) {
            view('errors/404', ['title' => 'Listing not found'], 404);
        }

        $name = clean_text($_POST['sender_name'] ?? '', 80);
        $email = mb_strtolower(clean_text($_POST['sender_email'] ?? '', 190));
        $body = clean_text($_POST['body'] ?? '', 2000);

        $errors = [];
        if ($name === '') {
            $errors[] = 'Please enter your name.';
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors[] = 'Please enter a valid email address.';
        }
        if (mb_strlen($body) < 5) {
            $errors[] = 'Please enter a message.';
        }

        if ($errors) {
            foreach ($errors as $err) {
                flash('error', $err);
            }
            redirect('/listing?id=' . $id);
        }

        Listings::addInquiry($id, (int) $listing['agent_id'], $name, $email, $body);
        flash('success', 'Your message has been sent to the agent.');
        redirect('/listing?id=' . $id);
    }

    /**
     * @return array{q:string,location:string,min_price:?int,max_price:?int,beds:?int}
     */
    private function readFilters(): array
    {
        $minRaw = $_GET['min_price'] ?? '';
        $maxRaw = $_GET['max_price'] ?? '';
        $bedsRaw = $_GET['beds'] ?? '';

        return [
            'q'         => clean_text($_GET['q'] ?? '', 100),
            'location'  => clean_text($_GET['location'] ?? '', 100),
            'min_price' => is_numeric($minRaw) ? max(0, (int) $minRaw) : null,
            'max_price' => is_numeric($maxRaw) ? max(0, (int) $maxRaw) : null,
            'beds'      => is_numeric($bedsRaw) ? max(0, (int) $bedsRaw) : null,
        ];
    }
}
