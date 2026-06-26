# Express Auction Site

A small Node.js/Express auction application backed by SQLite. Sellers can list items with a starting price and end time, and buyers can place bids that must exceed the current highest bid. After an auction ends, the highest bidder is shown as the winner.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:5071`.

The app stores data in `data/auction.sqlite`, which is created automatically on startup.
