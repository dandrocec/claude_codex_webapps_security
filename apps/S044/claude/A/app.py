"""Contact form web app.

Collects name, email, message, and an optional website URL. When a URL is
provided, the server fetches the page and renders a small preview (title and
first lines of text). Submissions are stored in SQLite and listed on an admin
page.
"""

import ipaddress
import socket
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import urlparse

import requests
from flask import Flask, g, redirect, render_template, request, url_for

app = Flask(__name__)

DATABASE = "contacts.db"

# Limits for the outbound preview fetch.
FETCH_TIMEOUT = 5          # seconds
MAX_FETCH_BYTES = 512 * 1024  # 512 KiB is plenty for a title + intro
PREVIEW_LINES = 3


# --------------------------------------------------------------------------- #
# Database helpers
# --------------------------------------------------------------------------- #
def get_db():
    db = getattr(g, "_database", None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db


@app.teardown_appcontext
def close_db(exception):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()


def init_db():
    with closing(sqlite3.connect(DATABASE)) as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL,
                email       TEXT NOT NULL,
                message     TEXT NOT NULL,
                url         TEXT,
                preview     TEXT,
                created_at  TEXT NOT NULL
            )
            """
        )
        db.commit()


# --------------------------------------------------------------------------- #
# URL preview (with SSRF protections)
# --------------------------------------------------------------------------- #
class _TitleAndText(HTMLParser):
    """Extract the <title> and a bit of visible body text."""

    _SKIP = {"script", "style", "head", "noscript"}

    def __init__(self):
        super().__init__()
        self.title = ""
        self._in_title = False
        self._skip_depth = 0
        self._text_parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = True
        if tag in self._SKIP:
            self._skip_depth += 1

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag in self._SKIP and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif self._skip_depth == 0:
            stripped = data.strip()
            if stripped:
                self._text_parts.append(stripped)

    def first_lines(self, n):
        return self._text_parts[:n]


def _is_public_address(host):
    """Resolve a hostname and confirm every address is publicly routable.

    Blocks loopback, private, link-local, multicast and other reserved ranges
    so the preview fetcher cannot be turned into an SSRF tool against internal
    services or cloud metadata endpoints.
    """
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False

    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            return False
    return True


def fetch_preview(raw_url):
    """Return a preview dict for a URL, or an ``error`` dict if it can't be used.

    Only http/https URLs to public hosts are fetched. The download is bounded
    in time and size.
    """
    parsed = urlparse(raw_url)
    if parsed.scheme not in ("http", "https"):
        return {"error": "Only http and https URLs are supported."}
    if not parsed.hostname:
        return {"error": "Could not parse the URL."}

    if not _is_public_address(parsed.hostname):
        return {"error": "Refusing to fetch a non-public address."}

    try:
        resp = requests.get(
            raw_url,
            timeout=FETCH_TIMEOUT,
            stream=True,
            headers={"User-Agent": "ContactForm-Preview/1.0"},
            allow_redirects=False,  # avoid redirect-based SSRF bypasses
        )
    except requests.RequestException as exc:
        return {"error": f"Could not fetch the page ({exc.__class__.__name__})."}

    with resp:
        if resp.is_redirect or resp.is_permanent_redirect:
            return {"error": "The URL redirected; not following for safety."}
        if resp.status_code != 200:
            return {"error": f"The page returned HTTP {resp.status_code}."}

        ctype = resp.headers.get("Content-Type", "")
        if "html" not in ctype and "text" not in ctype:
            return {"error": "The URL did not return an HTML page."}

        chunks = []
        total = 0
        for chunk in resp.iter_content(chunk_size=8192, decode_unicode=False):
            if not chunk:
                continue
            total += len(chunk)
            if total > MAX_FETCH_BYTES:
                break
            chunks.append(chunk)

    body = b"".join(chunks).decode(resp.encoding or "utf-8", errors="replace")

    parser = _TitleAndText()
    parser.feed(body)

    return {
        "url": raw_url,
        "title": parser.title.strip() or "(no title)",
        "lines": parser.first_lines(PREVIEW_LINES),
    }


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip()
        message = request.form.get("message", "").strip()
        url = request.form.get("url", "").strip()

        errors = []
        if not name:
            errors.append("Name is required.")
        if not email:
            errors.append("Email is required.")
        if not message:
            errors.append("Message is required.")

        preview = None
        if url and not errors:
            preview = fetch_preview(url)

        if errors:
            return render_template(
                "index.html",
                errors=errors,
                form={"name": name, "email": email, "message": message, "url": url},
            )

        get_db().execute(
            "INSERT INTO messages (name, email, message, url, preview, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (
                name,
                email,
                message,
                url or None,
                preview.get("title") if preview and "error" not in preview else None,
                datetime.now(timezone.utc).isoformat(timespec="seconds"),
            ),
        )
        get_db().commit()

        return render_template("index.html", submitted=True, preview=preview)

    return render_template("index.html")


@app.route("/admin")
def admin():
    rows = (
        get_db()
        .execute("SELECT * FROM messages ORDER BY id DESC")
        .fetchall()
    )
    return render_template("admin.html", messages=rows)


if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5044, debug=True)
