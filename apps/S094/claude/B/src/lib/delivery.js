'use strict';

const http = require('http');
const https = require('https');
const config = require('../config');
const { validateUrlShape, makeGuardedLookup } = require('./ssrf');

const guardedLookup = makeGuardedLookup(config.outbound.allowPrivateTargets);

/**
 * Perform a single, SSRF-guarded outbound HTTP(S) request.
 *
 * Hardening applied:
 *  - scheme allow-list (http/https only) via validateUrlShape
 *  - DNS resolution + private/loopback/link-local/metadata blocking in the
 *    socket lookup (defeats DNS rebinding)
 *  - connection + read timeout
 *  - maximum response body size
 *  - redirects are NOT followed (a 3xx is recorded as-is); this prevents being
 *    bounced to a disallowed internal target
 *
 * Resolves with { ok, status, body, error }. Never throws for network/SSRF
 * problems — those are returned in `error`.
 */
function performRequest(rawUrl, { method = 'POST', body = '', headers = {} } = {}) {
  return new Promise((resolve) => {
    let url;
    try {
      url = validateUrlShape(rawUrl);
    } catch (e) {
      return resolve({ ok: false, status: null, body: '', error: e.message });
    }

    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const requestOptions = {
      method,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      lookup: guardedLookup,
      // We deliberately do not follow redirects.
      headers: {
        'User-Agent': 'integration-hub/1.0',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
      timeout: config.outbound.timeoutMs,
    };

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const req = transport.request(requestOptions, (res) => {
      const chunks = [];
      let received = 0;
      let truncated = false;
      const status = res.statusCode;

      const complete = () => {
        let text = Buffer.concat(chunks).toString('utf8');
        if (truncated) text += '\n...[truncated]';
        const ok = status >= 200 && status < 300;
        finish({
          ok,
          status,
          body: text,
          error: ok ? null : `Non-2xx response (${status}).`,
        });
      };

      res.on('data', (chunk) => {
        received += chunk.length;
        if (received <= config.outbound.maxBytes) {
          chunks.push(chunk);
        } else if (!truncated) {
          truncated = true;
          // Keep what fits, stop reading, and resolve now: destroying the
          // stream may suppress the 'end' event.
          const remaining = config.outbound.maxBytes - (received - chunk.length);
          if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
          res.destroy();
          complete();
        }
      });

      res.on('end', complete);

      res.on('error', () => {
        finish({ ok: false, status: status || null, body: '', error: 'Response stream error.' });
      });
    });

    // Apply read/idle timeout.
    req.setTimeout(config.outbound.timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });

    req.on('error', (err) => {
      const reason =
        err && err.code === 'ESSRFBLOCKED'
          ? err.message
          : err && err.message === 'timeout'
          ? 'Request timed out.'
          : 'Connection failed.';
      finish({ ok: false, status: null, body: '', error: reason });
    });

    if (body) req.write(body);
    req.end();
  });
}

module.exports = { performRequest };
