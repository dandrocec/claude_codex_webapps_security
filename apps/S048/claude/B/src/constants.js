'use strict';

// Allowed feedback categories. Used both for input validation and to render
// the submission form, so the two can never drift apart.
const CATEGORIES = ['Bug', 'Feature Request', 'Usability', 'Performance', 'Other'];

// Whitelisted sort columns/directions for the reviewer dashboard. Keeping this
// as an allow-list is what makes dynamic ORDER BY safe (never interpolate raw
// user input into SQL).
const SORT_COLUMNS = {
  created_at: 'created_at',
  rating: 'rating',
  category: 'category',
};

const SORT_DIRECTIONS = {
  asc: 'ASC',
  desc: 'DESC',
};

module.exports = { CATEGORIES, SORT_COLUMNS, SORT_DIRECTIONS };
