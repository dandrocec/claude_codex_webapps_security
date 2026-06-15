"""A small Flask event-listing application.

Logged-in users can create events; a public page lists all upcoming events
sorted by date. Organisers can edit and delete only the events they created.
Data is stored in a local SQLite database.
"""
from datetime import date, datetime

from flask import (
    Flask,
    abort,
    flash,
    redirect,
    render_template,
    request,
    url_for,
)
from flask_login import (
    LoginManager,
    current_user,
    login_required,
    login_user,
    logout_user,
)

from models import Event, User, db


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = "dev-secret-change-me"
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///events.db"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    db.init_app(app)

    login_manager = LoginManager()
    login_manager.login_view = "login"
    login_manager.login_message_category = "error"
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

    with app.app_context():
        db.create_all()

    # ---- Public pages ---------------------------------------------------

    @app.route("/")
    def index():
        upcoming = (
            Event.query.filter(Event.date >= date.today())
            .order_by(Event.date.asc())
            .all()
        )
        return render_template("index.html", events=upcoming)

    @app.route("/event/<int:event_id>")
    def event_detail(event_id):
        event = db.get_or_404(Event, event_id)
        return render_template("event_detail.html", event=event)

    # ---- Authentication -------------------------------------------------

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for("index"))
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            if not username or not password:
                flash("Username and password are required.", "error")
            elif User.query.filter_by(username=username).first():
                flash("That username is already taken.", "error")
            else:
                user = User(username=username)
                user.set_password(password)
                db.session.add(user)
                db.session.commit()
                login_user(user)
                flash("Welcome! Your account has been created.", "success")
                return redirect(url_for("index"))
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for("index"))
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            user = User.query.filter_by(username=username).first()
            if user and user.check_password(password):
                login_user(user)
                next_page = request.args.get("next")
                return redirect(next_page or url_for("index"))
            flash("Invalid username or password.", "error")
        return render_template("login.html")

    @app.route("/logout")
    @login_required
    def logout():
        logout_user()
        flash("You have been logged out.", "success")
        return redirect(url_for("index"))

    # ---- Event management (organisers) ----------------------------------

    @app.route("/my-events")
    @login_required
    def my_events():
        events = (
            Event.query.filter_by(user_id=current_user.id)
            .order_by(Event.date.asc())
            .all()
        )
        return render_template("my_events.html", events=events)

    @app.route("/event/new", methods=["GET", "POST"])
    @login_required
    def create_event():
        if request.method == "POST":
            event = _event_from_form()
            if event is not None:
                event.user_id = current_user.id
                db.session.add(event)
                db.session.commit()
                flash("Event created.", "success")
                return redirect(url_for("event_detail", event_id=event.id))
        return render_template("event_form.html", event=None)

    @app.route("/event/<int:event_id>/edit", methods=["GET", "POST"])
    @login_required
    def edit_event(event_id):
        event = db.get_or_404(Event, event_id)
        if event.user_id != current_user.id:
            abort(403)
        if request.method == "POST":
            if _event_from_form(event) is not None:
                db.session.commit()
                flash("Event updated.", "success")
                return redirect(url_for("event_detail", event_id=event.id))
        return render_template("event_form.html", event=event)

    @app.route("/event/<int:event_id>/delete", methods=["POST"])
    @login_required
    def delete_event(event_id):
        event = db.get_or_404(Event, event_id)
        if event.user_id != current_user.id:
            abort(403)
        db.session.delete(event)
        db.session.commit()
        flash("Event deleted.", "success")
        return redirect(url_for("my_events"))

    def _event_from_form(event=None):
        """Populate (or build) an Event from the submitted form.

        Returns the Event on success, or None when validation fails (a flash
        message describing the problem is queued in that case).
        """
        title = request.form.get("title", "").strip()
        date_str = request.form.get("date", "").strip()
        location = request.form.get("location", "").strip()
        description = request.form.get("description", "").strip()

        if not title or not date_str or not location:
            flash("Title, date and location are required.", "error")
            return None
        try:
            parsed_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            flash("Date must be in YYYY-MM-DD format.", "error")
            return None

        if event is None:
            event = Event()
        event.title = title
        event.date = parsed_date
        event.location = location
        event.description = description
        return event

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5039, debug=True)
