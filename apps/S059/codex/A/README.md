# Room Reservation System

A Node.js/Express app for booking rooms by day and time slot. It uses SQLite for users, rooms, time slots, bookings, and session storage. A unique database constraint prevents double-booking the same room, date, and slot.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:5059`.

The app creates `data/reservations.sqlite` automatically on first start, then seeds a few rooms and time slots.
