'use strict';

const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../middleware');

const router = express.Router();

// Every route here is patient-only.
router.use(requireRole('patient'));

// Dashboard: this patient's own appointments + own records ONLY.
router.get('/', (req, res) => {
  const me = req.session.user.id;

  const appointments = db
    .prepare(
      `SELECT a.*, d.full_name AS doctor_name, d.specialty AS doctor_specialty
         FROM appointments a
         JOIN users d ON d.id = a.doctor_id
        WHERE a.patient_id = ?
        ORDER BY a.slot`
    )
    .all(me);

  const records = db
    .prepare(
      `SELECT r.*, d.full_name AS doctor_name
         FROM medical_records r
         JOIN users d ON d.id = r.doctor_id
        WHERE r.patient_id = ?
        ORDER BY r.created_at DESC`
    )
    .all(me);

  res.render('patient/dashboard', {
    title: 'My Portal',
    appointments,
    records,
  });
});

// Booking form.
router.get('/book', (req, res) => {
  const doctors = db
    .prepare(`SELECT id, full_name, specialty FROM users WHERE role = 'doctor' ORDER BY full_name`)
    .all();
  res.render('patient/book', { title: 'Book appointment', doctors, error: null });
});

router.post('/book', (req, res) => {
  const me = req.session.user.id;
  const { doctor_id, slot, reason } = req.body;

  const doctor = db
    .prepare(`SELECT id FROM users WHERE id = ? AND role = 'doctor'`)
    .get(Number(doctor_id));

  const renderError = (msg) => {
    const doctors = db
      .prepare(`SELECT id, full_name, specialty FROM users WHERE role = 'doctor' ORDER BY full_name`)
      .all();
    return res.status(400).render('patient/book', { title: 'Book appointment', doctors, error: msg });
  };

  if (!doctor) return renderError('Please choose a valid doctor.');
  if (!slot) return renderError('Please choose a date and time.');

  db.prepare(
    `INSERT INTO appointments (patient_id, doctor_id, slot, reason, status)
     VALUES (?, ?, ?, ?, 'requested')`
  ).run(me, doctor.id, String(slot), String(reason || ''));

  res.redirect('/patient');
});

// Patient may cancel only their OWN appointment.
router.post('/appointments/:id/cancel', (req, res) => {
  const me = req.session.user.id;
  const info = db
    .prepare(`UPDATE appointments SET status = 'cancelled' WHERE id = ? AND patient_id = ?`)
    .run(Number(req.params.id), me);

  if (info.changes === 0) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'You can only cancel your own appointments.',
    });
  }
  res.redirect('/patient');
});

module.exports = router;
