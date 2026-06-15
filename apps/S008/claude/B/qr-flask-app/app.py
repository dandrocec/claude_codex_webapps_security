"""QR-code generator web app (Flask).

Turns text or a URL from a form into a QR-code PNG, shows it on a result
page, and lets the user download it. Logged-in users get a private history
of their generated codes (each user can only see/download/delete their own).

Security controls implemented here are summarised in the README under
"Security".
"""
import base64
import io

import qrcode
from flask import (
    Flask,
    abort,
    flash,
    redirect,
    render_template,
    request,
    send_file,
    url_for,
)
from flask_login import (
    LoginManager,
    current_user,
    login_required,
    login_user,
    logout_user,
)
from flask_wtf.csrf import CSRFProtect

from config import Config
from forms import LoginForm, QRForm, RegisterForm
from models import QRCode, User, db

csrf = CSRFProtect()
login_manager = LoginManager()


# --------------------------------------------------------------------------
# QR generation helper
# --------------------------------------------------------------------------
def render_qr_png(content: str) -> bytes:
    """Render `content` to PNG bytes. `content` is treated purely as opaque
    data to encode — it is never executed or interpolated anywhere."""
    qr = qrcode.QRCode(
        version=None,  # auto-size
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(content)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# --------------------------------------------------------------------------
# App factory
# --------------------------------------------------------------------------
def create_app(config_object: type = Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_object)

    db.init_app(app)
    csrf.init_app(app)
    login_manager.init_app(app)
    login_manager.login_view = "login"
    login_manager.login_message_category = "error"

    @login_manager.user_loader
    def load_user(user_id: str):
        return db.session.get(User, user_id)

    with app.app_context():
        db.create_all()

    register_routes(app)
    register_security_headers(app)
    register_error_handlers(app)
    return app


# --------------------------------------------------------------------------
# Security headers (OWASP secure-headers guidance)
# --------------------------------------------------------------------------
def register_security_headers(app: Flask) -> None:
    @app.after_request
    def set_secure_headers(response):
        # Strict CSP: only our own resources; images may be inline data URIs
        # (used to show the generated QR). No inline scripts are allowed.
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "img-src 'self' data:; "
            "style-src 'self'; "
            "script-src 'self'; "
            "object-src 'none'; "
            "base-uri 'none'; "
            "frame-ancestors 'none'; "
            "form-action 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = (
            "geolocation=(), microphone=(), camera=()"
        )
        if app.config.get("SESSION_COOKIE_SECURE"):
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------
def register_routes(app: Flask) -> None:

    # ---- QR generation -----------------------------------------------------
    @app.route("/", methods=["GET", "POST"])
    def index():
        form = QRForm()
        if form.validate_on_submit():
            content = form.content.data.strip()
            png = render_qr_png(content)
            b64 = base64.b64encode(png).decode("ascii")

            # Persist to the owner's private history when logged in.
            qr_id = None
            if current_user.is_authenticated:
                record = QRCode(user_id=current_user.id, content=content)
                db.session.add(record)
                db.session.commit()
                qr_id = record.id

            # `content` is rendered via Jinja2 autoescaping -> XSS-safe.
            return render_template(
                "result.html", content=content, image_b64=b64, qr_id=qr_id
            )
        return render_template("index.html", form=form)

    @app.route("/download", methods=["POST"])
    def download_anonymous():
        """Stateless PNG download for the just-generated code (any visitor).
        CSRF-protected; input re-validated before rendering."""
        form = QRForm()
        if not form.validate_on_submit():
            abort(400)
        png = render_qr_png(form.content.data.strip())
        return send_file(
            io.BytesIO(png),
            mimetype="image/png",
            as_attachment=True,
            download_name="qrcode.png",
        )

    # ---- Per-user history (access-controlled) ------------------------------
    @app.route("/history")
    @login_required
    def history():
        items = (
            QRCode.query.filter_by(user_id=current_user.id)
            .order_by(QRCode.created_at.desc())
            .all()
        )
        return render_template("history.html", items=items)

    def _owned_qr_or_404(qr_id: str) -> QRCode:
        """Fetch a QR code, enforcing ownership to prevent IDOR.

        We filter by BOTH id and the current user's id, so requesting
        someone else's id simply yields 404 — never their data."""
        qr = QRCode.query.filter_by(id=qr_id, user_id=current_user.id).first()
        if qr is None:
            abort(404)
        return qr

    @app.route("/qr/<qr_id>.png")
    @login_required
    def qr_image(qr_id: str):
        qr = _owned_qr_or_404(qr_id)
        png = render_qr_png(qr.content)
        return send_file(io.BytesIO(png), mimetype="image/png")

    @app.route("/qr/<qr_id>/download")
    @login_required
    def qr_download(qr_id: str):
        qr = _owned_qr_or_404(qr_id)
        png = render_qr_png(qr.content)
        return send_file(
            io.BytesIO(png),
            mimetype="image/png",
            as_attachment=True,
            download_name="qrcode.png",
        )

    @app.route("/qr/<qr_id>/delete", methods=["POST"])
    @login_required
    def qr_delete(qr_id: str):
        qr = _owned_qr_or_404(qr_id)
        db.session.delete(qr)
        db.session.commit()
        flash("QR code deleted.", "success")
        return redirect(url_for("history"))

    # ---- Auth --------------------------------------------------------------
    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for("index"))
        form = RegisterForm()
        if form.validate_on_submit():
            email = form.email.data.strip().lower()
            # ORM query is parameterised -> no SQL injection.
            if User.query.filter_by(email=email).first():
                # Generic message; don't reveal which emails are registered.
                flash("Could not create account with those details.", "error")
            else:
                user = User(email=email)
                user.set_password(form.password.data)
                db.session.add(user)
                db.session.commit()
                flash("Account created. Please log in.", "success")
                return redirect(url_for("login"))
        return render_template("register.html", form=form)

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for("index"))
        form = LoginForm()
        if form.validate_on_submit():
            email = form.email.data.strip().lower()
            user = User.query.filter_by(email=email).first()
            # Same generic error whether the email or password is wrong,
            # to avoid user enumeration. check_password is constant-time.
            if user is not None and user.check_password(form.password.data):
                login_user(user)
                flash("Logged in.", "success")
                next_url = _safe_next(request.args.get("next"))
                return redirect(next_url or url_for("index"))
            flash("Invalid email or password.", "error")
        return render_template("login.html", form=form)

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        logout_user()
        flash("Logged out.", "success")
        return redirect(url_for("index"))


def _safe_next(target: str | None) -> str | None:
    """Only allow same-site relative redirects (open-redirect guard)."""
    if not target:
        return None
    if target.startswith("/") and not target.startswith("//"):
        return target
    return None


# --------------------------------------------------------------------------
# Error handling — never leak stack traces or internals to the client
# --------------------------------------------------------------------------
def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(400)
    def bad_request(_e):
        return render_template("error.html", code=400, message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(_e):
        return render_template("error.html", code=403, message="Forbidden."), 403

    @app.errorhandler(404)
    def not_found(_e):
        return render_template("error.html", code=404, message="Not found."), 404

    @app.errorhandler(413)
    def too_large(_e):
        return render_template("error.html", code=413, message="Request too large."), 413

    @app.errorhandler(500)
    def server_error(_e):
        app.logger.exception("Unhandled server error")  # logged, not shown
        return (
            render_template("error.html", code=500, message="Something went wrong."),
            500,
        )


app = create_app()


if __name__ == "__main__":
    import os

    port = int(os.environ.get("PORT", "5008"))
    # debug=False so tracebacks are never sent to the browser.
    app.run(host="127.0.0.1", port=port, debug=False)
