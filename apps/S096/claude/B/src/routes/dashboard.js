'use strict';

const express = require('express');
const apiKeys = require('../services/apiKeys');
const usage = require('../services/usage');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/dashboard', requireAuth, (req, res) => {
  const keys = apiKeys.listKeysForUser(req.user.id);
  const { summary, perKeyMap, recent } = usage.dashboardData(req.user.id);

  // One-time flash messages (e.g. a freshly created key).
  const flash = req.session.flash || null;
  req.session.flash = undefined;

  res.render('dashboard', {
    title: 'Dashboard',
    keys,
    perKeyMap,
    summary,
    recent,
    flash,
    backendUrl: config.backendUrl,
    defaultRateLimit: config.defaultRateLimit,
  });
});

module.exports = router;
