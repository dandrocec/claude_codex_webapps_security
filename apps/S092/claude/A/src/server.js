'use strict';

const path = require('node:path');
const express = require('express');
const session = require('express-session');

const { init } = require('./db');
const { exposeUser, requireLogin } = require('./middleware');

const authRoutes = require('./routes/auth');
const patientRoutes = require('./routes/patient');
const doctorRoutes = require('./routes/doctor');
const receptionRoutes = require('./routes/reception');

const PORT = process.env.PORT || 5092;

init(); // ensure schema exists

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(
  session({
    name: 'clinic.sid',
    secret: process.env.SESSION_SECRET || 'dev-only-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
  })
);

app.use(exposeUser);

// Auth (login/logout) is public.
app.use('/', authRoutes);

// Send the logged-in user to the dashboard that matches their role.
app.get('/', requireLogin, (req, res) => {
  switch (req.session.user.role) {
    case 'patient':
      return res.redirect('/patient');
    case 'doctor':
      return res.redirect('/doctor');
    case 'receptionist':
      return res.redirect('/reception');
    default:
      return res.redirect('/login');
  }
});

// Role-scoped areas. The requireRole guard lives inside each router.
app.use('/patient', patientRoutes);
app.use('/doctor', doctorRoutes);
app.use('/reception', receptionRoutes);

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'Page not found.' });
});

app.listen(PORT, () => {
  console.log(`Clinic portal running at http://localhost:${PORT}`);
});
