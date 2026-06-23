'use strict';

const dns = require('dns');
const ipaddr = require('ipaddr.js');

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

// Reject anything that is not a normal, globally-routable unicast address.
// ipaddr.js classifies addresses into ranges; we treat everything outside
// "unicast" (for the public internet) as disallowed, and additionally
// hard-block the cloud metadata address.
const BLOCKED_IPV4_RANGES = [
  'unspecified', // 0.0.0.0/8
  'broadcast', // 255.255.255.255
  'multicast', // 224.0.0.0/4
  'linkLocal', // 169.254.0.0/16 (includes 169.254.169.254 metadata)
  'loopback', // 127.0.0.0/8
  'carrierGradeNat', // 100.64.0.0/10
  'private', // 10/8, 172.16/12, 192.168/16
  'reserved', // various
];

const BLOCKED_IPV6_RANGES = [
  'unspecified', // ::
  'linkLocal', // fe80::/10
  'multicast', // ff00::/8
  'loopback', // ::1
  'uniqueLocal', // fc00::/7
  'ipv4Mapped', // re-checked below as the embedded v4
  'rfc6145',
  'rfc6052',
  'teredo',
  'reserved',
];

/**
 * Returns null if the IP is a publicly-routable unicast address we are willing
 * to connect to, or a string reason if it must be blocked.
 */
function ipBlockReason(ipStr) {
  let addr;
  try {
    addr = ipaddr.parse(ipStr);
  } catch (e) {
    return 'unparseable address';
  }

  // Normalise IPv4-mapped IPv6 (e.g. ::ffff:169.254.169.254) to its IPv4 form
  // so the embedded address is range-checked, not the wrapper.
  if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) {
    addr = addr.toIPv4Address();
  }

  const range = addr.range();

  if (addr.kind() === 'ipv4') {
    if (BLOCKED_IPV4_RANGES.includes(range)) {
      return `blocked IPv4 range: ${range}`;
    }
  } else {
    if (BLOCKED_IPV6_RANGES.includes(range)) {
      return `blocked IPv6 range: ${range}`;
    }
  }

  // Belt-and-braces explicit metadata check.
  if (ipStr === '169.254.169.254' || ipStr === 'fe80::a9fe:a9fe') {
    return 'cloud metadata endpoint';
  }

  return null;
}

/**
 * Validate a user-supplied URL's shape (scheme + that it parses).
 * Throws an Error with a safe message on failure. Returns the parsed URL.
 */
function validateUrlShape(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (e) {
    throw new Error('Invalid URL.');
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new Error('Only http and https URLs are allowed.');
  }
  if (!url.hostname) {
    throw new Error('URL must include a host.');
  }
  // Disallow embedded credentials which can be used to confuse parsers.
  if (url.username || url.password) {
    throw new Error('URLs must not contain credentials.');
  }
  return url;
}

/**
 * A drop-in replacement for dns.lookup that resolves the hostname and rejects
 * the connection if ANY resolved address falls in a blocked range. By doing the
 * check here, inside the socket lookup, we also defeat DNS-rebinding: the very
 * address the socket will connect to is the one validated.
 *
 * `allowPrivate` (test-only) bypasses the range checks.
 */
function makeGuardedLookup(allowPrivate) {
  return function guardedLookup(hostname, options, callback) {
    // Node calls lookup(hostname, options, cb) or lookup(hostname, cb).
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err);
      if (!addresses || addresses.length === 0) {
        return callback(new Error('Host did not resolve.'));
      }
      if (!allowPrivate) {
        for (const a of addresses) {
          const reason = ipBlockReason(a.address);
          if (reason) {
            const blockErr = new Error(`Refusing to connect to ${hostname}: ${reason}.`);
            blockErr.code = 'ESSRFBLOCKED';
            return callback(blockErr);
          }
        }
      }
      const chosen = addresses[0];
      if (options && options.all) {
        return callback(null, addresses);
      }
      return callback(null, chosen.address, chosen.family);
    });
  };
}

module.exports = {
  ALLOWED_SCHEMES,
  ipBlockReason,
  validateUrlShape,
  makeGuardedLookup,
};
