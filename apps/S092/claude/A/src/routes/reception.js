'use strict';

const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../middleware');

const router = express.Router();

router.use(requireRole('receptionist'));

const VALID_STATUSES = ['requested', 'confirmed', 'cancelled', 'completed'];

// Schedule: receptionists see the whole clinic schedule, but NOT clinical records.
router.get('/', (req, res) => {
  const appointments = db
    .prepare(
      `SELECT a.*, p.full_name AS patient_name, d.full_name AS doctor_name
         FROM appointments a
         JOIN users p ON p.id = a.patient_id
         JOIN users d ON d.id = a.doctor_id
        ORDER BY a.slot`
    )
    .all();

  res.render('reception/schedule', { title: 'Front desk — schedule', appointments, statuses: VALID_STATUSES });
});

// Update an appointment's status (confirm / cancel / etc.).
router.post('/appointments/:id/status', (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).render('error', { title: 'Bad request', message: 'Invalid status.' });
  }
  db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(status, Number(req.params.id));
  res.redirect('/reception');
});

// Reschedule (change the slot) of any appointment.
router.post('/appointments/:id/reschedule', (req, res) => {
  const { slot } = req.body;
  if (!slot) {
    return res.status(400).render('error', { title: 'Bad request', message: 'A new date/time is required.' });
  }
  db.prepare('UPDATE appointments SET slot = ? WHERE id = ?').run(String(slot), Number(req.params.id));
  res.redirect('/reception');
});

module.exports = router;
