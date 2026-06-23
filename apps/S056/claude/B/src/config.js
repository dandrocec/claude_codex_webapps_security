'use strict';

require('dotenv').config();

const crypto = require('crypto');

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

// Never hardcode secrets. Read JWT_SECRET from the environment.
// In production we refuse to start without one. In development we fall back to
// an ephemeral random secret (logged as a warning) so the app stays runnable —
// note that restarting the server invalidates all previously issued tokens.
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (isProduction) {
    // eslint-disable-next-line no-console
    console.error('FATAL: JWT_SECRET is not set. Refusing to start in production.');
    process.exit(1);
  }
  jwtSecret = crypto.randomBytes(48).toString('hex');
  // eslint-disable-next-line no-console
  console.warn(
    '[WARN] JWT_SECRET not set — generated a temporary one for this session.\n' +
      '       Set JWT_SECRET in your .env to keep sessions valid across restarts.'
  );
}

module.exports = {
  nodeEnv: NODE_ENV,
  isProduction,
  port: Number(process.env.PORT) || 5056,
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  // Cookie names
  authCookieName: 'token',
  csrfCookieName: 'csrfToken',
  csrfHeaderName: 'x-csrf-token',
};
