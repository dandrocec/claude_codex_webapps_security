'use strict';

require('dotenv').config();

const app = require('./app');

const PORT = Number(process.env.PORT) || 5018;

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Password strength checker running at http://localhost:${PORT}`);
});

// Graceful shutdown so the SQLite handle is released cleanly.
function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`\nReceived ${signal}, shutting down...`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
