'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');

const { Deals, Contacts } = require('../models');
const { STAGES } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const STAGE_KEYS = STAGES.map((s) => s.key);
const isManager = (req) => req.user.role === 'manager';

const dealRules = [
  body('title').trim().notEmpty().withMessage('Title is required.').isLength({ max: 150 }),
  body('amount').trim().optional({ values: 'falsy' })
    .isFloat({ min: 0, max: 1_000_000_000 }).withMessage('Amount must be a positive number.'),
  body('stage').trim().isIn(STAGE_KEYS).withMessage('Invalid stage.'),
  body('contact_id').trim().optional({ values: 'falsy' })
    .isInt({ min: 1 }).withMessage('Invalid contact.'),
];

// Convert a dollars string into integer cents; validate ownership of contact.
function buildPayload(req) {
  const amountCents = Math.round(Number(req.body.amount || 0) * 100);
  let contactId = null;
  if (req.body.contact_id) {
    // Only allow linking to a contact the user owns.
    const owned = Contacts.getOwned(Number(req.body.contact_id), req.user.id);
    contactId = owned ? owned.id : null;
  }
  return {
    title: req.body.title,
    amount: amountCents,
    stage: req.body.stage,
    contact_id: contactId,
  };
}

// Pipeline board — deals grouped by stage.
router.get('/', (req, res) => {
  const deals = Deals.list(req.user.id, isManager(req));
  const columns = STAGES.map((stage) => ({
    ...stage,
    deals: deals.filter((d) => d.stage === stage.key),
  }));
  res.render('deals/board', { title: 'Pipeline', columns, stages: STAGES });
});

// New form
router.get('/new', (req, res) => {
  const contacts = Contacts.list(req.user.id, false); // own contacts only
  res.render('deals/form', {
    title: 'New deal',
    deal: { stage: 'lead' },
    amountValue: '',
    contacts,
    stages: STAGES,
    errors: [],
    action: '/deals',
  });
});

// Create
router.post('/', dealRules, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const contacts = Contacts.list(req.user.id, false);
    return res.status(400).render('deals/form', {
      title: 'New deal',
      deal: req.body,
      amountValue: req.body.amount || '',
      contacts,
      stages: STAGES,
      errors: errors.array(),
      action: '/deals',
    });
  }
  Deals.create({ owner_id: req.user.id, ...buildPayload(req) });
  res.redirect('/deals');
});

// Edit form — owner only.
router.get('/:id/edit', (req, res) => {
  const id = Number(req.params.id);
  const deal = Deals.getOwned(id, req.user.id);
  if (!deal) return notFound(res);
  const contacts = Contacts.list(req.user.id, false);
  res.render('deals/form', {
    title: 'Edit deal',
    deal,
    amountValue: (deal.amount / 100).toFixed(2),
    contacts,
    stages: STAGES,
    errors: [],
    action: `/deals/${deal.id}`,
  });
});

// Update — owner only.
router.post('/:id', dealRules, (req, res) => {
  const id = Number(req.params.id);
  const existing = Deals.getOwned(id, req.user.id);
  if (!existing) return notFound(res);

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const contacts = Contacts.list(req.user.id, false);
    return res.status(400).render('deals/form', {
      title: 'Edit deal',
      deal: { ...req.body, id },
      amountValue: req.body.amount || '',
      contacts,
      stages: STAGES,
      errors: errors.array(),
      action: `/deals/${id}`,
    });
  }
  Deals.update({ id, owner_id: req.user.id, ...buildPayload(req) });
  res.redirect('/deals');
});

// Move a deal to another stage (board drag/drop or buttons) — owner only.
router.post('/:id/stage', [body('stage').trim().isIn(STAGE_KEYS)], (req, res) => {
  const id = Number(req.params.id);
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).render('error', {
      title: 'Invalid request',
      message: 'Invalid pipeline stage.',
    });
  }
  const result = Deals.updateStage(id, req.user.id, req.body.stage);
  if (result.changes === 0) return notFound(res);
  res.redirect('/deals');
});

// Delete — owner only.
router.post('/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  const result = Deals.remove(id, req.user.id);
  if (result.changes === 0) return notFound(res);
  res.redirect('/deals');
});

function notFound(res) {
  return res.status(404).render('error', {
    title: 'Not found',
    message: 'That deal does not exist or you do not have access to it.',
  });
}

module.exports = router;
