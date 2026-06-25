# Secure File Sharing App

Node.js/Express app where registered users upload files, view only their own uploads, and download or delete their own files. Metadata is stored in SQLite and file bytes are stored on disk under server-generated names.

## Run locally on port 5045

1. Install Node.js 20 or newer.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set a long random `SESSION_SECRET`.
4. Start the app:
   ```bash
   npm start
   ```
5. Open `http://localhost:5045`.

For local HTTP development, `.env.example` sets `COOKIE_SECURE=false` so browsers will keep the session cookie. In production, use HTTPS and set `COOKIE_SECURE=true`.

## Configuration

- `PORT`: HTTP port, defaults to `5045`.
- `SESSION_SECRET`: required, at least 32 characters.
- `COOKIE_SECURE`: set to `true` behind HTTPS; set to `false` only for local HTTP development.
- `DATABASE_PATH`: optional SQLite database path.
- `UPLOAD_DIR`: optional upload storage directory.
- `MAX_UPLOAD_BYTES`: optional maximum upload size in bytes, defaults to 5 MB.

Allowed uploads are PNG, JPEG, PDF, and plain text files. The server validates file content, enforces a size limit, stores files outside the static web directory, and checks ownership on all download and delete routes.
