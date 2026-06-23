'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');

const { users, posts, follows } = require('../models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// --- Profile settings (edit own bio only) ---------------------------------

router.get('/settings', requireAuth, (req, res) => {
  const user = users.byId.get(req.currentUser.id);
  res.render('settings', { errors: [], values: { bio: user.bio } });
});

router.post('/settings', requireAuth, [
  body('bio').trim().isLength({ max: 300 }).withMessage('Bio must be 300 characters or fewer.'),
], (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('settings', {
        errors: errors.array(), values: { bio: req.body.bio || '' },
      });
    }
    // Scoped to the session user's own id — cannot edit anyone else.
    users.updateBio.run({ id: req.currentUser.id, bio: req.body.bio });
    req.session.flash = { type: 'success', message: 'Profile updated.' };
    res.redirect('/u/' + encodeURIComponent(req.currentUser.username));
  } catch (err) {
    next(err);
  }
});

// --- Public profile page --------------------------------------------------

router.get('/u/:username', [
  param('username').trim().matches(/^[a-zA-Z0-9_]+$/),
], (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const e = new Error('Not found'); e.status = 404; e.expose = true;
      return next(e);
    }
    const profile = users.byUsername.get(req.params.username);
    if (!profile) {
      const e = new Error('Not found'); e.status = 404; e.expose = true;
      return next(e);
    }

    const me = req.currentUser;
    const isSelf = me && me.id === profile.id;
    const isFollowing = me && !isSelf
      ? !!follows.isFollowing.get(me.id, profile.id)
      : false;

    res.render('profile', {
      profile: { id: profile.id, username: profile.username, bio: profile.bio, created_at: profile.created_at },
      posts: posts.byUser.all(profile.id),
      isSelf,
      isFollowing,
      followers: follows.followerCount.get(profile.id).n,
      following: follows.followingCount.get(profile.id).n,
    });
  } catch (err) {
    next(err);
  }
});

// --- Follow / unfollow ----------------------------------------------------

function followTarget(req, res, next, action) {
  try {
    const target = users.byUsername.get(req.params.username);
    if (!target) {
      const e = new Error('Not found'); e.status = 404; e.expose = true;
      return next(e);
    }
    if (target.id === req.currentUser.id) {
      req.session.flash = { type: 'error', message: 'You cannot follow yourself.' };
      return res.redirect('back');
    }
    // follower_id is always the session user — you can only act for yourself.
    const args = { follower_id: req.currentUser.id, followee_id: target.id };
    if (action === 'follow') follows.follow.run(args);
    else follows.unfollow.run(args);

    res.redirect('/u/' + encodeURIComponent(target.username));
  } catch (err) {
    next(err);
  }
}

router.post('/u/:username/follow', requireAuth, (req, res, next) =>
  followTarget(req, res, next, 'follow'));

router.post('/u/:username/unfollow', requireAuth, (req, res, next) =>
  followTarget(req, res, next, 'unfollow'));

module.exports = router;
