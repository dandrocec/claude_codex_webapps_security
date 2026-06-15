'use strict';

// express-rate-limit v7 exposes the factory as a named/`default` export
// depending on the loader; normalise to a callable regardless.
const _erl = require('express-rate-limit');
const rateLimit = _erl.rateLimit || _erl.default || _erl;

// Loose global limit to blunt obvious abuse.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict limit on authentication attempts. Counts POSTs only, so it does not
// penalise people simply viewing the sign-in / register pages.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method !== 'POST',
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

module.exports = { globalLimiter, authLimiter };
