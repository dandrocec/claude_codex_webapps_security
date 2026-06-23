'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { UPLOAD_DIR } = require('./db');

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 10 * 1024 * 1024;

// Explicit allow-list. The accepted type is decided by INSPECTING the file's
// bytes (magic numbers), not by trusting the client-supplied filename or
// Content-Type header.
const ALLOWED = [
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.slice(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/png', ext: 'png', test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', ext: 'gif', test: (b) => { const s = b.slice(0, 6).toString('latin1'); return s === 'GIF87a' || s === 'GIF89a'; } },
];

// Plain-text is allowed only if the content is valid UTF-8 with no NUL bytes and
// no other ASCII control chars beyond tab/newline/carriage-return.
function looksLikeText(buf) {
  if (buf.includes(0x00)) return false;
  const sample = buf.subarray(0, 8192);
  for (const byte of sample) {
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
    if (byte < 0x20) return false;
  }
  // Reject invalid UTF-8 sequences.
  return Buffer.from(sample.toString('utf8'), 'utf8').length > 0 || sample.length === 0;
}

/**
 * Decide the canonical type of an uploaded buffer.
 * Returns { mime, ext } from the allow-list, or null if not permitted.
 */
function sniffType(buf) {
  if (!buf || buf.length === 0) return null;
  for (const entry of ALLOWED) {
    try {
      if (entry.test(buf)) return { mime: entry.mime, ext: entry.ext };
    } catch (_) {
      /* ignore and keep checking */
    }
  }
  if (looksLikeText(buf)) return { mime: 'text/plain', ext: 'txt' };
  return null;
}

// Keep the file in memory so we can inspect bytes BEFORE deciding to persist it.
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

/**
 * Persist a validated buffer under a server-generated random name.
 * The filename never derives from user input, eliminating path traversal.
 */
function storeBuffer(buf) {
  const random = crypto.randomBytes(16).toString('hex');
  const storedFilename = `${random}.bin`; // generic extension; never executed
  const dest = path.join(UPLOAD_DIR, storedFilename);
  fs.writeFileSync(dest, buf, { mode: 0o600 });
  return storedFilename;
}

/**
 * Resolve a stored filename to an absolute path, guaranteeing the result stays
 * inside UPLOAD_DIR. Returns null if the name is malformed or escapes the dir.
 */
function resolveStoredPath(storedFilename) {
  if (typeof storedFilename !== 'string' || !/^[a-f0-9]{32}\.bin$/.test(storedFilename)) {
    return null;
  }
  const resolved = path.resolve(UPLOAD_DIR, storedFilename);
  const base = path.resolve(UPLOAD_DIR);
  if (resolved !== path.join(base, storedFilename)) return null;
  if (!resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

function deleteStored(storedFilename) {
  const p = resolveStoredPath(storedFilename);
  if (p) {
    try { fs.unlinkSync(p); } catch (_) { /* already gone */ }
  }
}

module.exports = {
  MAX_UPLOAD_BYTES,
  memoryUpload,
  sniffType,
  storeBuffer,
  resolveStoredPath,
  deleteStored,
};
