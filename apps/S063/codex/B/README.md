# Secure Social Express

A Node.js/Express social app where users register, create a profile, follow other users, post short status updates, and view a feed from people they follow. Data is stored in SQLite.

## Run locally on port 5063

1. Install dependencies:
   ```bash
   npm install
   ```
2. Set environment variables:
   ```bash
   SESSION_SECRET="replace-with-a-long-random-secret"
   PORT=5063
   COOKIE_SECURE=false
   ```
3. Start the app:
   ```bash
   npm start
   ```

Open `http://localhost:5063`.

For production behind HTTPS, set `NODE_ENV=production`, keep `COOKIE_SECURE=true`, use a strong `SESSION_SECRET`, and place the SQLite database in a persistent path with `DATABASE_FILE`.
