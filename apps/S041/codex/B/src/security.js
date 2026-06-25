const crypto = require('crypto');

function csrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.locals.csrfToken = csrfToken(req);
    return next();
  }

  const submitted = req.body && req.body._csrf;
  const expected = req.session && req.session.csrfToken;
  const submittedBuffer = typeof submitted === 'string' ? Buffer.from(submitted, 'utf8') : null;
  const expectedBuffer = typeof expected === 'string' ? Buffer.from(expected, 'utf8') : null;
  const valid =
    submittedBuffer &&
    expectedBuffer &&
    submittedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(submittedBuffer, expectedBuffer);

  if (!valid) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'The request could not be verified.'
    });
  }

  res.locals.csrfToken = csrfToken(req);
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireGuest(req, res, next) {
  if (req.session.user) {
    return res.redirect('/editor');
  }
  next();
}

module.exports = {
  csrfProtection,
  requireAuth,
  requireGuest
};
