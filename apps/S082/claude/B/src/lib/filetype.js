'use strict';

// Content-based file-type detection for a small, explicit allow-list.
//
// We deliberately do NOT trust the client-supplied filename or Content-Type.
// Instead we inspect the leading bytes ("magic numbers") of the stored file and
// only accept a type when the bytes match a known signature. Anything else is
// rejected, regardless of what the upload claimed to be.

const fs = require('fs');

// Each entry: a detector that receives the first chunk of the file (Buffer) and
// returns a canonical { ext, mime } descriptor, or null if it does not match.
const SIGNATURES = [
  {
    ext: 'png',
    mime: 'image/png',
    test: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    ext: 'jpg',
    mime: 'image/jpeg',
    test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: 'gif',
    mime: 'image/gif',
    test: (b) =>
      b.length >= 6 &&
      b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 &&
      (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61,
  },
  {
    ext: 'webp',
    mime: 'image/webp',
    test: (b) =>
      b.length >= 12 &&
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP',
  },
  {
    ext: 'pdf',
    mime: 'application/pdf',
    test: (b) => b.length >= 5 && b.toString('ascii', 0, 5) === '%PDF-',
  },
];

// Allow-list of MIME types we are willing to store/serve.
const ALLOWED_MIME = new Set(SIGNATURES.map((s) => s.mime));

/**
 * Detect type from a Buffer of the file's leading bytes.
 * @returns {{ext:string, mime:string}|null}
 */
function detectFromBuffer(buf) {
  for (const sig of SIGNATURES) {
    if (sig.test(buf)) return { ext: sig.ext, mime: sig.mime };
  }
  return null;
}

/**
 * Detect type by reading the first bytes of a file on disk.
 * @returns {{ext:string, mime:string}|null}
 */
function detectFromFile(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buf, 0, 16, 0);
    return detectFromBuffer(buf.subarray(0, bytesRead));
  } finally {
    fs.closeSync(fd);
  }
}

function allowedDescription() {
  return SIGNATURES.map((s) => s.ext.toUpperCase()).join(', ');
}

module.exports = {
  detectFromBuffer,
  detectFromFile,
  allowedDescription,
  ALLOWED_MIME,
};
