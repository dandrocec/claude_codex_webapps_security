# Secure Ticketing App

A Node.js/Express ticketing app where organisers create events with limited ticket inventory and signed-in users buy tickets until an event sells out. Purchases are stored in SQLite and each user can only view their own tickets.

## Run locally on port 5084

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a local environment file:
   ```bash
   cp .env.example .env
   ```
3. Set a strong `SESSION_SECRET` in `.env`.
4. Start the app:
   ```bash
   npm start
   ```
5. Open `http://localhost:5084`.

In production, run with `NODE_ENV=production` behind HTTPS so secure session cookies are enforced by browsers.
