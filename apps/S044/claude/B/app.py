"""Contact form web app with OWASP-aligned security controls.

Features:
  * Public contact form (name, email, message, optional website URL).
  * Optional server-side page preview for the submitted URL, behind a
    strict SSRF guard.
  * Authenticated admin page that lists / deletes stored messages.

Run with:  python app.py   (serves on http://127.0.0.1:5044)
"""

import os
import re
import socket
import ipaddress
import sqlite3
import secrets
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import urlsplit, urljoin
from contextlib import closing

import requests
from requests.adapters import HTTPAdapter
from urllib3.poolmanager import PoolManager
from urllib3.connection import HTTPConnection, HTTPSConnection
from urllib3.connectionpool import HTTPConnectionPool, HTTPSConnectionPool

from flask import (
    Flask, request, render_template, redirect, url_for, session,
    abort, flash, g,
)
from werkzeug.exceptions import HTTPException
from flask_wtf import CSRFProtect
from flask_wtf.csrf import CSRFError
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError

# --------------------------------------------------------------------------
# Configuration (all secrets come from the environment, never hardcoded)
# --------------------------------------------------------------------------
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "contact.db"))

# Cookie "Secure" flag must be True in production (HTTPS). For local plain
# HTTP testing it defaults to False so the session cookie is actually sent;
# set COOKIE_SECURE=true once you serve over TLS.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"

# SSRF / outbound-fetch limits
FETCH_CONNECT_TIMEOUT = float(os.environ.get("FETCH_CONNECT_TIMEOUT", "5"))
FETCH_READ_TIMEOUT = float(os.environ.get("FETCH_READ_TIMEOUT", "5"))
FETCH_MAX_BYTES = int(os.environ.get("FETCH_MAX_BYTES", str(512 * 1024)))  # 512 KiB
FETCH_MAX_REDIRECTS = int(os.environ.get("FETCH_MAX_REDIRECTS", "3"))
ALLOWED_SCHEMES = {"http", "https"}

# Input limits
NAME_MAX = 100
MESSAGE_MAX = 5000
URL_MAX = 2048
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

app = Flask(__name__)

_secret = os.environ.get("SECRET_KEY")
if not _secret:
    # Allow zero-config local runs, but a fixed secret via env is required to
    # keep sessions valid across restarts / multiple workers in production.
    _secret = secrets.token_hex(32)
    app.logger.warning("SECRET_KEY not set; generated an ephemeral one. "
                       "Set SECRET_KEY in the environment for production.")
app.config.update(
    SECRET_KEY=_secret,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=COOKIE_SECURE,
    SESSION_COOKIE_SAMESITE="Lax",
    MAX_CONTENT_LENGTH=64 * 1024,          # cap inbound request bodies
    WTF_CSRF_TIME_LIMIT=None,
)

csrf = CSRFProtect(app)
ph = PasswordHasher()


# --------------------------------------------------------------------------
# Database helpers (parameterised queries only)
# --------------------------------------------------------------------------
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    with closing(sqlite3.connect(DB_PATH)) as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS admins (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                name          TEXT NOT NULL,
                email         TEXT NOT NULL,
                message       TEXT NOT NULL,
                website_url   TEXT,
                preview_title TEXT,
                preview_text  TEXT,
                created_at    TEXT NOT NULL
            );
            """
        )
        db.commit()


def seed_admin():
    """Create the admin account from env vars if it does not yet exist."""
    username = os.environ.get("ADMIN_USERNAME", "admin")
    password = os.environ.get("ADMIN_PASSWORD")
    with closing(sqlite3.connect(DB_PATH)) as db:
        row = db.execute(
            "SELECT id FROM admins WHERE username = ?", (username,)
        ).fetchone()
        if row:
            return
        if not password:
            password = secrets.token_urlsafe(16)
            app.logger.warning(
                "ADMIN_PASSWORD not set. Created admin '%s' with a generated "
                "password: %s  (set ADMIN_PASSWORD to choose your own).",
                username, password,
            )
        db.execute(
            "INSERT INTO admins (username, password_hash) VALUES (?, ?)",
            (username, ph.hash(password)),
        )
        db.commit()


# --------------------------------------------------------------------------
# SSRF-hardened outbound fetcher
# --------------------------------------------------------------------------
class SSRFError(Exception):
    """Raised when a target host / IP is disallowed."""


def _ip_is_blocked(ip_str: str) -> bool:
    """Block private, loopback, link-local, reserved, multicast, etc."""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True
    # Normalise IPv4-mapped / 6to4-style addresses to their IPv4 form.
    if ip.version == 6:
        if ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        elif getattr(ip, "sixtofour", None):
            ip = ip.sixtofour
    return (
        ip.is_private          # 10/8, 172.16/12, 192.168/16, fc00::/7, 127/8 ...
        or ip.is_loopback      # 127/8, ::1
        or ip.is_link_local    # 169.254/16 (incl. 169.254.169.254), fe80::/10
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified   # 0.0.0.0, ::
    )


def _assert_peer_allowed(sock):
    """Validate the *actually connected* peer IP (defeats DNS rebinding)."""
    try:
        peer_ip = sock.getpeername()[0]
    except OSError as exc:  # pragma: no cover - defensive
        raise SSRFError("could not determine peer address") from exc
    if _ip_is_blocked(peer_ip):
        raise SSRFError(f"connection to disallowed address {peer_ip}")


class _ValidatingHTTPConnection(HTTPConnection):
    def connect(self):
        super().connect()
        _assert_peer_allowed(self.sock)


class _ValidatingHTTPSConnection(HTTPSConnection):
    def connect(self):
        super().connect()
        _assert_peer_allowed(self.sock)


class _ValidatingHTTPConnectionPool(HTTPConnectionPool):
    ConnectionCls = _ValidatingHTTPConnection


class _ValidatingHTTPSConnectionPool(HTTPSConnectionPool):
    ConnectionCls = _ValidatingHTTPSConnection


class _ValidatingPoolManager(PoolManager):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pool_classes_by_scheme = {
            "http": _ValidatingHTTPConnectionPool,
            "https": _ValidatingHTTPSConnectionPool,
        }


class SSRFAdapter(HTTPAdapter):
    def init_poolmanager(self, connections, maxsize, block=False, **kw):
        self.poolmanager = _ValidatingPoolManager(
            num_pools=connections, maxsize=maxsize, block=block, **kw
        )


def _validate_target(url: str) -> str:
    """Scheme allow-list + pre-resolution IP check. Returns normalised URL."""
    parts = urlsplit(url)
    if parts.scheme.lower() not in ALLOWED_SCHEMES:
        raise SSRFError("only http/https URLs are allowed")
    host = parts.hostname
    if not host:
        raise SSRFError("URL has no host")
    port = parts.port or (443 if parts.scheme.lower() == "https" else 80)
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise SSRFError("host could not be resolved") from exc
    if not infos:
        raise SSRFError("host could not be resolved")
    for info in infos:
        if _ip_is_blocked(info[4][0]):
            raise SSRFError("target resolves to a disallowed address")
    return url


def fetch_preview(url: str):
    """Fetch a URL safely and return (title, text) or raise SSRFError.

    Redirects are not followed automatically; each hop is re-validated.
    """
    sess = requests.Session()
    adapter = SSRFAdapter()
    sess.mount("http://", adapter)
    sess.mount("https://", adapter)
    headers = {
        "User-Agent": "ContactFormPreview/1.0",
        "Accept": "text/html,application/xhtml+xml",
    }

    current = url
    for _ in range(FETCH_MAX_REDIRECTS + 1):
        current = _validate_target(current)
        resp = sess.get(
            current,
            headers=headers,
            timeout=(FETCH_CONNECT_TIMEOUT, FETCH_READ_TIMEOUT),
            allow_redirects=False,
            stream=True,
        )
        if resp.is_redirect or resp.status_code in (301, 302, 303, 307, 308):
            location = resp.headers.get("Location")
            resp.close()
            if not location:
                raise SSRFError("redirect without a location")
            current = urljoin(current, location)  # re-validated next iteration
            continue

        ctype = resp.headers.get("Content-Type", "")
        if "html" not in ctype and "text" not in ctype:
            resp.close()
            raise SSRFError("target is not an HTML/text document")

        chunks, total = [], 0
        for chunk in resp.iter_content(8192):
            chunks.append(chunk)
            total += len(chunk)
            if total >= FETCH_MAX_BYTES:
                break
        resp.close()
        body = b"".join(chunks)[:FETCH_MAX_BYTES]
        encoding = resp.encoding or "utf-8"
        try:
            html = body.decode(encoding, errors="replace")
        except (LookupError, ValueError):
            html = body.decode("utf-8", errors="replace")
        return _extract_preview(html)

    raise SSRFError("too many redirects")


class _PreviewParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self._in_title = False
        self._in_skip = False
        self.title_parts = []
        self.text_parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = True
        elif tag in ("script", "style", "noscript"):
            self._in_skip = True

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag in ("script", "style", "noscript"):
            self._in_skip = False

    def handle_data(self, data):
        if self._in_title:
            self.title_parts.append(data)
        elif not self._in_skip:
            stripped = data.strip()
            if stripped:
                self.text_parts.append(stripped)


def _extract_preview(html: str):
    parser = _PreviewParser()
    try:
        parser.feed(html)
    except Exception:                     # noqa: BLE001 - never trust input
        pass
    title = " ".join(" ".join(parser.title_parts).split())[:200]
    text = " ".join(" ".join(parser.text_parts).split())[:300]
    return (title or None), (text or None)


# --------------------------------------------------------------------------
# Auth helpers / access control
# --------------------------------------------------------------------------
def current_admin_id():
    return session.get("admin_id")


def login_required(view):
    from functools import wraps

    @wraps(view)
    def wrapped(*args, **kwargs):
        if not current_admin_id():
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------
@app.route("/", methods=["GET", "POST"])
def contact():
    preview = None
    form = {"name": "", "email": "", "message": "", "website_url": ""}
    if request.method == "POST":
        name = (request.form.get("name") or "").strip()
        email = (request.form.get("email") or "").strip()
        message = (request.form.get("message") or "").strip()
        website = (request.form.get("website_url") or "").strip()
        form = {"name": name, "email": email,
                "message": message, "website_url": website}

        errors = []
        if not name or len(name) > NAME_MAX:
            errors.append("Please provide a name (max %d chars)." % NAME_MAX)
        if not EMAIL_RE.match(email) or len(email) > 254:
            errors.append("Please provide a valid email address.")
        if not message or len(message) > MESSAGE_MAX:
            errors.append("Please provide a message (max %d chars)." % MESSAGE_MAX)

        preview_title = preview_text = None
        if website:
            if len(website) > URL_MAX:
                errors.append("The website URL is too long.")
            else:
                try:
                    preview_title, preview_text = fetch_preview(website)
                    preview = {"title": preview_title, "text": preview_text}
                except SSRFError as exc:
                    errors.append("Could not preview that URL: %s." % exc)
                except requests.RequestException:
                    errors.append("Could not reach that URL.")

        if errors:
            for e in errors:
                flash(e, "error")
            return render_template("contact.html", form=form, preview=preview)

        db = get_db()
        db.execute(
            "INSERT INTO messages "
            "(name, email, message, website_url, preview_title, preview_text, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (name, email, message, website or None,
             preview_title, preview_text,
             datetime.now(timezone.utc).isoformat()),
        )
        db.commit()
        flash("Thanks! Your message was received.", "success")
        return redirect(url_for("contact"))

    return render_template("contact.html", form=form, preview=preview)


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        db = get_db()
        row = db.execute(
            "SELECT id, password_hash FROM admins WHERE username = ?",
            (username,),
        ).fetchone()

        authenticated = False
        if row:
            try:
                ph.verify(row["password_hash"], password)
                authenticated = True
                if ph.check_needs_rehash(row["password_hash"]):
                    db.execute(
                        "UPDATE admins SET password_hash = ? WHERE id = ?",
                        (ph.hash(password), row["id"]),
                    )
                    db.commit()
            except (VerifyMismatchError, InvalidHashError):
                authenticated = False
        else:
            # Equalise timing whether or not the user exists.
            ph.hash(password)

        if authenticated:
            session.clear()
            session["admin_id"] = row["id"]
            session.permanent = False
            nxt = request.args.get("next", "")
            # Only allow local redirects (no open redirect).
            if (nxt.startswith("/") and not nxt.startswith("//")
                    and "\\" not in nxt):
                return redirect(nxt)
            return redirect(url_for("admin"))

        flash("Invalid credentials.", "error")

    return render_template("login.html")


@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    flash("Logged out.", "success")
    return redirect(url_for("login"))


@app.route("/admin")
@login_required
def admin():
    db = get_db()
    rows = db.execute(
        "SELECT id, name, email, message, website_url, preview_title, "
        "preview_text, created_at FROM messages ORDER BY id DESC"
    ).fetchall()
    return render_template("admin.html", messages=rows)


@app.route("/admin/messages/<int:message_id>/delete", methods=["POST"])
@login_required
def delete_message(message_id):
    db = get_db()
    row = db.execute(
        "SELECT id FROM messages WHERE id = ?", (message_id,)
    ).fetchone()
    if not row:
        abort(404)
    db.execute("DELETE FROM messages WHERE id = ?", (message_id,))
    db.commit()
    flash("Message deleted.", "success")
    return redirect(url_for("admin"))


# --------------------------------------------------------------------------
# Security headers + error handling (no stack traces to clients)
# --------------------------------------------------------------------------
@app.after_request
def set_security_headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; "
        "style-src 'self'; script-src 'self'; "
        "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    )
    resp.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    if COOKIE_SECURE:
        resp.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
    return resp


@app.errorhandler(CSRFError)
def handle_csrf_error(_exc):
    return render_template("error.html", code=400,
                           message="The form session expired. Please retry."), 400


@app.errorhandler(404)
def not_found(_exc):
    return render_template("error.html", code=404,
                           message="Not found."), 404


@app.errorhandler(413)
def too_large(_exc):
    return render_template("error.html", code=413,
                           message="Request too large."), 413


@app.errorhandler(HTTPException)
def handle_http_exception(exc):
    # Preserve the real status code; show only the generic description.
    return render_template("error.html", code=exc.code,
                           message=exc.name), exc.code


@app.errorhandler(Exception)
def handle_unexpected(exc):
    # Log full detail server-side; never expose internals to the client.
    app.logger.exception("Unhandled error: %s", exc)
    return render_template("error.html", code=500,
                           message="An unexpected error occurred."), 500


def bootstrap():
    init_db()
    seed_admin()


bootstrap()


if __name__ == "__main__":
    # debug=False so stack traces are never sent to clients.
    app.run(host="127.0.0.1", port=5044, debug=False)
