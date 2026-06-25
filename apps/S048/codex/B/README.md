# Secure Feedback Portal

Node.js/Express feedback portal with SQLite storage. Visitors can submit categorized feedback with a rating and comment; authenticated reviewers can view all feedback in a sortable list.

## Run locally on port 5048

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create an environment file or export these variables:

   ```bash
   PORT=5048
   SESSION_SECRET=replace-with-at-least-32-random-characters
   REVIEWER_EMAIL=reviewer@example.com
   REVIEWER_PASSWORD=replace-with-a-strong-password
   COOKIE_SECURE=false
   ```

   `COOKIE_SECURE=false` is only for local HTTP development. Use secure cookies behind HTTPS in production.

3. Start the app:

   ```bash
   npm start
   ```

Open `http://localhost:5048`. The SQLite database is created automatically under `data/` unless `DB_PATH` is set.

## Security notes

The app uses parameterized SQLite queries, bcrypt password hashing, server-side validation, EJS output escaping, CSRF tokens on state-changing routes, reviewer-only access control, secure session settings, Helmet security headers, rate limiting on login, and generic client-facing error responses.
