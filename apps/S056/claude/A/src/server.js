'use strict';

const createApp = require('./app');

const PORT = process.env.PORT || 5056;

const app = createApp();

app.listen(PORT, () => {
  console.log(`Task Management API listening on http://localhost:${PORT}`);
});
