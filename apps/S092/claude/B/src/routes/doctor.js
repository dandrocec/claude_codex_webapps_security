'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('doctor'));

// ---- prepared statements ----
const listMyPatients = db.prepare(`
  SELECT id, full_name, email
  FROM users
  WHERE role = 'patient' AND doctor_id = ?
  ORDER BY full_name
`);
// IDOR guard: a patient row is only returned if assigned to THIS doctor.
const getMyPatient = db.prepare(
  "SELECT id, full_name, email FROM users WHERE id = ? AND role = 'patient' AND doctor_id = ?"
);
const listPatientRecords = db.prepare(`
  SELECT id, title, notes, created_at, updated_at
  FROM records
  WHERE patient_id = ?
  ORDER BY updated_at DESC
`);
const insertRecord = db.prepare(`
  INSERT INTO records (patient_id, doctor_id, title, notes)
  VALUES (@patient_id, @doctor_id, @title, @notes)
`);
const getRecordForDoctor = db.prepare(
  'SELECT * FROM records WHERE id = ? AND patient_id = ? AND doctor_id = ?'
);
const updateRecord = db.prepare(`
  UPDATE records SET title = @title, notes = @notes, updated_at = datetime('now')
  WHERE id = @id AND doctor_id = @doctor_id
`);
const listMyDoctorAppointments = db.prepare(`
  SELECT a.id, a.scheduled_at, a.reason, a.status, p.full_name AS patient_name
  FROM appointments a
  JOIN users p ON p.id = a.patient_id
  WHERE a.doctor_id = ?
  ORDER BY a.scheduled_at DESC
`);

// --------------------------------- Patients --------------------------------
router.get('/patients', (req, res) => {
  res.render('doctor/patients', {
    title: 'My patients',
    patients: listMyPatients.all(req.session.user.id),
  });
});

router.get('/appointments', (req, res) => {
  res.render('doctor/appointments', {
    title: 'My appointments',
    appointments: listMyDoctorAppointments.all(req.session.user.id),
  });
});

// View + manage a single patient's records (only if they're this doctor's patient).
router.get(
  '/patients/:id/records',
  param('id').isInt({ min: 1 }),
  (req, res) => {
    if (!validationResult(req).isEmpty()) {
      return res.status(400).render('error', { title: 'Bad request', message: 'Invalid patient id.', status: 400 });
    }
    const patient = getMyPatient.get(req.params.id, req.session.user.id);
    if (!patient) {
      return res.status(404).render('error', {
        title: 'Not found',
        message: 'Patient not found among your patients.',
        status: 404,
      });
    }
    res.render('doctor/records', {
      title: `Records — ${patient.full_name}`,
      patient,
      records: listPatientRecords.all(patient.id),
      errors: [],
      values: {},
    });
  }
);

// Add a new record for a patient.
router.post(
  '/patients/:id/records',
  param('id').isInt({ min: 1 }),
  body('title').trim().isLength({ min: 1, max: 120 }).withMessage('Title is required (max 120)'),
  body('notes').trim().isLength({ min: 1, max: 5000 }).withMessage('Notes are required (max 5000)'),
  (req, res) => {
    const patient = getMyPatient.get(req.params.id, req.session.user.id);
    if (!patient) {
      return res.status(404).render('error', {
        title: 'Not found',
        message: 'Patient not found among your patients.',
        status: 404,
      });
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('doctor/records', {
        title: `Records — ${patient.full_name}`,
        patient,
        records: listPatientRecords.all(patient.id),
        errors: errors.array(),
        values: { title: req.body.title, notes: req.body.notes },
      });
    }

    insertRecord.run({
      patient_id: patient.id,
      doctor_id: req.session.user.id,
      title: req.body.title,
      notes: req.body.notes,
    });
    res.redirect(`/doctor/patients/${patient.id}/records`);
  }
);

// Update an existing record (only one authored for this doctor's patient).
router.post(
  '/patients/:id/records/:recordId',
  param('id').isInt({ min: 1 }),
  param('recordId').isInt({ min: 1 }),
  body('title').trim().isLength({ min: 1, max: 120 }).withMessage('Title is required (max 120)'),
  body('notes').trim().isLength({ min: 1, max: 5000 }).withMessage('Notes are required (max 5000)'),
  (req, res) => {
    const patient = getMyPatient.get(req.params.id, req.session.user.id);
    if (!patient) {
      return res.status(404).render('error', { title: 'Not found', message: 'Patient not found.', status: 404 });
    }
    const record = getRecordForDoctor.get(req.params.recordId, patient.id, req.session.user.id);
    if (!record) {
      return res.status(404).render('error', { title: 'Not found', message: 'Record not found.', status: 404 });
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('doctor/records', {
        title: `Records — ${patient.full_name}`,
        patient,
        records: listPatientRecords.all(patient.id),
        errors: errors.array(),
        values: {},
      });
    }

    updateRecord.run({
      id: record.id,
      doctor_id: req.session.user.id,
      title: req.body.title,
      notes: req.body.notes,
    });
    res.redirect(`/doctor/patients/${patient.id}/records`);
  }
);

module.exports = router;
