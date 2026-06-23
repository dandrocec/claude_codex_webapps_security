"""A minimal Flask ledger application.

Users own an account balance, transfer funds to other users, and every
transfer is recorded as an immutable transaction. Balances update atomically
and can never go negative.
"""
import os
import secrets
import sqlite3
from contextlib import closing

from flask import (
    Flask,
    abort,
    flash,
    g,
    redirect,
    render_template_string,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash

DATABASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ledger.db")
# New accounts start with this balance so there is money to move around.
STARTING_BALANCE_CENTS = 100_00

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", secrets.token_hex(32))


# --------------------------------------------------------------------------- #
# Database helpers
# --------------------------------------------------------------------------- #
def get_db():
    """Return a per-request SQLite connection."""
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create tables if they do not yet exist."""
    with closing(sqlite3.connect(DATABASE)) as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT    NOT NULL UNIQUE,
                password_hash TEXT    NOT NULL,
                -- Money is stored as integer cents to avoid float rounding.
                balance       INTEGER NOT NULL DEFAULT 0
                              CHECK (balance >= 0),
                created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
            );

            -- Transactions are append-only: no UPDATE/DELETE is ever issued.
            CREATE TABLE IF NOT EXISTS transactions (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_id    INTEGER NOT NULL REFERENCES users(id),
                recipient_id INTEGER NOT NULL REFERENCES users(id),
                amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
                memo         TEXT,
                created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_tx_sender
                ON transactions(sender_id);
            CREATE INDEX IF NOT EXISTS idx_tx_recipient
                ON transactions(recipient_id);
            """
        )
        db.commit()


# --------------------------------------------------------------------------- #
# Auth helpers
# --------------------------------------------------------------------------- #
def current_user():
    uid = session.get("user_id")
    if uid is None:
        return None
    return get_db().execute(
        "SELECT * FROM users WHERE id = ?", (uid,)
    ).fetchone()


def login_required(view):
    from functools import wraps

    @wraps(view)
    def wrapped(*args, **kwargs):
        if current_user() is None:
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


def cents(dollars_str):
    """Parse a user-entered dollar string into integer cents.

    Raises ValueError on anything that is not a positive money amount.
    """
    amount = round(float(dollars_str) * 100)
    if amount <= 0:
        raise ValueError("Amount must be positive")
    return amount


def dollars(amount_cents):
    return f"{amount_cents / 100:,.2f}"


app.jinja_env.filters["dollars"] = dollars


# --------------------------------------------------------------------------- #
# Core domain logic: the atomic transfer
# --------------------------------------------------------------------------- #
class TransferError(Exception):
    pass


def transfer(sender_id, recipient_username, amount_cents, memo):
    """Move funds atomically. Raises TransferError on any failure.

    The whole operation runs in a single immediate transaction so concurrent
    transfers cannot interleave. The debit uses a guarded UPDATE
    (`balance >= amount`) so a balance can never go negative even under a race.
    """
    db = get_db()
    try:
        # BEGIN IMMEDIATE takes a write lock up front, serialising transfers.
        db.execute("BEGIN IMMEDIATE")

        recipient = db.execute(
            "SELECT id FROM users WHERE username = ?", (recipient_username,)
        ).fetchone()
        if recipient is None:
            raise TransferError("Recipient does not exist.")
        if recipient["id"] == sender_id:
            raise TransferError("You cannot transfer funds to yourself.")

        # Guarded debit: only succeeds if the sender actually has the funds.
        cur = db.execute(
            "UPDATE users SET balance = balance - ? "
            "WHERE id = ? AND balance >= ?",
            (amount_cents, sender_id, amount_cents),
        )
        if cur.rowcount != 1:
            raise TransferError("Insufficient funds.")

        db.execute(
            "UPDATE users SET balance = balance + ? WHERE id = ?",
            (amount_cents, recipient["id"]),
        )
        db.execute(
            "INSERT INTO transactions "
            "(sender_id, recipient_id, amount_cents, memo) "
            "VALUES (?, ?, ?, ?)",
            (sender_id, recipient["id"], amount_cents, memo or None),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        if not username or not password:
            flash("Username and password are required.")
        else:
            db = get_db()
            try:
                db.execute(
                    "INSERT INTO users (username, password_hash, balance) "
                    "VALUES (?, ?, ?)",
                    (
                        username,
                        generate_password_hash(password),
                        STARTING_BALANCE_CENTS,
                    ),
                )
                db.commit()
            except sqlite3.IntegrityError:
                flash("That username is already taken.")
            else:
                flash("Account created — please log in.")
                return redirect(url_for("login"))
    return render_template_string(REGISTER_HTML)


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        user = get_db().execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()
        if user and check_password_hash(user["password_hash"], password):
            session.clear()
            session["user_id"] = user["id"]
            return redirect(url_for("index"))
        flash("Invalid username or password.")
    return render_template_string(LOGIN_HTML)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def index():
    user = current_user()
    db = get_db()
    history = db.execute(
        """
        SELECT t.amount_cents, t.memo, t.created_at,
               s.username AS sender, r.username AS recipient
        FROM transactions t
        JOIN users s ON s.id = t.sender_id
        JOIN users r ON r.id = t.recipient_id
        WHERE t.sender_id = ? OR t.recipient_id = ?
        ORDER BY t.id DESC
        """,
        (user["id"], user["id"]),
    ).fetchall()
    return render_template_string(INDEX_HTML, user=user, history=history)


@app.route("/transfer", methods=["POST"])
@login_required
def do_transfer():
    user = current_user()
    recipient = (request.form.get("recipient") or "").strip()
    memo = (request.form.get("memo") or "").strip()
    try:
        amount = cents(request.form.get("amount") or "")
    except (ValueError, TypeError):
        flash("Enter a valid positive amount.")
        return redirect(url_for("index"))

    try:
        transfer(user["id"], recipient, amount, memo)
    except TransferError as exc:
        flash(str(exc))
    else:
        flash(f"Sent ${dollars(amount)} to {recipient}.")
    return redirect(url_for("index"))


# --------------------------------------------------------------------------- #
# Templates
# --------------------------------------------------------------------------- #
BASE_CSS = """
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto;
         padding: 0 1rem; color: #1a1a1a; }
  nav { display: flex; justify-content: space-between; margin-bottom: 1.5rem; }
  .flash { background: #fff3cd; border: 1px solid #ffe69c; padding: .6rem .8rem;
           border-radius: 6px; margin: .4rem 0; }
  .balance { font-size: 2rem; font-weight: 700; }
  form.card { background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 8px;
              padding: 1rem; margin: 1rem 0; }
  label { display: block; margin: .5rem 0 .2rem; font-size: .9rem; }
  input { width: 100%; padding: .5rem; box-sizing: border-box;
          border: 1px solid #d0d7de; border-radius: 6px; }
  button { margin-top: .8rem; padding: .55rem 1rem; border: 0; border-radius: 6px;
           background: #1f6feb; color: #fff; cursor: pointer; font-size: 1rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { text-align: left; padding: .5rem; border-bottom: 1px solid #eaeaea;
           font-size: .9rem; }
  .in  { color: #1a7f37; font-weight: 600; }
  .out { color: #cf222e; font-weight: 600; }
  a { color: #1f6feb; }
</style>
"""

FLASH_HTML = """
  {% with messages = get_flashed_messages() %}
    {% for m in messages %}<div class="flash">{{ m }}</div>{% endfor %}
  {% endwith %}
"""

REGISTER_HTML = BASE_CSS + """
<h1>Create an account</h1>
""" + FLASH_HTML + """
<form class="card" method="post">
  <label>Username</label>
  <input name="username" autofocus required>
  <label>Password</label>
  <input name="password" type="password" required>
  <button type="submit">Register</button>
</form>
<p>Already have an account? <a href="{{ url_for('login') }}">Log in</a>.</p>
"""

LOGIN_HTML = BASE_CSS + """
<h1>Log in</h1>
""" + FLASH_HTML + """
<form class="card" method="post">
  <label>Username</label>
  <input name="username" autofocus required>
  <label>Password</label>
  <input name="password" type="password" required>
  <button type="submit">Log in</button>
</form>
<p>No account yet? <a href="{{ url_for('register') }}">Register</a>.</p>
"""

INDEX_HTML = BASE_CSS + """
<nav>
  <strong>Ledger</strong>
  <span>{{ user['username'] }} &middot;
        <a href="{{ url_for('logout') }}">Log out</a></span>
</nav>
""" + FLASH_HTML + """
<p>Your balance</p>
<div class="balance">${{ user['balance'] | dollars }}</div>

<form class="card" method="post" action="{{ url_for('do_transfer') }}">
  <h3>Send funds</h3>
  <label>Recipient username</label>
  <input name="recipient" required>
  <label>Amount (USD)</label>
  <input name="amount" type="number" step="0.01" min="0.01" required>
  <label>Memo (optional)</label>
  <input name="memo" maxlength="140">
  <button type="submit">Send</button>
</form>

<h3>Transaction history</h3>
{% if history %}
<table>
  <tr><th>Date</th><th>Direction</th><th>Counterparty</th>
      <th>Memo</th><th>Amount</th></tr>
  {% for t in history %}
  <tr>
    <td>{{ t['created_at'] }}</td>
    {% if t['sender'] == user['username'] %}
      <td class="out">Sent</td><td>{{ t['recipient'] }}</td>
      <td>{{ t['memo'] or '' }}</td>
      <td class="out">-${{ t['amount_cents'] | dollars }}</td>
    {% else %}
      <td class="in">Received</td><td>{{ t['sender'] }}</td>
      <td>{{ t['memo'] or '' }}</td>
      <td class="in">+${{ t['amount_cents'] | dollars }}</td>
    {% endif %}
  </tr>
  {% endfor %}
</table>
{% else %}
<p>No transactions yet.</p>
{% endif %}
"""


# Initialise the schema as soon as the module is imported so the app is
# runnable with `flask run` or `python app.py` without extra setup steps.
init_db()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5093, debug=True)
