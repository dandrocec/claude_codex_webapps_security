# Room Reservation System

A Node.js/Express application for booking room time slots with SQLite storage.

## Run locally on port 5059

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file:
   ```bash
   PORT=5059
   SESSION_SECRET=replace-with-a-long-random-secret
   DATABASE_FILE=./data/reservations.sqlite
   COOKIE_SECURE=false
   ```
   Use `COOKIE_SECURE=true` when serving over HTTPS.
3. Start the app:
   ```bash
   npm start
   ```
4. Open `http://localhost:5059`.

On first start, the app creates the database schema and sample rooms automatically.
