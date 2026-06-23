'use strict';

require('dotenv').config();

// Fail fast if the session secret is missing — never fall back to a default.
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16) {
  console.error(
    'FATAL: SESSION_SECRET is missing or too short. Set it in your .env file ' +
      '(see .env.example) before starting the server.'
  );
  process.exit(1);
}

const app = require('./app');

const PORT = Number(process.env.PORT) || 5092;

app.listen(PORT, () => {
  console.log(`Clinic portal listening on http://localhost:${PORT}`);
});
