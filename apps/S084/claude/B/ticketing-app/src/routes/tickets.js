'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// A user's own tickets. The WHERE clause is scoped to the session user id,
// so there is no way to view another user's tickets (prevents IDOR).
router.get('/my-tickets', requireAuth, (req, res) => {
  const tickets = db
    .prepare(
      `SELECT t.id, t.purchased_at,
              e.id AS event_id, e.name AS event_name, e.event_date
       FROM tickets t
       JOIN events e ON e.id = t.event_id
       WHERE t.user_id = ?
       ORDER BY t.purchased_at DESC`
    )
    .all(req.session.userId);

  res.render('tickets/index', { title: 'My tickets', tickets });
});

module.exports = router;
