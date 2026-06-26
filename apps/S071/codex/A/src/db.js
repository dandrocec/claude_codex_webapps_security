const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'auction.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS auctions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    seller_name TEXT NOT NULL,
    starting_price_cents INTEGER NOT NULL CHECK (starting_price_cents >= 1),
    end_time TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    auction_id INTEGER NOT NULL,
    bidder_name TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 1),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_bids_auction_amount ON bids(auction_id, amount_cents DESC, created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_auctions_end_time ON auctions(end_time);
`);

const auctionCount = db.prepare('SELECT COUNT(*) AS count FROM auctions').get().count;

if (auctionCount === 0) {
  const insertAuction = db.prepare(`
    INSERT INTO auctions (title, description, seller_name, starting_price_cents, end_time)
    VALUES (@title, @description, @sellerName, @startingPriceCents, @endTime)
  `);

  const insertBid = db.prepare(`
    INSERT INTO bids (auction_id, bidder_name, amount_cents)
    VALUES (?, ?, ?)
  `);

  const now = Date.now();
  const first = insertAuction.run({
    title: 'Walnut Writing Desk',
    description: 'A compact restored desk with two drawers and a satin finish.',
    sellerName: 'Mira Studio',
    startingPriceCents: 12500,
    endTime: new Date(now + 1000 * 60 * 60 * 12).toISOString()
  });

  const second = insertAuction.run({
    title: 'Vintage Field Camera',
    description: 'Bellows are intact, lens is clean, and the body shows honest wear.',
    sellerName: 'Northlight Finds',
    startingPriceCents: 9000,
    endTime: new Date(now + 1000 * 60 * 60 * 30).toISOString()
  });

  const third = insertAuction.run({
    title: 'Signed Ceramic Vase',
    description: 'Hand-thrown stoneware vase with ash glaze and maker mark.',
    sellerName: 'Cedar Market',
    startingPriceCents: 4500,
    endTime: new Date(now - 1000 * 60 * 60 * 2).toISOString()
  });

  insertBid.run(first.lastInsertRowid, 'Iris', 14500);
  insertBid.run(first.lastInsertRowid, 'Jon', 17250);
  insertBid.run(second.lastInsertRowid, 'Lea', 10100);
  insertBid.run(third.lastInsertRowid, 'Noah', 5200);
}

module.exports = db;
