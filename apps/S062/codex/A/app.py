from datetime import datetime
import os
import sqlite3
from functools import wraps

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


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.path.join(BASE_DIR, "helpdesk.sqlite3")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-helpdesk-secret")


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('customer', 'agent'))
);

CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    assigned_agent_id INTEGER,
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES users(id),
    FOREIGN KEY (assigned_agent_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
"""


BASE_TEMPLATE = """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ title or "Helpdesk" }}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7f9;
      --panel: #ffffff;
      --ink: #1f2933;
      --muted: #65758b;
      --line: #d9e1ea;
      --brand: #166f7a;
      --brand-dark: #0f5660;
      --accent: #b45f06;
      --danger: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      background: var(--bg);
      color: var(--ink);
      line-height: 1.45;
    }
    header {
      background: #ffffff;
      border-bottom: 1px solid var(--line);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .bar, main {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
    }
    .bar {
      min-height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .brand {
      font-size: 20px;
      font-weight: 700;
      color: var(--brand-dark);
      text-decoration: none;
    }
    nav {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    nav a, .link-button {
      color: var(--brand-dark);
      text-decoration: none;
      font-weight: 600;
      border: 0;
      background: transparent;
      cursor: pointer;
      font: inherit;
      padding: 0;
    }
    main { padding: 28px 0 48px; }
    h1 { font-size: 30px; margin: 0 0 18px; }
    h2 { font-size: 21px; margin: 0 0 14px; }
    h3 { font-size: 17px; margin: 0 0 8px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 18px;
    }
    .panel, .ticket-card, .reply {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
    }
    .ticket-card {
      display: grid;
      gap: 10px;
    }
    .meta {
      color: var(--muted);
      font-size: 14px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 2px 8px;
      border-radius: 999px;
      background: #e7f2f3;
      color: var(--brand-dark);
      font-size: 13px;
      font-weight: 700;
      text-transform: capitalize;
      width: max-content;
    }
    .badge.closed, .badge.resolved { background: #e6f4ea; color: #23643b; }
    .badge.pending { background: #fff3d6; color: #7a4b00; }
    form { display: grid; gap: 12px; }
    label { display: grid; gap: 6px; font-weight: 700; }
    input, textarea, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px 11px;
      color: var(--ink);
      background: #fff;
      font: inherit;
    }
    textarea { min-height: 130px; resize: vertical; }
    button, .button {
      border: 0;
      border-radius: 6px;
      background: var(--brand);
      color: #fff;
      font-weight: 700;
      padding: 10px 14px;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: max-content;
      min-height: 40px;
    }
    button:hover, .button:hover { background: var(--brand-dark); }
    .secondary {
      background: #eef2f6;
      color: var(--ink);
    }
    .secondary:hover { background: #dce5ed; }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: end;
    }
    .split {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: 18px;
      align-items: start;
    }
    .flash {
      margin: 0 0 18px;
      padding: 12px 14px;
      border: 1px solid #f0c36d;
      background: #fff8e6;
      border-radius: 6px;
    }
    .empty {
      padding: 28px;
      text-align: center;
      color: var(--muted);
      border: 1px dashed var(--line);
      border-radius: 8px;
      background: #fff;
    }
    .reply { margin-top: 12px; }
    .reply.agent { border-left: 4px solid var(--accent); }
    .reply.customer { border-left: 4px solid var(--brand); }
    .description { white-space: pre-wrap; }
    @media (max-width: 760px) {
      .bar { align-items: flex-start; flex-direction: column; padding: 14px 0; }
      nav { justify-content: flex-start; }
      .split { grid-template-columns: 1fr; }
      h1 { font-size: 25px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="bar">
      <a class="brand" href="{{ url_for('index') }}">Flask Helpdesk</a>
      <nav>
        {% if current_user %}
          <span class="meta">{{ current_user.name }} · {{ current_user.role }}</span>
          <a href="{{ url_for('tickets') }}">Tickets</a>
          {% if current_user.role == "customer" %}
            <a href="{{ url_for('new_ticket') }}">New ticket</a>
          {% endif %}
          <form method="post" action="{{ url_for('logout') }}" style="display:inline">
            <button class="link-button" type="submit">Sign out</button>
          </form>
        {% else %}
          <a href="{{ url_for('login') }}">Sign in</a>
          <a href="{{ url_for('register') }}">Register</a>
        {% endif %}
      </nav>
    </div>
  </header>
  <main>
    {% for message in get_flashed_messages() %}
      <div class="flash">{{ message }}</div>
    {% endfor %}
    {{ body|safe }}
  </main>
</body>
</html>
"""


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(error=None):
    connection = g.pop("db", None)
    if connection is not None:
        connection.close()


def now():
    return datetime.utcnow().replace(microsecond=0).isoformat(sep=" ")


def init_db():
    connection = db()
    connection.executescript(SCHEMA)
    agent = connection.execute(
        "SELECT id FROM users WHERE email = ?", ("agent@example.com",)
    ).fetchone()
    if agent is None:
        connection.execute(
            "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
            (
                "Demo Agent",
                "agent@example.com",
                generate_password_hash("password"),
                "agent",
            ),
        )
    connection.commit()


@app.before_request
def load_user():
    init_db()
    user_id = session.get("user_id")
    g.current_user = None
    if user_id:
        g.current_user = db().execute(
            "SELECT * FROM users WHERE id = ?", (user_id,)
        ).fetchone()


@app.context_processor
def inject_user():
    return {"current_user": g.get("current_user")}


def page(body, title="Helpdesk"):
    return render_template_string(BASE_TEMPLATE, body=body, title=title)


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.current_user is None:
            flash("Please sign in first.")
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


def agent_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.current_user is None:
            flash("Please sign in first.")
            return redirect(url_for("login"))
        if g.current_user["role"] != "agent":
            abort(403)
        return view(*args, **kwargs)

    return wrapped


def get_ticket(ticket_id):
    ticket = db().execute(
        """
        SELECT
            tickets.*,
            customers.name AS customer_name,
            customers.email AS customer_email,
            agents.name AS agent_name
        FROM tickets
        JOIN users customers ON customers.id = tickets.customer_id
        LEFT JOIN users agents ON agents.id = tickets.assigned_agent_id
        WHERE tickets.id = ?
        """,
        (ticket_id,),
    ).fetchone()
    if ticket is None:
        abort(404)
    if g.current_user["role"] == "customer" and ticket["customer_id"] != g.current_user["id"]:
        abort(403)
    return ticket


@app.route("/")
def index():
    if g.current_user:
        return redirect(url_for("tickets"))
    body = render_template_string(
        """
        <section class="grid">
          <div class="panel">
            <h1>Helpdesk ticketing</h1>
            <p>Customers can open tickets and continue the conversation. Agents can see every ticket, assign ownership, update status, and reply.</p>
            <div class="actions">
              <a class="button" href="{{ url_for('login') }}">Sign in</a>
              <a class="button secondary" href="{{ url_for('register') }}">Create customer account</a>
            </div>
          </div>
          <div class="panel">
            <h2>Demo agent</h2>
            <p class="meta">Use this account to review all tickets.</p>
            <p><strong>Email:</strong> agent@example.com<br><strong>Password:</strong> password</p>
          </div>
        </section>
        """
    )
    return page(body)


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        name = request.form["name"].strip()
        email = request.form["email"].strip().lower()
        password = request.form["password"]
        if not name or not email or not password:
            flash("Name, email, and password are required.")
        else:
            try:
                cursor = db().execute(
                    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
                    (name, email, generate_password_hash(password), "customer"),
                )
                db().commit()
                session["user_id"] = cursor.lastrowid
                return redirect(url_for("tickets"))
            except sqlite3.IntegrityError:
                flash("That email address is already registered.")
    body = render_template_string(
        """
        <div class="panel">
          <h1>Create customer account</h1>
          <form method="post">
            <label>Name <input name="name" autocomplete="name" required></label>
            <label>Email <input type="email" name="email" autocomplete="email" required></label>
            <label>Password <input type="password" name="password" autocomplete="new-password" required></label>
            <button type="submit">Register</button>
          </form>
        </div>
        """
    )
    return page(body, "Register")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = request.form["email"].strip().lower()
        password = request.form["password"]
        user = db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if user and check_password_hash(user["password_hash"], password):
            session.clear()
            session["user_id"] = user["id"]
            return redirect(url_for("tickets"))
        flash("Invalid email or password.")
    body = render_template_string(
        """
        <div class="panel">
          <h1>Sign in</h1>
          <form method="post">
            <label>Email <input type="email" name="email" autocomplete="email" required></label>
            <label>Password <input type="password" name="password" autocomplete="current-password" required></label>
            <button type="submit">Sign in</button>
          </form>
          <p class="meta">Demo agent: agent@example.com / password</p>
        </div>
        """
    )
    return page(body, "Sign in")


@app.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))


@app.route("/tickets")
@login_required
def tickets():
    if g.current_user["role"] == "agent":
        rows = db().execute(
            """
            SELECT
                tickets.*,
                customers.name AS customer_name,
                agents.name AS agent_name
            FROM tickets
            JOIN users customers ON customers.id = tickets.customer_id
            LEFT JOIN users agents ON agents.id = tickets.assigned_agent_id
            ORDER BY tickets.updated_at DESC
            """
        ).fetchall()
        heading = "All tickets"
    else:
        rows = db().execute(
            """
            SELECT
                tickets.*,
                customers.name AS customer_name,
                agents.name AS agent_name
            FROM tickets
            JOIN users customers ON customers.id = tickets.customer_id
            LEFT JOIN users agents ON agents.id = tickets.assigned_agent_id
            WHERE tickets.customer_id = ?
            ORDER BY tickets.updated_at DESC
            """,
            (g.current_user["id"],),
        ).fetchall()
        heading = "My tickets"
    body = render_template_string(
        """
        <div class="actions" style="justify-content: space-between; margin-bottom: 18px;">
          <h1 style="margin:0">{{ heading }}</h1>
          {% if current_user.role == "customer" %}
            <a class="button" href="{{ url_for('new_ticket') }}">Open ticket</a>
          {% endif %}
        </div>
        {% if rows %}
          <section class="grid">
            {% for ticket in rows %}
              <article class="ticket-card">
                <div class="actions" style="justify-content: space-between;">
                  <span class="badge {{ ticket.status }}">{{ ticket.status }}</span>
                  <span class="meta">#{{ ticket.id }}</span>
                </div>
                <h2><a href="{{ url_for('ticket_detail', ticket_id=ticket.id) }}">{{ ticket.subject }}</a></h2>
                <div class="meta">
                  <span>Customer: {{ ticket.customer_name }}</span>
                  <span>Agent: {{ ticket.agent_name or "Unassigned" }}</span>
                  <span>Updated: {{ ticket.updated_at }}</span>
                </div>
              </article>
            {% endfor %}
          </section>
        {% else %}
          <div class="empty">No tickets yet.</div>
        {% endif %}
        """,
        rows=rows,
        heading=heading,
    )
    return page(body, heading)


@app.route("/tickets/new", methods=["GET", "POST"])
@login_required
def new_ticket():
    if g.current_user["role"] != "customer":
        abort(403)
    if request.method == "POST":
        subject = request.form["subject"].strip()
        description = request.form["description"].strip()
        if not subject or not description:
            flash("Subject and description are required.")
        else:
            timestamp = now()
            cursor = db().execute(
                """
                INSERT INTO tickets
                    (customer_id, subject, description, status, created_at, updated_at)
                VALUES (?, ?, ?, 'open', ?, ?)
                """,
                (g.current_user["id"], subject, description, timestamp, timestamp),
            )
            db().commit()
            return redirect(url_for("ticket_detail", ticket_id=cursor.lastrowid))
    body = render_template_string(
        """
        <div class="panel">
          <h1>Open a ticket</h1>
          <form method="post">
            <label>Subject <input name="subject" maxlength="160" required></label>
            <label>Description <textarea name="description" required></textarea></label>
            <button type="submit">Create ticket</button>
          </form>
        </div>
        """
    )
    return page(body, "Open ticket")


@app.route("/tickets/<int:ticket_id>")
@login_required
def ticket_detail(ticket_id):
    ticket = get_ticket(ticket_id)
    replies = db().execute(
        """
        SELECT replies.*, users.name, users.role
        FROM replies
        JOIN users ON users.id = replies.user_id
        WHERE replies.ticket_id = ?
        ORDER BY replies.created_at ASC
        """,
        (ticket_id,),
    ).fetchall()
    agents = []
    if g.current_user["role"] == "agent":
        agents = db().execute(
            "SELECT id, name FROM users WHERE role = 'agent' ORDER BY name"
        ).fetchall()
    body = render_template_string(
        """
        <div class="split">
          <section>
            <div class="panel">
              <div class="actions" style="justify-content: space-between;">
                <h1 style="margin:0">{{ ticket.subject }}</h1>
                <span class="badge {{ ticket.status }}">{{ ticket.status }}</span>
              </div>
              <p class="meta">
                Ticket #{{ ticket.id }} · Customer: {{ ticket.customer_name }} ·
                Agent: {{ ticket.agent_name or "Unassigned" }} · Updated: {{ ticket.updated_at }}
              </p>
              <p class="description">{{ ticket.description }}</p>
            </div>

            <h2 style="margin-top: 22px;">Conversation</h2>
            {% for reply in replies %}
              <article class="reply {{ reply.role }}">
                <h3>{{ reply.name }} <span class="meta">({{ reply.role }}) · {{ reply.created_at }}</span></h3>
                <p class="description">{{ reply.body }}</p>
              </article>
            {% else %}
              <div class="empty">No replies yet.</div>
            {% endfor %}

            <div class="panel" style="margin-top:18px;">
              <h2>Add reply</h2>
              <form method="post" action="{{ url_for('add_reply', ticket_id=ticket.id) }}">
                <label>Message <textarea name="body" required></textarea></label>
                <button type="submit">Post reply</button>
              </form>
            </div>
          </section>

          {% if current_user.role == "agent" %}
            <aside class="panel">
              <h2>Manage ticket</h2>
              <form method="post" action="{{ url_for('update_ticket', ticket_id=ticket.id) }}">
                <label>Status
                  <select name="status">
                    {% for status in ["open", "pending", "resolved", "closed"] %}
                      <option value="{{ status }}" {% if ticket.status == status %}selected{% endif %}>{{ status.title() }}</option>
                    {% endfor %}
                  </select>
                </label>
                <label>Assigned agent
                  <select name="assigned_agent_id">
                    <option value="">Unassigned</option>
                    {% for agent in agents %}
                      <option value="{{ agent.id }}" {% if ticket.assigned_agent_id == agent.id %}selected{% endif %}>{{ agent.name }}</option>
                    {% endfor %}
                  </select>
                </label>
                <button type="submit">Save changes</button>
              </form>
            </aside>
          {% endif %}
        </div>
        """,
        ticket=ticket,
        replies=replies,
        agents=agents,
    )
    return page(body, ticket["subject"])


@app.post("/tickets/<int:ticket_id>/reply")
@login_required
def add_reply(ticket_id):
    get_ticket(ticket_id)
    body = request.form["body"].strip()
    if not body:
        flash("Reply cannot be empty.")
        return redirect(url_for("ticket_detail", ticket_id=ticket_id))
    timestamp = now()
    db().execute(
        "INSERT INTO replies (ticket_id, user_id, body, created_at) VALUES (?, ?, ?, ?)",
        (ticket_id, g.current_user["id"], body, timestamp),
    )
    db().execute(
        "UPDATE tickets SET updated_at = ? WHERE id = ?",
        (timestamp, ticket_id),
    )
    db().commit()
    return redirect(url_for("ticket_detail", ticket_id=ticket_id))


@app.post("/tickets/<int:ticket_id>/update")
@agent_required
def update_ticket(ticket_id):
    get_ticket(ticket_id)
    status = request.form["status"]
    assigned_agent_id = request.form.get("assigned_agent_id") or None
    if status not in {"open", "pending", "resolved", "closed"}:
        abort(400)
    if assigned_agent_id is not None:
        agent = db().execute(
            "SELECT id FROM users WHERE id = ? AND role = 'agent'", (assigned_agent_id,)
        ).fetchone()
        if agent is None:
            abort(400)
    db().execute(
        """
        UPDATE tickets
        SET status = ?, assigned_agent_id = ?, updated_at = ?
        WHERE id = ?
        """,
        (status, assigned_agent_id, now(), ticket_id),
    )
    db().commit()
    return redirect(url_for("ticket_detail", ticket_id=ticket_id))


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5062, debug=True)
