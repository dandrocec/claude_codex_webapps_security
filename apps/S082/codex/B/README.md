# Secure File Storage

Node.js/Express app for personal file uploads and revocable read-only share links.

## Run locally on port 5082

```bash
npm install
SESSION_SECRET="replace-with-a-long-random-secret" npm start
```

Open `http://localhost:5082`.

Optional environment variables:

- `PORT` defaults to `5082`
- `SESSION_SECRET` is required
- `DATABASE_PATH` defaults to `data/app.db`
- `UPLOAD_DIR` defaults to `data/uploads`
- `MAX_UPLOAD_BYTES` defaults to `5242880`
- `SECURE_COOKIES=true` enables HTTPS-only cookies for deployments behind TLS

The app stores metadata in SQLite and uploaded files on disk under server-generated names.
