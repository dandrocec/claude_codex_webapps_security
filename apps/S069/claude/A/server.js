'use strict';

const path = require('path');
const express = require('express');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5069;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------------- helpers ------------------------------- */

// Make currency + progress helpers available to every template.
app.locals.formatMoney = (cents) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function loadCampaign(id) {
  const campaign = db
    .prepare('SELECT * FROM campaigns WHERE id = ?')
    .get(id);
  if (!campaign) return null;

  const { raised, backers } = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS raised,
              COUNT(*)                       AS backers
         FROM pledges WHERE campaign_id = ?`
    )
    .get(id);

  const pct = campaign.goal_cents > 0
    ? Math.min(100, Math.round((raised / campaign.goal_cents) * 100))
    : 0;
  const daysLeft = Math.ceil(
    (new Date(campaign.deadline) - new Date()) / (1000 * 60 * 60 * 24)
  );

  return {
    ...campaign,
    raised,
    backers,
    pct,
    daysLeft,
    expired: daysLeft < 0,
    funded: raised >= campaign.goal_cents,
  };
}

// Parse a dollar string like "25" or "25.50" into integer cents.
function dollarsToCents(value) {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/* -------------------------------- routes ------------------------------- */

// Home: list all campaigns with progress.
app.get('/', (req, res) => {
  const ids = db.prepare('SELECT id FROM campaigns ORDER BY created_at DESC').all();
  const campaigns = ids.map((row) => loadCampaign(row.id));
  res.render('index', { campaigns });
});

// Form to create a new campaign.
app.get('/campaigns/new', (req, res) => {
  res.render('new', { error: null, form: {} });
});

// Create a campaign.
app.post('/campaigns', (req, res) => {
  const { title, creator, description, goal, deadline } = req.body;
  const goalCents = dollarsToCents(goal);

  if (!title || !creator || !goalCents || !deadline) {
    return res.status(400).render('new', {
      error: 'Title, creator, a positive goal, and a deadline are all required.',
      form: req.body,
    });
  }

  const info = db
    .prepare(
      `INSERT INTO campaigns (title, creator, description, goal_cents, deadline)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(title.trim(), creator.trim(), (description || '').trim(), goalCents, deadline);

  res.redirect(`/campaigns/${info.lastInsertRowid}`);
});

// Campaign detail page.
app.get('/campaigns/:id', (req, res) => {
  const campaign = loadCampaign(req.params.id);
  if (!campaign) return res.status(404).render('404');

  const pledges = db
    .prepare(
      'SELECT * FROM pledges WHERE campaign_id = ? ORDER BY created_at DESC'
    )
    .all(campaign.id);

  res.render('campaign', { campaign, pledges, error: null });
});

// Back a campaign (create a pledge).
app.post('/campaigns/:id/pledge', (req, res) => {
  const campaign = loadCampaign(req.params.id);
  if (!campaign) return res.status(404).render('404');

  const { backer, amount } = req.body;
  const amountCents = dollarsToCents(amount);

  if (!backer || !amountCents) {
    const pledges = db
      .prepare('SELECT * FROM pledges WHERE campaign_id = ? ORDER BY created_at DESC')
      .all(campaign.id);
    return res.status(400).render('campaign', {
      campaign,
      pledges,
      error: 'Please enter your name and a positive pledge amount.',
    });
  }

  if (campaign.expired) {
    const pledges = db
      .prepare('SELECT * FROM pledges WHERE campaign_id = ? ORDER BY created_at DESC')
      .all(campaign.id);
    return res.status(400).render('campaign', {
      campaign,
      pledges,
      error: 'This campaign has ended and is no longer accepting pledges.',
    });
  }

  db.prepare(
    'INSERT INTO pledges (campaign_id, backer, amount_cents) VALUES (?, ?, ?)'
  ).run(campaign.id, backer.trim(), amountCents);

  res.redirect(`/campaigns/${campaign.id}`);
});

app.use((req, res) => res.status(404).render('404'));

app.listen(PORT, () => {
  console.log(`Crowdfund running at http://localhost:${PORT}`);
});
