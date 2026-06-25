import base64
import html
import ipaddress
import os
import secrets
import socket
import sqlite3
import ssl
from datetime import timedelta
from http.client import HTTPConnection, HTTPSConnection
from pathlib import Path
from urllib.parse import urljoin, urlparse

import bcrypt
from bs4 import BeautifulSoup
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
from markupsafe import Markup


BASE_DIR = Path(__file__).resolve().parent
DATABASE = BASE_DIR / "contact.sqlite3"
MAX_MESSAGE_LENGTH = 4000
MAX_PREVIEW_BYTES = 128 * 1024
CONNECT_TIMEOUT = 3
READ_TIMEOUT = 4
MAX_REDIRECTS = 3


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY") or secrets.token_urlsafe(48)
    app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(hours=2)
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_SECURE"] = env_bool("SESSION_COOKIE_SECURE", True)
    app.config["MAX_CONTENT_LENGTH"] = 64 * 1024

    register_security_hooks(app)
    register_routes(app)
    app.jinja_env.filters["nl2br"] = nl2br

    @app.teardown_appcontext
    def close_db(_error):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    with app.app_context():
        init_db()

    return app


def env_bool(name, default):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def register_security_hooks(app):
    @app.before_request
    def load_csrf_token():
        if "csrf_token" not in session:
            session["csrf_token"] = secrets.token_urlsafe(32)

    @app.after_request
    def set_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "img-src 'self' data:; "
            "style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "frame-ancestors 'none'"
        )
        return response

    @app.errorhandler(400)
    @app.errorhandler(403)
    @app.errorhandler(404)
    @app.errorhandler(500)
    def handle_error(error):
        status = getattr(error, "code", 500)
        return render_template("error.html", status=status), status


def register_routes(app):
    @app.get("/")
    def contact_form():
        return render_template("contact.html")

    @app.post("/submit")
    def submit_contact():
        require_csrf()
        name = clean_text(request.form.get("name", ""), 120)
        email = clean_text(request.form.get("email", ""), 254)
        message = clean_textarea(request.form.get("message", ""), MAX_MESSAGE_LENGTH)
        website = clean_text(request.form.get("website", ""), 2048)

        errors = validate_contact(name, email, message, website)
        preview_title = None
        preview_excerpt = None

        if not errors and website:
            try:
                preview_title, preview_excerpt = fetch_preview(website)
            except PreviewError as exc:
                errors.append(str(exc))

        if errors:
            for error in errors:
                flash(error, "error")
            return render_template(
                "contact.html",
                form={"name": name, "email": email, "message": message, "website": website},
            ), 400

        db = get_db()
        db.execute(
            """
            INSERT INTO messages (name, email, message, website, preview_title, preview_excerpt)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (name, email, message, website or None, preview_title, preview_excerpt),
        )
        db.commit()
        flash("Message submitted.", "success")
        return redirect(url_for("contact_form"))

    @app.get("/admin/login")
    def login_form():
        return render_template("login.html")

    @app.post("/admin/login")
    def login():
        require_csrf()
        username = clean_text(request.form.get("username", ""), 80)
        password = request.form.get("password", "")
        user = get_db().execute(
            "SELECT id, username, password_hash FROM admins WHERE username = ?", (username,)
        ).fetchone()

        if not user or not bcrypt.checkpw(password.encode("utf-8"), user["password_hash"].encode("utf-8")):
            flash("Invalid credentials.", "error")
            return render_template("login.html", username=username), 401

        session.clear()
        session.permanent = True
        session["admin_id"] = user["id"]
        session["csrf_token"] = secrets.token_urlsafe(32)
        return redirect(url_for("admin_messages"))

    @app.post("/admin/logout")
    def logout():
        require_csrf()
        session.clear()
        return redirect(url_for("contact_form"))

    @app.get("/admin/messages")
    def admin_messages():
        admin_id = require_admin()
        messages = get_db().execute(
            """
            SELECT id, name, email, message, website, preview_title, preview_excerpt, created_at
            FROM messages
            WHERE owner_admin_id IS NULL OR owner_admin_id = ?
            ORDER BY created_at DESC, id DESC
            """,
            (admin_id,),
        ).fetchall()
        return render_template("admin.html", messages=messages)


def require_csrf():
    token = request.form.get("csrf_token", "")
    if not token or not secrets.compare_digest(token, session.get("csrf_token", "")):
        abort(403)


def require_admin():
    admin_id = session.get("admin_id")
    if not admin_id:
        abort(403)
    user = get_db().execute("SELECT id FROM admins WHERE id = ?", (admin_id,)).fetchone()
    if not user:
        session.clear()
        abort(403)
    return user["id"]


def get_db():
    if "db" not in g:
        conn = sqlite3.connect(DATABASE)
        conn.row_factory = sqlite3.Row
        g.db = conn
    return g.db


def init_db():
    db = get_db()
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_admin_id INTEGER NULL REFERENCES admins(id) ON DELETE SET NULL,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            message TEXT NOT NULL,
            website TEXT NULL,
            preview_title TEXT NULL,
            preview_excerpt TEXT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    maybe_seed_admin(db)
    db.commit()


def maybe_seed_admin(db):
    if db.execute("SELECT 1 FROM admins LIMIT 1").fetchone():
        return

    username = os.environ.get("ADMIN_USERNAME", "admin")
    password = os.environ.get("ADMIN_PASSWORD")
    if not password:
        return

    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
    db.execute(
        "INSERT INTO admins (username, password_hash) VALUES (?, ?)",
        (username, password_hash),
    )


@create_app().teardown_appcontext
def close_db(_error):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def clean_text(value, max_len):
    value = " ".join(str(value).split())
    return value[:max_len]


def clean_textarea(value, max_len):
    value = str(value).replace("\r\n", "\n").replace("\r", "\n").strip()
    return value[:max_len]


def validate_contact(name, email, message, website):
    errors = []
    if not name:
        errors.append("Name is required.")
    if not email or "@" not in email or len(email) > 254:
        errors.append("A valid email address is required.")
    if not message:
        errors.append("Message is required.")
    if website:
        try:
            parsed = urlparse(website)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname:
                errors.append("Website URL must use http or https.")
        except ValueError:
            errors.append("Website URL is invalid.")
    return errors


class PreviewError(Exception):
    pass


def fetch_preview(url):
    current_url = url
    for _ in range(MAX_REDIRECTS + 1):
        parsed, address = validate_outbound_url(current_url)
        body, status, location, content_type = request_url(parsed, address)
        if 300 <= status < 400 and location:
            current_url = urljoin(current_url, location)
            continue
        if status >= 400:
            raise PreviewError("Website preview could not be loaded.")
        if "text/html" not in content_type.lower():
            raise PreviewError("Website preview only supports HTML pages.")
        return parse_preview(body)
    raise PreviewError("Website preview redirected too many times.")


def validate_outbound_url(url):
    try:
        parsed = urlparse(url)
    except ValueError as exc:
        raise PreviewError("Website URL is invalid.") from exc

    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise PreviewError("Website URL must use http or https.")
    if parsed.username or parsed.password:
        raise PreviewError("Website URL cannot include credentials.")

    addresses = resolve_host(parsed.hostname)
    for address in addresses:
        if is_blocked_ip(address):
            raise PreviewError("Website URL points to a restricted network address.")
    return parsed, addresses[0]


def resolve_host(hostname):
    try:
        infos = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise PreviewError("Website host could not be resolved.") from exc

    addresses = []
    for info in infos:
        address = info[4][0]
        if address not in addresses:
            addresses.append(address)
    if not addresses:
        raise PreviewError("Website host could not be resolved.")
    return addresses


def is_blocked_ip(address):
    ip = ipaddress.ip_address(address)
    return any(
        [
            ip.is_private,
            ip.is_loopback,
            ip.is_link_local,
            ip.is_reserved,
            ip.is_multicast,
            ip.is_unspecified,
            ip.version == 6 and ip in ipaddress.ip_network("fc00::/7"),
        ]
    )


class ValidatedHTTPSConnection(HTTPSConnection):
    def __init__(self, address, port, hostname, context, timeout):
        super().__init__(address, port, context=context, timeout=timeout)
        self._validated_hostname = hostname

    def connect(self):
        raw_sock = socket.create_connection((self.host, self.port), self.timeout, self.source_address)
        self.sock = self._context.wrap_socket(raw_sock, server_hostname=self._validated_hostname)


def request_url(parsed, address):
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    path = parsed.path or "/"
    if parsed.query:
        path += f"?{parsed.query}"

    if parsed.scheme == "https":
        context = ssl.create_default_context()
        connection = ValidatedHTTPSConnection(
            address,
            port,
            parsed.hostname,
            context=context,
            timeout=CONNECT_TIMEOUT,
        )
    else:
        connection = HTTPConnection(address, port, timeout=CONNECT_TIMEOUT)
    try:
        connection.putrequest("GET", path, skip_host=True, skip_accept_encoding=True)
        host_header = parsed.hostname
        if parsed.port:
            host_header = f"{host_header}:{parsed.port}"
        connection.putheader("Host", host_header)
        connection.putheader("User-Agent", "ContactPreview/1.0")
        connection.putheader("Accept", "text/html")
        connection.putheader("Connection", "close")
        connection.endheaders()
        connection.sock.settimeout(READ_TIMEOUT)
        response = connection.getresponse()
        body = read_limited(response)
        return (
            body,
            response.status,
            response.getheader("Location"),
            response.getheader("Content-Type", ""),
        )
    except (OSError, ssl.SSLError) as exc:
        raise PreviewError("Website preview could not be loaded.") from exc
    finally:
        connection.close()


def read_limited(response):
    chunks = []
    total = 0
    while True:
        chunk = response.read(min(8192, MAX_PREVIEW_BYTES - total + 1))
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_PREVIEW_BYTES:
            raise PreviewError("Website preview is too large.")
        chunks.append(chunk)
    return b"".join(chunks)


def parse_preview(body):
    text = body.decode("utf-8", errors="replace")
    soup = BeautifulSoup(text, "html.parser")
    title = clean_text(soup.title.string if soup.title and soup.title.string else "Untitled page", 200)

    for element in soup(["script", "style", "noscript"]):
        element.decompose()
    lines = [line.strip() for line in soup.get_text("\n").splitlines() if line.strip()]
    excerpt = "\n".join(lines[:4])[:700]
    return title, excerpt


def nl2br(value):
    escaped = html.escape(value or "")
    return Markup(escaped.replace("\n", "<br>"))


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5044")))
