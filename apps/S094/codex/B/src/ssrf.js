const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const net = require('net');

const MAX_RESPONSE_BYTES = 128 * 1024;
const TIMEOUT_MS = 5000;
const METADATA_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal']);

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
}

function ipv4InCidr(ip, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

function expandIpv6(address) {
  if (address.includes('.')) {
    return null;
  }
  const [left, right = ''] = address.toLowerCase().split('::');
  const leftParts = left ? left.split(':') : [];
  const rightParts = right ? right.split(':') : [];
  const missing = 8 - leftParts.length - rightParts.length;
  if (missing < 0) return null;
  return [...leftParts, ...Array(missing).fill('0'), ...rightParts].map((part) => part.padStart(4, '0'));
}

function isBlockedIp(ip) {
  const family = net.isIP(ip);
  if (!family) return true;

  if (family === 4) {
    return [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.168.0.0', 16],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4]
    ].some(([base, bits]) => ipv4InCidr(ip, base, bits));
  }

  const parts = expandIpv6(ip);
  if (!parts) return true;
  const first = parseInt(parts[0], 16);
  return (
    ip === '::1' ||
    ip === '::' ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00
  );
}

async function validateTarget(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid outbound URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are allowed');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URLs with embedded credentials are not allowed');
  }
  if (METADATA_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('Metadata service destinations are not allowed');
  }

  const records = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isBlockedIp(record.address))) {
    throw new Error('Outbound URL resolves to a blocked network range');
  }
  return { parsed, address: records[0].address, family: records[0].family };
}

async function sendOutbound({ method, url, payload }) {
  const target = await validateTarget(url);
  const { parsed } = target;
  const body = JSON.stringify(payload);
  const transport = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    const req = transport.request({
      protocol: parsed.protocol,
      hostname: target.address,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      family: target.family,
      servername: parsed.hostname,
      timeout: TIMEOUT_MS,
      headers: {
        host: parsed.host,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'user-agent': 'secure-integration-hub/1.0'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve({ ok: false, statusCode: res.statusCode, body: '', error: 'Redirects are not followed' });
        return;
      }

      let size = 0;
      const chunks = [];
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('Response too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf8').slice(0, MAX_RESPONSE_BYTES);
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, body: responseBody });
      });
    });

    req.on('timeout', () => req.destroy(new Error('Outbound request timed out')));
    req.on('error', (error) => resolve({ ok: false, statusCode: null, body: '', error: error.message }));
    req.write(body);
    req.end();
  });
}

module.exports = { sendOutbound, validateTarget, isBlockedIp };
