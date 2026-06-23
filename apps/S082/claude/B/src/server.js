'use strict';

const app = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Secure file storage running at http://localhost:${config.port}`);
});
