# Secure Q&A Site

A Node.js/Express question-and-answer app with user accounts, answers, one vote per answer per user, accepted answers, CSRF protection, secure headers, bcrypt password hashing, and SQLite persistence.

## Run locally on port 5065

1. Install dependencies:
   ```bash
   npm install
   ```
2. Set a session secret:
   ```bash
   set SESSION_SECRET=replace-with-a-long-random-secret
   ```
   On macOS/Linux:
   ```bash
   export SESSION_SECRET=replace-with-a-long-random-secret
   ```
3. Start the app:
   ```bash
   npm start
   ```
4. Open `http://localhost:5065`.

The app creates `data/qa.sqlite` automatically. Optional environment variables:

- `PORT`: defaults to `5065`
- `DATABASE_PATH`: defaults to `data/qa.sqlite`
- `SESSION_SECRET`: required in production; defaults only for local development
- `SESSION_COOKIE_SECURE`: set to `true` when serving over HTTPS
