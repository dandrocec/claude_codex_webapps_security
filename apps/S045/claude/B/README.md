# Secure File Share

A small file-sharing web app built with **Node.js + Express**. Authenticated
users upload files and see a private list of their own uploads with download
links. Files are stored on disk under server-generated random names; metadata
lives in a SQLite database.

The project deliberately uses only **pure-JavaScript dependencies** plus Node's
**built-in `node:sqlite`** module, so `npm install` never needs a native
compiler.

---

## Requirements

- **Node.js ≥ 22.5.0** (developed and intended for Node 22/24). The built-in
  `node:sqlite` module ships with these versions — no separate database to
  install.
- npm.

## Run it locally (port 5045)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env        # Windows PowerShell: copy .env.example .env

# 3. (Recommended) set a session secret in .env
#    Generate one with:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#    Paste the value into SESSION_SECRET= in .env
#    (If you skip this in development, a random secret is generated at startup
#     and sessions reset whenever you restart the server.)

# 4. Start the server
npm start
```

Then open **http://localhost:5045**. Create an account, sign in, and upload.

The database file and uploaded blobs are written under `./data/` (created
automatically and git-ignored). Delete that folder to reset all state.

> The port is read from `PORT` in `.env` and defaults to **5045**.

### Useful scripts

| Command         | Description                                  |
| --------------- | -------------------------------------------- |
| `npm start`     | Start the server.                            |
| `npm run dev`   | Start with `--watch` (auto-restart on edits).|

---

## What you can do

- **Register / sign in / sign out.**
- **Upload** a file (allow-list: PNG, JPEG, GIF, WEBP, PDF, or UTF-8 text;
  default max 10 MiB).
- **See only your own files**, with size and upload time.
- **Download** or **delete** your own files.

---

## Configuration (environment variables)

All configuration comes from the environment (see `.env.example`). No secrets
are hardcoded.

| Variable           | Default      | Purpose                                             |
| ------------------ | ------------ | --------------------------------------------------- |
| `PORT`             | `5045`       | Port to listen on.                                  |
| `SESSION_SECRET`   | _(required in production)_ | Secret used to sign session cookies.  |
| `NODE_ENV`         | `development`| `production` enables Secure cookies / HSTS, etc.    |
| `MAX_UPLOAD_BYTES` | `10485760`   | Maximum accepted upload size, in bytes.             |
| `DATA_DIR`         | `./data`     | Where the DB file and uploads are stored.           |

---

## Security design

This app follows OWASP Top 10 guidance throughout.

| Area | How it's handled |
| ---- | ---------------- |
| **SQL injection (A03)** | Every query uses **parameterised statements** (`?` placeholders) via `node:sqlite` prepared statements. No string concatenation of user data into SQL. |
| **Password storage (A02/A07)** | Passwords are hashed with **bcrypt** (`bcryptjs`, cost 12, per-password salt). Plaintext passwords are never stored or logged. |
| **XSS (A03)** | All dynamic values render through EJS `<%= %>` **auto-escaping** (context-aware HTML encoding). A strict **Content-Security-Policy** (no inline scripts) is set via Helmet. |
| **CSRF** | **Synchroniser-token** pattern: a per-session random token is required on every state-changing request (`POST`), verified with a constant-time comparison. Cookies are additionally `SameSite=Lax`. |
| **Access control / IDOR (A01)** | File lookups, downloads, and deletes are scoped to `owner_id = <current user>` **in the SQL WHERE clause**. Another user's id simply returns nothing (404). |
| **Session security (A05/A07)** | Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production. The session id is **regenerated on login** (anti session-fixation) and destroyed on logout. |
| **Security headers (A05)** | **Helmet** sets CSP, HSTS (prod), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `frame-ancestors 'none'`, etc. `X-Powered-By` is disabled. |
| **Error handling (A05)** | A central error handler logs full details server-side but returns only **generic messages** to clients. No stack traces or internals are leaked. |
| **Secrets (A05)** | All secrets/config come from **environment variables**; nothing sensitive is hardcoded. |
| **Brute force** | Authentication endpoints are **rate-limited** (plus a looser global limit). |

### File-upload hardening

| Control | Implementation |
| ------- | -------------- |
| **Type allow-list by content** | Uploads are buffered in memory and the **real file type is detected from magic bytes** (`src/lib/fileType.js`). The client-supplied filename and `Content-Type` are **not trusted**. Text files are validated as clean UTF-8. |
| **Size limit** | Enforced by Multer (`MAX_UPLOAD_BYTES`, default 10 MiB) before anything touches disk. |
| **Random storage names** | Files are written under a **server-generated random name** (`crypto.randomBytes`) plus the detected extension — never the user's filename. |
| **Path traversal** | The storage path is `path.basename`-stripped and re-checked to be **inside the upload directory**; writes use the exclusive `wx` flag. Downloads resolve the same way. |
| **No code execution** | Uploads live under `./data/uploads`, which is **never served as static or executable content**. Downloads are sent as `Content-Disposition: attachment` with `nosniff`, so browsers download rather than render them. |

---

## Project layout

```
.
├── package.json
├── .env.example
├── README.md
├── public/
│   └── styles.css            # the only static asset (no client JS)
├── views/                    # EJS templates (auto-escaped output)
│   ├── partials/ (header, footer)
│   ├── login.ejs  register.ejs  files.ejs  error.ejs
└── src/
    ├── server.js             # entry point
    ├── app.js                # Express wiring, security middleware
    ├── config.js             # environment-driven configuration
    ├── db.js                 # node:sqlite schema + prepared statements
    ├── middleware/ (auth, csrf, errors)
    ├── lib/ (fileType, validate)
    └── routes/ (auth, files)
```

## Notes & limitations

- The session store is the default in-memory store, which is fine for local
  development. For a real deployment, use a persistent session store (Redis,
  database, etc.) and run behind HTTPS with `NODE_ENV=production`.
- This is a focused demo; it intentionally omits features like email
  verification, password reset, and pagination.
