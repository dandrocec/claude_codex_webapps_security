# DocVault — Document Management System

A self-contained document-management application built with **Node.js + Express**.
Users register, upload documents into folders, share them with specific users or
groups (view / edit rights), and keep a full **version history** with the ability
to **restore** any previous version.

## Features

- **Authentication** — register / login with session cookies (passwords hashed with bcrypt).
- **Folders** — organise documents; folders can be nested.
- **Documents** — upload files; each upload is stored as an immutable version.
- **Version history** — every document keeps all versions; download any of them.
- **Non-destructive restore** — restoring an old version creates a new current
  version from it, so history is never lost.
- **Sharing** — grant `view` or `edit` to individual **users** or **groups**.
  Folder shares cascade to every document inside.
- **Groups** — create groups and manage their members; share once with a whole team.
- **Web UI** — a lightweight single-page front-end at `/` (no build step).

## How data is stored

| Data | Where |
|------|-------|
| Users, groups, folders, document metadata, versions, shares | **SQLite** database at `data/app.db` (via `better-sqlite3`) |
| Sessions | SQLite at `data/sessions.db` |
| Uploaded file contents | **Filesystem** under `storage/` (random names; original names kept in the DB) |

All of these directories are created automatically on first run.

## Requirements

- Node.js **18+** (uses the built-in fetch-free server; `better-sqlite3` ships a prebuilt binary for common platforms).

## Run it locally (port 5088)

```bash
npm install
npm start
```

Then open **http://localhost:5088**.

> The app listens on port **5088** by default. Override with `PORT=xxxx npm start` if needed.

### Optional: seed demo users

To try sharing quickly, create two demo accounts (`alice` / `password` and
`bob` / `password`):

```bash
npm run seed
```

Otherwise just click **Register** on the login screen to create accounts.

## Quick tour

1. Register or log in.
2. Create a folder in the left sidebar (optional) and select it.
3. Upload a document with the **Upload** form.
4. Click **History** on a document to see versions, download, or **restore** one.
5. Click **New version** (visible when you have edit rights) to upload an updated file.
6. Click **Share** on a document or folder to grant `view`/`edit` to a user or group.
7. Create a **Group**, add members, and share with the whole group at once.

## REST API (summary)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/auth/register` \| `/login` \| `/logout` | Auth |
| GET | `/api/auth/me` \| `/api/auth/users` | Current user / user directory |
| GET/POST | `/api/folders` | List / create folders |
| DELETE | `/api/folders/:id` | Delete a folder (owner only) |
| GET/POST | `/api/documents` | List / upload (creates first version) |
| POST | `/api/documents/:id/versions` | Upload a new version |
| GET | `/api/documents/:id/versions` | Version history |
| POST | `/api/documents/:id/restore/:versionId` | Restore a version |
| GET | `/api/documents/:id/download?versionId=` | Download (current or specific) |
| DELETE | `/api/documents/:id` | Delete a document (owner only) |
| GET/POST | `/api/groups`, `/api/groups/:id/members` | Groups & membership |
| GET/POST | `/api/shares/:resourceType/:resourceId` | List / grant shares |
| DELETE | `/api/shares/:id` | Revoke a share |

## Permission model

Effective permission on a document is the **strongest** of:

- document ownership → `edit`
- direct shares on the document (to you or a group you're in)
- shares on any ancestor folder (folder shares cascade down)
- ownership of any ancestor folder → `edit`

Ranking is `none < view < edit`. Only a resource's **owner** can manage its shares
or delete it.

## Project layout

```
src/
  server.js        Express app, sessions, static hosting, error handling
  db.js            SQLite connection + schema
  permissions.js   Effective-permission resolution
  middleware.js    requireAuth + async error wrapper
  routes/          auth, folders, documents, groups, shares
  seed.js          optional demo users
public/            index.html, app.js, style.css (front-end)
data/              SQLite databases (auto-created, git-ignored)
storage/           uploaded files          (auto-created, git-ignored)
```
