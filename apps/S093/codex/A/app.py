import os
import sqlite3
from contextlib import contextmanager
from functools import wraps

from flask import (
    Flask,
    flash,
    g,
    redirect,
    render_template_string,
    request,
    session,
    url_for,
)
from jinja2 import DictLoader
from werkzeug.security import check_password_hash, generate_password_hash


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.path.join(BASE_DIR, "ledger.sqlite3")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-ledger-secret-change-me")
app.config["DATABASE"] = os.environ.get("DATABASE", DATABASE)


SCHEMA = """
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    balance_cents INTEGER NOT NULL DEFAULT 10000 CHECK (balance_cents >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    recipient_id INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (recipient_id) REFERENCES users(id),
    CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_sender_created
    ON transactions(sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_recipient_created
    ON transactions(recipient_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS transactions_no_update
BEFORE UPDATE ON transactions
BEGIN
    SELECT RAISE(ABORT, 'transactions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS transactions_no_delete
BEFORE DELETE ON transactions
BEGIN
    SELECT RAISE(ABORT, 'transactions are immutable');
END;
"""


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(app.config["DATABASE"], isolation_level=None)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
        g.db.execute("PRAGMA busy_timeout = 5000")
    return g.db


@app.teardown_appcontext
def close_db(_error):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(app.config["DATABASE"], isolation_level=None)
    try:
        db.executescript(SCHEMA)
    finally:
        db.close()


@contextmanager
def write_transaction():
    db = get_db()
    db.execute("BEGIN IMMEDIATE")
    try:
        yield db
    except Exception:
        db.execute("ROLLBACK")
        raise
    else:
        db.execute("COMMIT")


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if "user_id" not in session:
            return redirect(url_for("login"))
        return view(**kwargs)

    return wrapped_view


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return get_db().execute(
        "SELECT id, username, balance_cents FROM users WHERE id = ?", (user_id,)
    ).fetchone()


def cents_to_display(cents):
    return f"${cents / 100:,.2f}"


def parse_amount_to_cents(raw_amount):
    value = (raw_amount or "").strip()
    if not value:
        raise ValueError("Amount is required.")
    try:
        dollars, dot, cents = value.partition(".")
        if (
            not dollars.isdigit()
            or (dot and (not cents.isdigit() or len(cents) > 2))
        ):
            raise ValueError
        cents = (cents + "00")[:2]
        amount_cents = int(dollars) * 100 + int(cents or "0")
    except ValueError as exc:
        raise ValueError("Enter a valid positive dollar amount.") from exc
    if amount_cents <= 0:
        raise ValueError("Amount must be greater than zero.")
    return amount_cents


def transfer_funds(sender_id, recipient_username, amount_cents):
    recipient_username = recipient_username.strip()
    if not recipient_username:
        raise ValueError("Recipient is required.")

    with write_transaction() as db:
        sender = db.execute(
            "SELECT id, username FROM users WHERE id = ?", (sender_id,)
        ).fetchone()
        recipient = db.execute(
            "SELECT id, username FROM users WHERE username = ? COLLATE NOCASE",
            (recipient_username,),
        ).fetchone()

        if recipient is None:
            raise ValueError("Recipient user was not found.")
        if recipient["id"] == sender["id"]:
            raise ValueError("You cannot transfer funds to yourself.")

        debit = db.execute(
            """
            UPDATE users
               SET balance_cents = balance_cents - ?
             WHERE id = ?
               AND balance_cents >= ?
            """,
            (amount_cents, sender["id"], amount_cents),
        )
        if debit.rowcount != 1:
            raise ValueError("Insufficient funds.")

        db.execute(
            "UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?",
            (amount_cents, recipient["id"]),
        )
        db.execute(
            """
            INSERT INTO transactions (sender_id, recipient_id, amount_cents)
            VALUES (?, ?, ?)
            """,
            (sender["id"], recipient["id"], amount_cents),
        )


@app.before_request
def ensure_database():
    if not os.path.exists(app.config["DATABASE"]):
        init_db()


@app.context_processor
def template_helpers():
    return {"money": cents_to_display}


@app.route("/")
def index():
    if "user_id" in session:
        return redirect(url_for("dashboard"))
    return redirect(url_for("login"))


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        if len(username) < 3:
            flash("Username must be at least 3 characters.", "error")
        elif len(password) < 8:
            flash("Password must be at least 8 characters.", "error")
        else:
            try:
                get_db().execute(
                    """
                    INSERT INTO users (username, password_hash)
                    VALUES (?, ?)
                    """,
                    (username, generate_password_hash(password)),
                )
                flash("Account created. Sign in to continue.", "success")
                return redirect(url_for("login"))
            except sqlite3.IntegrityError:
                flash("That username is already taken.", "error")
    return render_template_string(AUTH_TEMPLATE, mode="Register")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = get_db().execute(
            "SELECT * FROM users WHERE username = ? COLLATE NOCASE", (username,)
        ).fetchone()
        if user and check_password_hash(user["password_hash"], password):
            session.clear()
            session["user_id"] = user["id"]
            return redirect(url_for("dashboard"))
        flash("Invalid username or password.", "error")
    return render_template_string(AUTH_TEMPLATE, mode="Login")


@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/dashboard", methods=["GET", "POST"])
@login_required
def dashboard():
    user = current_user()
    if request.method == "POST":
        try:
            amount_cents = parse_amount_to_cents(request.form.get("amount"))
            transfer_funds(user["id"], request.form.get("recipient", ""), amount_cents)
            flash("Transfer completed.", "success")
            return redirect(url_for("dashboard"))
        except ValueError as exc:
            flash(str(exc), "error")

    transactions = get_db().execute(
        """
        SELECT t.id,
               t.amount_cents,
               t.created_at,
               sender.username AS sender_username,
               recipient.username AS recipient_username,
               CASE WHEN t.sender_id = ? THEN 'sent' ELSE 'received' END AS direction
          FROM transactions t
          JOIN users sender ON sender.id = t.sender_id
          JOIN users recipient ON recipient.id = t.recipient_id
         WHERE t.sender_id = ? OR t.recipient_id = ?
         ORDER BY t.created_at DESC, t.id DESC
        """,
        (user["id"], user["id"], user["id"]),
    ).fetchall()
    users = get_db().execute(
        """
        SELECT username
          FROM users
         WHERE id <> ?
         ORDER BY username COLLATE NOCASE
        """,
        (user["id"],),
    ).fetchall()
    user = current_user()
    return render_template_string(
        DASHBOARD_TEMPLATE, user=user, transactions=transactions, users=users
    )


BASE_TEMPLATE = """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Flask Ledger</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f5f7fb;
      color: #17202a;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; }
    a { color: #075985; font-weight: 650; text-decoration: none; }
    .shell { width: min(1100px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0; }
    .topbar {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 18px 0 28px;
    }
    .brand { font-size: 22px; font-weight: 800; letter-spacing: 0; }
    .panel {
      background: #ffffff; border: 1px solid #d9e1ec; border-radius: 8px;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.07);
    }
    .auth { max-width: 430px; margin: 72px auto; padding: 28px; }
    .grid { display: grid; grid-template-columns: 360px 1fr; gap: 20px; align-items: start; }
    .section { padding: 24px; }
    h1, h2 { margin: 0 0 18px; line-height: 1.15; letter-spacing: 0; }
    h1 { font-size: 30px; }
    h2 { font-size: 20px; }
    .balance { font-size: clamp(34px, 7vw, 52px); font-weight: 850; margin: 10px 0 22px; color: #14532d; }
    label { display: block; font-size: 14px; font-weight: 700; margin: 14px 0 6px; color: #344054; }
    input, select {
      width: 100%; height: 44px; border: 1px solid #c8d3df; border-radius: 6px;
      padding: 0 12px; font: inherit; background: #ffffff; color: #17202a;
    }
    input:focus, select:focus { outline: 3px solid #bae6fd; border-color: #0284c7; }
    button {
      border: 0; border-radius: 6px; min-height: 44px; padding: 0 16px;
      background: #0f766e; color: #ffffff; font: inherit; font-weight: 800; cursor: pointer;
    }
    button.secondary { background: #e2e8f0; color: #17202a; }
    .actions { display: flex; align-items: center; gap: 12px; margin-top: 18px; flex-wrap: wrap; }
    .flash { padding: 12px 14px; border-radius: 6px; margin: 0 0 16px; font-weight: 650; }
    .flash.error { background: #fee2e2; color: #991b1b; }
    .flash.success { background: #dcfce7; color: #166534; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 13px 10px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
    th { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
    .amount { font-weight: 800; white-space: nowrap; }
    .sent { color: #b91c1c; }
    .received { color: #166534; }
    .muted { color: #64748b; }
    @media (max-width: 780px) {
      .shell { width: min(100% - 20px, 1100px); padding-top: 14px; }
      .grid { grid-template-columns: 1fr; }
      .topbar { align-items: flex-start; }
      th:nth-child(1), td:nth-child(1) { display: none; }
    }
  </style>
</head>
<body>
  <main class="shell">
    {% block body %}{% endblock %}
  </main>
</body>
</html>
"""


AUTH_TEMPLATE = (
    "{% extends 'base.html' %}"
    "{% block body %}"
    "<section class='panel auth'>"
    "<div class='brand'>Flask Ledger</div>"
    "<h1>{{ mode }}</h1>"
    "{% with messages = get_flashed_messages(with_categories=true) %}"
    "{% for category, message in messages %}<div class='flash {{ category }}'>{{ message }}</div>{% endfor %}"
    "{% endwith %}"
    "<form method='post'>"
    "<label for='username'>Username</label>"
    "<input id='username' name='username' autocomplete='username' required minlength='3'>"
    "<label for='password'>Password</label>"
    "<input id='password' name='password' type='password' autocomplete='current-password' required minlength='8'>"
    "<div class='actions'>"
    "<button type='submit'>{{ mode }}</button>"
    "{% if mode == 'Login' %}<a href='{{ url_for(\"register\") }}'>Create account</a>"
    "{% else %}<a href='{{ url_for(\"login\") }}'>Sign in</a>{% endif %}"
    "</div>"
    "</form>"
    "</section>"
    "{% endblock %}"
)


DASHBOARD_TEMPLATE = (
    "{% extends 'base.html' %}"
    "{% block body %}"
    "<header class='topbar'>"
    "<div><div class='brand'>Flask Ledger</div><div class='muted'>Signed in as {{ user.username }}</div></div>"
    "<form action='{{ url_for(\"logout\") }}' method='post'><button class='secondary' type='submit'>Log out</button></form>"
    "</header>"
    "{% with messages = get_flashed_messages(with_categories=true) %}"
    "{% for category, message in messages %}<div class='flash {{ category }}'>{{ message }}</div>{% endfor %}"
    "{% endwith %}"
    "<div class='grid'>"
    "<section class='panel section'>"
    "<h1>Balance</h1>"
    "<div class='balance'>{{ money(user.balance_cents) }}</div>"
    "<h2>New transfer</h2>"
    "<form method='post'>"
    "<label for='recipient'>Recipient</label>"
    "<select id='recipient' name='recipient' required>"
    "<option value=''>Select a user</option>"
    "{% for other in users %}<option value='{{ other.username }}'>{{ other.username }}</option>{% endfor %}"
    "</select>"
    "<label for='amount'>Amount</label>"
    "<input id='amount' name='amount' inputmode='decimal' placeholder='25.00' required>"
    "<div class='actions'><button type='submit'>Send funds</button></div>"
    "</form>"
    "</section>"
    "<section class='panel section'>"
    "<h2>Transaction history</h2>"
    "{% if transactions %}"
    "<table>"
    "<thead><tr><th>When</th><th>Transfer</th><th>Amount</th></tr></thead>"
    "<tbody>"
    "{% for tx in transactions %}"
    "<tr>"
    "<td class='muted'>{{ tx.created_at }}</td>"
    "<td>"
    "{% if tx.direction == 'sent' %}To {{ tx.recipient_username }}{% else %}From {{ tx.sender_username }}{% endif %}"
    "</td>"
    "<td class='amount {{ tx.direction }}'>{% if tx.direction == 'sent' %}-{% else %}+{% endif %}{{ money(tx.amount_cents) }}</td>"
    "</tr>"
    "{% endfor %}"
    "</tbody>"
    "</table>"
    "{% else %}<p class='muted'>No transactions yet.</p>{% endif %}"
    "</section>"
    "</div>"
    "{% endblock %}"
)


app.jinja_loader = DictLoader(
    {
        "base.html": BASE_TEMPLATE,
    }
)


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5093)
