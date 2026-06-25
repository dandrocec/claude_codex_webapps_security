const crypto = require('crypto');

function ensureToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  res.locals.csrfToken = ensureToken(req);

  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    next();
    return;
  }

  const submittedToken = req.body && req.body._csrf;
  if (!submittedToken || submittedToken !== req.session.csrfToken) {
    res.status(403).render('error', {
      title: 'Forbidden',
      message: 'The form expired or was submitted from an invalid source.'
    });
    return;
  }

  req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

module.exports = csrfProtection;
