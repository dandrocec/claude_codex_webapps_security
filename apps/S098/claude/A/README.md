# Collaborative Editor

A real-time collaborative document editor built with Node.js, Express, Socket.IO,
and SQLite. Users register, create documents, invite collaborators with **view**
or **edit** rights, and edit shared documents that update live for everyone
currently viewing them.

## Features

- **Accounts** — register / log in (session cookies, bcrypt-hashed passwords).
- **Documents** — create, list, and open your own and shared documents.
- **Access control** — the owner invites collaborators by username and grants
  `view` or `edit` rights; access can be revoked at any time.
- **Real-time sync** — edits broadcast over WebSockets to everyone viewing the
  document; view-only users see live updates but cannot type.
- **Access list** — each document shows exactly who can see/edit it.
- **Persistence** — users, documents, permissions, and sessions are stored in
  SQLite files on disk.

## Requirements

- Node.js 18 or newer (includes npm).

## Run locally

```bash
npm install
npm start
```

Then open **http://localhost:5098** in your browser.

> The server listens on port **5098** by default. To use another port:
> `PORT=4000 npm start` (PowerShell: `$env:PORT=4000; npm start`).

## Try the collaboration

1. Open http://localhost:5098 and **register** a user (e.g. `alice`).
2. Create a document and start typing.
3. In a second browser (or an incognito window), register another user
   (e.g. `bob`).
4. As `alice`, open the document, enter `bob` in **Invite a collaborator**,
   choose **Can edit** or **Can view**, and click **Invite**.
5. As `bob`, reload — the shared document appears in the sidebar. Open it and
   watch edits sync live between the two windows.

## Project layout

| File | Purpose |
|------|---------|
| `server.js` | Express app, REST API, and Socket.IO real-time layer. |
| `db.js` | SQLite connection and schema (users, documents, permissions). |
| `access.js` | Role resolution and access-list helpers. |
| `public/` | Front-end (HTML, CSS, vanilla-JS client). |

## Data files

Created automatically on first run (safe to delete to reset state):

- `data.sqlite` — application data.
- `sessions.sqlite` — login sessions.

## Notes

- Real-time editing broadcasts the full document content on each change; this is
  intentionally simple and reliable for the scope of this app rather than an
  operational-transform / CRDT merge engine.
- Set a strong `SESSION_SECRET` environment variable for any non-local use.
