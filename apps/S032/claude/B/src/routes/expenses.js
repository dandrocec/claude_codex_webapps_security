'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');

const expenses = require('../models/expenses');
const { requireAuth } = require('../middleware/auth');
const { resolveMonth, formatAmount } = require('../helpers');
const { categories } = require('../config');

const router = express.Router();

// Everything below requires an authenticated user.
router.use(requireAuth);

// Validation chain shared by create and update.
const expenseRules = [
  body('amount')
    .trim()
    .matches(/^\d{1,9}(\.\d{1,2})?$/)
    .withMessage('Amount must be a positive number with up to 2 decimals.')
    .bail()
    .custom((v) => Number(v) > 0)
    .withMessage('Amount must be greater than zero.'),
  body('category')
    .trim()
    .isIn(categories)
    .withMessage('Please choose a valid category.'),
  body('spent_on')
    .trim()
    .isISO8601({ strict: true })
    .withMessage('Please provide a valid date.')
    .customSanitizer((v) => v.slice(0, 10)),
  body('note')
    .trim()
    .isLength({ max: 200 })
    .withMessage('Note must be 200 characters or fewer.'),
];

// Normalise validated input into the shape the model expects.
function toRecord(reqBody) {
  return {
    amount: Math.round(Number(reqBody.amount) * 100), // store as integer cents
    category: reqBody.category,
    spentOn: reqBody.spent_on.slice(0, 10),
    note: reqBody.note || '',
  };
}

// ---- Dashboard / list --------------------------------------------------------

router.get('/', (req, res) => {
  const month = resolveMonth(req.query.month);
  const rows = expenses.listForMonth(
    req.user.id,
    month.monthStart,
    month.nextMonthStart
  );
  const totalCents = expenses.monthlyTotal(
    req.user.id,
    month.monthStart,
    month.nextMonthStart
  );

  res.render('dashboard', {
    month,
    expenses: rows.map((r) => ({ ...r, amountDisplay: formatAmount(r.amount) })),
    total: formatAmount(totalCents),
    categories,
    formError: null,
    values: {},
  });
});

// ---- Create ------------------------------------------------------------------

router.post('/expenses', expenseRules, (req, res) => {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    // Re-render the dashboard with errors and the user's input preserved.
    const month = resolveMonth(req.query.month);
    const rows = expenses.listForMonth(
      req.user.id,
      month.monthStart,
      month.nextMonthStart
    );
    const totalCents = expenses.monthlyTotal(
      req.user.id,
      month.monthStart,
      month.nextMonthStart
    );
    return res.status(400).render('dashboard', {
      month,
      expenses: rows.map((r) => ({ ...r, amountDisplay: formatAmount(r.amount) })),
      total: formatAmount(totalCents),
      categories,
      formError: result.array()[0].msg,
      values: req.body,
    });
  }

  expenses.create(req.user.id, toRecord(req.body));
  res.redirect('/');
});

// ---- Edit (form) -------------------------------------------------------------

router.get('/expenses/:id/edit', (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next();

  // Ownership enforced in the query (id AND user_id).
  const expense = expenses.findById(id, req.user.id);
  if (!expense) {
    return res.status(404).render('404');
  }

  res.render('edit', {
    expense: { ...expense, amountDisplay: formatAmount(expense.amount) },
    categories,
    errors: [],
  });
});

// ---- Update ------------------------------------------------------------------

router.post('/expenses/:id', expenseRules, (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next();

  const existing = expenses.findById(id, req.user.id);
  if (!existing) {
    return res.status(404).render('404');
  }

  const result = validationResult(req);
  if (!result.isEmpty()) {
    return res.status(400).render('edit', {
      expense: { id, ...req.body, amountDisplay: req.body.amount, spent_on: req.body.spent_on },
      categories,
      errors: result.array(),
    });
  }

  // update() also scopes by user_id, so it is a no-op for non-owners.
  expenses.update(id, req.user.id, toRecord(req.body));
  res.redirect('/');
});

// ---- Delete ------------------------------------------------------------------

router.post('/expenses/:id/delete', (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next();

  expenses.remove(id, req.user.id); // scoped by user_id; safe if not owner
  res.redirect('/');
});

module.exports = router;
