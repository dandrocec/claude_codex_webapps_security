'use strict';

const express = require('express');
const { db } = require('../../db');

const router = express.Router();

router.get('/', (req, res) => {
  res.redirect('/menu');
});

router.get('/menu', (req, res) => {
  const items = db
    .prepare(
      'SELECT id, name, description, price_cents FROM menu_items WHERE available = 1 ORDER BY name'
    )
    .all();
  res.render('menu', { title: 'Menu', items });
});

module.exports = router;
