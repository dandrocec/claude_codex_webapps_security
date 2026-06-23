"""Executes submitted commands in background worker threads."""

import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import database as db

# Bounded pool: at most a few jobs run at once so a burst of submissions
# can't exhaust the machine.
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="job")

# Hard ceiling so a runaway job (e.g. `yes`) can't fill the disk/DB.
MAX_OUTPUT_BYTES = 1_000_000
JOB_TIMEOUT_SECONDS = 300


def submit(job_id: int) -> None:
    """Schedule a previously-created (pending) job for execution."""
    _executor.submit(_run, job_id)


def _run(job_id: int) -> None:
    job = db.get_job(job_id)
    if job is None:
        return

    command = job["command"]
    db.mark_running(job_id)

    try:
        # shell=True so users can submit shell pipelines/scripts, which is the
        # whole point of a job runner. This is intentional RCE-by-design and is
        # why the app requires login and binds to localhost by default.
        proc = subprocess.Popen(
            command,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            cwd=None,
        )
    except Exception as exc:  # command failed to even start
        db.append_output(job_id, f"[failed to start: {exc}]\n")
        db.finish_job(job_id, "failed", None)
        return

    written = 0
    truncated = False
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            if written >= MAX_OUTPUT_BYTES:
                if not truncated:
                    db.append_output(job_id, "\n[output truncated]\n")
                    truncated = True
                continue
            written += len(line)
            db.append_output(job_id, line)
        proc.wait(timeout=JOB_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        proc.kill()
        db.append_output(job_id, f"\n[killed: exceeded {JOB_TIMEOUT_SECONDS}s timeout]\n")
        db.finish_job(job_id, "failed", None)
        return
    except Exception as exc:
        db.append_output(job_id, f"\n[error: {exc}]\n")
        db.finish_job(job_id, "failed", proc.returncode)
        return

    status = "success" if proc.returncode == 0 else "failed"
    db.finish_job(job_id, status, proc.returncode)


def requeue_orphans() -> None:
    """On startup, mark jobs that were 'running' when the server died as failed."""
    for job in db.list_jobs(limit=1000):
        if job["status"] in ("running", "pending"):
            db.append_output(job["id"], "\n[interrupted: server restarted]\n")
            db.finish_job(job["id"], "failed", None)
