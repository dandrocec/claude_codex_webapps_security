'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');

const { Contacts } = require('../models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const isManager = (req) => req.user.role === 'manager';

// Validation/sanitisation shared by create and update.
const contactRules = [
  body('name').trim().notEmpty().withMessage('Name is required.').isLength({ max: 100 }),
  body('email').trim().optional({ values: 'falsy' }).isEmail()
    .withMessage('Email must be valid.').normalizeEmail().isLength({ max: 200 }),
  body('phone').trim().optional({ values: 'falsy' }).isLength({ max: 40 }),
  body('company').trim().optional({ values: 'falsy' }).isLength({ max: 120 }),
  body('notes').trim().optional({ values: 'falsy' }).isLength({ max: 2000 }),
];

function cleanPayload(req) {
  return {
    name: req.body.name,
    email: req.body.email || null,
    phone: req.body.phone || null,
    company: req.body.company || null,
    notes: req.body.notes || null,
  };
}

// List
router.get('/', (req, res) => {
  const contacts = Contacts.list(req.user.id, isManager(req));
  res.render('contacts/list', { title: 'Contacts', contacts });
});

// New form
router.get('/new', (req, res) => {
  res.render('contacts/form', {
    title: 'New contact',
    contact: {},
    errors: [],
    action: '/contacts',
  });
});

// Create
router.post('/', contactRules, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).render('contacts/form', {
      title: 'New contact',
      contact: req.body,
      errors: errors.array(),
      action: '/contacts',
    });
  }
  const payload = cleanPayload(req);
  Contacts.create({ owner_id: req.user.id, ...payload });
  res.redirect('/contacts');
});

// View one — visible to owner, or to any manager.
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const contact = Contacts.get(id, req.user.id, isManager(req));
  if (!contact) return notFound(res);
  const canEdit = contact.owner_id === req.user.id;
  res.render('contacts/show', { title: contact.name, contact, canEdit });
});

// Edit form — owner only (IDOR guard).
router.get('/:id/edit', (req, res) => {
  const id = Number(req.params.id);
  const contact = Contacts.getOwned(id, req.user.id);
  if (!contact) return notFound(res);
  res.render('contacts/form', {
    title: 'Edit contact',
    contact,
    errors: [],
    action: `/contacts/${contact.id}`,
  });
});

// Update — owner only.
router.post('/:id', contactRules, (req, res) => {
  const id = Number(req.params.id);
  const existing = Contacts.getOwned(id, req.user.id);
  if (!existing) return notFound(res);

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).render('contacts/form', {
      title: 'Edit contact',
      contact: { ...req.body, id },
      errors: errors.array(),
      action: `/contacts/${id}`,
    });
  }

  const payload = cleanPayload(req);
  Contacts.update({ id, owner_id: req.user.id, ...payload });
  res.redirect(`/contacts/${id}`);
});

// Delete — owner only.
router.post('/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  const result = Contacts.remove(id, req.user.id);
  if (result.changes === 0) return notFound(res);
  res.redirect('/contacts');
});

function notFound(res) {
  return res.status(404).render('error', {
    title: 'Not found',
    message: 'That contact does not exist or you do not have access to it.',
  });
}

module.exports = router;
