'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');

const db = require('../db');
const { requireAuth } = require('../lib/auth');
const { centsToDisplay, dollarsToCents } = require('../lib/money');

const router = express.Router();

// ---- Prepared statements (parameterised — no string concatenation) ---------

const stmts = {
  listCampaigns: db.prepare(`
    SELECT c.id, c.title, c.goal_cents, c.deadline, u.display_name AS creator_name,
           COALESCE((SELECT SUM(amount_cents) FROM pledges WHERE campaign_id = c.id), 0) AS raised_cents
    FROM campaigns c
    JOIN users u ON u.id = c.creator_id
    ORDER BY c.created_at DESC
  `),
  getCampaign: db.prepare(`
    SELECT c.*, u.display_name AS creator_name
    FROM campaigns c
    JOIN users u ON u.id = c.creator_id
    WHERE c.id = ?
  `),
  raisedForCampaign: db.prepare(
    'SELECT COALESCE(SUM(amount_cents), 0) AS raised FROM pledges WHERE campaign_id = ?'
  ),
  recentPledges: db.prepare(`
    SELECT p.amount_cents, p.created_at, u.display_name AS backer_name
    FROM pledges p
    JOIN users u ON u.id = p.backer_id
    WHERE p.campaign_id = ?
    ORDER BY p.created_at DESC
    LIMIT 20
  `),
  insertCampaign: db.prepare(
    'INSERT INTO campaigns (creator_id, title, description, goal_cents, deadline) VALUES (?, ?, ?, ?, ?)'
  ),
  insertPledge: db.prepare(
    'INSERT INTO pledges (campaign_id, backer_id, amount_cents) VALUES (?, ?, ?)'
  ),
  deleteCampaign: db.prepare('DELETE FROM campaigns WHERE id = ? AND creator_id = ?'),
};

function decorate(campaign, raisedCents) {
  const goal = campaign.goal_cents;
  const pct = goal > 0 ? Math.min(100, Math.round((raisedCents / goal) * 100)) : 0;
  return {
    ...campaign,
    raised_display: centsToDisplay(raisedCents),
    goal_display: centsToDisplay(goal),
    raised_cents: raisedCents,
    percent: pct,
    expired: new Date(campaign.deadline + 'T23:59:59') < new Date(),
  };
}

// ---- List ------------------------------------------------------------------

router.get('/', (req, res) => {
  const campaigns = stmts.listCampaigns.all().map((c) => decorate(c, c.raised_cents));
  res.render('index', { campaigns });
});

// ---- New campaign form -----------------------------------------------------

router.get('/campaigns/new', requireAuth, (req, res) => {
  res.render('new-campaign', { errors: [], values: {} });
});

router.post(
  '/campaigns',
  requireAuth,
  body('title').trim().isLength({ min: 3, max: 120 }).withMessage('Title must be 3–120 characters.'),
  body('description')
    .trim()
    .isLength({ min: 10, max: 5000 })
    .withMessage('Description must be 10–5000 characters.'),
  body('goal').custom((v) => {
    if (dollarsToCents(v) === null) throw new Error('Goal must be a positive dollar amount.');
    return true;
  }),
  body('deadline')
    .isISO8601()
    .withMessage('Deadline must be a valid date.')
    .custom((v) => {
      if (new Date(v + 'T23:59:59') <= new Date()) throw new Error('Deadline must be in the future.');
      return true;
    }),
  (req, res, next) => {
    try {
      const errors = validationResult(req);
      const values = {
        title: req.body.title,
        description: req.body.description,
        goal: req.body.goal,
        deadline: req.body.deadline,
      };
      if (!errors.isEmpty()) {
        return res.status(400).render('new-campaign', { errors: errors.array(), values });
      }

      const result = stmts.insertCampaign.run(
        req.user.id,
        req.body.title,
        req.body.description,
        dollarsToCents(req.body.goal),
        req.body.deadline
      );
      res.redirect(`/campaigns/${result.lastInsertRowid}`);
    } catch (err) {
      next(err);
    }
  }
);

// ---- Campaign detail -------------------------------------------------------

router.get(
  '/campaigns/:id',
  param('id').isInt({ min: 1 }),
  (req, res, next) => {
    if (!validationResult(req).isEmpty()) return next(); // 404 via fall-through
    const campaign = stmts.getCampaign.get(req.params.id);
    if (!campaign) return next();

    const raised = stmts.raisedForCampaign.get(campaign.id).raised;
    const pledges = stmts.recentPledges.all(campaign.id).map((p) => ({
      ...p,
      amount_display: centsToDisplay(p.amount_cents),
    }));

    res.render('campaign', {
      campaign: decorate(campaign, raised),
      pledges,
      isOwner: req.user && req.user.id === campaign.creator_id,
      errors: [],
    });
  }
);

// ---- Pledge ----------------------------------------------------------------

router.post(
  '/campaigns/:id/pledge',
  requireAuth,
  param('id').isInt({ min: 1 }),
  body('amount').custom((v) => {
    if (dollarsToCents(v) === null) throw new Error('Pledge must be a positive dollar amount.');
    return true;
  }),
  (req, res, next) => {
    try {
      const campaign = stmts.getCampaign.get(req.params.id);
      if (!campaign) return next();

      const renderWithError = (msg) => {
        const raised = stmts.raisedForCampaign.get(campaign.id).raised;
        const pledges = stmts.recentPledges.all(campaign.id).map((p) => ({
          ...p,
          amount_display: centsToDisplay(p.amount_cents),
        }));
        return res.status(400).render('campaign', {
          campaign: decorate(campaign, raised),
          pledges,
          isOwner: req.user.id === campaign.creator_id,
          errors: [{ msg }],
        });
      };

      const errors = validationResult(req);
      if (!errors.isEmpty()) return renderWithError(errors.array()[0].msg);

      if (new Date(campaign.deadline + 'T23:59:59') < new Date()) {
        return renderWithError('This campaign has ended and no longer accepts pledges.');
      }
      if (campaign.creator_id === req.user.id) {
        return renderWithError('You cannot pledge to your own campaign.');
      }

      stmts.insertPledge.run(campaign.id, req.user.id, dollarsToCents(req.body.amount));
      res.redirect(`/campaigns/${campaign.id}`);
    } catch (err) {
      next(err);
    }
  }
);

// ---- Delete (owner only — prevents IDOR) -----------------------------------

router.post(
  '/campaigns/:id/delete',
  requireAuth,
  param('id').isInt({ min: 1 }),
  (req, res, next) => {
    if (!validationResult(req).isEmpty()) return next();
    // The WHERE clause ties the delete to the owning user; a non-owner deletes nothing.
    const info = stmts.deleteCampaign.run(req.params.id, req.user.id);
    if (info.changes === 0) {
      const err = new Error('Not found');
      err.status = 404;
      return next(err);
    }
    res.redirect('/');
  }
);

module.exports = router;
