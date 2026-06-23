'use strict';

/**
 * Executes a service's deployment steps sequentially.
 *
 * SECURITY / TRUST MODEL
 * ----------------------
 * Running shell steps is the core feature of this tool, so the operator-defined
 * commands ARE executed. That capability is therefore restricted by access
 * control, not by trying to "sanitise" the command text:
 *   - Only authenticated users with the 'operator' role can define steps.
 *   - Only the OWNER of a service can edit its steps or trigger its
 *     deployments (enforced in the routes — see IDOR checks there).
 * Treat operator accounts as you would shell accounts on the box.
 *
 * Each step runs with the service's decrypted secrets injected as environment
 * variables. Output is streamed live to subscribers (SSE) and persisted to the
 * database line-by-line so it can be replayed later.
 */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const deploymentModel = require('../models/deploymentModel');
const secretModel = require('../models/secretModel');

// deploymentId -> { emitter, done } for in-flight deployments.
const active = new Map();

const STEP_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per step

function isActive(deploymentId) {
  return active.has(deploymentId);
}

function subscribe(deploymentId, listener) {
  const entry = active.get(deploymentId);
  if (!entry) return null;
  entry.emitter.on('log', listener);
  return () => entry.emitter.off('log', listener);
}

function onDone(deploymentId, listener) {
  const entry = active.get(deploymentId);
  if (!entry) return null;
  entry.emitter.once('done', listener);
  return () => entry.emitter.off('done', listener);
}

/**
 * Start a deployment. Returns the created deployment record immediately;
 * execution continues asynchronously.
 */
function start(service, user) {
  const deployment = deploymentModel.create(service.id, user.id);
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  active.set(deployment.id, { emitter });

  // Snapshot secrets at trigger time.
  let secretEnv = {};
  try {
    secretEnv = secretModel.getDecryptedMap(service.id);
  } catch (err) {
    // If decryption fails (e.g. key rotated), proceed without secrets but log it.
    emitLine(deployment.id, emitter, 'system', `Warning: could not load secrets: ${err.message}`);
  }

  runSteps(deployment, service, secretEnv, emitter).catch((err) => {
    emitLine(deployment.id, emitter, 'system', `Fatal: ${err.message}`);
    finish(deployment.id, emitter, 'failed');
  });

  return deployment;
}

let seqCounters = new Map();

function nextSeq(deploymentId) {
  const cur = (seqCounters.get(deploymentId) || 0) + 1;
  seqCounters.set(deploymentId, cur);
  return cur;
}

function emitLine(deploymentId, emitter, stream, text) {
  // Split on newlines so each logical line is a separate stored/streamed record.
  const lines = String(text).split(/\r?\n/);
  for (const raw of lines) {
    if (raw === '') continue;
    const seq = nextSeq(deploymentId);
    deploymentModel.appendLog(deploymentId, seq, stream, raw);
    emitter.emit('log', { seq, stream, line: raw });
  }
}

async function runSteps(deployment, service, secretEnv, emitter) {
  const steps = Array.isArray(service.steps) ? service.steps : [];
  emitLine(deployment.id, emitter, 'system', `Starting deployment #${deployment.id} for "${service.name}" (${steps.length} step(s)).`);

  if (steps.length === 0) {
    emitLine(deployment.id, emitter, 'system', 'No steps configured — nothing to do.');
    finish(deployment.id, emitter, 'success');
    return;
  }

  // Child environment: inherit a clean copy and overlay secrets.
  const childEnv = { ...process.env, ...secretEnv };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const label = step.name || `step ${i + 1}`;
    emitLine(deployment.id, emitter, 'system', `\n=== [${i + 1}/${steps.length}] ${label} ===`);
    emitLine(deployment.id, emitter, 'system', `$ ${step.command}`);

    const code = await runOne(deployment.id, step.command, childEnv, emitter);
    if (code !== 0) {
      emitLine(deployment.id, emitter, 'system', `Step "${label}" exited with code ${code}. Aborting.`);
      finish(deployment.id, emitter, 'failed');
      return;
    }
  }

  emitLine(deployment.id, emitter, 'system', '\nAll steps completed successfully.');
  finish(deployment.id, emitter, 'success');
}

function runOne(deploymentId, command, env, emitter) {
  return new Promise((resolve) => {
    let child;
    try {
      // shell:true is intentional — steps are shell commands by design.
      child = spawn(command, {
        shell: true,
        env,
        windowsHide: true,
      });
    } catch (err) {
      emitLine(deploymentId, emitter, 'system', `Failed to start command: ${err.message}`);
      return resolve(1);
    }

    const timer = setTimeout(() => {
      emitLine(deploymentId, emitter, 'system', `Step timed out after ${STEP_TIMEOUT_MS / 1000}s; killing.`);
      child.kill('SIGKILL');
    }, STEP_TIMEOUT_MS);

    child.stdout.on('data', (d) => emitLine(deploymentId, emitter, 'stdout', d.toString()));
    child.stderr.on('data', (d) => emitLine(deploymentId, emitter, 'stderr', d.toString()));

    child.on('error', (err) => {
      clearTimeout(timer);
      emitLine(deploymentId, emitter, 'system', `Process error: ${err.message}`);
      resolve(1);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === null ? 1 : code);
    });
  });
}

function finish(deploymentId, emitter, status) {
  deploymentModel.setStatus(deploymentId, status);
  emitter.emit('done', { status });
  // Give SSE subscribers a tick to flush, then clean up.
  setImmediate(() => {
    active.delete(deploymentId);
    seqCounters.delete(deploymentId);
    emitter.removeAllListeners();
  });
}

module.exports = { start, subscribe, onDone, isActive };
