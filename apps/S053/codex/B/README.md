# Secure Express Portfolio

A Node.js/Express portfolio site with a public project grid and an authenticated owner dashboard for creating, editing, and deleting projects. Data is stored in SQLite.

## Run locally on port 5053

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file:
   ```bash
   PORT=5053
   NODE_ENV=development
   COOKIE_SECURE=false
   SESSION_SECRET=replace-with-at-least-32-random-characters
   OWNER_EMAIL=owner@example.com
   OWNER_PASSWORD=change-this-password
   DATABASE_PATH=./data/portfolio.sqlite
   ```
3. Start the app:
   ```bash
   npm start
   ```
4. Open `http://localhost:5053`.

The first startup creates the owner account from `OWNER_EMAIL` and `OWNER_PASSWORD` if no user exists. Use `COOKIE_SECURE=false` only for local HTTP development; leave it enabled behind HTTPS in production.
