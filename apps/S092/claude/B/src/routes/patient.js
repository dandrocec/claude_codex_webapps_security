'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// All routes here are for the logged-in patient acting on their OWN data.
router.use(requireAuth, requireRole('patient'));

// ---- prepared statements ----
const getAssignedDoctor = db.prepare(
  "SELECT u.id, u.full_name FROM users p JOIN users u ON u.id = p.doctor_id WHERE p.id = ? AND u.role = 'doctor'"
);
const listMyAppointments = db.prepare(`
  SELECT a.id, a.scheduled_at, a.reason, a.status, d.full_name AS doctor_name
  FROM appointments a
  JOIN users d ON d.id = a.doctor_id
  WHERE a.patient_id = ?
  ORDER BY a.scheduled_at DESC
`);
const insertAppointment = db.prepare(`
  INSERT INTO appointments (patient_id, doctor_id, scheduled_at, reason, status)
  VALUES (@patient_id, @doctor_id, @scheduled_at, @reason, 'requested')
`);
const listMyRecords = db.prepare(`
  SELECT r.id, r.title, r.notes, r.created_at, r.updated_at, d.full_name AS doctor_name
  FROM records r
  JOIN users d ON d.id = r.doctor_id
  WHERE r.patient_id = ?
  ORDER BY r.updated_at DESC
`);

// ------------------------------ Appointments ------------------------------
router.get('/appointments', (req, res) => {
  res.render('patient/appointments', {
    title: 'My appointments',
    appointments: listMyAppointments.all(req.session.user.id),
  });
});

router.get('/appointments/new', (req, res) => {
  const doctor = getAssignedDoctor.get(req.session.user.id);
  res.render('patient/appointment_new', {
    title: 'Book an appointment',
    doctor,
    errors: [],
    values: {},
  });
});

router.post(
  '/appointments',
  body('scheduled_at')
    .trim()
    .notEmpty()
    .withMessage('Please choose a date and time')
    .isISO8601()
    .withMessage('Invalid date/time'),
  body('reason').trim().isLength({ min: 3, max: 500 }).withMessage('Reason must be 3-500 characters'),
  (req, res) => {
    const doctor = getAssignedDoctor.get(req.session.user.id);
    const errors = validationResult(req);
    const errorList = errors.array();

    if (!doctor) {
      errorList.push({ msg: 'You have no assigned doctor. Please contact reception.' });
    }
    // Reject appointments in the past.
    const when = new Date(req.body.scheduled_at);
    if (req.body.scheduled_at && (!isNaN(when) ? when.getTime() < Date.now() : false)) {
      errorList.push({ msg: 'Appointment time must be in the future' });
    }

    if (errorList.length > 0) {
      return res.status(400).render('patient/appointment_new', {
        title: 'Book an appointment',
        doctor,
        errors: errorList,
        values: { scheduled_at: req.body.scheduled_at, reason: req.body.reason },
      });
    }

    insertAppointment.run({
      patient_id: req.session.user.id, // bound to the session, never from the client
      doctor_id: doctor.id,
      scheduled_at: req.body.scheduled_at,
      reason: req.body.reason,
    });

    res.redirect('/appointments');
  }
);

// -------------------------------- Records ---------------------------------
router.get('/records', (req, res) => {
  res.render('patient/records', {
    title: 'My medical records',
    records: listMyRecords.all(req.session.user.id),
  });
});

module.exports = router;
