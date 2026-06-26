# Secure Document Management

A Node.js/Express document-management system with folders, document uploads, sharing to users or groups, edit/view permissions, version history, and restore support.

## Run Locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Set `SESSION_SECRET` to a long random value. For local HTTP testing, keep `COOKIE_SECURE=false`; set it to `true` behind HTTPS.
3. Start the app on port 5088:
   ```bash
   npm start
   ```
4. Open `http://localhost:5088`.

SQLite data is stored in `data/app.sqlite`. Uploaded file blobs are stored in `storage/uploads` under server-generated random names and are only served through authorized download routes.
