'use strict';

const db = require('../src/db');
const auth = require('../src/auth');

// Seed two default accounts (one per role) if no users exist yet, plus a demo
// service so the dashboard has something to show on first launch.
function ensureSeed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;

  auth.createUser('operator', 'operator123', 'operator');
  auth.createUser('viewer', 'viewer123', 'viewer');

  const operator = auth.findUserByUsername('operator');

  // Plain echo commands run identically under cmd.exe and POSIX sh.
  const demoSteps = JSON.stringify([
    { name: 'Checkout', command: 'echo Checking out demo-service' },
    { name: 'Install', command: 'echo Installing dependencies' },
    { name: 'Build', command: 'echo Building... && echo Build complete.' },
    { name: 'Deploy', command: 'echo Deploy succeeded' },
  ]);

  db.prepare(
    'INSERT INTO services (name, description, repo_url, steps, created_by) VALUES (?, ?, ?, ?, ?)'
  ).run(
    'demo-service',
    'A sample service to demonstrate deployments.',
    'https://example.com/org/demo-service.git',
    demoSteps,
    operator.id
  );

  console.log('Seeded default users (operator/operator123, viewer/viewer123) and demo-service.');
}

module.exports = { ensureSeed };

// Allow running directly: `npm run seed`
if (require.main === module) {
  ensureSeed();
}
