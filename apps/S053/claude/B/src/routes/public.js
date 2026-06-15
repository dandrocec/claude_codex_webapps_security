'use strict';

const express = require('express');
const { Projects } = require('../models');

const router = express.Router();

// Public landing page: the project grid, visible to everyone.
router.get('/', (req, res) => {
  const projects = Projects.all();
  res.render('index', { projects });
});

module.exports = router;
