'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('receptionist'));

// ---- prepared statements ----
const listSchedule = db.prepare(`
  SELECT a.id, a.scheduled_at, a.reason, a.status,
         p.full_name AS patient_name, d.full_name AS doctor_name
  FROM appointments a
  JOIN users p ON p.id = a.patient_id
  JOIN users d ON d.id = a.doctor_id
  ORDER BY a.scheduled_at DESC
`);
const listPatients = db.prepare(
  "SELECT id, full_name FROM users WHERE role = 'patient' ORDER BY full_name"
);
const listDoctors = db.prepare(
  "SELECT id, full_name FROM users WHERE role = 'doctor' ORDER BY full_name"
);
const isRole = db.prepare('SELECT id FROM users WHERE id = ? AND role = ?');
const insertAppointment = db.prepare(`
  INSERT INTO appointments (patient_id, doctor_id, scheduled_at, reason, status)
  VALUES (@patient_id, @doctor_id, @scheduled_at, @reason, @status)
`);
const updateStatus = db.prepare('UPDATE appointments SET status = ? WHERE id = ?');
const getAppointment = db.prepare('SELECT id FROM appointments WHERE id = ?');

const ALLOWED_STATUS = ['requested', 'confirmed', 'cancelled', 'completed'];

// -------------------------------- Schedule ---------------------------------
router.get('/', (req, res) => {
  res.render('reception/schedule', {
    title: 'Clinic schedule',
    appointments: listSchedule.all(),
  });
});

router.get('/new', (req, res) => {
  res.render('reception/schedule_new', {
    title: 'New appointment',
    patients: listPatients.all(),
    doctors: listDoctors.all(),
    errors: [],
    values: {},
  });
});

router.post(
  '/',
  body('patient_id').isInt({ min: 1 }).withMessage('Choose a patient'),
  body('doctor_id').isInt({ min: 1 }).withMessage('Choose a doctor'),
  body('scheduled_at').trim().notEmpty().isISO8601().withMessage('Valid date/time required'),
  body('reason').trim().isLength({ min: 3, max: 500 }).withMessage('Reason must be 3-500 characters'),
  body('status').optional().isIn(ALLOWED_STATUS),
  (req, res) => {
    const patients = listPatients.all();
    const doctors = listDoctors.all();
    const errors = validationResult(req);
    const errorList = errors.array();

    // Verify referenced users exist with the correct roles (defence in depth).
    if (req.body.patient_id && !isRole.get(req.body.patient_id, 'patient')) {
      errorList.push({ msg: 'Selected patient is not valid' });
    }
    if (req.body.doctor_id && !isRole.get(req.body.doctor_id, 'doctor')) {
      errorList.push({ msg: 'Selected doctor is not valid' });
    }

    if (errorList.length > 0) {
      return res.status(400).render('reception/schedule_new', {
        title: 'New appointment',
        patients,
        doctors,
        errors: errorList,
        values: req.body,
      });
    }

    insertAppointment.run({
      patient_id: Number(req.body.patient_id),
      doctor_id: Number(req.body.doctor_id),
      scheduled_at: req.body.scheduled_at,
      reason: req.body.reason,
      status: ALLOWED_STATUS.includes(req.body.status) ? req.body.status : 'confirmed',
    });
    res.redirect('/schedule');
  }
);

// Change an appointment's status.
router.post(
  '/:id/status',
  param('id').isInt({ min: 1 }),
  body('status').isIn(ALLOWED_STATUS).withMessage('Invalid status'),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('error', { title: 'Bad request', message: 'Invalid status update.', status: 400 });
    }
    if (!getAppointment.get(req.params.id)) {
      return res.status(404).render('error', { title: 'Not found', message: 'Appointment not found.', status: 404 });
    }
    updateStatus.run(req.body.status, Number(req.params.id));
    res.redirect('/schedule');
  }
);

module.exports = router;
