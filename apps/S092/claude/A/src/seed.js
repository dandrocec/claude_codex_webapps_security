'use strict';

// Idempotent seed: creates demo users and sample data if the DB is empty.
const bcrypt = require('bcryptjs');
const { db, init } = require('./db');

function seed() {
  init();

  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) {
    console.log('Database already seeded (%d users). Skipping.', count);
    return;
  }

  const hash = (pw) => bcrypt.hashSync(pw, 10);
  const insertUser = db.prepare(
    `INSERT INTO users (username, password_hash, role, full_name, specialty)
     VALUES (?, ?, ?, ?, ?)`
  );

  // Everyone's demo password is "password".
  const pw = hash('password');

  const drSmith = insertUser.run('drsmith', pw, 'doctor', 'Dr. Sarah Smith', 'General Medicine').lastInsertRowid;
  const drJones = insertUser.run('drjones', pw, 'doctor', 'Dr. Alan Jones', 'Cardiology').lastInsertRowid;
  const reception = insertUser.run('reception', pw, 'receptionist', 'Rita Reception', null).lastInsertRowid;
  const alice = insertUser.run('alice', pw, 'patient', 'Alice Patient', null).lastInsertRowid;
  const bob = insertUser.run('bob', pw, 'patient', 'Bob Patient', null).lastInsertRowid;

  const insertAppt = db.prepare(
    `INSERT INTO appointments (patient_id, doctor_id, slot, reason, status)
     VALUES (?, ?, ?, ?, ?)`
  );
  insertAppt.run(alice, drSmith, '2026-06-25T09:30', 'Annual check-up', 'confirmed');
  insertAppt.run(alice, drJones, '2026-07-02T14:00', 'Chest pain follow-up', 'requested');
  insertAppt.run(bob, drSmith, '2026-06-26T11:00', 'Persistent cough', 'requested');

  const insertRecord = db.prepare(
    `INSERT INTO medical_records (patient_id, doctor_id, diagnosis, treatment, notes)
     VALUES (?, ?, ?, ?, ?)`
  );
  insertRecord.run(alice, drSmith, 'Mild hypertension', 'Lifestyle changes; recheck in 3 months',
    'Patient advised to reduce sodium intake.');

  console.log('Seeded demo data.');
  console.log('Login with any of these (password: "password"):');
  console.log('  doctor       -> drsmith, drjones');
  console.log('  receptionist -> reception');
  console.log('  patient      -> alice, bob');
}

seed();
