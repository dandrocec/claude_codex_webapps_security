# File Sharing App

A minimal Node.js / Express app where logged-in users upload files and see a list of
**their own** uploads with download links. File bytes are stored on disk; metadata
(owner, original name, size, timestamp) lives in a SQLite database.

## Features

- Register / log in / log out (passwords hashed with bcrypt, sessions persisted to SQLite)
- Upload files (up to 50 MB each) via the browser
- Per-user file list — you only ever see and download your own files
- Download and delete your files
- No external services required: SQLite + local disk

## Tech stack

- **Express** — web server and routing
- **express-session** + **connect-sqlite3** — login sessions
- **multer** — multipart file uploads to disk
- **better-sqlite3** — file & user metadata
- **bcryptjs** — password hashing
- **EJS** — server-rendered views

## Requirements

- Node.js 18 or newer (uses the built-in `node:crypto` / `fs` APIs and `node --watch`)
- npm

> `better-sqlite3` is a native module. On most systems `npm install` fetches a prebuilt
> binary. If your platform has no prebuild, you'll need build tools (on Windows install the
> "Desktop development with C++" workload, on macOS install Xcode CLT, on Linux install
> `build-essential` + `python3`).

## Run it locally on port 5045

```bash
# 1. install dependencies
npm install

# 2. start the server (listens on port 5045 by default)
npm start
```

Then open <http://localhost:5045> in your browser.

1. Click **Register** and create an account.
2. Upload a file from the dashboard.
3. It appears in **Your files** with a download link.

To run with auto-restart on file changes during development:

```bash
npm run dev
```

## Configuration

Environment variables (all optional):

| Variable         | Default            | Purpose                              |
| ---------------- | ------------------ | ------------------------------------ |
| `PORT`           | `5045`             | Port the server listens on           |
| `SESSION_SECRET` | `dev-secret-...`   | Secret used to sign session cookies  |

Example:

```bash
# macOS / Linux
SESSION_SECRET="a-long-random-string" npm start

# Windows (PowerShell)
$env:SESSION_SECRET="a-long-random-string"; npm start
```

## Where things are stored

| Path          | Contents                                  |
| ------------- | ----------------------------------------- |
| `uploads/`    | The raw uploaded file bytes               |
| `data/app.db` | Users + file metadata (SQLite)            |
| `data/sessions.db` | Login sessions                       |

Both directories are created automatically on first run and are git-ignored.

## Project layout

```
server.js              Express app, routes, auth, upload handling
db.js                  SQLite connection + schema
views/                 EJS templates (login, register, files, partials)
uploads/               Uploaded files (created at runtime)
data/                  SQLite databases (created at runtime)
```

## Notes / limitations

This is a compact demo. For production you'd want HTTPS (and `cookie.secure`), CSRF
protection on the forms, rate limiting on login, and an object store (e.g. S3) instead of
local disk. Access control is enforced: every download/delete query is scoped to the
logged-in user's `user_id`, so users cannot reach each other's files.
