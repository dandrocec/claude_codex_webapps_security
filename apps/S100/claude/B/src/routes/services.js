'use strict';

const express = require('express');
const serviceModel = require('../models/serviceModel');
const secretModel = require('../models/secretModel');
const deploymentModel = require('../models/deploymentModel');
const deployRunner = require('../lib/deployRunner');
const { requireAuth, requireOperator } = require('../middleware/auth');
const {
  serviceRules,
  secretRules,
  collectErrors,
  buildSteps,
} = require('../lib/validators');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse and validate a numeric :id route param. */
function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Load a service by id from the route. Loads the service into req.service.
 * Returns 404 (not 403) for missing services to avoid leaking existence.
 */
function loadService(req, res, next) {
  const id = parseId(req.params.id);
  if (id === null) return next(makeError(404, 'Service not found.'));
  const service = serviceModel.findById(id);
  if (!service) return next(makeError(404, 'Service not found.'));
  req.service = service;
  next();
}

/**
 * Ownership guard — the heart of IDOR prevention. The user may only MUTATE
 * (edit/delete/deploy/secrets) a service they own. Even an operator cannot act
 * on another operator's service.
 */
function requireOwnership(req, res, next) {
  if (!req.user) return next(makeError(401, 'Authentication required.'));
  if (req.service.owner_id !== req.user.id) {
    return next(makeError(403, 'You do not have access to this resource.'));
  }
  next();
}

function makeError(status, publicMessage) {
  const err = new Error(publicMessage);
  err.status = status;
  err.publicMessage = publicMessage;
  return err;
}

function isOwner(req) {
  return req.user && req.service && req.service.owner_id === req.user.id;
}

// ---------------------------------------------------------------------------
// Dashboard: list services
// ---------------------------------------------------------------------------

router.get('/', requireAuth, (req, res) => {
  const services = serviceModel.listAll();
  res.render('dashboard', { title: 'Dashboard', services });
});

// ---------------------------------------------------------------------------
// Create service (operators only)
// ---------------------------------------------------------------------------

router.get('/services/new', requireOperator, (req, res) => {
  res.render('service_form', {
    title: 'Register service',
    mode: 'create',
    service: { name: '', repo_url: '', description: '', steps: [] },
  });
});

router.post('/services', requireOperator, serviceRules, (req, res, next) => {
  const errors = collectErrors(req) || [];
  let steps = [];
  try {
    steps = buildSteps(req);
  } catch (e) {
    errors.push(e.message);
  }
  if (errors.length) {
    return res.status(400).render('service_form', {
      title: 'Register service',
      mode: 'create',
      errors,
      service: {
        name: req.body.name,
        repo_url: req.body.repo_url,
        description: req.body.description,
        steps,
      },
    });
  }
  const service = serviceModel.create({
    ownerId: req.user.id,
    name: req.body.name.trim(),
    repoUrl: (req.body.repo_url || '').trim(),
    description: (req.body.description || '').trim(),
    steps,
  });
  req.flash('success', `Service "${service.name}" registered.`);
  res.redirect(`/services/${service.id}`);
});

// ---------------------------------------------------------------------------
// View service detail
// ---------------------------------------------------------------------------

router.get('/services/:id', requireAuth, loadService, (req, res) => {
  const owner = isOwner(req);
  const deployments = deploymentModel.listByService(req.service.id);
  // Secret VALUES are never sent to the browser — only keys/metadata, and
  // only to the owner.
  const secrets = owner ? secretModel.listKeys(req.service.id) : [];
  res.render('service_detail', {
    title: req.service.name,
    service: req.service,
    isOwner: owner,
    deployments,
    secrets,
  });
});

// ---------------------------------------------------------------------------
// Edit / update service (owner only)
// ---------------------------------------------------------------------------

router.get('/services/:id/edit', requireOperator, loadService, requireOwnership, (req, res) => {
  res.render('service_form', {
    title: `Edit ${req.service.name}`,
    mode: 'edit',
    service: req.service,
  });
});

router.post('/services/:id', requireOperator, loadService, requireOwnership, serviceRules, (req, res) => {
  const errors = collectErrors(req) || [];
  let steps = [];
  try {
    steps = buildSteps(req);
  } catch (e) {
    errors.push(e.message);
  }
  if (errors.length) {
    return res.status(400).render('service_form', {
      title: `Edit ${req.service.name}`,
      mode: 'edit',
      errors,
      service: {
        id: req.service.id,
        name: req.body.name,
        repo_url: req.body.repo_url,
        description: req.body.description,
        steps,
      },
    });
  }
  serviceModel.update(req.service.id, {
    name: req.body.name.trim(),
    repoUrl: (req.body.repo_url || '').trim(),
    description: (req.body.description || '').trim(),
    steps,
  });
  req.flash('success', 'Service updated.');
  res.redirect(`/services/${req.service.id}`);
});

router.post('/services/:id/delete', requireOperator, loadService, requireOwnership, (req, res) => {
  serviceModel.remove(req.service.id);
  req.flash('success', 'Service deleted.');
  res.redirect('/');
});

// ---------------------------------------------------------------------------
// Secrets (owner only). Values are write-only from the UI's perspective.
// ---------------------------------------------------------------------------

router.post('/services/:id/secrets', requireOperator, loadService, requireOwnership, secretRules, (req, res) => {
  const errors = collectErrors(req);
  if (errors) {
    req.flash('error', errors.join(' '));
    return res.redirect(`/services/${req.service.id}`);
  }
  secretModel.setSecret(req.service.id, req.body.key.trim(), req.body.value);
  req.flash('success', `Secret "${req.body.key.trim()}" saved.`);
  res.redirect(`/services/${req.service.id}`);
});

router.post('/services/:id/secrets/:secretId/delete', requireOperator, loadService, requireOwnership, (req, res, next) => {
  const secretId = parseId(req.params.secretId);
  if (secretId === null) return next(makeError(404, 'Secret not found.'));
  secretModel.removeSecret(req.service.id, secretId);
  req.flash('success', 'Secret deleted.');
  res.redirect(`/services/${req.service.id}`);
});

// ---------------------------------------------------------------------------
// Deployments (owner only to trigger; viewers can read logs)
// ---------------------------------------------------------------------------

router.post('/services/:id/deploy', requireOperator, loadService, requireOwnership, (req, res) => {
  const deployment = deployRunner.start(req.service, req.user);
  req.flash('success', `Deployment #${deployment.id} started.`);
  res.redirect(`/services/${req.service.id}/deployments/${deployment.id}`);
});

// View a deployment + its logs (any authenticated user may read).
router.get('/services/:id/deployments/:deployId', requireAuth, loadService, (req, res, next) => {
  const deployId = parseId(req.params.deployId);
  if (deployId === null) return next(makeError(404, 'Deployment not found.'));
  const deployment = deploymentModel.findById(deployId);
  if (!deployment || deployment.service_id !== req.service.id) {
    return next(makeError(404, 'Deployment not found.'));
  }
  const logs = deploymentModel.getLogs(deployId);
  res.render('deployment_detail', {
    title: `Deployment #${deployment.id}`,
    service: req.service,
    deployment,
    logs,
    live: deployRunner.isActive(deployId),
  });
});

// Server-Sent Events stream for live logs.
router.get('/services/:id/deployments/:deployId/stream', requireAuth, loadService, (req, res, next) => {
  const deployId = parseId(req.params.deployId);
  if (deployId === null) return next(makeError(404, 'Deployment not found.'));
  const deployment = deploymentModel.findById(deployId);
  if (!deployment || deployment.service_id !== req.service.id) {
    return next(makeError(404, 'Deployment not found.'));
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // Replay any logs already persisted, then attach to the live stream.
  const existing = deploymentModel.getLogs(deployId);
  let lastSeq = 0;
  for (const row of existing) {
    sendEvent(res, 'log', row);
    lastSeq = row.seq;
  }

  if (!deployRunner.isActive(deployId)) {
    // Already finished — tell the client and close.
    sendEvent(res, 'done', { status: deployment.status });
    return res.end();
  }

  const unsubscribe = deployRunner.subscribe(deployId, (entry) => {
    if (entry.seq > lastSeq) {
      lastSeq = entry.seq;
      sendEvent(res, 'log', entry);
    }
  });
  const unsubDone = deployRunner.onDone(deployId, (info) => {
    sendEvent(res, 'done', info);
    cleanup();
    res.end();
  });

  // Heartbeat keeps proxies from closing the idle connection.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

  function cleanup() {
    clearInterval(heartbeat);
    if (unsubscribe) unsubscribe();
    if (unsubDone) unsubDone();
  }

  req.on('close', cleanup);
});

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

module.exports = router;
