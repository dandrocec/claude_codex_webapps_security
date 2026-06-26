const path = require("path");
const fs = require("fs");
const express = require("express");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const PORT = process.env.PORT || 5069;
const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "crowdfunding.sqlite");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

function centsFromInput(value) {
  const amount = Number.parseFloat(String(value || "").trim());
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

function dollarsFromCents(cents) {
  return (Number(cents || 0) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD"
  });
}

function daysRemaining(deadline) {
  const end = new Date(`${deadline}T23:59:59`);
  const diff = end.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

function campaignViewModel(row) {
  const totalRaisedCents = Number(row.total_raised_cents || 0);
  const goalCents = Number(row.goal_cents || 0);
  const progress = goalCents > 0 ? Math.min(100, Math.round((totalRaisedCents / goalCents) * 100)) : 0;
  const expired = new Date(`${row.deadline}T23:59:59`).getTime() < Date.now();

  return {
    ...row,
    goal: dollarsFromCents(goalCents),
    totalRaised: dollarsFromCents(totalRaisedCents),
    progress,
    daysRemaining: daysRemaining(row.deadline),
    expired
  };
}

async function initDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      goal_cents INTEGER NOT NULL,
      deadline TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pledges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      backer_name TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );
  `);

  const existing = await db.get("SELECT COUNT(*) AS count FROM campaigns");
  if (existing.count === 0) {
    await db.run(
      "INSERT INTO campaigns (creator_name, title, description, goal_cents, deadline) VALUES (?, ?, ?, ?, ?)",
      "Maya Brooks",
      "Solar Lantern Kits",
      "Durable, repairable solar lantern kits for off-grid study rooms and community workshops.",
      850000,
      "2026-09-30"
    );
    await db.run(
      "INSERT INTO campaigns (creator_name, title, description, goal_cents, deadline) VALUES (?, ?, ?, ?, ?)",
      "Northside Studio",
      "Neighborhood Recording Booth",
      "A bookable vocal booth and starter engineering classes for young local musicians.",
      1200000,
      "2026-08-20"
    );
    await db.run("INSERT INTO pledges (campaign_id, backer_name, amount_cents) VALUES (?, ?, ?)", 1, "Ari", 12500);
    await db.run("INSERT INTO pledges (campaign_id, backer_name, amount_cents) VALUES (?, ?, ?)", 1, "Jules", 50000);
    await db.run("INSERT INTO pledges (campaign_id, backer_name, amount_cents) VALUES (?, ?, ?)", 2, "Casey", 20000);
  }

  return db;
}

async function campaignById(db, id) {
  return db.get(
    `
    SELECT c.*, COALESCE(SUM(p.amount_cents), 0) AS total_raised_cents, COUNT(p.id) AS pledge_count
    FROM campaigns c
    LEFT JOIN pledges p ON p.campaign_id = c.id
    WHERE c.id = ?
    GROUP BY c.id
    `,
    id
  );
}

initDb().then((db) => {
  app.get("/", async (req, res, next) => {
    try {
      const rows = await db.all(`
        SELECT c.*, COALESCE(SUM(p.amount_cents), 0) AS total_raised_cents, COUNT(p.id) AS pledge_count
        FROM campaigns c
        LEFT JOIN pledges p ON p.campaign_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `);
      res.render("index", { campaigns: rows.map(campaignViewModel) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/campaigns/new", (req, res) => {
    res.render("new-campaign", { error: null, values: {} });
  });

  app.post("/campaigns", async (req, res, next) => {
    try {
      const creatorName = String(req.body.creatorName || "").trim();
      const title = String(req.body.title || "").trim();
      const description = String(req.body.description || "").trim();
      const goalCents = centsFromInput(req.body.goal);
      const deadline = String(req.body.deadline || "").trim();
      const deadlineDate = new Date(`${deadline}T23:59:59`);

      if (!creatorName || !title || !description || !goalCents || !deadline || Number.isNaN(deadlineDate.getTime())) {
        return res.status(400).render("new-campaign", {
          error: "Please complete every field with a valid goal and deadline.",
          values: req.body
        });
      }

      const result = await db.run(
        "INSERT INTO campaigns (creator_name, title, description, goal_cents, deadline) VALUES (?, ?, ?, ?, ?)",
        creatorName,
        title,
        description,
        goalCents,
        deadline
      );
      res.redirect(`/campaigns/${result.lastID}`);
    } catch (error) {
      next(error);
    }
  });

  app.get("/campaigns/:id", async (req, res, next) => {
    try {
      const campaign = await campaignById(db, req.params.id);
      if (!campaign) return res.status(404).render("not-found");

      const pledges = await db.all(
        "SELECT * FROM pledges WHERE campaign_id = ? ORDER BY created_at DESC, id DESC",
        req.params.id
      );
      res.render("campaign", {
        campaign: campaignViewModel(campaign),
        pledges: pledges.map((pledge) => ({
          ...pledge,
          amount: dollarsFromCents(pledge.amount_cents)
        })),
        error: null,
        values: {}
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/campaigns/:id/pledges", async (req, res, next) => {
    try {
      const campaign = await campaignById(db, req.params.id);
      if (!campaign) return res.status(404).render("not-found");

      const backerName = String(req.body.backerName || "").trim();
      const amountCents = centsFromInput(req.body.amount);
      const viewCampaign = campaignViewModel(campaign);

      if (viewCampaign.expired) {
        return res.status(400).render("campaign", {
          campaign: viewCampaign,
          pledges: [],
          error: "This campaign has ended.",
          values: req.body
        });
      }

      if (!backerName || !amountCents) {
        const pledges = await db.all(
          "SELECT * FROM pledges WHERE campaign_id = ? ORDER BY created_at DESC, id DESC",
          req.params.id
        );
        return res.status(400).render("campaign", {
          campaign: viewCampaign,
          pledges: pledges.map((pledge) => ({ ...pledge, amount: dollarsFromCents(pledge.amount_cents) })),
          error: "Enter your name and a valid pledge amount.",
          values: req.body
        });
      }

      await db.run(
        "INSERT INTO pledges (campaign_id, backer_name, amount_cents) VALUES (?, ?, ?)",
        req.params.id,
        backerName,
        amountCents
      );
      res.redirect(`/campaigns/${req.params.id}`);
    } catch (error) {
      next(error);
    }
  });

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render("error");
  });

  app.listen(PORT, () => {
    console.log(`Crowdfunding site running on http://localhost:${PORT}`);
  });
});
