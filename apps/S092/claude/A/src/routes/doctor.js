'use strict';

const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../middleware');

const router = express.Router();

router.use(requireRole('doctor'));

// A doctor's "patients" are those who have at least one appointment with them.
function isMyPatient(doctorId, patientId) {
  const row = db
    .prepare(
      `SELECT 1 FROM appointments
        WHERE doctor_id = ? AND patient_id = ? LIMIT 1`
    )
    .get(doctorId, patientId);
  return Boolean(row);
}

// Dashboard: this doctor's appointments + the distinct list of their patients.
router.get('/', (req, res) => {
  const me = req.session.user.id;

  const appointments = db
    .prepare(
      `SELECT a.*, p.full_name AS patient_name
         FROM appointments a
         JOIN users p ON p.id = a.patient_id
        WHERE a.doctor_id = ?
        ORDER BY a.slot`
    )
    .all(me);

  const patients = db
    .prepare(
      `SELECT DISTINCT p.id, p.full_name
         FROM appointments a
         JOIN users p ON p.id = a.patient_id
        WHERE a.doctor_id = ?
        ORDER BY p.full_name`
    )
    .all(me);

  res.render('doctor/dashboard', { title: 'Doctor portal', appointments, patients });
});

// View one patient's records (only if they are this doctor's patient).
router.get('/patients/:id', (req, res) => {
  const me = req.session.user.id;
  const patientId = Number(req.params.id);

  if (!isMyPatient(me, patientId)) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'This patient is not assigned to you.',
    });
  }

  const patient = db.prepare(`SELECT id, full_name FROM users WHERE id = ? AND role = 'patient'`).get(patientId);
  if (!patient) {
    return res.status(404).render('error', { title: 'Not found', message: 'Patient not found.' });
  }

  const records = db
    .prepare(
      `SELECT r.*, d.full_name AS doctor_name
         FROM medical_records r
         JOIN users d ON d.id = r.doctor_id
        WHERE r.patient_id = ?
        ORDER BY r.created_at DESC`
    )
    .all(patientId);

  res.render('doctor/patient', { title: patient.full_name, patient, records, error: null });
});

// Add/update a medical record for a patient (doctor authorship is stamped server-side).
router.post('/patients/:id/records', (req, res) => {
  const me = req.session.user.id;
  const patientId = Number(req.params.id);

  if (!isMyPatient(me, patientId)) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'This patient is not assigned to you.',
    });
  }

  const { diagnosis, treatment, notes } = req.body;
  db.prepare(
    `INSERT INTO medical_records (patient_id, doctor_id, diagnosis, treatment, notes)
     VALUES (?, ?, ?, ?, ?)`
  ).run(patientId, me, String(diagnosis || ''), String(treatment || ''), String(notes || ''));

  res.redirect('/doctor/patients/' + patientId);
});

// Mark one of this doctor's appointments as completed.
router.post('/appointments/:id/complete', (req, res) => {
  const me = req.session.user.id;
  const info = db
    .prepare(`UPDATE appointments SET status = 'completed' WHERE id = ? AND doctor_id = ?`)
    .run(Number(req.params.id), me);

  if (info.changes === 0) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'You can only update your own appointments.',
    });
  }
  res.redirect('/doctor');
});

module.exports = router;
