<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Auth;
use App\Csrf;
use App\Listings;
use App\Uploads;

final class AgentController
{
    public function __construct()
    {
        Auth::requireAgent();
    }

    public function dashboard(): void
    {
        $agentId = (int) Auth::id();
        view('agent/dashboard', [
            'title'     => 'My listings',
            'listings'  => Listings::forAgent($agentId),
            'inquiries' => Listings::inquiriesForAgent($agentId),
        ]);
    }

    public function createForm(): void
    {
        view('agent/form', [
            'title'   => 'New listing',
            'listing' => null,
            'photos'  => [],
            'action'  => '/listing/new',
        ]);
    }

    public function create(): void
    {
        Csrf::requireValid();
        $data = $this->validateListing();

        $id = Listings::create((int) Auth::id(), $data);
        $this->handlePhotoUploads($id);

        flash('success', 'Listing created.');
        redirect('/listing/edit?id=' . $id);
    }

    public function editForm(): void
    {
        $listing = $this->ownedListingOr404((int) ($_GET['id'] ?? 0));
        view('agent/form', [
            'title'   => 'Edit listing',
            'listing' => $listing,
            'photos'  => Listings::photos((int) $listing['id']),
            'action'  => '/listing/edit',
        ]);
    }

    public function update(): void
    {
        Csrf::requireValid();
        $listing = $this->ownedListingOr404((int) ($_POST['id'] ?? 0));
        $data = $this->validateListing();

        Listings::update((int) $listing['id'], $data);
        $this->handlePhotoUploads((int) $listing['id']);

        flash('success', 'Listing updated.');
        redirect('/listing/edit?id=' . $listing['id']);
    }

    public function delete(): void
    {
        Csrf::requireValid();
        $listing = $this->ownedListingOr404((int) ($_POST['id'] ?? 0));

        // Remove photo files first, then the row (cascade clears photo rows).
        foreach (Listings::photos((int) $listing['id']) as $photo) {
            Uploads::delete((string) $photo['filename']);
        }
        Listings::delete((int) $listing['id']);

        flash('success', 'Listing deleted.');
        redirect('/dashboard');
    }

    public function deletePhoto(): void
    {
        Csrf::requireValid();
        $photoId = (int) ($_POST['photo_id'] ?? 0);
        $photo = $photoId > 0 ? Listings::findPhoto($photoId) : null;
        if ($photo === null) {
            view('errors/404', ['title' => 'Not found'], 404);
        }

        // IDOR guard: the photo's listing must belong to the current agent.
        $this->ownedListingOr404((int) $photo['listing_id']);

        Uploads::delete((string) $photo['filename']);
        Listings::deletePhoto($photoId);

        flash('success', 'Photo removed.');
        redirect('/listing/edit?id=' . $photo['listing_id']);
    }

    // ---- helpers -----------------------------------------------------------

    /**
     * Fetch a listing and enforce that the logged-in agent owns it.
     * Returns 403/404 (without leaking which) otherwise.
     *
     * @return array<string,mixed>
     */
    private function ownedListingOr404(int $id): array
    {
        $listing = $id > 0 ? Listings::find($id) : null;
        if ($listing === null) {
            view('errors/404', ['title' => 'Not found'], 404);
        }
        if ((int) $listing['agent_id'] !== (int) Auth::id()) {
            view('errors/403', ['title' => 'Forbidden'], 403);
        }
        return $listing;
    }

    /**
     * @return array<string,mixed>
     */
    private function validateListing(): array
    {
        $title = clean_text($_POST['title'] ?? '', 120);
        $description = clean_text($_POST['description'] ?? '', 4000);
        $location = clean_text($_POST['location'] ?? '', 120);
        $priceRaw = $_POST['price'] ?? '';
        $beds = (int) ($_POST['bedrooms'] ?? 0);
        $baths = (int) ($_POST['bathrooms'] ?? 0);
        $area = (int) ($_POST['area_sqm'] ?? 0);

        $errors = [];
        if ($title === '') {
            $errors[] = 'Title is required.';
        }
        if ($location === '') {
            $errors[] = 'Location is required.';
        }
        if (!is_numeric($priceRaw) || (int) $priceRaw < 0) {
            $errors[] = 'Price must be a non-negative number.';
        }
        $price = is_numeric($priceRaw) ? (int) $priceRaw : 0;
        if ($beds < 0 || $beds > 100) {
            $errors[] = 'Bedrooms is out of range.';
        }
        if ($baths < 0 || $baths > 100) {
            $errors[] = 'Bathrooms is out of range.';
        }
        if ($area < 0 || $area > 1000000) {
            $errors[] = 'Area is out of range.';
        }

        if ($errors) {
            foreach ($errors as $err) {
                flash('error', $err);
            }
            $back = isset($_POST['id']) && (int) $_POST['id'] > 0
                ? '/listing/edit?id=' . (int) $_POST['id']
                : '/listing/new';
            redirect($back);
        }

        return [
            'title'       => $title,
            'description' => $description,
            'price'       => $price,
            'location'    => $location,
            'bedrooms'    => $beds,
            'bathrooms'   => $baths,
            'area_sqm'    => $area,
        ];
    }

    private function handlePhotoUploads(int $listingId): void
    {
        if (empty($_FILES['photos']) || !is_array($_FILES['photos']['name'])) {
            return;
        }

        $names = $_FILES['photos']['name'];
        $count = count($names);
        $stored = 0;
        $maxPerRequest = 10;

        for ($i = 0; $i < $count && $stored < $maxPerRequest; $i++) {
            $error = $_FILES['photos']['error'][$i] ?? UPLOAD_ERR_NO_FILE;
            if ($error === UPLOAD_ERR_NO_FILE) {
                continue;
            }

            $file = [
                'name'     => $_FILES['photos']['name'][$i] ?? '',
                'type'     => $_FILES['photos']['type'][$i] ?? '',
                'tmp_name' => $_FILES['photos']['tmp_name'][$i] ?? '',
                'error'    => $error,
                'size'     => $_FILES['photos']['size'][$i] ?? 0,
            ];

            [$ok, $result] = Uploads::store($file);
            if ($ok) {
                // Derive mime from the canonical extension we assigned.
                $ext = pathinfo($result, PATHINFO_EXTENSION);
                $mime = match ($ext) {
                    'jpg' => 'image/jpeg',
                    'png' => 'image/png',
                    'webp' => 'image/webp',
                    'gif' => 'image/gif',
                    default => 'application/octet-stream',
                };
                Listings::addPhoto($listingId, $result, $mime);
                $stored++;
            } else {
                flash('error', 'A photo was rejected: ' . $result);
            }
        }
    }
}
