import ipaddress
import socket
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from flask import Flask, g, redirect, render_template, request, url_for


BASE_DIR = Path(__file__).resolve().parent
DATABASE = BASE_DIR / "contacts.db"

app = Flask(__name__)
app.config["SECRET_KEY"] = "dev-contact-form-secret"


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    with closing(sqlite3.connect(DATABASE)) as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                message TEXT NOT NULL,
                website_url TEXT,
                preview_title TEXT,
                preview_text TEXT,
                fetch_error TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        db.commit()


def normalize_url(raw_url):
    value = (raw_url or "").strip()
    if not value:
        return ""
    if "://" not in value:
        value = f"https://{value}"
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Enter a valid HTTP or HTTPS URL.")
    if parsed.username or parsed.password:
        raise ValueError("URLs with credentials are not supported.")
    return value


def host_is_public(hostname):
    try:
        addresses = socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return False

    for entry in addresses:
        ip_text = entry[4][0]
        try:
            address = ipaddress.ip_address(ip_text)
        except ValueError:
            return False
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_multicast
            or address.is_reserved
            or address.is_unspecified
        ):
            return False
    return True


def extract_preview(url):
    parsed = urlparse(url)
    if not host_is_public(parsed.hostname):
        raise ValueError("Preview is only available for public websites.")

    response = requests.get(
        url,
        timeout=4,
        allow_redirects=True,
        headers={"User-Agent": "ContactPreviewBot/1.0"},
    )
    response.raise_for_status()

    final = urlparse(response.url)
    if final.scheme not in {"http", "https"} or not host_is_public(final.hostname):
        raise ValueError("The preview redirected to a non-public address.")

    content_type = response.headers.get("content-type", "")
    if "text/html" not in content_type.lower():
        raise ValueError("The URL did not return an HTML page.")

    soup = BeautifulSoup(response.text[:200_000], "html.parser")
    for element in soup(["script", "style", "noscript", "svg"]):
        element.decompose()

    title = soup.title.string.strip() if soup.title and soup.title.string else ""
    text = soup.get_text("\n")
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    preview_lines = lines[:4]

    return {
        "title": title[:180] or "Untitled page",
        "text": "\n".join(preview_lines)[:600],
    }


@app.route("/", methods=["GET", "POST"])
def index():
    errors = []
    form = {
        "name": "",
        "email": "",
        "message": "",
        "website_url": "",
    }
    preview = None
    fetch_error = None

    if request.method == "POST":
        form = {
            "name": request.form.get("name", "").strip(),
            "email": request.form.get("email", "").strip(),
            "message": request.form.get("message", "").strip(),
            "website_url": request.form.get("website_url", "").strip(),
        }

        if not form["name"]:
            errors.append("Name is required.")
        if "@" not in form["email"] or "." not in form["email"]:
            errors.append("Enter a valid email address.")
        if not form["message"]:
            errors.append("Message is required.")

        normalized_url = ""
        if form["website_url"]:
            try:
                normalized_url = normalize_url(form["website_url"])
                preview = extract_preview(normalized_url)
            except (ValueError, requests.RequestException) as error:
                fetch_error = str(error)

        if not errors:
            db = get_db()
            db.execute(
                """
                INSERT INTO submissions (
                    name, email, message, website_url, preview_title,
                    preview_text, fetch_error, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    form["name"],
                    form["email"],
                    form["message"],
                    normalized_url,
                    preview["title"] if preview else None,
                    preview["text"] if preview else None,
                    fetch_error,
                    datetime.now(timezone.utc).isoformat(timespec="seconds"),
                ),
            )
            db.commit()
            return redirect(url_for("thanks"))

    return render_template(
        "index.html",
        errors=errors,
        form=form,
        preview=preview,
        fetch_error=fetch_error,
    )


@app.route("/thanks")
def thanks():
    return render_template("thanks.html")


@app.route("/admin")
def admin():
    rows = get_db().execute(
        "SELECT * FROM submissions ORDER BY id DESC"
    ).fetchall()
    return render_template("admin.html", submissions=rows)


init_db()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5044, debug=True)
