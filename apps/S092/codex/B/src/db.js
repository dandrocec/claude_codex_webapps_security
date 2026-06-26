const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcrypt');

const ROLE_PATIENT = 'patient';
const ROLE_DOCTOR = 'doctor';
const ROLE_RECEPTIONIST = 'receptionist';
const ROLES = [ROLE_PATIENT, ROLE_DOCTOR, ROLE_RECEPTIONIST];

let db;

async function getDb() {
  if (!db) {
    const filename = process.env.DATABASE_FILE || 'clinic.sqlite';
    db = await open({
      filename: path.resolve(process.cwd(), filename),
      driver: sqlite3.Database
    });
    await db.exec('PRAGMA foreign_keys = ON');
  }
  return db;
}

async function migrate() {
  const database = await getDb();
  await database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('patient', 'doctor', 'receptionist')),
      full_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS doctor_patients (
      doctor_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      PRIMARY KEY (doctor_id, patient_id),
      FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      starts_at TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('requested', 'scheduled', 'completed', 'cancelled')) DEFAULT 'requested',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      notes TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

async function seedDemoData() {
  const database = await getDb();
  const existing = await database.get('SELECT COUNT(*) AS total FROM users');
  if (existing.total > 0) return;

  const demoPassword = process.env.DEMO_PASSWORD;
  if (!demoPassword || demoPassword.length < 12) {
    throw new Error('DEMO_PASSWORD must be set to at least 12 characters before first run.');
  }

  const passwordHash = await bcrypt.hash(demoPassword, 12);
  const doctor = await database.run(
    'INSERT INTO users (email, password_hash, role, full_name) VALUES (?, ?, ?, ?)',
    'doctor@example.com',
    passwordHash,
    ROLE_DOCTOR,
    'Dr. Avery Singh'
  );
  const patient = await database.run(
    'INSERT INTO users (email, password_hash, role, full_name) VALUES (?, ?, ?, ?)',
    'patient@example.com',
    passwordHash,
    ROLE_PATIENT,
    'Jordan Lee'
  );
  await database.run(
    'INSERT INTO users (email, password_hash, role, full_name) VALUES (?, ?, ?, ?)',
    'reception@example.com',
    passwordHash,
    ROLE_RECEPTIONIST,
    'Morgan Patel'
  );
  await database.run(
    'INSERT INTO doctor_patients (doctor_id, patient_id) VALUES (?, ?)',
    doctor.lastID,
    patient.lastID
  );
  await database.run(
    'INSERT INTO records (patient_id, doctor_id, title, notes) VALUES (?, ?, ?, ?)',
    patient.lastID,
    doctor.lastID,
    'Initial visit',
    'Patient reports seasonal allergies. No urgent concerns recorded.'
  );
  await database.run(
    'INSERT INTO appointments (patient_id, doctor_id, starts_at, reason, status) VALUES (?, ?, ?, ?, ?)',
    patient.lastID,
    doctor.lastID,
    new Date(Date.now() + 86400000).toISOString(),
    'Follow-up appointment',
    'scheduled'
  );
}

module.exports = {
  getDb,
  migrate,
  seedDemoData,
  ROLES,
  ROLE_PATIENT,
  ROLE_DOCTOR,
  ROLE_RECEPTIONIST
};
