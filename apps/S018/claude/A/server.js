'use strict';

const path = require('path');
const express = require('express');
const { ratePassword } = require('./strength');

const app = express();
const PORT = process.env.PORT || 5018;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Serve the form.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Accept a candidate password and return a strength rating.
// Responds with JSON for API/fetch clients.
app.post('/check', (req, res) => {
  const password = (req.body && req.body.password) || '';
  const result = ratePassword(password);
  res.json(result);
});

app.listen(PORT, () => {
  console.log(`Password strength checker running at http://localhost:${PORT}`);
});
