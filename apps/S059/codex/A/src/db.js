const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "reservations.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      capacity INTEGER NOT NULL,
      location TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS time_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      UNIQUE (start_time, end_time)
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL,
      slot_id INTEGER NOT NULL,
      booking_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (slot_id) REFERENCES time_slots(id) ON DELETE CASCADE,
      UNIQUE (room_id, slot_id, booking_date)
    );
  `);

  const roomCount = db.prepare("SELECT COUNT(*) AS count FROM rooms").get().count;
  if (roomCount === 0) {
    const insertRoom = db.prepare(
      "INSERT INTO rooms (name, capacity, location) VALUES (?, ?, ?)"
    );
    const seedRooms = db.transaction(() => {
      insertRoom.run("Atlas Room", 8, "First floor");
      insertRoom.run("Beacon Room", 12, "Second floor");
      insertRoom.run("Cedar Room", 6, "Second floor");
      insertRoom.run("Delta Room", 20, "Ground floor");
    });
    seedRooms();
  }

  const slotCount = db.prepare("SELECT COUNT(*) AS count FROM time_slots").get().count;
  if (slotCount === 0) {
    const insertSlot = db.prepare(
      "INSERT INTO time_slots (start_time, end_time) VALUES (?, ?)"
    );
    const seedSlots = db.transaction(() => {
      insertSlot.run("09:00", "10:00");
      insertSlot.run("10:00", "11:00");
      insertSlot.run("11:00", "12:00");
      insertSlot.run("13:00", "14:00");
      insertSlot.run("14:00", "15:00");
      insertSlot.run("15:00", "16:00");
      insertSlot.run("16:00", "17:00");
    });
    seedSlots();
  }
}

module.exports = {
  db,
  initializeDatabase
};
