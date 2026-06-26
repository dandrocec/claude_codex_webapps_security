# Secure Movie Watchlist

A Node.js/Express movie watchlist with user registration, login, SQLite storage, per-user movie records, ratings, status filtering, CSRF protection, bcrypt password hashing, validation, and security headers.

## Run locally on port 5051

1. Install dependencies:

   ```bash
   npm install
   ```

2. Set required environment variables and start the server:

   ```bash
   SESSION_SECRET="replace-with-at-least-32-random-characters" PORT=5051 SESSION_COOKIE_SECURE=false npm start
   ```

3. Open `http://localhost:5051`.

For production, use HTTPS and set `SESSION_COOKIE_SECURE=true`. You can also set `DATABASE_PATH` to choose a SQLite database file path.
