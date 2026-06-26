# Secure Admin Dashboard

An Express and SQLite admin dashboard with bcrypt password hashing, CSRF protection, secure headers, input validation, parameterised SQL queries, and role-based access control.

## Run locally on port 5086

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file:
   ```bash
   PORT=5086
   SESSION_SECRET=replace-with-a-long-random-secret
   ADMIN_EMAIL=admin@example.com
   ADMIN_PASSWORD=replace-with-a-strong-password
   DATABASE_FILE=./data/app.sqlite
   NODE_ENV=development
   COOKIE_SECURE=false
   ```
3. Start the app:
   ```bash
   npm start
   ```
4. Open `http://localhost:5086` and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

For production, run behind HTTPS, set `NODE_ENV=production`, set `COOKIE_SECURE=true`, and use strong unique environment secrets.
