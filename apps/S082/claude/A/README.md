# File Vault

A small Node.js / Express file-storage app. Each user uploads files into their own
personal folder and can create **share links** that grant read-only access to one
specific file. Users can list and **revoke** their share links at any time.

- **Metadata** (users, files, shares) is stored in a SQLite database (`data/app.db`).
- **File contents** are stored on disk under `uploads/<userId>/`.

## Features

- Register / log in (sessions, bcrypt-hashed passwords)
- Upload files into a private per-user folder
- Download or delete your own files
- Create a share link for a single file (random, unguessable token)
- Public, read-only download via a share link — no account required
- List and revoke share links; revoking cuts off access immediately

## Requirements

- Node.js 18+ (developed on Node 24)
- npm

`better-sqlite3` ships prebuilt binaries for common platforms, so no database
server and, in most cases, no build toolchain are needed.

## Run locally on port 5082

```bash
npm install
npm start
```

Then open <http://localhost:5082>.

The app listens on port **5082** by default. To override:

```bash
PORT=5082 SESSION_SECRET="some-long-random-string" npm start
```

On Windows PowerShell:

```powershell
$env:PORT = "5082"; npm start
```

## How to use

1. Open <http://localhost:5082> and **Register** an account.
2. On **My Files**, upload a file. It lands in `uploads/<your-user-id>/`.
3. Click **Create share link** for a file, then open **Share Links**.
4. Copy the share URL (`/s/<token>`) and open it in a private window or share it —
   anyone with the link can download that one file, with no login.
5. Click **Revoke** to disable a link. The URL stops working immediately.

## Project layout

```
src/
  app.js              Express setup, sessions, route mounting, error handling
  db.js               SQLite connection + schema (users / files / shares)
  storage.js          Per-user upload folders, multer config, path-traversal guard
  auth.js             Session user loading + requireAuth middleware
  routes/
    accounts.js       register / login / logout
    files.js          upload / list / download / delete (owner only)
    shares.js         create / list / revoke + public /s/:token read access
views/                EJS templates
public/style.css      Styling
data/                 SQLite database (created at runtime, gitignored)
uploads/              Stored file blobs (created at runtime, gitignored)
```

## Security notes

- Passwords are hashed with bcrypt; sessions are HTTP-only cookies and the session
  id is regenerated on login (anti session-fixation).
- File ownership is enforced on every file/share action — you can only touch your
  own files and links.
- Stored filenames are random; the original name is kept only in the database.
  Resolved disk paths are validated to stay within the owner's folder
  (path-traversal guard).
- Share tokens are 24 random bytes (base64url), so links are unguessable.
- This is a local demo: set a strong `SESSION_SECRET` and run behind HTTPS
  (with a secure cookie) before using anything like it in production.
```
