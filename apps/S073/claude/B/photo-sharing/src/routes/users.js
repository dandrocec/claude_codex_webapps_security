'use strict';

const express = require('express');
const { param, validationResult } = require('express-validator');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const usernameParam = param('username').trim().matches(/^[a-zA-Z0-9_]{3,30}$/);

// List of all users (simple discovery page).
router.get('/users', (req, res) => {
  const users = db.prepare('SELECT username FROM users ORDER BY username ASC LIMIT 200').all();
  res.render('users', { title: 'People', users });
});

// Public profile + that user's photos.
router.get('/users/:username', usernameParam, (req, res, next) => {
  if (!validationResult(req).isEmpty()) {
    return next(Object.assign(new Error('User not found'), { status: 404, expose: true }));
  }

  const profile = db.prepare('SELECT id, username, created_at FROM users WHERE username = ?').get(req.params.username);
  if (!profile) return next(Object.assign(new Error('User not found'), { status: 404, expose: true }));

  const photos = db
    .prepare('SELECT id, filename, caption, created_at FROM photos WHERE user_id = ? ORDER BY created_at DESC')
    .all(profile.id);

  const counts = {
    photos: photos.length,
    followers: db.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?').get(profile.id).n,
    following: db.prepare('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?').get(profile.id).n,
  };

  const isFollowing = req.user
    ? !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(req.user.id, profile.id)
    : false;

  const isSelf = req.user && req.user.id === profile.id;

  res.render('profile', { title: profile.username, profile, photos, counts, isFollowing, isSelf });
});

// Follow / unfollow a user (acting only as oneself).
router.post('/users/:username/follow', requireAuth, usernameParam, (req, res, next) => {
  try {
    if (!validationResult(req).isEmpty()) {
      return next(Object.assign(new Error('User not found'), { status: 404, expose: true }));
    }
    const target = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
    if (!target) return next(Object.assign(new Error('User not found'), { status: 404, expose: true }));

    if (target.id === req.user.id) {
      req.flash('error', 'You cannot follow yourself.');
      return res.redirect('/users/' + req.params.username);
    }

    const existing = db
      .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?')
      .get(req.user.id, target.id);
    if (existing) {
      db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(req.user.id, target.id);
    } else {
      db.prepare('INSERT INTO follows (follower_id, followee_id) VALUES (?, ?)').run(req.user.id, target.id);
    }
    res.redirect('/users/' + req.params.username);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
