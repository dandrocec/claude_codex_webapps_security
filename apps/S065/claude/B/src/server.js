'use strict';

require('dotenv').config();

const createApp = require('./app');

// Fail fast if the session secret is missing — never fall back to a default.
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16) {
  console.error(
    'FATAL: SESSION_SECRET is not set or is too short. ' +
      'Copy .env.example to .env and set a long random value.'
  );
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 5065;
const app = createApp();

app.listen(PORT, () => {
  console.log(`Q&A site listening on http://localhost:${PORT}`);
});
