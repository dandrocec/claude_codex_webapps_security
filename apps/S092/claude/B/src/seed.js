'use strict';

require('dotenv').config();

const bcrypt = require('bcryptjs');
const db = require('./db');

// Idempotent demo seed. Safe to run multiple times.
const upsertUser = db.prepare(`
  INSERT INTO users (username, email, full_name, role, password_hash, doctor_id)
  VALUES (@username, @email, @full_name, @role, @password_hash, @doctor_id)
  ON CONFLICT(username) DO UPDATE SET
    email = excluded.email,
    full_name = excluded.full_name,
    role = excluded.role,
    password_hash = excluded.password_hash,
    doctor_id = excluded.doctor_id
`);
const getUser = db.prepare('SELECT id FROM users WHERE username = ?');

const PW = 'Password123!'; // demo password for every seeded account
const hash = bcrypt.hashSync(PW, 12);

function make(username, email, full_name, role, doctor_id = null) {
  upsertUser.run({ username, email, full_name, role, password_hash: hash, doctor_id });
  return getUser.get(username).id;
}

const seed = db.transaction(() => {
  const drHouse = make('dr.house', 'house@clinic.test', 'Dr. Gregory House', 'doctor');
  const drGrey = make('dr.grey', 'grey@clinic.test', 'Dr. Meredith Grey', 'doctor');

  make('reception', 'front.desk@clinic.test', 'Rita Reception', 'receptionist');

  const alice = make('alice', 'alice@example.test', 'Alice Patient', 'patient', drHouse);
  const bob = make('bob', 'bob@example.test', 'Bob Patient', 'patient', drGrey);

  // A couple of records and appointments so the views aren't empty.
  const recCount = db.prepare('SELECT COUNT(*) AS c FROM records').get().c;
  if (recCount === 0) {
    db.prepare(
      'INSERT INTO records (patient_id, doctor_id, title, notes) VALUES (?, ?, ?, ?)'
    ).run(alice, drHouse, 'Initial consultation', 'Patient reports mild headaches. Advised rest and hydration.');
    db.prepare(
      'INSERT INTO records (patient_id, doctor_id, title, notes) VALUES (?, ?, ?, ?)'
    ).run(bob, drGrey, 'Annual check-up', 'All vitals normal.');
  }

  const apptCount = db.prepare('SELECT COUNT(*) AS c FROM appointments').get().c;
  if (apptCount === 0) {
    db.prepare(
      "INSERT INTO appointments (patient_id, doctor_id, scheduled_at, reason, status) VALUES (?, ?, datetime('now','+2 days'), ?, 'confirmed')"
    ).run(alice, drHouse, 'Follow-up on headaches');
    db.prepare(
      "INSERT INTO appointments (patient_id, doctor_id, scheduled_at, reason, status) VALUES (?, ?, datetime('now','+5 days'), ?, 'requested')"
    ).run(bob, drGrey, 'Sore throat');
  }
});

seed();

console.log('Seed complete. Demo accounts (password for all: %s):', PW);
console.log('  doctor       -> dr.house / dr.grey');
console.log('  receptionist -> reception');
console.log('  patient      -> alice (Dr. House) / bob (Dr. Grey)');
