#!/usr/bin/env python3
"""Batch orchestrator for application generation, with a resume checkpoint.

Drives harness/run_generation.py across many (spec x tool x variant) jobs and
remembers progress in logs/generation_state.json, so it can be stopped and
re-run and will continue exactly where it left off.

Design
------
* Jobs run in catalogue order S001..S100. For each spec, for each selected tool,
  for each selected variant.
* DEFAULTS: --tools claude  (Codex is queued, not attempted, until installed)
            --variants A B
* A job is "done" if logs/generation_state.json says so OR the app directory
  apps/<spec>/<tool>/<variant>/ already contains a generated app (immutability:
  done jobs are never re-run).
* If a tool is not on PATH (e.g. codex), its jobs are marked "blocked" and
  skipped, then reported — re-running later (once installed) picks them up.
* The frozen catalogue is verified against specs/catalog.lock before any run.

Usage
-----
  # See the plan without doing anything:
  python harness/run_batch.py --dry-run

  # Generate the first 5 Claude jobs (both variants), pinning the model:
  python harness/run_batch.py --tools claude --model claude-opus-4-8 --limit 5

  # Only variant A, only T1 specs:
  python harness/run_batch.py --variants A --specs S001-S025 --model claude-opus-4-8

  # Retry previously failed jobs:
  python harness/run_batch.py --retry-failed --model claude-opus-4-8
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CATALOG = REPO_ROOT / "specs" / "catalog.json"
LOCK = REPO_ROOT / "specs" / "catalog.lock"
APPS = REPO_ROOT / "apps"
STATE = REPO_ROOT / "logs" / "generation_state.json"
RUN_GENERATION = REPO_ROOT / "harness" / "run_generation.py"


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_catalog() -> list[dict]:
    return json.loads(CATALOG.read_text(encoding="utf-8-sig"))


def verify_lock() -> str | None:
    """Return an error string if catalog.json no longer matches catalog.lock."""
    if not LOCK.exists():
        return "specs/catalog.lock missing (run harness/build_catalog.py to freeze)"
    text = CATALOG.read_text(encoding="utf-8")
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    m = re.search(r"sha256:\s*([0-9a-f]{64})", LOCK.read_text(encoding="utf-8"))
    if not m:
        return "no sha256 found in catalog.lock"
    if m.group(1) != digest:
        return ("catalog.json does not match the frozen catalog.lock "
                f"(expected {m.group(1)[:16]}..., got {digest[:16]}...)")
    return None


def load_state() -> dict:
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8-sig"))
    return {}


def save_state(state: dict) -> None:
    STATE.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def app_done(spec: str, tool: str, variant: str) -> bool:
    d = APPS / spec / tool / variant
    if not d.is_dir():
        return False
    return any(c.name != ".gitkeep" for c in d.iterdir())


def parse_specs(arg: str, all_ids: list[str]) -> list[str]:
    if not arg:
        return all_ids
    chosen: list[str] = []
    for part in arg.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            lo, hi = int(a[1:]), int(b[1:])
            chosen += [f"S{n:03d}" for n in range(lo, hi + 1)]
        elif part:
            chosen.append(part)
    return [s for s in all_ids if s in set(chosen)]


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--tools", nargs="+", default=["claude"], choices=["claude", "codex"])
    p.add_argument("--variants", nargs="+", default=["A", "B"], choices=["A", "B"])
    p.add_argument("--specs", default="", help="e.g. 'S001-S025' or 'S001,S010'")
    p.add_argument("--model", default="", help="model to pin (required for real runs)")
    p.add_argument("--limit", type=int, default=0, help="max jobs to run this batch (0 = no limit)")
    p.add_argument("--retry-failed", action="store_true", help="also re-attempt failed jobs")
    p.add_argument("--dry-run", action="store_true", help="print the plan; run nothing")
    p.add_argument("--no-verify-lock", action="store_true", help="skip the frozen-catalog hash check")
    p.add_argument("--extra-arg", action="append", default=[], help="passed verbatim to run_generation")
    args = p.parse_args(argv[1:])

    if not args.no_verify_lock:
        err = verify_lock()
        if err:
            sys.exit(f"error: {err}\n(use --no-verify-lock only if you intend to regenerate the lock)")

    catalog = load_catalog()
    all_ids = [e["spec_id"] for e in catalog]
    specs = parse_specs(args.specs, all_ids)
    state = load_state()

    # availability of each tool on PATH
    available = {t: shutil.which(t) is not None for t in args.tools}

    # build ordered job list
    jobs = [(s, t, v) for s in specs for t in args.tools for v in args.variants]

    planned, skipped_done, blocked = [], 0, []
    for spec, tool, variant in jobs:
        key = f"{spec}|{tool}|{variant}"
        st = state.get(key, {}).get("status")
        if st == "done" or app_done(spec, tool, variant):
            skipped_done += 1
            continue
        if not available[tool]:
            blocked.append(key)
            state[key] = {"status": "blocked", "reason": f"{tool} not on PATH", "updated": _now()}
            continue
        if st == "failed" and not args.retry_failed:
            continue  # leave failed alone unless --retry-failed
        planned.append((spec, tool, variant, key))

    print(f"catalog: {len(all_ids)} specs | selected specs: {len(specs)} | "
          f"tools: {args.tools} | variants: {args.variants}")
    print(f"already done (skipped): {skipped_done} | blocked (tool missing): {len(blocked)} | "
          f"to run: {len(planned)}"
          + (f" | limit: {args.limit}" if args.limit else ""))
    if blocked:
        ex = ", ".join(sorted(blocked)[:6])
        print(f"  blocked examples: {ex}{' ...' if len(blocked) > 6 else ''} "
              f"(will run once the tool is installed)")

    if args.dry_run:
        for spec, tool, variant, _ in planned[: args.limit or len(planned)]:
            print(f"  PLAN  {spec} {tool} {variant}")
        return 0  # dry-run is side-effect free (does not touch the state file)

    if not args.model:
        sys.exit("error: --model is required for a real batch (pin the model explicitly)")

    save_state(state)
    ran = 0
    for spec, tool, variant, key in planned:
        if args.limit and ran >= args.limit:
            print(f"reached limit ({args.limit}); stopping. Re-run to continue.")
            break
        run_id = f"{spec}_{tool}_{variant}_{_dt.datetime.now(_dt.timezone.utc).strftime('%Y%m%d%H%M%S')}"
        cmd = [sys.executable, str(RUN_GENERATION),
               "--spec", spec, "--tool", tool, "--variant", variant,
               "--model", args.model, "--run-id", run_id, *args.extra_arg]
        print(f"\n>>> {spec} {tool} {variant}  (run_id {run_id})")
        state[key] = {"status": "running", "run_id": run_id, "updated": _now()}
        save_state(state)
        rc = subprocess.run(cmd).returncode
        state[key] = {"status": "done" if rc == 0 else "failed",
                      "run_id": run_id, "exit": rc, "updated": _now()}
        save_state(state)
        ran += 1

    # summary
    counts: dict[str, int] = {}
    for v in state.values():
        counts[v["status"]] = counts.get(v["status"], 0) + 1
    print(f"\nbatch complete: ran {ran} this session. state totals: {counts}")
    print(f"state file: {STATE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
