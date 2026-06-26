const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'clinic.sqlite');

let db;

async function getDb() {
  if (db) return db;

  fs.mkdirSync(dataDir, { recursive: true });
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.exec('PRAGMA foreign_keys = ON');
  await migrate();
  await seed();
  return db;
}

async function migrate() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('patient', 'doctor', 'receptionist')),
      full_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      date_of_birth TEXT NOT NULL,
      phone TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS doctors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      specialty TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS doctor_patients (
      doctor_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      PRIMARY KEY (doctor_id, patient_id),
      FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      starts_at TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('booked', 'checked-in', 'completed', 'cancelled')) DEFAULT 'booked',
      created_by_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS medical_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      diagnosis TEXT NOT NULL,
      treatment TEXT NOT NULL,
      notes TEXT NOT NULL,
      updated_by_user_id INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
    );
  `);
}

async function seed() {
  const existing = await db.get('SELECT COUNT(*) AS count FROM users');
  if (existing.count > 0) return;

  const passwordHash = await bcrypt.hash('password123', 10);
  const users = [
    ['alice.patient', 'patient', 'Alice Morgan'],
    ['bob.patient', 'patient', 'Bob Patel'],
    ['dr.smith', 'doctor', 'Dr. Evelyn Smith'],
    ['dr.lee', 'doctor', 'Dr. Marcus Lee'],
    ['reception', 'receptionist', 'Jordan Reed']
  ];

  const ids = {};
  for (const [username, role, fullName] of users) {
    const result = await db.run(
      'INSERT INTO users (username, password_hash, role, full_name) VALUES (?, ?, ?, ?)',
      username,
      passwordHash,
      role,
      fullName
    );
    ids[username] = result.lastID;
  }

  const alice = await db.run(
    'INSERT INTO patients (user_id, date_of_birth, phone) VALUES (?, ?, ?)',
    ids['alice.patient'],
    '1990-04-12',
    '555-0101'
  );
  const bob = await db.run(
    'INSERT INTO patients (user_id, date_of_birth, phone) VALUES (?, ?, ?)',
    ids['bob.patient'],
    '1984-09-21',
    '555-0102'
  );
  const smith = await db.run(
    'INSERT INTO doctors (user_id, specialty) VALUES (?, ?)',
    ids['dr.smith'],
    'Family Medicine'
  );
  const lee = await db.run(
    'INSERT INTO doctors (user_id, specialty) VALUES (?, ?)',
    ids['dr.lee'],
    'Cardiology'
  );

  await db.run('INSERT INTO doctor_patients (doctor_id, patient_id) VALUES (?, ?)', smith.lastID, alice.lastID);
  await db.run('INSERT INTO doctor_patients (doctor_id, patient_id) VALUES (?, ?)', smith.lastID, bob.lastID);
  await db.run('INSERT INTO doctor_patients (doctor_id, patient_id) VALUES (?, ?)', lee.lastID, bob.lastID);

  await db.run(
    'INSERT INTO appointments (patient_id, doctor_id, starts_at, reason, status, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?)',
    alice.lastID,
    smith.lastID,
    '2026-07-02T09:00',
    'Annual wellness visit',
    'booked',
    ids['reception']
  );
  await db.run(
    'INSERT INTO appointments (patient_id, doctor_id, starts_at, reason, status, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?)',
    bob.lastID,
    lee.lastID,
    '2026-07-03T11:30',
    'Blood pressure follow-up',
    'checked-in',
    ids['reception']
  );

  await db.run(
    `INSERT INTO medical_records
      (patient_id, doctor_id, diagnosis, treatment, notes, updated_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?)`,
    alice.lastID,
    smith.lastID,
    'Seasonal allergies',
    'Daily non-drowsy antihistamine as needed.',
    'Patient reports mild spring symptoms, no asthma history.',
    ids['dr.smith']
  );
  await db.run(
    `INSERT INTO medical_records
      (patient_id, doctor_id, diagnosis, treatment, notes, updated_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?)`,
    bob.lastID,
    lee.lastID,
    'Elevated blood pressure',
    'Lifestyle changes and home monitoring for 30 days.',
    'Follow-up scheduled to review home readings.',
    ids['dr.lee']
  );
}

module.exports = { getDb };
