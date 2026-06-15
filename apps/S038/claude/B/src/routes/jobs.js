'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');

const { Jobs } = require('../models');
const { requireLogin } = require('../middleware');

const router = express.Router();

const jobValidationRules = [
  body('title').trim().isLength({ min: 1, max: 120 }).withMessage('Title is required (max 120 chars).'),
  body('company').trim().isLength({ min: 1, max: 120 }).withMessage('Company is required (max 120 chars).'),
  body('location').trim().isLength({ min: 1, max: 120 }).withMessage('Location is required (max 120 chars).'),
  body('description').trim().isLength({ min: 1, max: 5000 }).withMessage('Description is required (max 5000 chars).'),
];

function jobFromBody(req) {
  return {
    title: req.body.title.trim(),
    company: req.body.company.trim(),
    location: req.body.location.trim(),
    description: req.body.description.trim(),
  };
}

// --- Browse & search (public) ----------------------------------------------

router.get('/', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const jobs = Jobs.list(q);
  res.render('index', { jobs, q });
});

// --- Create -----------------------------------------------------------------

router.get('/jobs/new', requireLogin, (req, res) => {
  res.render('job-form', { mode: 'new', errors: [], values: {}, job: null });
});

router.post('/jobs', requireLogin, jobValidationRules, (req, res) => {
  const errors = validationResult(req);
  const values = jobFromBody(req);

  if (!errors.isEmpty()) {
    return res.status(400).render('job-form', {
      mode: 'new', errors: errors.array(), values, job: null,
    });
  }

  const id = Jobs.create({ user_id: req.session.user.id, ...values });
  req.session.flash = { type: 'success', message: 'Job listing posted.' };
  res.redirect(`/jobs/${id}`);
});

// --- Read (public) ----------------------------------------------------------

router.get('/jobs/:id', (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return next(); // 404

  const job = Jobs.findById(id);
  if (!job) return next(); // 404

  const isOwner = req.session.user && req.session.user.id === job.user_id;
  res.render('job-detail', { job, isOwner });
});

// --- Edit -------------------------------------------------------------------

router.get('/jobs/:id/edit', requireLogin, (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return next();

  const job = Jobs.findById(id);
  if (!job) return next();

  // Access control: only the owner may edit (prevents IDOR).
  if (job.user_id !== req.session.user.id) {
    const err = new Error('You are not allowed to edit this listing.');
    err.status = 403;
    return next(err);
  }

  res.render('job-form', { mode: 'edit', errors: [], values: job, job });
});

router.post('/jobs/:id', requireLogin, jobValidationRules, (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return next();

  const job = Jobs.findById(id);
  if (!job) return next();

  if (job.user_id !== req.session.user.id) {
    const err = new Error('You are not allowed to edit this listing.');
    err.status = 403;
    return next(err);
  }

  const errors = validationResult(req);
  const values = jobFromBody(req);

  if (!errors.isEmpty()) {
    return res.status(400).render('job-form', {
      mode: 'edit', errors: errors.array(), values: { ...values, id }, job,
    });
  }

  // The UPDATE is also scoped to user_id as a defence-in-depth check.
  Jobs.update(id, req.session.user.id, values);
  req.session.flash = { type: 'success', message: 'Listing updated.' };
  res.redirect(`/jobs/${id}`);
});

// --- Delete -----------------------------------------------------------------

router.post('/jobs/:id/delete', requireLogin, (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return next();

  const job = Jobs.findById(id);
  if (!job) return next();

  if (job.user_id !== req.session.user.id) {
    const err = new Error('You are not allowed to delete this listing.');
    err.status = 403;
    return next(err);
  }

  Jobs.remove(id, req.session.user.id);
  req.session.flash = { type: 'success', message: 'Listing deleted.' };
  res.redirect('/');
});

module.exports = router;
