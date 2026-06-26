import os
import re
import sqlite3
from functools import wraps

import bcrypt
from flask import (
    Flask,
    abort,
    flash,
    g,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from flask_wtf import CSRFProtect


USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
STATUS_VALUES = ("todo", "doing", "done")


def create_app():
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY"),
        DATABASE_PATH=os.environ.get("DATABASE_PATH", "project_board.sqlite3"),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "true").lower()
        not in {"0", "false", "no"},
        SESSION_COOKIE_SAMESITE="Lax",
        WTF_CSRF_TIME_LIMIT=3600,
        MAX_CONTENT_LENGTH=256 * 1024,
    )

    if not app.config["SECRET_KEY"]:
        raise RuntimeError("SECRET_KEY environment variable is required")

    CSRFProtect(app)

    @app.before_request
    def load_user():
        g.user = None
        user_id = session.get("user_id")
        if user_id is not None:
            g.user = query_one("SELECT id, username FROM users WHERE id = ?", (user_id,))

    @app.after_request
    def set_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "style-src 'self'; "
            "script-src 'self'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'; "
            "form-action 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if request.is_secure:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    @app.errorhandler(400)
    @app.errorhandler(403)
    @app.errorhandler(404)
    @app.errorhandler(413)
    @app.errorhandler(500)
    def handle_error(error):
        code = getattr(error, "code", 500)
        message = {
            400: "Bad request.",
            403: "You do not have access to that resource.",
            404: "The requested page was not found.",
            413: "The request was too large.",
        }.get(code, "An unexpected error occurred.")
        return render_template("error.html", code=code, message=message), code

    @app.route("/")
    def index():
        if g.user:
            return redirect(url_for("projects"))
        return render_template("index.html")

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            username = clean_username(request.form.get("username", ""))
            password = request.form.get("password", "")
            if not username:
                flash("Choose a username with 3-32 letters, numbers, dots, dashes, or underscores.")
            elif len(password) < 12:
                flash("Password must be at least 12 characters.")
            elif query_one("SELECT id FROM users WHERE username = ?", (username,)):
                flash("That username is already taken.")
            else:
                password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
                execute("INSERT INTO users (username, password_hash) VALUES (?, ?)", (username, password_hash))
                flash("Account created. Sign in to continue.")
                return redirect(url_for("login"))
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            username = clean_username(request.form.get("username", ""))
            password = request.form.get("password", "")
            user = query_one("SELECT id, password_hash FROM users WHERE username = ?", (username,))
            if user and bcrypt.checkpw(password.encode("utf-8"), user["password_hash"].encode("utf-8")):
                session.clear()
                session["user_id"] = user["id"]
                return redirect(url_for("projects"))
            flash("Invalid username or password.")
        return render_template("login.html")

    @app.post("/logout")
    @login_required
    def logout():
        session.clear()
        return redirect(url_for("index"))

    @app.route("/projects")
    @login_required
    def projects():
        rows = query_all(
            """
            SELECT p.id, p.name, p.description, pm.role,
                   COUNT(t.id) AS task_count
            FROM projects p
            JOIN project_members pm ON pm.project_id = p.id
            LEFT JOIN tasks t ON t.project_id = p.id
            WHERE pm.user_id = ?
            GROUP BY p.id, pm.role
            ORDER BY p.created_at DESC
            """,
            (g.user["id"],),
        )
        return render_template("projects.html", projects=rows)

    @app.route("/projects/new", methods=["GET", "POST"])
    @login_required
    def new_project():
        if request.method == "POST":
            name = clean_text(request.form.get("name", ""), 80)
            description = clean_text(request.form.get("description", ""), 500)
            if not name:
                flash("Project name is required.")
            else:
                with get_db() as db:
                    cursor = db.execute(
                        "INSERT INTO projects (name, description, owner_id) VALUES (?, ?, ?)",
                        (name, description, g.user["id"]),
                    )
                    project_id = cursor.lastrowid
                    db.execute(
                        "INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)",
                        (project_id, g.user["id"], "owner"),
                    )
                    db.commit()
                return redirect(url_for("project_board", project_id=project_id))
        return render_template("project_form.html")

    @app.route("/projects/<int:project_id>")
    @login_required
    @project_member_required
    def project_board(project_id):
        project = get_project(project_id)
        members = get_project_members(project_id)
        tasks = query_all(
            """
            SELECT t.id, t.title, t.description, t.status, t.assignee_id,
                   u.username AS assignee_name
            FROM tasks t
            LEFT JOIN users u ON u.id = t.assignee_id
            WHERE t.project_id = ?
            ORDER BY t.created_at DESC
            """,
            (project_id,),
        )
        grouped = {status: [] for status in STATUS_VALUES}
        for task in tasks:
            grouped[task["status"]].append(task)
        return render_template("board.html", project=project, members=members, tasks=grouped, statuses=STATUS_VALUES)

    @app.post("/projects/<int:project_id>/invite")
    @login_required
    @project_member_required
    def invite_member(project_id):
        username = clean_username(request.form.get("username", ""))
        user = query_one("SELECT id FROM users WHERE username = ?", (username,))
        if not user:
            flash("No user exists with that username.")
        elif is_project_member(project_id, user["id"]):
            flash("That user is already a member.")
        else:
            execute(
                "INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)",
                (project_id, user["id"], "member"),
            )
            flash("Member invited.")
        return redirect(url_for("project_board", project_id=project_id))

    @app.post("/projects/<int:project_id>/tasks")
    @login_required
    @project_member_required
    def add_task(project_id):
        title = clean_text(request.form.get("title", ""), 120)
        description = clean_text(request.form.get("description", ""), 500)
        assignee_id = parse_optional_int(request.form.get("assignee_id"))
        if not title:
            flash("Task title is required.")
        elif assignee_id is not None and not is_project_member(project_id, assignee_id):
            abort(403)
        else:
            execute(
                """
                INSERT INTO tasks (project_id, title, description, status, assignee_id, creator_id)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (project_id, title, description, "todo", assignee_id, g.user["id"]),
            )
        return redirect(url_for("project_board", project_id=project_id))

    @app.post("/projects/<int:project_id>/tasks/<int:task_id>")
    @login_required
    @project_member_required
    def update_task(project_id, task_id):
        task = get_task(project_id, task_id)
        status = request.form.get("status", "")
        assignee_id = parse_optional_int(request.form.get("assignee_id"))
        if status not in STATUS_VALUES:
            abort(400)
        if assignee_id is not None and not is_project_member(project_id, assignee_id):
            abort(403)
        execute(
            "UPDATE tasks SET status = ?, assignee_id = ? WHERE id = ? AND project_id = ?",
            (status, assignee_id, task["id"], project_id),
        )
        return redirect(url_for("project_board", project_id=project_id))

    @app.post("/projects/<int:project_id>/tasks/<int:task_id>/delete")
    @login_required
    @project_member_required
    def delete_task(project_id, task_id):
        task = get_task(project_id, task_id)
        execute("DELETE FROM tasks WHERE id = ? AND project_id = ?", (task["id"], project_id))
        return redirect(url_for("project_board", project_id=project_id))

    app.teardown_appcontext(close_db)

    with app.app_context():
        init_db()

    return app


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app_config("DATABASE_PATH"))
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def current_app_config(key):
    from flask import current_app

    return current_app.config[key]


def close_db(error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            owner_id INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS project_members (
            project_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (project_id, user_id),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'done')),
            assignee_id INTEGER,
            creator_id INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
        """
    )
    db.commit()


def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()


def query_all(sql, params=()):
    return get_db().execute(sql, params).fetchall()


def execute(sql, params=()):
    db = get_db()
    db.execute(sql, params)
    db.commit()


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


def project_member_required(view):
    @wraps(view)
    def wrapped(project_id, *args, **kwargs):
        if not is_project_member(project_id, g.user["id"]):
            abort(403)
        return view(project_id, *args, **kwargs)

    return wrapped


def is_project_member(project_id, user_id):
    return (
        query_one(
            "SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?",
            (project_id, user_id),
        )
        is not None
    )


def get_project(project_id):
    project = query_one(
        """
        SELECT p.id, p.name, p.description, p.owner_id, u.username AS owner_name
        FROM projects p
        JOIN users u ON u.id = p.owner_id
        WHERE p.id = ?
        """,
        (project_id,),
    )
    if not project:
        abort(404)
    return project


def get_project_members(project_id):
    return query_all(
        """
        SELECT u.id, u.username, pm.role
        FROM project_members pm
        JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = ?
        ORDER BY pm.role DESC, u.username ASC
        """,
        (project_id,),
    )


def get_task(project_id, task_id):
    task = query_one("SELECT id FROM tasks WHERE id = ? AND project_id = ?", (task_id, project_id))
    if not task:
        abort(404)
    return task


def clean_username(value):
    value = (value or "").strip()
    if not USERNAME_RE.fullmatch(value):
        return ""
    return value


def clean_text(value, max_length):
    value = " ".join((value or "").replace("\x00", "").split())
    return value[:max_length]


def parse_optional_int(value):
    if value in {None, "", "none"}:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        abort(400)
    if parsed < 1:
        abort(400)
    return parsed


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5064)
