'use strict';

require('dotenv').config();

const crypto = require('node:crypto');

const isProduction = process.env.NODE_ENV === 'production';

// Secrets must come from the environment — never hardcode them.
// In production we refuse to start without an explicit SESSION_SECRET so we
// never accidentally ship a predictable key.
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProduction) {
    // eslint-disable-next-line no-console
    console.error('FATAL: SESSION_SECRET environment variable is required in production.');
    process.exit(1);
  }
  // Dev-only convenience: ephemeral secret so the app still boots. Sessions
  // will not survive a restart, which is fine for local development.
  sessionSecret = crypto.randomBytes(48).toString('hex');
  // eslint-disable-next-line no-console
  console.warn('WARNING: SESSION_SECRET not set — using a random ephemeral secret (dev only).');
}

module.exports = {
  isProduction,
  port: Number(process.env.PORT) || 5059,
  sessionSecret,
  databaseFile: process.env.DATABASE_FILE || './data/reservations.db',

  // Booking domain configuration.
  // Hourly slots presented to the user. Stored verbatim and validated against
  // this allow-list so a client can never inject an arbitrary slot value.
  slots: [
    '09:00-10:00',
    '10:00-11:00',
    '11:00-12:00',
    '12:00-13:00',
    '13:00-14:00',
    '14:00-15:00',
    '15:00-16:00',
    '16:00-17:00',
  ],

  // How many days ahead (including today) a user may book.
  bookingHorizonDays: 30,
};
