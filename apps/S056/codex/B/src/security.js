const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const isProduction = process.env.NODE_ENV === 'production';

const authCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'strict',
  path: '/',
  maxAge: 60 * 60 * 1000
};

const csrfCookieOptions = {
  httpOnly: false,
  secure: isProduction,
  sameSite: 'strict',
  path: '/',
  maxAge: 60 * 60 * 1000
};

function requireJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set to at least 32 characters');
  }
  return secret;
}

function createJwt(user) {
  return jwt.sign(
    { sub: String(user.id), username: user.username },
    requireJwtSecret(),
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '1h',
      issuer: 'task-management-api',
      audience: 'task-management-api-users'
    }
  );
}

function verifyJwt(token) {
  return jwt.verify(token, requireJwtSecret(), {
    issuer: 'task-management-api',
    audience: 'task-management-api-users'
  });
}

function extractBearerToken(req) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme && scheme.toLowerCase() === 'bearer' && token) {
    return token;
  }
  return null;
}

function authenticate(req, res, next) {
  const token = extractBearerToken(req) || req.cookies.access_token;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = verifyJwt(token);
    req.user = {
      id: Number(payload.sub),
      username: payload.username
    };
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function issueCsrfToken(req, res) {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie('csrf_token', token, csrfCookieOptions);
  return token;
}

function csrfProtection(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return next();
  }

  const cookieToken = req.cookies.csrf_token;
  const headerToken = req.get('x-csrf-token');

  if (!cookieToken || !headerToken) {
    issueCsrfToken(req, res);
    return res.status(403).json({ error: 'CSRF token required' });
  }

  const cookieBuffer = Buffer.from(cookieToken);
  const headerBuffer = Buffer.from(headerToken);
  if (
    cookieBuffer.length !== headerBuffer.length ||
    !crypto.timingSafeEqual(cookieBuffer, headerBuffer)
  ) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  return next();
}

module.exports = {
  authCookieOptions,
  authenticate,
  createJwt,
  csrfProtection,
  issueCsrfToken
};
