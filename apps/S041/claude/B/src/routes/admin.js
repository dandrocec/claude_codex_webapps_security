'use strict';

const express = require('express');
const { Faqs } = require('../models');
const { verifyCsrf, requireAuth } = require('../middleware/security');
const {
  faqValidators,
  idParam,
  reorderValidators,
  collectErrors,
} = require('../middleware/validators');

const router = express.Router();

// Every admin route requires an authenticated editor.
router.use(requireAuth);

// Dashboard: list ONLY the current editor's own FAQs (IDOR prevention).
router.get('/', (req, res) => {
  const items = Faqs.allForOwner(req.session.user.id);
  res.render('admin/dashboard', {
    title: 'Manage FAQs',
    items,
  });
});

// New FAQ form.
router.get('/faqs/new', (req, res) => {
  res.render('admin/faq-form', {
    title: 'Add FAQ',
    mode: 'create',
    action: '/admin/faqs',
    errors: null,
    faq: { question: '', answer: '', category: '' },
  });
});

// Create.
router.post('/faqs', verifyCsrf, faqValidators, (req, res) => {
  const errors = collectErrors(req);
  const { question, answer, category } = req.body;
  if (errors) {
    return res.status(400).render('admin/faq-form', {
      title: 'Add FAQ',
      mode: 'create',
      action: '/admin/faqs',
      errors,
      faq: { question, answer, category },
    });
  }
  Faqs.create({ question, answer, category, authorId: req.session.user.id });
  res.redirect('/admin');
});

// Edit form — only loads a row the editor owns.
router.get('/faqs/:id/edit', idParam, (req, res, next) => {
  if (collectErrors(req)) return next(); // bad id -> 404 handler
  const faq = Faqs.findOwned(req.params.id, req.session.user.id);
  if (!faq) {
    const err = new Error('Not found');
    err.status = 404;
    return next(err);
  }
  res.render('admin/faq-form', {
    title: 'Edit FAQ',
    mode: 'edit',
    action: `/admin/faqs/${faq.id}`,
    errors: null,
    faq,
  });
});

// Update — ownership enforced in the WHERE clause.
router.post('/faqs/:id', verifyCsrf, idParam, faqValidators, (req, res, next) => {
  const errors = collectErrors(req);
  const { question, answer, category } = req.body;
  if (errors) {
    return res.status(400).render('admin/faq-form', {
      title: 'Edit FAQ',
      mode: 'edit',
      action: `/admin/faqs/${req.params.id}`,
      errors,
      faq: { id: req.params.id, question, answer, category },
    });
  }
  const result = Faqs.update(req.params.id, req.session.user.id, {
    question,
    answer,
    category,
  });
  if (result.changes === 0) {
    const err = new Error('Not found');
    err.status = 404;
    return next(err);
  }
  res.redirect('/admin');
});

// Delete.
router.post('/faqs/:id/delete', verifyCsrf, idParam, (req, res, next) => {
  if (collectErrors(req)) {
    const err = new Error('Not found');
    err.status = 404;
    return next(err);
  }
  Faqs.delete(req.params.id, req.session.user.id);
  res.redirect('/admin');
});

// Reorder (move up/down within the editor's ordering).
router.post('/faqs/:id/reorder', verifyCsrf, reorderValidators, (req, res, next) => {
  if (collectErrors(req)) {
    const err = new Error('Bad request');
    err.status = 400;
    return next(err);
  }
  Faqs.reorder(req.params.id, req.session.user.id, req.body.direction);
  res.redirect('/admin');
});

module.exports = router;
