'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const userModel = require('../models/userModel');
const { registerRules, loginRules, collectErrors } = require('../lib/validators');

const router = express.Router();

// Throttle auth attempts to blunt credential-stuffing / brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('register', { title: 'Register', values: {} });
});

router.post('/register', authLimiter, registerRules, (req, res, next) => {
  if (req.user) return res.redirect('/');
  const errors = collectErrors(req);
  const values = { username: req.body.username, role: req.body.role };
  if (errors) {
    return res.status(400).render('register', { title: 'Register', errors, values });
  }
  try {
    const existing = userModel.findByUsername(req.body.username.trim());
    if (existing) {
      return res.status(409).render('register', {
        title: 'Register',
        errors: ['That username is already taken.'],
        values,
      });
    }
    const user = userModel.create({
      username: req.body.username.trim(),
      password: req.body.password,
      role: req.body.role,
    });
    // Prevent session fixation: regenerate the session on privilege change.
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.flash('success', `Welcome, ${user.username}! Your account was created.`);
      res.redirect('/');
    });
  } catch (err) {
    next(err);
  }
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Sign in', values: {} });
});

router.post('/login', authLimiter, loginRules, (req, res, next) => {
  const errors = collectErrors(req);
  if (errors) {
    return res.status(400).render('login', {
      title: 'Sign in',
      errors,
      values: { username: req.body.username },
    });
  }
  const user = userModel.verifyCredentials(req.body.username.trim(), req.body.password);
  if (!user) {
    // Generic message — do not reveal which field was wrong.
    return res.status(401).render('login', {
      title: 'Sign in',
      errors: ['Invalid username or password.'],
      values: { username: req.body.username },
    });
  }
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = user.id;
    req.flash('success', `Signed in as ${user.username}.`);
    res.redirect('/');
  });
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/login');
  });
});

module.exports = router;
