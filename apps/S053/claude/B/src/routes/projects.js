'use strict';

const express = require('express');

const { Projects } = require('../models');
const { requireAuth } = require('../middleware/auth');
const { projectRules, handleValidation } = require('../middleware/validators');

const router = express.Router();

// Every route below requires an authenticated owner.
router.use(requireAuth);

function renderForm(req, extra = {}) {
  return {
    errors: [],
    project: { title: '', description: '', link: '', imageUrl: '' },
    ...extra,
  };
}

// Dashboard: only the current owner's projects.
router.get('/', (req, res) => {
  const projects = Projects.byOwner(req.user.id);
  res.render('admin/list', { projects });
});

router.get('/new', (req, res) => {
  res.render('admin/form', { ...renderForm(req), mode: 'create', action: '/admin/projects' });
});

router.post(
  '/projects',
  projectRules,
  handleValidation('admin/form', (req) => ({
    mode: 'create',
    action: '/admin/projects',
    project: {
      title: req.body.title,
      description: req.body.description,
      link: req.body.link,
      imageUrl: req.body.imageUrl,
    },
  })),
  (req, res) => {
    Projects.create(req.user.id, {
      title: req.body.title,
      description: req.body.description,
      link: req.body.link,
      imageUrl: req.body.imageUrl,
    });
    res.redirect('/admin');
  }
);

// Helper that loads a project AND enforces ownership (prevents IDOR).
function loadOwnedProject(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(404).render('error', { status: 404, message: 'Project not found' });
    return null;
  }
  const project = Projects.findById(id);
  if (!project || project.owner_id !== req.user.id) {
    // Same response whether it doesn't exist or isn't yours — no info leak.
    res.status(404).render('error', { status: 404, message: 'Project not found' });
    return null;
  }
  return project;
}

router.get('/projects/:id/edit', (req, res) => {
  const project = loadOwnedProject(req, res);
  if (!project) return;
  res.render('admin/form', {
    errors: [],
    mode: 'edit',
    action: `/admin/projects/${project.id}`,
    project: {
      id: project.id,
      title: project.title,
      description: project.description,
      link: project.link,
      imageUrl: project.image_url,
    },
  });
});

router.post(
  '/projects/:id',
  projectRules,
  handleValidation('admin/form', (req) => ({
    mode: 'edit',
    action: `/admin/projects/${Number.parseInt(req.params.id, 10)}`,
    project: {
      id: Number.parseInt(req.params.id, 10),
      title: req.body.title,
      description: req.body.description,
      link: req.body.link,
      imageUrl: req.body.imageUrl,
    },
  })),
  (req, res) => {
    const project = loadOwnedProject(req, res);
    if (!project) return;
    Projects.update(project.id, req.user.id, {
      title: req.body.title,
      description: req.body.description,
      link: req.body.link,
      imageUrl: req.body.imageUrl,
    });
    res.redirect('/admin');
  }
);

router.post('/projects/:id/delete', (req, res) => {
  const project = loadOwnedProject(req, res);
  if (!project) return;
  Projects.delete(project.id, req.user.id);
  res.redirect('/admin');
});

module.exports = router;
