'use strict';

const app = require('./app');
const config = require('./config');

const server = app.listen(config.port, () => {
  console.log(`Portfolio site running at http://localhost:${config.port} (${config.env})`);
});

// Graceful shutdown.
function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
