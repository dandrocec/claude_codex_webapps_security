const crypto = require('crypto');
const { validationResult } = require('express-validator');

function csrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function requireCsrf(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const sent = String(req.body._csrf || '');
  const expected = String(req.session.csrfToken || '');
  const valid =
    sent.length === expected.length &&
    sent.length > 0 &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!valid) return res.status(403).render('error', { title: 'Forbidden', message: 'Invalid CSRF token.' });
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'You do not have access to that resource.' });
    }
    next();
  };
}

function handleValidation(view, modelBuilder) {
  return (req, res, next) => {
    const errors = validationResult(req);
    if (errors.isEmpty()) return next();
    return res.status(400).render(view, {
      ...modelBuilder(req),
      errors: errors.array().map((error) => error.msg)
    });
  };
}

module.exports = { csrfToken, requireCsrf, requireAuth, requireRole, handleValidation };
