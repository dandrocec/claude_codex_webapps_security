'use strict';

const express = require('express');
const config = require('../config');
const apiKeys = require('../services/apiKeys');
const usage = require('../services/usage');

const router = express.Router();

// Capture the raw body for any content type so it can be forwarded untouched.
// (This router is API-key authenticated and is intentionally exempt from the
// session/CSRF machinery, which only applies to cookie-based browser routes.)
router.use(express.raw({ type: '*/*', limit: '5mb' }));

// Headers that must not be forwarded verbatim (hop-by-hop or sensitive).
const STRIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'x-api-key',
  'cookie',
]);

const STRIP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding', // fetch already decoded the body
  'content-length',
]);

function getApiKey(req) {
  const header = req.get('x-api-key');
  if (header) return header.trim();
  const auth = req.get('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return null;
}

router.all('/*', async (req, res) => {
  const started = Date.now();
  const subPath = req.originalUrl.slice('/gateway'.length) || '/';

  // 1) Authenticate the API key.
  const plaintext = getApiKey(req);
  const keyRecord = plaintext ? apiKeys.findActiveKeyByPlaintext(plaintext) : null;
  if (!keyRecord) {
    return res.status(401).json({ error: 'Missing or invalid API key.' });
  }

  // 2) Enforce the per-key rate limit (fixed 60s window).
  const used = usage.countRecent(keyRecord.id);
  if (used >= keyRecord.rate_limit) {
    usage.logRequest({
      keyId: keyRecord.id,
      method: req.method,
      path: subPath,
      status: 429,
      durationMs: Date.now() - started,
    });
    res.set('Retry-After', '60');
    return res.status(429).json({
      error: 'Rate limit exceeded.',
      limit: keyRecord.rate_limit,
      windowSeconds: config.rateWindowMs / 1000,
    });
  }

  // 3) Proxy to the configured backend.
  const targetUrl = config.backendUrl + subPath;
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!STRIP_REQUEST_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }
  headers['x-forwarded-for'] = req.ip;
  headers['x-forwarded-host'] = req.get('host') || '';

  const hasBody = !['GET', 'HEAD'].includes(req.method) && req.body && req.body.length > 0;

  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: 'manual',
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[gateway] upstream error:', err.message);
    usage.logRequest({
      keyId: keyRecord.id,
      method: req.method,
      path: subPath,
      status: 502,
      durationMs: Date.now() - started,
    });
    return res.status(502).json({ error: 'Bad gateway: upstream request failed.' });
  }

  // 4) Relay the response.
  upstream.headers.forEach((value, name) => {
    if (!STRIP_RESPONSE_HEADERS.has(name.toLowerCase())) res.set(name, value);
  });
  const buffer = Buffer.from(await upstream.arrayBuffer());

  usage.logRequest({
    keyId: keyRecord.id,
    method: req.method,
    path: subPath,
    status: upstream.status,
    durationMs: Date.now() - started,
  });

  res.status(upstream.status).send(buffer);
});

module.exports = router;
