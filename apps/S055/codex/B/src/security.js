const crypto = require('crypto');
const sanitizeHtml = require('sanitize-html');
const validator = require('validator');

function cleanText(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  const stripped = sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} });
  return stripped.slice(0, maxLength);
}

function validEmail(value) {
  return typeof value === 'string' && validator.isEmail(value) && value.length <= 254;
}

function ensureCsrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

function requireCsrf(req, res, next) {
  const submitted = req.body && req.body._csrf;
  if (!submitted || submitted !== req.session.csrfToken) {
    return res.status(403).render('error', { message: 'Invalid request token.' });
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

function redirectIfAuthenticated(req, res, next) {
  if (req.session.userId) {
    return res.redirect('/dashboard');
  }
  next();
}

function currentUser(req, res, next) {
  res.locals.currentUser = req.session.user || null;
  next();
}

module.exports = {
  cleanText,
  currentUser,
  ensureCsrfToken,
  redirectIfAuthenticated,
  requireAuth,
  requireCsrf,
  validEmail
};
