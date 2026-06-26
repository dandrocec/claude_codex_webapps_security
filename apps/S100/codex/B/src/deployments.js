const { spawn } = require("child_process");
const db = require("./db");
const { decryptSecret, redactSecrets } = require("./crypto");

const subscribers = new Map();

function publish(deploymentId, event) {
  const listeners = subscribers.get(Number(deploymentId));
  if (!listeners) return;
  for (const res of listeners) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

function subscribe(deploymentId, res) {
  const id = Number(deploymentId);
  if (!subscribers.has(id)) subscribers.set(id, new Set());
  subscribers.get(id).add(res);
  res.on("close", () => {
    const listeners = subscribers.get(id);
    if (!listeners) return;
    listeners.delete(res);
    if (listeners.size === 0) subscribers.delete(id);
  });
}

const insertLog = db.prepare(`
  INSERT INTO deployment_logs (deployment_id, line_no, stream, content)
  VALUES (?, ?, ?, ?)
`);
const nextLine = db.prepare("SELECT COALESCE(MAX(line_no), 0) + 1 AS n FROM deployment_logs WHERE deployment_id = ?");

function appendLog(deploymentId, stream, content, secretValues = []) {
  const safe = redactSecrets(String(content).slice(0, 8000), secretValues);
  const lineNo = nextLine.get(deploymentId).n;
  insertLog.run(deploymentId, lineNo, stream, safe);
  publish(deploymentId, { lineNo, stream, content: safe });
}

function loadSecrets(serviceId) {
  const rows = db.prepare("SELECT name, encrypted_value FROM service_secrets WHERE service_id = ?").all(serviceId);
  const env = {};
  const values = [];
  for (const row of rows) {
    const value = decryptSecret(row.encrypted_value);
    env[row.name] = value;
    values.push(value);
  }
  return { env, values };
}

function runStep(command, options) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      windowsHide: true
    });

    child.stdout.on("data", (data) => appendLog(options.deploymentId, "stdout", data.toString(), options.secretValues));
    child.stderr.on("data", (data) => appendLog(options.deploymentId, "stderr", data.toString(), options.secretValues));
    child.on("error", (err) => {
      appendLog(options.deploymentId, "stderr", err.message, options.secretValues);
      resolve(1);
    });
    child.on("close", (code) => resolve(code || 0));
  });
}

async function startDeployment(deploymentId) {
  const deployment = db.prepare(`
    SELECT d.*, s.name, s.deploy_steps, s.working_directory
    FROM deployments d
    JOIN services s ON s.id = d.service_id
    WHERE d.id = ?
  `).get(deploymentId);
  if (!deployment) return;

  db.prepare("UPDATE deployments SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = ?").run(deploymentId);
  publish(deploymentId, { status: "running" });

  let secretContext;
  try {
    secretContext = loadSecrets(deployment.service_id);
  } catch (err) {
    appendLog(deploymentId, "stderr", "Unable to decrypt service secrets.");
    db.prepare("UPDATE deployments SET status = 'failed', exit_code = 1, finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(deploymentId);
    publish(deploymentId, { status: "failed" });
    return;
  }

  const steps = JSON.parse(deployment.deploy_steps);
  appendLog(deploymentId, "system", `Deployment started for ${deployment.name}.`, secretContext.values);

  for (const step of steps) {
    appendLog(deploymentId, "system", `$ ${step}`, secretContext.values);
    const code = await runStep(step, {
      deploymentId,
      cwd: deployment.working_directory || process.cwd(),
      env: secretContext.env,
      secretValues: secretContext.values
    });
    if (code !== 0) {
      appendLog(deploymentId, "system", `Step failed with exit code ${code}.`, secretContext.values);
      db.prepare("UPDATE deployments SET status = 'failed', exit_code = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(code, deploymentId);
      publish(deploymentId, { status: "failed", exitCode: code });
      return;
    }
  }

  appendLog(deploymentId, "system", "Deployment completed successfully.", secretContext.values);
  db.prepare("UPDATE deployments SET status = 'success', exit_code = 0, finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(deploymentId);
  publish(deploymentId, { status: "success", exitCode: 0 });
}

function enqueueDeployment(serviceId, userId) {
  const result = db.prepare(`
    INSERT INTO deployments (service_id, triggered_by, status)
    VALUES (?, ?, 'queued')
  `).run(serviceId, userId);
  setImmediate(() => startDeployment(result.lastInsertRowid).catch(() => {
    db.prepare("UPDATE deployments SET status = 'failed', exit_code = 1, finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(result.lastInsertRowid);
  }));
  return result.lastInsertRowid;
}

module.exports = { enqueueDeployment, subscribe };
