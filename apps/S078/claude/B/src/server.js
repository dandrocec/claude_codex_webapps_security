'use strict';

require('dotenv').config();

const app = require('./app');

const PORT = Number(process.env.PORT) || 5078;

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`CRM running at http://localhost:${PORT}`);
});
