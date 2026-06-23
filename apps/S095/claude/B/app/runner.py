"""Job execution.

SECURITY NOTE
-------------
By design this application runs commands/scripts supplied by an authenticated
user. That capability is inherently powerful (it is effectively remote code
execution scoped to whatever privileges the server process holds), so:

  * Only authenticated users can submit jobs, and every job is owned by, and
    only visible to, the submitting user (access control / no IDOR).
  * Jobs run under a wall-clock timeout and their captured output is bounded.
  * In any real deployment you MUST additionally sandbox execution (a locked
    down container, an unprivileged user, seccomp/AppArmor, no network, ...)
    and never run the server as root. See the README.

The submitted text is executed as a shell script. We deliberately do not try
to "sanitise" the command itself, because executing it is the explicit purpose
of the tool; the controls above contain the blast radius instead.
"""
from __future__ import annotations

import datetime as dt
import os
import subprocess
import sys
import tempfile
import threading

from .config import settings
from .db import SessionLocal
from .models import Job, utcnow


def _run(job_id: int) -> None:
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is None:
            return
        job.status = "running"
        job.started_at = utcnow()
        db.commit()

        command = job.command
        try:
            output, exit_code, status = _execute(command)
        except subprocess.TimeoutExpired:
            output, exit_code, status = (
                f"[job exceeded timeout of {settings.JOB_TIMEOUT_SECONDS}s and was terminated]",
                None,
                "timeout",
            )
        except Exception:  # pragma: no cover - defensive
            # Never surface internal errors to the user; log server-side only.
            print(f"[ERROR] job {job_id} failed to execute", file=sys.stderr)
            import traceback

            traceback.print_exc()
            output, exit_code, status = (
                "[the job could not be started due to a server error]",
                None,
                "error",
            )

        job = db.get(Job, job_id)
        if job is None:
            return
        job.output = output[: settings.MAX_OUTPUT_BYTES]
        job.exit_code = exit_code
        job.status = status
        job.finished_at = utcnow()
        db.commit()
    finally:
        db.close()


def _execute(command: str) -> tuple[str, int | None, str]:
    """Run *command* as a script, capturing combined stdout+stderr."""
    is_windows = os.name == "nt"
    suffix = ".bat" if is_windows else ".sh"

    fd, path = tempfile.mkstemp(suffix=suffix, prefix="job_")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            if not is_windows:
                fh.write("#!/bin/sh\n")
            fh.write(command)

        if is_windows:
            args = ["cmd.exe", "/c", path]
        else:
            os.chmod(path, 0o700)
            args = ["/bin/sh", path]

        completed = subprocess.run(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            timeout=settings.JOB_TIMEOUT_SECONDS,
            # Do not inherit the full server environment; provide a minimal one.
            env={
                "PATH": os.environ.get("PATH", ""),
                "HOME": os.environ.get("HOME", os.environ.get("USERPROFILE", "")),
            },
            cwd=tempfile.gettempdir(),
            text=True,
            errors="replace",
        )
        output = completed.stdout or ""
        exit_code = completed.returncode
        status = "success" if exit_code == 0 else "failed"
        return output, exit_code, status
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def submit_job(job_id: int) -> None:
    """Launch the job in a background daemon thread."""
    thread = threading.Thread(target=_run, args=(job_id,), daemon=True)
    thread.start()
