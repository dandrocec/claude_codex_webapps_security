'use strict';

// All database access goes through prepared statements with bound parameters.
// This is what prevents SQL injection: user input is never concatenated into SQL.

const db = require('./db');

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
const Users = {
  create: db.prepare(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES (@name, @email, @password_hash, @role)`
  ),
  findByEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
  findById: db.prepare(`SELECT id, name, email, role, created_at FROM users WHERE id = ?`),

  add(user) {
    return this.create.run(user);
  },
  byEmail(email) {
    return this.findByEmail.get(email);
  },
  byId(id) {
    return this.findById.get(id);
  },
};

// ---------------------------------------------------------------------------
// Contacts
//
// Every read/write is scoped by ownership. Sales users may only touch their
// own rows; managers may see (but the UI restricts editing to owners) the
// whole team. The `scopeOwner` argument is null for managers (no filter).
// ---------------------------------------------------------------------------
const Contacts = {
  _insert: db.prepare(
    `INSERT INTO contacts (owner_id, name, email, phone, company, notes)
     VALUES (@owner_id, @name, @email, @phone, @company, @notes)`
  ),
  _update: db.prepare(
    `UPDATE contacts
        SET name = @name, email = @email, phone = @phone,
            company = @company, notes = @notes, updated_at = datetime('now')
      WHERE id = @id AND owner_id = @owner_id`
  ),
  _delete: db.prepare(`DELETE FROM contacts WHERE id = @id AND owner_id = @owner_id`),
  _byIdOwned: db.prepare(`SELECT * FROM contacts WHERE id = ? AND owner_id = ?`),
  _byIdAny: db.prepare(
    `SELECT c.*, u.name AS owner_name
       FROM contacts c JOIN users u ON u.id = c.owner_id
      WHERE c.id = ?`
  ),
  _listOwned: db.prepare(
    `SELECT c.*, u.name AS owner_name
       FROM contacts c JOIN users u ON u.id = c.owner_id
      WHERE c.owner_id = ?
      ORDER BY c.name COLLATE NOCASE`
  ),
  _listAll: db.prepare(
    `SELECT c.*, u.name AS owner_name
       FROM contacts c JOIN users u ON u.id = c.owner_id
      ORDER BY c.name COLLATE NOCASE`
  ),

  create(data) {
    return this._insert.run(data);
  },
  update(data) {
    return this._update.run(data); // changes === 0 when not owned
  },
  remove(id, ownerId) {
    return this._delete.run({ id, owner_id: ownerId });
  },
  // Returns the row only if the user is allowed to see it.
  get(id, userId, isManager) {
    return isManager ? this._byIdAny.get(id) : this._byIdOwned.get(id, userId);
  },
  // Returns the row only if the user OWNS it (for edit/delete authorisation).
  getOwned(id, ownerId) {
    return this._byIdOwned.get(id, ownerId);
  },
  list(userId, isManager) {
    return isManager ? this._listAll.all() : this._listOwned.all(userId);
  },
};

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------
const Deals = {
  _insert: db.prepare(
    `INSERT INTO deals (owner_id, contact_id, title, amount, stage)
     VALUES (@owner_id, @contact_id, @title, @amount, @stage)`
  ),
  _update: db.prepare(
    `UPDATE deals
        SET title = @title, amount = @amount, stage = @stage,
            contact_id = @contact_id, updated_at = datetime('now')
      WHERE id = @id AND owner_id = @owner_id`
  ),
  _updateStage: db.prepare(
    `UPDATE deals
        SET stage = @stage, updated_at = datetime('now')
      WHERE id = @id AND owner_id = @owner_id`
  ),
  _delete: db.prepare(`DELETE FROM deals WHERE id = @id AND owner_id = @owner_id`),
  _byIdOwned: db.prepare(`SELECT * FROM deals WHERE id = ? AND owner_id = ?`),
  _listOwned: db.prepare(
    `SELECT d.*, u.name AS owner_name, c.name AS contact_name
       FROM deals d
       JOIN users u ON u.id = d.owner_id
       LEFT JOIN contacts c ON c.id = d.contact_id
      WHERE d.owner_id = ?
      ORDER BY d.updated_at DESC`
  ),
  _listAll: db.prepare(
    `SELECT d.*, u.name AS owner_name, c.name AS contact_name
       FROM deals d
       JOIN users u ON u.id = d.owner_id
       LEFT JOIN contacts c ON c.id = d.contact_id
      ORDER BY d.updated_at DESC`
  ),

  create(data) {
    return this._insert.run(data);
  },
  update(data) {
    return this._update.run(data);
  },
  updateStage(id, ownerId, stage) {
    return this._updateStage.run({ id, owner_id: ownerId, stage });
  },
  remove(id, ownerId) {
    return this._delete.run({ id, owner_id: ownerId });
  },
  getOwned(id, ownerId) {
    return this._byIdOwned.get(id, ownerId);
  },
  list(userId, isManager) {
    return isManager ? this._listAll.all() : this._listOwned.all(userId);
  },
};

module.exports = { Users, Contacts, Deals };
