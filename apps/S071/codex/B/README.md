# Secure Auction Site

Node.js/Express auction application with SQLite storage. Sellers can list items with a starting price and end time, buyers can bid above the current highest bid, and ended auctions show the winning bidder.

## Run locally on port 5071

1. Install dependencies:
   ```bash
   npm install
   ```
2. Set a strong session secret:
   ```bash
   $env:SESSION_SECRET="replace-with-at-least-32-random-characters"
   ```
3. Start the app:
   ```bash
   npm start
   ```
4. Open `https://localhost:5071`.

The app uses a self-signed HTTPS certificate generated at startup so Secure cookies work locally. Your browser may ask you to accept the local certificate warning.

Optional environment variables:

- `PORT` defaults to `5071`
- `DATABASE_PATH` defaults to `auction.sqlite`
- `BCRYPT_ROUNDS` defaults to `12`
- `SESSION_SECRET` is required and must not be hardcoded
