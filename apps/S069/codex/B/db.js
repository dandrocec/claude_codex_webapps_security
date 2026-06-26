const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'crowdfunding.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 4 AND 120),
    description TEXT NOT NULL CHECK (length(description) BETWEEN 20 AND 2500),
    goal_cents INTEGER NOT NULL CHECK (goal_cents > 0),
    deadline TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pledges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    backer_id INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (backer_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_campaigns_creator ON campaigns(creator_id);
  CREATE INDEX IF NOT EXISTS idx_pledges_campaign ON pledges(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_pledges_backer ON pledges(backer_id);
`);

const campaignSelect = `
  SELECT
    c.*,
    u.name AS creator_name,
    COALESCE(SUM(p.amount_cents), 0) AS raised_cents,
    COUNT(p.id) AS pledge_count
  FROM campaigns c
  JOIN users u ON u.id = c.creator_id
  LEFT JOIN pledges p ON p.campaign_id = c.id
`;

module.exports = {
  createUser(name, email, passwordHash) {
    const stmt = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)');
    const result = stmt.run(name, email, passwordHash);
    return db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(result.lastInsertRowid);
  },

  getUserByEmail(email) {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  },

  listCampaigns() {
    return db.prepare(`
      ${campaignSelect}
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `).all();
  },

  getCampaign(id) {
    return db.prepare(`
      ${campaignSelect}
      WHERE c.id = ?
      GROUP BY c.id
    `).get(id);
  },

  createCampaign({ creatorId, title, description, goalCents, deadline }) {
    const stmt = db.prepare(`
      INSERT INTO campaigns (creator_id, title, description, goal_cents, deadline)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(creatorId, title, description, goalCents, deadline);
    return { id: result.lastInsertRowid };
  },

  deleteCampaignOwnedBy(id, creatorId) {
    const stmt = db.prepare('DELETE FROM campaigns WHERE id = ? AND creator_id = ?');
    return stmt.run(id, creatorId).changes > 0;
  },

  createPledge({ campaignId, backerId, amountCents }) {
    const stmt = db.prepare('INSERT INTO pledges (campaign_id, backer_id, amount_cents) VALUES (?, ?, ?)');
    return stmt.run(campaignId, backerId, amountCents);
  },

  listPledges(campaignId) {
    return db.prepare(`
      SELECT p.*, u.name AS backer_name
      FROM pledges p
      JOIN users u ON u.id = p.backer_id
      WHERE p.campaign_id = ?
      ORDER BY p.created_at DESC
    `).all(campaignId);
  }
};
