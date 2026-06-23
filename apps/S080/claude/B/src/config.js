'use strict';

require('dotenv').config();
const path = require('path');

// Fail fast on missing critical secrets — never fall back to a hardcoded value.
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16) {
  // eslint-disable-next-line no-console
  console.error(
    '\nFATAL: SESSION_SECRET is missing or too short.\n' +
      'Copy .env.example to .env and set a strong SESSION_SECRET.\n'
  );
  process.exit(1);
}

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  port: parseInt(process.env.PORT, 10) || 5080,
  isProduction,
  sessionSecret: process.env.SESSION_SECRET,
  dbPath: process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(__dirname, '..', 'data', 'warehouse.db'),
  seed: {
    managerUsername: process.env.SEED_MANAGER_USERNAME || 'manager',
    managerPassword: process.env.SEED_MANAGER_PASSWORD,
    clerkUsername: process.env.SEED_CLERK_USERNAME || 'clerk',
    clerkPassword: process.env.SEED_CLERK_PASSWORD,
  },
};
