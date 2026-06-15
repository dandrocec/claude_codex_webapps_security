<?php

declare(strict_types=1);

namespace App\Controllers;

use App\ContactRepository;
use App\Database;
use App\Flash;
use App\Http;
use App\Validator;
use App\View;

final class ContactController
{
    private ContactRepository $contacts;

    public function __construct()
    {
        $this->contacts = new ContactRepository(Database::connection());
    }

    public function index(array $query): void
    {
        $userId = Http::requireAuth();

        $search = Validator::str($query, 'q') ?? '';
        if (mb_strlen($search) > 255) {
            $search = mb_substr($search, 0, 255);
        }

        $contacts = $this->contacts->forUser($userId, $search);

        echo View::render('contacts/index', [
            'title' => 'My Contacts',
            'contacts' => $contacts,
            'search' => $search,
        ]);
    }

    public function create(): void
    {
        Http::requireAuth();

        echo View::render('contacts/form', [
            'title' => 'Add contact',
            'mode' => 'create',
            'action' => '/contacts',
            'errors' => [],
            'contact' => ['id' => null, 'name' => '', 'email' => '', 'phone' => '', 'address' => ''],
        ]);
    }

    public function store(array $post): void
    {
        $userId = Http::requireAuth();
        Http::assertCsrf($post);

        $v = $this->validate($post);

        if ($v->fails()) {
            echo View::render('contacts/form', [
                'title' => 'Add contact',
                'mode' => 'create',
                'action' => '/contacts',
                'errors' => $v->errors(),
                'contact' => $this->oldContact($post, null),
            ], 422);

            return;
        }

        $this->contacts->create($userId, $v->clean());
        Flash::set('success', 'Contact added.');
        Http::redirect('/contacts');
    }

    public function edit(array $query): void
    {
        $userId = Http::requireAuth();

        $id = Http::intParam($query, 'id');
        $contact = $id !== null ? $this->contacts->find($id, $userId) : null;

        if ($contact === null) {
            $this->notFound();

            return;
        }

        echo View::render('contacts/form', [
            'title' => 'Edit contact',
            'mode' => 'edit',
            'action' => '/contacts/update',
            'errors' => [],
            'contact' => $contact,
        ]);
    }

    public function update(array $post): void
    {
        $userId = Http::requireAuth();
        Http::assertCsrf($post);

        $id = Http::intParam($post, 'id');
        if ($id === null || $this->contacts->find($id, $userId) === null) {
            $this->notFound();

            return;
        }

        $v = $this->validate($post);

        if ($v->fails()) {
            echo View::render('contacts/form', [
                'title' => 'Edit contact',
                'mode' => 'edit',
                'action' => '/contacts/update',
                'errors' => $v->errors(),
                'contact' => $this->oldContact($post, $id),
            ], 422);

            return;
        }

        $this->contacts->update($id, $userId, $v->clean());
        Flash::set('success', 'Contact updated.');
        Http::redirect('/contacts');
    }

    public function destroy(array $post): void
    {
        $userId = Http::requireAuth();
        Http::assertCsrf($post);

        $id = Http::intParam($post, 'id');
        if ($id === null || !$this->contacts->delete($id, $userId)) {
            $this->notFound();

            return;
        }

        Flash::set('success', 'Contact deleted.');
        Http::redirect('/contacts');
    }

    private function validate(array $post): Validator
    {
        $v = new Validator();
        $v->require('name', Validator::str($post, 'name'), 'Name', 255);
        $v->email('email', Validator::str($post, 'email'), 'Email', false, 255);
        $v->phone('phone', Validator::str($post, 'phone'), 'Phone', 64);
        $v->optional('address', Validator::str($post, 'address'), 'Address', 1000);

        return $v;
    }

    /** @return array<string, mixed> */
    private function oldContact(array $post, ?int $id): array
    {
        return [
            'id' => $id,
            'name' => Validator::str($post, 'name') ?? '',
            'email' => Validator::str($post, 'email') ?? '',
            'phone' => Validator::str($post, 'phone') ?? '',
            'address' => Validator::str($post, 'address') ?? '',
        ];
    }

    private function notFound(): void
    {
        echo View::render('error', [
            'title' => 'Not found',
            'heading' => 'Contact not found',
            'message' => 'That contact does not exist or you do not have access to it.',
        ], 404);
    }
}
