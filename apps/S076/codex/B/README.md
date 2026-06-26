# Secure Express Chat

A Node.js/Express chat application with user registration, login, rooms, membership, and persisted ordered messages backed by SQLite.

## Run locally on port 5076

1. Install Node.js 20 or newer.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Set a session secret and start the app:

   ```bash
   SESSION_SECRET="replace-with-a-long-random-secret" PORT=5076 npm start
   ```

4. Open `http://localhost:5076`.

For production behind HTTPS, also set `COOKIE_SECURE=true` so session cookies include the `Secure` attribute. The database file defaults to `chat.sqlite`; override it with `DATABASE_PATH`.

## Security notes

The app uses bcrypt password hashing, parameterized SQLite queries, CSRF tokens on state-changing requests, server-side validation, EJS output escaping, Helmet security headers, HttpOnly/SameSite session cookies, membership checks for room access, and generic client-facing error messages.
