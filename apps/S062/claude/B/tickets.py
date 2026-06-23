"""Tickets blueprint: the core helpdesk workflow.

Access-control rules (enforced server-side on every request):
  * Customers can see and act on ONLY their own tickets.
  * Agents can see all tickets, assign them, change status, and reply.
Ownership is checked against the authenticated user's id from the session,
never from a client-supplied parameter — this prevents IDOR.
"""
from flask import (
    Blueprint,
    abort,
    flash,
    g,
    redirect,
    render_template,
    url_for,
)

from db import get_db
from forms import AssignForm, ReplyForm, StatusForm, TicketForm
from security import login_required, role_required

bp = Blueprint("tickets", __name__)


def _get_ticket_or_404(ticket_id: int):
    """Fetch a ticket plus customer/agent names, or 404."""
    return get_db().execute(
        """
        SELECT t.*,
               c.name  AS customer_name,
               c.email AS customer_email,
               a.name  AS agent_name
        FROM tickets t
        JOIN users c ON c.id = t.customer_id
        LEFT JOIN users a ON a.id = t.assigned_agent_id
        WHERE t.id = ?
        """,
        (ticket_id,),
    ).fetchone()


def _can_access(ticket) -> bool:
    """Agents may access any ticket; customers only their own."""
    if g.user["role"] == "agent":
        return True
    return ticket["customer_id"] == g.user["id"]


@bp.route("/")
@login_required
def index():
    db = get_db()
    if g.user["role"] == "agent":
        tickets = db.execute(
            """
            SELECT t.id, t.subject, t.status, t.updated_at,
                   c.name AS customer_name, a.name AS agent_name
            FROM tickets t
            JOIN users c ON c.id = t.customer_id
            LEFT JOIN users a ON a.id = t.assigned_agent_id
            ORDER BY t.updated_at DESC
            """
        ).fetchall()
    else:
        tickets = db.execute(
            """
            SELECT t.id, t.subject, t.status, t.updated_at,
                   a.name AS agent_name
            FROM tickets t
            LEFT JOIN users a ON a.id = t.assigned_agent_id
            WHERE t.customer_id = ?
            ORDER BY t.updated_at DESC
            """,
            (g.user["id"],),
        ).fetchall()
    return render_template("tickets/index.html", tickets=tickets)


@bp.route("/tickets/new", methods=["GET", "POST"])
@role_required("customer")
def new():
    form = TicketForm()
    if form.validate_on_submit():
        db = get_db()
        cur = db.execute(
            "INSERT INTO tickets (customer_id, subject, status) VALUES (?, ?, 'open')",
            (g.user["id"], form.subject.data.strip()),
        )
        ticket_id = cur.lastrowid
        db.execute(
            "INSERT INTO replies (ticket_id, author_id, body) VALUES (?, ?, ?)",
            (ticket_id, g.user["id"], form.body.data.strip()),
        )
        db.commit()
        flash("Ticket opened.", "success")
        return redirect(url_for("tickets.view", ticket_id=ticket_id))
    return render_template("tickets/new.html", form=form)


@bp.route("/tickets/<int:ticket_id>")
@login_required
def view(ticket_id: int):
    ticket = _get_ticket_or_404(ticket_id)
    if ticket is None or not _can_access(ticket):
        # 404 (not 403) for non-owners so we don't reveal the ticket exists.
        abort(404)

    db = get_db()
    replies = db.execute(
        """
        SELECT r.body, r.created_at, u.name AS author_name, u.role AS author_role
        FROM replies r
        JOIN users u ON u.id = r.author_id
        WHERE r.ticket_id = ?
        ORDER BY r.created_at ASC, r.id ASC
        """,
        (ticket_id,),
    ).fetchall()

    agents = []
    assign_form = None
    status_form = None
    if g.user["role"] == "agent":
        agents = db.execute(
            "SELECT id, name FROM users WHERE role = 'agent' ORDER BY name"
        ).fetchall()
        assign_form = AssignForm()
        assign_form.agent_id.choices = [(0, "— Unassigned —")] + [
            (a["id"], a["name"]) for a in agents
        ]
        if ticket["assigned_agent_id"]:
            assign_form.agent_id.data = ticket["assigned_agent_id"]
        status_form = StatusForm(status=ticket["status"])

    return render_template(
        "tickets/view.html",
        ticket=ticket,
        replies=replies,
        reply_form=ReplyForm(),
        assign_form=assign_form,
        status_form=status_form,
    )


@bp.route("/tickets/<int:ticket_id>/reply", methods=["POST"])
@login_required
def reply(ticket_id: int):
    ticket = _get_ticket_or_404(ticket_id)
    if ticket is None or not _can_access(ticket):
        abort(404)
    if ticket["status"] == "closed":
        flash("This ticket is closed.", "error")
        return redirect(url_for("tickets.view", ticket_id=ticket_id))

    form = ReplyForm()
    if form.validate_on_submit():
        db = get_db()
        db.execute(
            "INSERT INTO replies (ticket_id, author_id, body) VALUES (?, ?, ?)",
            (ticket_id, g.user["id"], form.body.data.strip()),
        )
        db.execute(
            "UPDATE tickets SET updated_at = datetime('now') WHERE id = ?",
            (ticket_id,),
        )
        db.commit()
        flash("Reply sent.", "success")
    else:
        flash("Your reply could not be sent.", "error")
    return redirect(url_for("tickets.view", ticket_id=ticket_id))


@bp.route("/tickets/<int:ticket_id>/status", methods=["POST"])
@role_required("agent")
def change_status(ticket_id: int):
    ticket = _get_ticket_or_404(ticket_id)
    if ticket is None:
        abort(404)
    form = StatusForm()
    if form.validate_on_submit():
        db = get_db()
        db.execute(
            "UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE id = ?",
            (form.status.data, ticket_id),
        )
        db.commit()
        flash("Status updated.", "success")
    else:
        flash("Invalid status.", "error")
    return redirect(url_for("tickets.view", ticket_id=ticket_id))


@bp.route("/tickets/<int:ticket_id>/assign", methods=["POST"])
@role_required("agent")
def assign(ticket_id: int):
    ticket = _get_ticket_or_404(ticket_id)
    if ticket is None:
        abort(404)

    db = get_db()
    agents = db.execute("SELECT id, name FROM users WHERE role = 'agent'").fetchall()
    form = AssignForm()
    form.agent_id.choices = [(0, "— Unassigned —")] + [
        (a["id"], a["name"]) for a in agents
    ]
    if form.validate_on_submit():
        new_agent = form.agent_id.data or None
        # Validate the chosen id really is an agent (defence in depth).
        if new_agent is not None and new_agent not in {a["id"] for a in agents}:
            abort(400)
        db.execute(
            "UPDATE tickets SET assigned_agent_id = ?, updated_at = datetime('now') "
            "WHERE id = ?",
            (new_agent, ticket_id),
        )
        db.commit()
        flash("Ticket assignment updated.", "success")
    else:
        flash("Could not update assignment.", "error")
    return redirect(url_for("tickets.view", ticket_id=ticket_id))
