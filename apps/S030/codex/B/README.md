# Bookmark Manager

A Node.js/Express bookmark manager with user registration, login, per-user bookmarks, tag filtering, SQLite storage, CSRF protection, secure sessions, bcrypt password hashing, validation, and security headers.

## Run locally on port 5030

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local environment file:

   ```bash
   cp .env.example .env
   ```

3. Start the app:

   ```bash
   npm start
   ```

4. Open `http://localhost:5030`.

For local plain HTTP testing, `.env.example` sets `SESSION_COOKIE_SECURE=false` so browsers will accept the session cookie. In production, serve over HTTPS and set `SESSION_COOKIE_SECURE=true`.
