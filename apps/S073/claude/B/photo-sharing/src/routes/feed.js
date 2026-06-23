'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Home: send logged-in users to their feed, others to login.
router.get('/', (req, res) => {
  res.redirect(req.user ? '/feed' : '/login');
});

// Feed: recent photos from people the current user follows (plus their own).
router.get('/feed', requireAuth, (req, res) => {
  const photos = db
    .prepare(
      `SELECT p.id, p.filename, p.caption, p.created_at, u.username,
              (SELECT COUNT(*) FROM likes l WHERE l.photo_id = p.id) AS like_count,
              (SELECT COUNT(*) FROM comments c WHERE c.photo_id = p.id) AS comment_count,
              EXISTS(SELECT 1 FROM likes l2 WHERE l2.photo_id = p.id AND l2.user_id = ?) AS liked_by_me
         FROM photos p
         JOIN users u ON u.id = p.user_id
        WHERE p.user_id = ?
           OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT 100`
    )
    .all(req.user.id, req.user.id, req.user.id);

  res.render('feed', { title: 'Your feed', photos });
});

module.exports = router;
