'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');

const {
  createBookmark,
  listBookmarks,
  getOwnedBookmark,
  updateOwnedBookmark,
  deleteOwnedBookmark,
} = require('../models');
const { normalizeTags, tagsToArray, collectTags } = require('../lib/tags');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Everything below requires an authenticated user.
router.use(requireAuth);

// Validation shared by create and update.
const bookmarkRules = [
  body('title')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Title is required (max 200 characters).'),
  body('url')
    .trim()
    .isLength({ max: 2048 })
    .withMessage('URL is too long.')
    // Only allow http/https URLs -> blocks javascript:, data:, etc. (XSS/SSRF).
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('Enter a valid http(s) URL.'),
  body('tags')
    .optional({ values: 'falsy' })
    .isLength({ max: 500 })
    .withMessage('Tags are too long.'),
];

const idRule = param('id')
  .isInt({ min: 1 })
  .withMessage('Invalid bookmark id.')
  .toInt();

// ---- List (with optional ?tag= filter) ------------------------------------

router.get('/', (req, res) => {
  const all = listBookmarks(req.user.id);
  const allTags = collectTags(all);

  // Filter by tag in the application layer against the user's own rows only.
  const filterTag = typeof req.query.tag === 'string' ? req.query.tag.trim().toLowerCase() : '';
  const bookmarks = filterTag
    ? all.filter((b) => tagsToArray(b.tags).includes(filterTag))
    : all;

  res.render('bookmarks/index', {
    bookmarks,
    allTags,
    filterTag,
    tagsToArray,
  });
});

// ---- New / Create ---------------------------------------------------------

router.get('/new', (req, res) => {
  res.render('bookmarks/new', { errors: [], values: {} });
});

router.post('/', bookmarkRules, (req, res) => {
  const errors = validationResult(req);
  const values = {
    title: req.body.title,
    url: req.body.url,
    tags: req.body.tags,
  };

  if (!errors.isEmpty()) {
    return res.status(400).render('bookmarks/new', {
      errors: errors.array().map((e) => e.msg),
      values,
    });
  }

  createBookmark({
    userId: req.user.id,
    title: values.title.trim(),
    url: values.url.trim(),
    tags: normalizeTags(values.tags),
  });

  res.redirect('/bookmarks');
});

// ---- Edit / Update --------------------------------------------------------

router.get('/:id/edit', idRule, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.redirect('/bookmarks');

  // Owner-scoped fetch => an id belonging to someone else yields nothing (IDOR).
  const bookmark = getOwnedBookmark(req.params.id, req.user.id);
  if (!bookmark) return res.status(404).render('404');

  res.render('bookmarks/edit', { errors: [], bookmark, values: bookmark });
});

router.post('/:id', idRule, bookmarkRules, (req, res) => {
  const errors = validationResult(req);
  const id = req.params.id;

  if (!errors.isEmpty()) {
    const bookmark = getOwnedBookmark(id, req.user.id);
    if (!bookmark) return res.status(404).render('404');
    return res.status(400).render('bookmarks/edit', {
      errors: errors.array().map((e) => e.msg),
      bookmark,
      values: { id, title: req.body.title, url: req.body.url, tags: req.body.tags },
    });
  }

  const ok = updateOwnedBookmark({
    id,
    userId: req.user.id,
    title: req.body.title.trim(),
    url: req.body.url.trim(),
    tags: normalizeTags(req.body.tags),
  });

  if (!ok) return res.status(404).render('404');
  res.redirect('/bookmarks');
});

// ---- Delete ---------------------------------------------------------------

router.post('/:id/delete', idRule, (req, res) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    deleteOwnedBookmark(req.params.id, req.user.id);
  }
  res.redirect('/bookmarks');
});

module.exports = router;
