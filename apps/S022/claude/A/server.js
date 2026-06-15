'use strict';

const path = require('path');
const express = require('express');
const { evaluate } = require('./evaluate');

const app = express();
const PORT = process.env.PORT || 5022;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/calc', (req, res) => {
  const { expression } = req.body || {};

  if (typeof expression !== 'string') {
    return res.status(400).json({ error: 'Request body must include an "expression" string.' });
  }

  try {
    const result = evaluate(expression);
    return res.json({ expression, result });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`calc-api listening on http://localhost:${PORT}`);
});
