# Secure Polls

A Node.js/Express polling app with account registration, poll creation, one vote per poll, live result updates, and SQLite persistence.

## Run locally on port 5043

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file:

   ```bash
   PORT=5043
   SESSION_SECRET=replace-with-a-long-random-secret
   COOKIE_SECRET=replace-with-another-long-random-secret
   DATABASE_FILE=./data/polls.sqlite
   COOKIE_SECURE=false
   ```

   Use `COOKIE_SECURE=true` with HTTPS or behind a trusted TLS-terminating proxy in production.

3. Start the app:

   ```bash
   npm start
   ```

4. Open `http://localhost:5043`.

## Security notes

The app uses bcrypt password hashing, parameterised SQLite queries, server-side input validation, EJS output escaping, CSRF tokens on state-changing requests, owner checks for poll deletion, hardened session cookie settings, Helmet security headers, rate limiting, and generic error responses.
