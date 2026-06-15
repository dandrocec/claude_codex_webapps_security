'use strict';

require('dotenv').config();

const app = require('./src/app');

const PORT = parseInt(process.env.PORT, 10) || 5051;

app.listen(PORT, () => {
  console.log(`Movie watchlist running at http://localhost:${PORT}`);
});
