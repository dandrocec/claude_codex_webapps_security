'use strict';

// Silence only the experimental-warning emitted by the built-in node:sqlite
// module. All other warnings pass through unchanged.
const originalEmitWarning = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const text = typeof warning === 'string' ? warning : warning && warning.message;
  const type = args[0] && (args[0].type || args[0]);
  if (type === 'ExperimentalWarning' && text && text.includes('SQLite')) return;
  return originalEmitWarning.call(process, warning, ...args);
};

const app = require('./app');
const { PORT } = require('./config');

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Secure file-share listening on http://localhost:${PORT}`);
});

function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`\n${signal} received, shutting down.`);
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
