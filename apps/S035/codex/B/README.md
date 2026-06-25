# Secure Habit Tracker

A Node.js/Express habit tracker where users can register, log in, create daily habits, mark them complete, and view current streaks. Data is stored in SQLite.

## Run locally on port 5035

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file:

   ```bash
   PORT=5035
   SESSION_SECRET=replace-with-a-long-random-secret
   DATABASE_PATH=./data/habits.sqlite
   COOKIE_SECURE=false
   ```

   `COOKIE_SECURE=false` is only for local HTTP development. In production, omit it or set `COOKIE_SECURE=true` and serve the app over HTTPS.

3. Start the app:

   ```bash
   npm start
   ```

4. Open `http://localhost:5035`.

## Security notes

The app uses parameterized SQL queries, bcrypt password hashing, CSRF protection on state-changing routes, input validation and sanitization, EJS output escaping, ownership checks for habit actions, secure HTTP headers, rate limiting, and generic error responses.
