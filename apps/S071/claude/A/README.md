# Auction House

A small auction site built with **Node.js**, **Express**, and **SQLite**
(`better-sqlite3`). Sellers list items with a starting price and an end time;
buyers place bids that must exceed the current highest bid; once the end time
passes, the highest bidder wins.

## Features

- **List an item** — title, description, seller name, starting price, end time.
- **Place a bid** — must be at least the starting price (first bid) and strictly
  greater than the current highest bid thereafter. Bidding is rejected once the
  auction has ended.
- **Winner determination** — when an item's end time passes, the listing is
  marked *ended* and the highest bidder is shown as the winner.
- **Bid history** per item, with the current leader highlighted.
- Data is persisted in a local SQLite file (`auction.db`), created
  automatically on first run.

## Requirements

- Node.js 18 or newer (developed/tested on Node 24).
- npm (bundled with Node).

`better-sqlite3` ships prebuilt binaries for common platforms, so no separate
database server is needed.

## Run it locally (port 5071)

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start
```

Then open <http://localhost:5071> in your browser.

To use a different port: `PORT=3000 npm start`
(on Windows PowerShell: `$env:PORT=3000; npm start`).

For auto-reload during development: `npm run dev`.

## How it works

| Path                     | Method | Description                              |
| ------------------------ | ------ | ---------------------------------------- |
| `/`                      | GET    | Browse all auctions (open and ended)     |
| `/items/new`             | GET    | Form to list a new item                  |
| `/items`                 | POST   | Create a listing                         |
| `/items/:id`             | GET    | Item detail, bid history, and bid form   |
| `/items/:id/bids`        | POST   | Place a bid                              |

### Notes

- There is no login system — sellers and bidders simply type their name. This
  keeps the demo runnable while still attributing listings and bids.
- End times are entered in your browser's local timezone and stored internally
  as UTC, so they display correctly regardless of timezone.
- Bids are validated inside a database transaction that re-reads the current
  highest bid, so two simultaneous bids cannot both win the same amount.
- The SQLite database file (`auction.db`) is created in the project directory on
  first run. Delete it to reset all data.

## Project structure

```
server.js            Express app, routes, and bid validation
db.js                SQLite connection and schema
views/               EJS templates (index, item, new, 404, partials)
public/style.css     Styling
package.json         Dependencies and scripts
```
