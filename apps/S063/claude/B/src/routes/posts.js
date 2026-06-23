'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');

const { posts } = require('../models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Create a post. Always attributed to the session user — never a client-supplied id.
router.post('/posts', requireAuth, [
  body('content')
    .trim()
    .isLength({ min: 1 }).withMessage('Post cannot be empty.')
    .isLength({ max: 280 }).withMessage('Post must be 280 characters or fewer.'),
], (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.session.flash = { type: 'error', message: errors.array()[0].msg };
      return res.redirect('/');
    }
    posts.create.run({ user_id: req.currentUser.id, content: req.body.content });
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

// Delete a post — access control: only the owner may delete (prevents IDOR).
router.post('/posts/:id/delete', requireAuth, [
  param('id').isInt({ min: 1 }),
], (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const e = new Error('Not found');
      e.status = 404; e.expose = true;
      return next(e);
    }
    const id = Number(req.params.id);
    const post = posts.byId.get(id);

    if (!post || post.user_id !== req.currentUser.id) {
      // Don't distinguish "missing" from "not yours" — both are 404.
      const e = new Error('Not found');
      e.status = 404; e.expose = true;
      return next(e);
    }

    // The DELETE statement is also scoped to user_id as defence in depth.
    posts.delete.run({ id, user_id: req.currentUser.id });
    req.session.flash = { type: 'success', message: 'Post deleted.' };
    res.redirect('back');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
