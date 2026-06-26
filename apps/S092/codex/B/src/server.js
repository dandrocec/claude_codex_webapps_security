require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const { body, param, validationResult } = require('express-validator');

const {
  getDb,
  migrate,
  seedDemoData,
  ROLE_PATIENT,
  ROLE_DOCTOR,
  ROLE_RECEPTIONIST
} = require('./db');
const { csrfToken, requireCsrf, requireAuth, requireRole, handleValidation } = require('./security');

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const port = Number(process.env.PORT || 5092);

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to at least 32 characters.');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 250, standardHeaders: true, legacyHeaders: false }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: false }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: process.cwd() }),
  name: 'clinic.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== 'false',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 4
  }
}));
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.csrfToken = csrfToken(req);
  res.locals.errors = [];
  next();
});
app.use(requireCsrf);

function dashboardFor(role) {
  if (role === ROLE_PATIENT) return '/patient';
  if (role === ROLE_DOCTOR) return '/doctor';
  if (role === ROLE_RECEPTIONIST) return '/reception';
  return '/login';
}

async function canDoctorAccessPatient(doctorId, patientId) {
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
  res.render('login', { title: 'Sign in', email: '' });
});

app.post(
  '/login',
  body('email').isEmail().normalizeEmail().withMessage('Enter a valid email address.'),
  body('password').isLength({ min: 1, max: 200 }).withMessage('Enter your password.'),
  handleValidation('login', (req) => ({ title: 'Sign in', email: req.body.email || '' })),
  async (req, res, next) => {
    try {
      const db = await getDb();
      const user = await db.get('SELECT * FROM users WHERE email = ?', req.body.email);
      const ok = user && await bcrypt.compare(req.body.password, user.password_hash);
      if (!ok) {
        return res.status(401).render('login', {
          title: 'Sign in',
          email: req.body.email,
          errors: ['Invalid email or password.']
        });
      }
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = { id: user.id, email: user.email, role: user.role, fullName: user.full_name };
        csrfToken(req);
        res.redirect(dashboardFor(user.role));
      });
    } catch (err) {
      next(err);
    }
  }
);

app.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('clinic.sid');
    res.redirect('/login');
  });
});

app.get('/patient', requireAuth, requireRole(ROLE_PATIENT), async (req, res, next) => {
  try {
    const db = await getDb();
    const appointments = await db.all(
      `SELECT appointments.*, users.full_name AS doctor_name
       FROM appointments
       JOIN users ON users.id = appointments.doctor_id
       WHERE appointments.patient_id = ?
       ORDER BY appointments.starts_at`,
      req.session.user.id
    );
    const records = await db.all(
      `SELECT records.*, users.full_name AS doctor_name
       FROM records
       JOIN users ON users.id = records.doctor_id
       WHERE records.patient_id = ?
       ORDER BY records.updated_at DESC`,
      req.session.user.id
    );
    const doctors = await db.all(
      `SELECT users.id, users.full_name
       FROM doctor_patients
       JOIN users ON users.id = doctor_patients.doctor_id
       WHERE doctor_patients.patient_id = ?
       ORDER BY users.full_name`,
      req.session.user.id
    );
    res.render('patient', { title: 'Patient portal', appointments, records, doctors });
  } catch (err) {
    next(err);
  }
});

app.post(
  '/patient/appointments',
  requireAuth,
  requireRole(ROLE_PATIENT),
  body('doctorId').isInt({ min: 1 }).withMessage('Choose a doctor.'),
  body('startsAt').isISO8601().withMessage('Choose a valid appointment date and time.'),
  body('reason').trim().isLength({ min: 3, max: 300 }).withMessage('Reason must be 3 to 300 characters.'),
  async (req, res, next) => {
    try {
      const db = await getDb();
      const doctorId = Number(req.body.doctorId);
      if (!await canDoctorAccessPatient(doctorId, req.session.user.id)) {
        return res.status(403).render('error', { title: 'Forbidden', message: 'That doctor is not assigned to your care.' });
      }
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).render('error', { title: 'Invalid request', message: errors.array()[0].msg });
      await db.run(
        'INSERT INTO appointments (patient_id, doctor_id, starts_at, reason, status) VALUES (?, ?, ?, ?, ?)',
        req.session.user.id,
        doctorId,
        new Date(req.body.startsAt).toISOString(),
        req.body.reason,
        'requested'
      );
      res.redirect('/patient');
    } catch (err) {
      next(err);
    }
  }
);

app.get('/doctor', requireAuth, requireRole(ROLE_DOCTOR), async (req, res, next) => {
  try {
    const db = await getDb();
    const patients = await db.all(
      `SELECT users.id, users.full_name, users.email
       FROM doctor_patients
       JOIN users ON users.id = doctor_patients.patient_id
       WHERE doctor_patients.doctor_id = ?
       ORDER BY users.full_name`,
      req.session.user.id
    );
    const appointments = await db.all(
      `SELECT appointments.*, users.full_name AS patient_name
       FROM appointments
       JOIN users ON users.id = appointments.patient_id
       WHERE appointments.doctor_id = ?
       ORDER BY appointments.starts_at`,
      req.session.user.id
    );
    res.render('doctor', { title: 'Doctor portal', patients, appointments });
  } catch (err) {
    next(err);
  }
});

app.get(
  '/doctor/patients/:patientId',
  requireAuth,
  requireRole(ROLE_DOCTOR),
  param('patientId').isInt({ min: 1 }),
  async (req, res, next) => {
    try {
      const patientId = Number(req.params.patientId);
      if (!await canDoctorAccessPatient(req.session.user.id, patientId)) {
        return res.status(403).render('error', { title: 'Forbidden', message: 'You can only view records for assigned patients.' });
      }
      const db = await getDb();
      const patient = await db.get('SELECT id, full_name, email FROM users WHERE id = ? AND role = ?', patientId, ROLE_PATIENT);
      const records = await db.all(
        'SELECT * FROM records WHERE patient_id = ? AND doctor_id = ? ORDER BY updated_at DESC',
        patientId,
        req.session.user.id
      );
      res.render('patient-records', { title: 'Patient records', patient, records });
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  '/doctor/patients/:patientId/records',
  requireAuth,
  requireRole(ROLE_DOCTOR),
  param('patientId').isInt({ min: 1 }),
  body('title').trim().isLength({ min: 3, max: 120 }).withMessage('Title must be 3 to 120 characters.'),
  body('notes').trim().isLength({ min: 3, max: 2000 }).withMessage('Notes must be 3 to 2000 characters.'),
  async (req, res, next) => {
    try {
      const patientId = Number(req.params.patientId);
      if (!await canDoctorAccessPatient(req.session.user.id, patientId)) {
        return res.status(403).render('error', { title: 'Forbidden', message: 'You can only update assigned patients.' });
      }
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).render('error', { title: 'Invalid request', message: errors.array()[0].msg });
      const db = await getDb();
      await db.run(
        'INSERT INTO records (patient_id, doctor_id, title, notes, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
        patientId,
        req.session.user.id,
        req.body.title,
        req.body.notes
      );
      res.redirect(`/doctor/patients/${patientId}`);
    } catch (err) {
      next(err);
    }
  }
);

app.get('/reception', requireAuth, requireRole(ROLE_RECEPTIONIST), async (req, res, next) => {
  try {
    const db = await getDb();
    const appointments = await db.all(
      `SELECT appointments.*, patients.full_name AS patient_name, doctors.full_name AS doctor_name
       FROM appointments
       JOIN users patients ON patients.id = appointments.patient_id
       JOIN users doctors ON doctors.id = appointments.doctor_id
       ORDER BY appointments.starts_at`
    );
    const patients = await db.all('SELECT id, full_name FROM users WHERE role = ? ORDER BY full_name', ROLE_PATIENT);
    const doctors = await db.all('SELECT id, full_name FROM users WHERE role = ? ORDER BY full_name', ROLE_DOCTOR);
    res.render('reception', { title: 'Reception schedule', appointments, patients, doctors });
  } catch (err) {
    next(err);
  }
});

app.post(
  '/reception/appointments',
  requireAuth,
  requireRole(ROLE_RECEPTIONIST),
  body('patientId').isInt({ min: 1 }).withMessage('Choose a patient.'),
  body('doctorId').isInt({ min: 1 }).withMessage('Choose a doctor.'),
  body('startsAt').isISO8601().withMessage('Choose a valid date and time.'),
  body('reason').trim().isLength({ min: 3, max: 300 }).withMessage('Reason must be 3 to 300 characters.'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).render('error', { title: 'Invalid request', message: errors.array()[0].msg });
      const db = await getDb();
      const patientId = Number(req.body.patientId);
      const doctorId = Number(req.body.doctorId);
      const patient = await db.get('SELECT id FROM users WHERE id = ? AND role = ?', patientId, ROLE_PATIENT);
      const doctor = await db.get('SELECT id FROM users WHERE id = ? AND role = ?', doctorId, ROLE_DOCTOR);
      if (!patient || !doctor) return res.status(400).render('error', { title: 'Invalid request', message: 'Choose valid users.' });
      await db.run('INSERT OR IGNORE INTO doctor_patients (doctor_id, patient_id) VALUES (?, ?)', doctorId, patientId);
      await db.run(
        'INSERT INTO appointments (patient_id, doctor_id, starts_at, reason, status) VALUES (?, ?, ?, ?, ?)',
        patientId,
        doctorId,
        new Date(req.body.startsAt).toISOString(),
        req.body.reason,
        'scheduled'
      );
      res.redirect('/reception');
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  '/reception/appointments/:id/status',
  requireAuth,
  requireRole(ROLE_RECEPTIONIST),
  param('id').isInt({ min: 1 }),
  body('status').isIn(['requested', 'scheduled', 'completed', 'cancelled']).withMessage('Choose a valid status.'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).render('error', { title: 'Invalid request', message: errors.array()[0].msg });
      const db = await getDb();
      await db.run(
        'UPDATE appointments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        req.body.status,
        Number(req.params.id)
      );
      res.redirect('/reception');
    } catch (err) {
      next(err);
    }
  }
);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'The requested page was not found.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render('error', { title: 'Server error', message: 'An unexpected error occurred.' });
});

(async () => {
  await migrate();
  await seedDemoData();
  app.listen(port, () => {
    console.log(`Clinic portal listening on port ${port}`);
  });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
