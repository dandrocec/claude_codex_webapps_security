'use strict';

/**
 * Minimal cookie parser so we don't pull in an extra dependency.
 * Populates req.cookies with a plain object of decoded name/value pairs.
 */
module.exports = function cookieParser(req, res, next) {
  const header = req.headers.cookie;
  const out = {};
  if (header) {
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      const name = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (name) {
        try {
          out[name] = decodeURIComponent(value);
        } catch {
          out[name] = value;
        }
      }
    }
  }
  req.cookies = out;
  next();
};
