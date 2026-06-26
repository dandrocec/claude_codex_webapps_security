const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const methodOverride = require('method-override');
const bcrypt = require('bcryptjs');
const { getDb } = require('./db');

const SQLiteStore = SQLiteStoreFactory(session);
const app = express();
const PORT = 5092;
const dataDir = path.join(__dirname, '..', 'data');

fs.mkdirSync(dataDir, { recursive: true });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, '..', 'data') }),
    secret: process.env.SESSION_SECRET || 'local-dev-clinic-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
  })
);

app.use(async (req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

function flash(req, type, message) {
  req.session.flash = { type, message };
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (!roles.includes(req.session.user.role)) return res.status(403).render('forbidden');
    next();
  };
}

function dashboardFor(role) {
  if (role === 'patient') return '/patient';
  if (role === 'doctor') return '/doctor';
  return '/reception';
}

async function getPatientForUser(userId) {
  const db = await getDb();
  return db.get('SELECT * FROM patients WHERE user_id = ?', userId);
}

async function getDoctorForUser(userId) {
  const db = await getDb();
  return db.get('SELECT * FROM doctors WHERE user_id = ?', userId);
}

async function doctorCanAccessPatient(doctorId, patientId) {
  const db = await getDb();
  const row = await db.get(
    'SELECT 1 FROM doctor_patients WHERE doctor_id = ? AND patient_id = ?',
    doctorId,
    patientId
  );
  return Boolean(row);
}

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect(dashboardFor(req.session.user.role));
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', async (req, res) => {
  const db = await getDb();
  const { username, password } = req.body;
  const user = await db.get('SELECT * FROM users WHERE username = ?', username);

  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    flash(req, 'error', 'Invalid username or password.');
    return res.redirect('/login');
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role,
    fullName: user.full_name
  };
  res.redirect(dashboardFor(user.role));
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/patient', requireRole('patient'), async (req, res) => {
  const db = await getDb();
  const patient = await getPatientForUser(req.session.user.id);
  const appointments = await db.all(
    `SELECT a.*, du.full_name AS doctor_name, d.specialty
       FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
       JOIN users du ON du.id = d.user_id
      WHERE a.patient_id = ?
      ORDER BY a.starts_at DESC`,
    patient.id
  );
  const records = await db.all(
    `SELECT r.*, du.full_name AS doctor_name
       FROM medical_records r
       JOIN doctors d ON d.id = r.doctor_id
       JOIN users du ON du.id = d.user_id
      WHERE r.patient_id = ?
      ORDER BY r.updated_at DESC`,
    patient.id
  );
  const doctors = await db.all(
    `SELECT d.id, u.full_name, d.specialty
       FROM doctor_patients dp
       JOIN doctors d ON d.id = dp.doctor_id
       JOIN users u ON u.id = d.user_id
      WHERE dp.patient_id = ?
      ORDER BY u.full_name`,
    patient.id
  );
  res.render('patient', { appointments, records, doctors });
});

app.post('/patient/appointments', requireRole('patient'), async (req, res) => {
  const db = await getDb();
  const patient = await getPatientForUser(req.session.user.id);
  const doctorId = Number(req.body.doctor_id);
  const assigned = await doctorCanAccessPatient(doctorId, patient.id);

  if (!assigned) return res.status(403).render('forbidden');
  await db.run(
    'INSERT INTO appointments (patient_id, doctor_id, starts_at, reason, created_by_user_id) VALUES (?, ?, ?, ?, ?)',
    patient.id,
    doctorId,
    req.body.starts_at,
    req.body.reason,
    req.session.user.id
  );
  flash(req, 'success', 'Appointment booked.');
  res.redirect('/patient');
});

app.get('/doctor', requireRole('doctor'), async (req, res) => {
  const db = await getDb();
  const doctor = await getDoctorForUser(req.session.user.id);
  const appointments = await db.all(
    `SELECT a.*, pu.full_name AS patient_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN users pu ON pu.id = p.user_id
      WHERE a.doctor_id = ?
      ORDER BY a.starts_at DESC`,
    doctor.id
  );
  const patients = await db.all(
    `SELECT p.id, p.date_of_birth, p.phone, u.full_name
       FROM doctor_patients dp
       JOIN patients p ON p.id = dp.patient_id
       JOIN users u ON u.id = p.user_id
      WHERE dp.doctor_id = ?
      ORDER BY u.full_name`,
    doctor.id
  );
  res.render('doctor', { appointments, patients });
});

app.get('/doctor/patients/:patientId', requireRole('doctor'), async (req, res) => {
  const db = await getDb();
  const doctor = await getDoctorForUser(req.session.user.id);
  const patientId = Number(req.params.patientId);
  if (!(await doctorCanAccessPatient(doctor.id, patientId))) return res.status(403).render('forbidden');

  const patient = await db.get(
    `SELECT p.*, u.full_name
       FROM patients p
       JOIN users u ON u.id = p.user_id
      WHERE p.id = ?`,
    patientId
  );
  const records = await db.all(
    `SELECT r.*, du.full_name AS doctor_name
       FROM medical_records r
       JOIN doctors d ON d.id = r.doctor_id
       JOIN users du ON du.id = d.user_id
      WHERE r.patient_id = ?
      ORDER BY r.updated_at DESC`,
    patientId
  );
  res.render('doctor_patient', { patient, records });
});

app.post('/doctor/patients/:patientId/records', requireRole('doctor'), async (req, res) => {
  const db = await getDb();
  const doctor = await getDoctorForUser(req.session.user.id);
  const patientId = Number(req.params.patientId);
  if (!(await doctorCanAccessPatient(doctor.id, patientId))) return res.status(403).render('forbidden');

  await db.run(
    `INSERT INTO medical_records
      (patient_id, doctor_id, diagnosis, treatment, notes, updated_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?)`,
    patientId,
    doctor.id,
    req.body.diagnosis,
    req.body.treatment,
    req.body.notes,
    req.session.user.id
  );
  flash(req, 'success', 'Record added.');
  res.redirect(`/doctor/patients/${patientId}`);
});

app.post('/doctor/records/:recordId', requireRole('doctor'), async (req, res) => {
  const db = await getDb();
  const doctor = await getDoctorForUser(req.session.user.id);
  const record = await db.get('SELECT * FROM medical_records WHERE id = ?', req.params.recordId);

  if (!record || !(await doctorCanAccessPatient(doctor.id, record.patient_id))) {
    return res.status(403).render('forbidden');
  }

  await db.run(
    `UPDATE medical_records
        SET diagnosis = ?,
            treatment = ?,
            notes = ?,
            updated_by_user_id = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    req.body.diagnosis,
    req.body.treatment,
    req.body.notes,
    req.session.user.id,
    req.params.recordId
  );
  flash(req, 'success', 'Record updated.');
  res.redirect(`/doctor/patients/${record.patient_id}`);
});

app.post('/doctor/appointments/:id/status', requireRole('doctor'), async (req, res) => {
  const db = await getDb();
  const doctor = await getDoctorForUser(req.session.user.id);
  const appointment = await db.get('SELECT * FROM appointments WHERE id = ? AND doctor_id = ?', req.params.id, doctor.id);
  if (!appointment) return res.status(403).render('forbidden');

  await db.run(
    "UPDATE appointments SET status = ? WHERE id = ? AND doctor_id = ?",
    req.body.status,
    req.params.id,
    doctor.id
  );
  flash(req, 'success', 'Appointment status updated.');
  res.redirect('/doctor');
});

app.get('/reception', requireRole('receptionist'), async (req, res) => {
  const db = await getDb();
  const [appointments, patients, doctors] = await Promise.all([
    db.all(
      `SELECT a.*, pu.full_name AS patient_name, du.full_name AS doctor_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN users pu ON pu.id = p.user_id
         JOIN doctors d ON d.id = a.doctor_id
         JOIN users du ON du.id = d.user_id
        ORDER BY a.starts_at DESC`
    ),
    db.all(
      `SELECT p.id, u.full_name
         FROM patients p
         JOIN users u ON u.id = p.user_id
        ORDER BY u.full_name`
    ),
    db.all(
      `SELECT d.id, u.full_name, d.specialty
         FROM doctors d
         JOIN users u ON u.id = d.user_id
        ORDER BY u.full_name`
    )
  ]);
  res.render('reception', { appointments, patients, doctors });
});

app.post('/reception/appointments', requireRole('receptionist'), async (req, res) => {
  const db = await getDb();
  await db.run(
    'INSERT INTO appointments (patient_id, doctor_id, starts_at, reason, status, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?)',
    req.body.patient_id,
    req.body.doctor_id,
    req.body.starts_at,
    req.body.reason,
    req.body.status,
    req.session.user.id
  );
  flash(req, 'success', 'Appointment created.');
  res.redirect('/reception');
});

app.post('/reception/appointments/:id', requireRole('receptionist'), async (req, res) => {
  const db = await getDb();
  await db.run(
    `UPDATE appointments
        SET patient_id = ?, doctor_id = ?, starts_at = ?, reason = ?, status = ?
      WHERE id = ?`,
    req.body.patient_id,
    req.body.doctor_id,
    req.body.starts_at,
    req.body.reason,
    req.body.status,
    req.params.id
  );
  flash(req, 'success', 'Appointment updated.');
  res.redirect('/reception');
});

app.post('/reception/appointments/:id/delete', requireRole('receptionist'), async (req, res) => {
  const db = await getDb();
  await db.run('DELETE FROM appointments WHERE id = ?', req.params.id);
  flash(req, 'success', 'Appointment removed.');
  res.redirect('/reception');
});

app.use(requireAuth, (req, res) => {
  res.status(404).render('not_found');
});

getDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Clinic portal running on http://localhost:${PORT}`);
  });
});
