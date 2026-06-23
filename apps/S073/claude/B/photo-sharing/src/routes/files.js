'use strict';

const path = require('path');
const express = require('express');
const config = require('../config');

const router = express.Router();

// Uploaded files live OUTSIDE any static directory and are streamed only through
// this route. Filenames are server-generated (32 hex chars + known extension); we
// reject anything that does not match exactly, which also blocks path traversal
// (no slashes, dots-dots, etc. can pass the regex).
const FILENAME_RE = /^[a-f0-9]{32}\.(jpg|png|gif|webp)$/;
const MIME_BY_EXT = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

router.get('/uploads/:name', (req, res, next) => {
  const { name } = req.params;
  const match = FILENAME_RE.exec(name);
  if (!match) {
    return next(Object.assign(new Error('Not found'), { status: 404, expose: true }));
  }

  // Serve as a non-executable image, never inline-rendered as HTML.
  res.type(MIME_BY_EXT[match[1]]);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, max-age=3600');

  res.sendFile(name, {
    root: config.uploadDir,
    dotfiles: 'deny',
    // root + a validated flat filename means sendFile cannot escape the directory.
  }, (err) => {
    if (err) next(Object.assign(new Error('Not found'), { status: 404, expose: true }));
  });
});

module.exports = router;
