'use strict';

const express = require('express');
const { Faqs } = require('../models');

const router = express.Router();

// Public, read-only FAQ page. Items are grouped by category and an optional
// keyword filter (?q=) narrows the list. Filtering is done in JS over already
// parameter-bound data; the query string is echoed back through EJS escaping.
router.get('/', (req, res) => {
  const rawQuery = typeof req.query.q === 'string' ? req.query.q : '';
  const keyword = rawQuery.trim().slice(0, 100).toLowerCase();

  let items = Faqs.allForPublic();
  if (keyword) {
    items = items.filter(
      (f) =>
        f.question.toLowerCase().includes(keyword) ||
        f.answer.toLowerCase().includes(keyword) ||
        f.category.toLowerCase().includes(keyword)
    );
  }

  // Group into { category: [items...] } preserving sort order.
  const grouped = new Map();
  for (const item of items) {
    if (!grouped.has(item.category)) grouped.set(item.category, []);
    grouped.get(item.category).push(item);
  }

  res.render('public', {
    title: 'Frequently Asked Questions',
    query: rawQuery,
    groups: [...grouped.entries()],
    totalCount: items.length,
  });
});

module.exports = router;
