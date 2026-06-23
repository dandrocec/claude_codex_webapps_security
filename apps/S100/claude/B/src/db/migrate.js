'use strict';

// Standalone migration entry point: `npm run init-db`.
// Importing the db module runs migrations as a side effect.
const { dbPath } = require('./index');

// eslint-disable-next-line no-console
console.log(`Database ready at ${dbPath}`);
process.exit(0);
