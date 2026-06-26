# Clinic Portal

A Node.js/Express clinic portal with SQLite storage and role-based access control.

## Run locally on port 5092

```bash
npm install
npm start
```

Open `http://localhost:5092`.

## Demo accounts

All demo accounts use password `password123`.

- Patient: `alice.patient`
- Patient: `bob.patient`
- Doctor: `dr.smith`
- Doctor: `dr.lee`
- Receptionist: `reception`

## Roles

- Patients can book appointments and view only their own appointments and medical records.
- Doctors can view their schedule and view or update records only for patients assigned to them.
- Receptionists can manage the appointment schedule for all doctors and patients, but cannot view or edit clinical records.

The app creates and seeds `data/clinic.sqlite` automatically on first start.
