'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../db');

const router = express.Router();

// A valid-format bcrypt hash used when a username doesn't exist, so the password
// comparison still runs and login timing doesn't reveal whether the user exists.
const DUMMY_HASH = bcrypt.hashSync('timing-equalisation-placeholder', 12);

// ---- prepared statements (parameterised — no string concatenation) ----
const findUserByUsername = db.prepare('SELECT * FROM users WHERE username = ?');
const findUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const listDoctors = db.prepare(
  "SELECT id, full_name FROM users WHERE role = 'doctor' ORDER BY full_name"
);
const insertPatient = db.prepare(`
  INSERT INTO users (username, email, full_name, role, password_hash, doctor_id)
  VALUES (@username, @email, @full_name, 'patient', @password_hash, @doctor_id)
`);

// ---------------------------------- Login ----------------------------------
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { title: 'Sign in', errors: [], values: {} });
});

router.post(
  '/login',
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required'),
  (req, res) => {
    const errors = validationResult(req);
    const values = { username: req.body.username || '' };
    if (!errors.isEmpty()) {
      return res.status(400).render('login', {
        title: 'Sign in',
        errors: errors.array(),
        values,
      });
    }

    const user = findUserByUsername.get(req.body.username);
    // Always run a hash comparison to reduce username-enumeration timing leaks.
    const hash = user ? user.password_hash : DUMMY_HASH;
    const ok = bcrypt.compareSync(req.body.password, hash);

    if (!user || !ok) {
      return res.status(401).render('login', {
        title: 'Sign in',
        errors: [{ msg: 'Invalid username or password.' }],
        values,
      });
    }

    // Prevent session fixation: issue a fresh session on privilege change.
    req.session.regenerate((err) => {
      if (err) return res.status(500).render('error', { title: 'Error', message: 'Could not sign you in.', status: 500 });
      req.session.user = {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
      };
      res.redirect('/');
    });
  }
);

// -------------------------------- Register ---------------------------------
// Self-service registration is for patients only. Staff accounts are seeded.
router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('register', {
    title: 'Create patient account',
    errors: [],
    values: {},
    doctors: listDoctors.all(),
  });
});

router.post(
  '/register',
  body('username')
    .trim()
    .isLength({ min: 3, max: 32 })
    .withMessage('Username must be 3-32 characters')
    .matches(/^[a-zA-Z0-9_.-]+$/)
    .withMessage('Username may contain letters, numbers, and . _ - only'),
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('full_name').trim().isLength({ min: 1, max: 100 }).withMessage('Full name is required'),
  body('password')
    .isLength({ min: 10, max: 200 })
    .withMessage('Password must be at least 10 characters'),
  body('doctor_id').isInt({ min: 1 }).withMessage('Please choose a doctor'),
  (req, res) => {
    const doctors = listDoctors.all();
    const values = {
      username: req.body.username || '',
      email: req.body.email || '',
      full_name: req.body.full_name || '',
      doctor_id: req.body.doctor_id || '',
    };

    const errors = validationResult(req);
    const errorList = errors.array();

    // Confirm the chosen doctor actually exists and is a doctor.
    const validDoctor = doctors.some((d) => String(d.id) === String(req.body.doctor_id));
    if (req.body.doctor_id && !validDoctor) {
      errorList.push({ msg: 'Selected doctor is not valid' });
    }

    if (errorList.length > 0) {
      return res.status(400).render('register', {
        title: 'Create patient account',
        errors: errorList,
        values,
        doctors,
      });
    }

    if (findUserByUsername.get(req.body.username) || findUserByEmail.get(req.body.email)) {
      return res.status(409).render('register', {
        title: 'Create patient account',
        errors: [{ msg: 'That username or email is already registered.' }],
        values,
        doctors,
      });
    }

    const password_hash = bcrypt.hashSync(req.body.password, 12);
    insertPatient.run({
      username: req.body.username,
      email: req.body.email,
      full_name: req.body.full_name,
      password_hash,
      doctor_id: Number(req.body.doctor_id),
    });

    res.redirect('/login');
  }
);

// --------------------------------- Logout ----------------------------------
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('clinic.sid');
    res.redirect('/login');
  });
});

module.exports = router;
