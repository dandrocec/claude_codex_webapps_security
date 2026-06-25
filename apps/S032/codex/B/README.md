# Personal Expense Tracker

A Node.js/Express expense tracker with user accounts, bcrypt password hashing, CSRF protection, secure sessions, validation, parameterized SQLite queries, per-user access control, and security headers.

## Run locally on port 5032

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a session secret:
   ```bash
   cp .env.example .env
   ```
   Then replace `change-me...` with a long random value.
3. Start the app:
   ```bash
   npm start
   ```
4. Open `http://localhost:5032`.

SQLite database files are created automatically in the project directory. In production, set `NODE_ENV=production`, use HTTPS, and provide `SESSION_SECRET` from a secret manager or environment configuration.
