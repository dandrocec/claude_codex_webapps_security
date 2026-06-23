'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const db = require('./db');
const { decrypt } = require('./crypto');

// Live log fan-out: deploymentId -> EventEmitter. Subscribers (SSE handlers)
// listen for 'log' and 'end' events. Persistence to the DB happens regardless
// of whether anyone is currently subscribed.
const emitters = new Map();

function emitterFor(deploymentId) {
  let em = emitters.get(deploymentId);
  if (!em) {
    em = new EventEmitter();
    em.setMaxListeners(0);
    emitters.set(deploymentId, em);
  }
  return em;
}

const insertLog = db.prepare(
  'INSERT INTO logs (deployment_id, stream, line) VALUES (?, ?, ?)'
);

function record(deploymentId, stream, line) {
  const info = insertLog.run(deploymentId, stream, line);
  const row = {
    id: info.lastInsertRowid,
    deployment_id: deploymentId,
    stream,
    line,
    ts: new Date().toISOString(),
  };
  emitterFor(deploymentId).emit('log', row);
  return row;
}

function setStatus(deploymentId, status, finished) {
  if (finished) {
    db.prepare('UPDATE deployments SET status = ?, finished_at = datetime(\'now\') WHERE id = ?')
      .run(status, deploymentId);
  } else {
    db.prepare('UPDATE deployments SET status = ?, started_at = datetime(\'now\') WHERE id = ?')
      .run(status, deploymentId);
  }
}

function loadSecretEnv(serviceId) {
  const rows = db
    .prepare('SELECT key, value_encrypted, iv, tag FROM secrets WHERE service_id = ?')
    .all(serviceId);
  const env = {};
  for (const r of rows) {
    try {
      env[r.key] = decrypt(r);
    } catch (e) {
      // A corrupt/unreadable secret should not crash the deployment.
      env[r.key] = '';
    }
  }
  return env;
}

// Run a single shell command, streaming its output. Resolves with the exit code.
function runStep(deploymentId, step, env) {
  return new Promise((resolve) => {
    record(deploymentId, 'system', `$ ${step.command}`);

    const child = spawn(step.command, {
      shell: true,
      env: { ...process.env, ...env },
      windowsHide: true,
    });

    let buffers = { stdout: '', stderr: '' };

    function handle(streamName, chunk) {
      buffers[streamName] += chunk.toString();
      const parts = buffers[streamName].split(/\r?\n/);
      buffers[streamName] = parts.pop(); // keep trailing partial line
      for (const line of parts) record(deploymentId, streamName, line);
    }

    child.stdout.on('data', (c) => handle('stdout', c));
    child.stderr.on('data', (c) => handle('stderr', c));

    child.on('error', (err) => {
      record(deploymentId, 'stderr', `Failed to start step: ${err.message}`);
      resolve(1);
    });

    child.on('close', (code) => {
      // flush any trailing partial lines
      if (buffers.stdout) record(deploymentId, 'stdout', buffers.stdout);
      if (buffers.stderr) record(deploymentId, 'stderr', buffers.stderr);
      record(deploymentId, 'system', `[exit code ${code}]`);
      resolve(code == null ? 1 : code);
    });
  });
}

// Execute all steps of a deployment in sequence. Stops on first failure.
async function runDeployment(deploymentId) {
  const dep = db.prepare('SELECT * FROM deployments WHERE id = ?').get(deploymentId);
  if (!dep) return;
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(dep.service_id);
  if (!service) return;

  let steps;
  try {
    steps = JSON.parse(service.steps || '[]');
  } catch {
    steps = [];
  }

  setStatus(deploymentId, 'running', false);
  record(deploymentId, 'system', `Deployment #${deploymentId} started for service "${service.name}"`);

  const env = loadSecretEnv(service.id);
  if (Object.keys(env).length) {
    record(deploymentId, 'system', `Injected ${Object.keys(env).length} secret(s) into the environment`);
  }

  let ok = true;
  if (!steps.length) {
    record(deploymentId, 'system', 'No steps defined for this service.');
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    record(deploymentId, 'system', `--- Step ${i + 1}/${steps.length}: ${step.name || step.command} ---`);
    const code = await runStep(deploymentId, step, env);
    if (code !== 0) {
      ok = false;
      record(deploymentId, 'system', `Step failed (exit ${code}); aborting deployment.`);
      break;
    }
  }

  const finalStatus = ok ? 'success' : 'failed';
  setStatus(deploymentId, finalStatus, true);
  record(deploymentId, 'system', `Deployment #${deploymentId} finished: ${finalStatus.toUpperCase()}`);
  emitterFor(deploymentId).emit('end', { status: finalStatus });
}

// Kick off a deployment without blocking the request.
function startDeployment(serviceId, userId) {
  const info = db
    .prepare('INSERT INTO deployments (service_id, status, triggered_by) VALUES (?, ?, ?)')
    .run(serviceId, 'pending', userId);
  const deploymentId = info.lastInsertRowid;
  setImmediate(() => {
    runDeployment(deploymentId).catch((err) => {
      record(deploymentId, 'system', `Runner error: ${err.message}`);
      setStatus(deploymentId, 'failed', true);
      emitterFor(deploymentId).emit('end', { status: 'failed' });
    });
  });
  return deploymentId;
}

module.exports = { startDeployment, emitterFor };
