'use strict';

require('dotenv').config();

const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';

// Secrets must come from the environment, never the source tree.
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 16) {
  // Fail fast and loudly at boot rather than running with a weak/empty secret.
  // The message is for operators (server console), not end users.
  throw new Error(
    'SESSION_SECRET environment variable is required and must be at least 16 characters. ' +
      'See .env.example for how to generate one.'
  );
}

module.exports = {
  isProduction,
  port: Number(process.env.PORT) || 5024,
  sessionSecret: SESSION_SECRET,
  databaseFile:
    process.env.DATABASE_FILE || path.join(__dirname, '..', 'data', 'app.db'),
  // bcrypt work factor. 12 is a sensible modern default.
  bcryptRounds: 12,
};
