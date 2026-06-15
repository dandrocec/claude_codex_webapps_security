#!/usr/bin/env python3
"""Batch-runner for one application-generation run (study Phase A/B x two tools).

Operationalises the protocol:
  * §5.1  Mechanically assembles the prompt from the catalogue:
            functional core (+ run footer) [+ security block + category addenda for B]
          enforcing the byte-identical invariants (functional core identical across
          all 4 conditions of a spec; security block identical across all B runs).
  * §5.3  Invokes Claude Code / Codex through the frozen, equivalent non-interactive
          entry points (see harness/invocation.md), in a clean, isolated session.
  * Records the exact command in logs/commands.log and appends a row to
          logs/sessions.csv.

It NEVER edits generated code. It refuses to overwrite an already-generated app
directory (immutability). Re-generation must target a clean directory.

Examples
--------
  # Dry run: assemble + print the prompt and the exact command, change nothing.
  python harness/run_generation.py --spec S001 --tool claude --variant A --dry-run

  # Real run (model pinned explicitly):
  python harness/run_generation.py --spec S001 --tool claude --variant B \
      --model claude-opus-4-8

Caveat on session hygiene
-------------------------
By default the tool is invoked in an ISOLATED temp working directory OUTSIDE this
repo, then the generated project is moved into apps/<spec>/<tool>/<variant>/. This
prevents the study repo's own CLAUDE.md / project memory / settings from leaking
into the generation. GLOBAL, user-level context (e.g. ~/.claude/CLAUDE.md) is NOT
isolated by this script — if your study requires excluding that too, add the
tool's own bare/no-memory flag via --extra-arg and document it.
"""
from __future__ import annotations

import argparse
import csv
import datetime as _dt
import hashlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SPECS = REPO_ROOT / "specs"
PROMPTS = REPO_ROOT / "prompts"
LOGS = REPO_ROOT / "logs"

SESSIONS_CSV = LOGS / "sessions.csv"
COMMANDS_LOG = LOGS / "commands.log"
RENDERED_DIR = PROMPTS / "rendered"

VALID_TOOLS = ("claude", "codex")
VALID_VARIANTS = ("A", "B")


# --------------------------------------------------------------------------- #
# loading
# --------------------------------------------------------------------------- #
def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def load_spec(spec_id: str, catalog_path: Path) -> dict:
    import json

    try:
        catalog = json.loads(_read(catalog_path))
    except FileNotFoundError:
        sys.exit(f"error: catalog not found: {catalog_path}")
    except json.JSONDecodeError as exc:
        sys.exit(f"error: invalid JSON in {catalog_path}: {exc}")
    for entry in catalog:
        if entry.get("spec_id") == spec_id:
            return entry
    sys.exit(f"error: spec_id {spec_id!r} not found in {catalog_path}")


def load_addenda_for_category(category: str) -> list[str]:
    """Return the addendum texts mapped to a category (deterministic, ordered)."""
    import json

    map_path = SPECS / "addenda" / "addenda_map.json"
    if not map_path.is_file():
        return []
    mapping = json.loads(_read(map_path)).get("map", {})
    texts: list[str] = []
    for fname in mapping.get(category, []):
        texts.append(_read(SPECS / "addenda" / fname).strip())
    return texts


# --------------------------------------------------------------------------- #
# §5.1 prompt assembly
# --------------------------------------------------------------------------- #
def render_functional_core(spec: dict) -> str:
    # Verbatim: the functional core is the exact variant-A text from the catalogue
    # (Appendix A). It is NOT re-rendered, so it stays byte-identical across the
    # four conditions of a spec.
    core = spec.get("functional_core")
    if not core:
        sys.exit(f"error: spec {spec.get('spec_id')} has no functional_core")
    return str(core).rstrip()


def render_run_footer(spec: dict) -> str:
    tmpl = _read(PROMPTS / "run_footer.tmpl")
    return (
        tmpl.replace("{{LANGUAGE}}", str(spec.get("language", "")))
        .replace("{{FRAMEWORK}}", str(spec.get("framework", "")))
        .replace("{{PORT}}", str(spec.get("port", "")))
        .rstrip()
    )


def render_security_block(spec: dict) -> str:
    canonical = _read(SPECS / "security_block.md").strip()
    addenda = load_addenda_for_category(str(spec.get("category", "")))
    return "\n\n".join([canonical, *addenda])


def assemble_prompt(spec: dict, variant: str) -> str:
    parts = [render_functional_core(spec), render_run_footer(spec)]   # parts 1 + 2
    if variant == "B":
        parts.append(render_security_block(spec))                     # part 3 (B only)
    return "\n\n".join(parts) + "\n"


# --------------------------------------------------------------------------- #
# §5.3 invocation
# --------------------------------------------------------------------------- #
def build_command(tool: str, prompt: str, model: str, workdir: Path,
                  extra: list[str]) -> tuple[list[str], Path | None]:
    """Return (argv, cwd). cwd is None when the tool takes a working-dir flag."""
    if tool == "claude":
        # Verified for Claude Code v2.1.169 (see harness/invocation.md):
        # -p print mode; no --output-dir (writes to cwd); auto-accept edits.
        argv = ["claude", "-p", prompt, "--model", model,
                "--permission-mode", "acceptEdits", *extra]
        return argv, workdir
    if tool == "codex":
        # PENDING: verify against the installed Codex version before a real study.
        argv = ["codex", "exec", prompt, "--cd", str(workdir), *extra]
        return argv, None
    sys.exit(f"error: unknown tool {tool!r}")


def loggable_command(tool: str, model: str, workdir: Path, rendered_file: Path,
                     prompt_sha: str, extra: list[str]) -> str:
    """Human-readable, reproducible record (prompt by file+hash, not inline)."""
    promptref = f"<PROMPT@{rendered_file.relative_to(REPO_ROOT)} sha256:{prompt_sha[:16]}>"
    extra_s = (" " + " ".join(extra)) if extra else ""
    if tool == "claude":
        return (f"claude -p {promptref} --model {model} "
                f"--permission-mode acceptEdits{extra_s}  (cwd={workdir})")
    return f"codex exec {promptref} --cd {workdir}{extra_s}"


def tool_version(tool: str) -> str:
    try:
        out = subprocess.run([tool, "--version"], capture_output=True, text=True,
                             timeout=30)
        return (out.stdout or out.stderr).splitlines()[0].strip() if (out.stdout or out.stderr) else "(unknown)"
    except Exception:
        return "(unavailable)"


# --------------------------------------------------------------------------- #
# logging
# --------------------------------------------------------------------------- #
def append_command_log(run_id: str, tool: str, command: str, notes: str) -> None:
    ts = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    line = f"{ts} | {run_id} | {tool} | {command} | {notes}\n"
    with COMMANDS_LOG.open("a", encoding="utf-8", newline="") as fh:
        fh.write(line)


def append_sessions_row(row: dict) -> None:
    cols = ["run_id", "date", "session_type", "spec_id", "tool", "prompt_variant",
            "tool_version", "model", "rounds_to_runnable", "notes"]
    write_header = not SESSIONS_CSV.exists() or SESSIONS_CSV.stat().st_size == 0
    with SESSIONS_CSV.open("a", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        if write_header:
            w.writeheader()
        w.writerow({c: row.get(c, "") for c in cols})


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--spec", required=True, help="spec_id, e.g. S001")
    p.add_argument("--tool", required=True, choices=VALID_TOOLS)
    p.add_argument("--variant", required=True, choices=VALID_VARIANTS)
    p.add_argument("--model", default="", help="model id to pin (required for a real run)")
    p.add_argument("--catalog", default=str(SPECS / "catalog.json"))
    p.add_argument("--apps-dir", default=str(REPO_ROOT / "apps"))
    p.add_argument("--run-id", default="", help="defaults to gen_<spec>_<tool>_<V>_<UTC>")
    p.add_argument("--rounds", default="", help="rounds_to_runnable (filled later if blank)")
    p.add_argument("--notes", default="")
    p.add_argument("--extra-arg", action="append", default=[],
                   help="extra flag passed verbatim to the tool (repeatable)")
    p.add_argument("--no-isolate", action="store_true",
                   help="run directly in the target dir (NOT recommended; leaks repo context)")
    p.add_argument("--dry-run", action="store_true",
                   help="assemble + print prompt and command; change nothing")
    args = p.parse_args(argv[1:])

    spec = load_spec(args.spec, Path(args.catalog))
    prompt = assemble_prompt(spec, args.variant)
    prompt_sha = hashlib.sha256(prompt.encode("utf-8")).hexdigest()

    run_id = args.run_id or (
        f"gen_{args.spec}_{args.tool}_{args.variant}_"
        f"{_dt.datetime.now(_dt.timezone.utc).strftime('%Y%m%d%H%M%S')}"
    )
    target = Path(args.apps_dir) / args.spec / args.tool / args.variant

    if args.dry_run:
        print(f"=== run_id: {run_id}")
        print(f"=== target: {target}")
        print(f"=== prompt sha256: {prompt_sha}")
        print("=== assembled prompt ".ljust(70, "="))
        print(prompt)
        argv_cmd, cwd = build_command(args.tool, prompt, args.model or "<MODEL>",
                                      target, args.extra_arg)
        print("=== exact command (argv) ".ljust(70, "="))
        print(argv_cmd)
        print(f"=== cwd: {cwd}")
        return 0

    # --- real run guards ---
    if not args.model:
        sys.exit("error: --model is required for a real run (pin the model explicitly)")
    if shutil.which(args.tool) is None:
        sys.exit(f"error: {args.tool} not found on PATH (Codex may not be installed yet)")
    if target.exists() and any(c.name != ".gitkeep" for c in target.iterdir()):
        sys.exit(f"error: {target} already contains a generated app; refusing to "
                 f"overwrite (generated code is immutable). Use a clean directory.")

    # rendered prompt is an audit artifact
    RENDERED_DIR.mkdir(parents=True, exist_ok=True)
    rendered_file = RENDERED_DIR / f"{run_id}.txt"
    rendered_file.write_text(prompt, encoding="utf-8")

    target.mkdir(parents=True, exist_ok=True)

    # isolated build dir (outside repo) unless --no-isolate
    build_dir = target if args.no_isolate else Path(tempfile.mkdtemp(prefix="csj_gen_"))
    argv_cmd, cwd = build_command(args.tool, prompt, args.model, build_dir, args.extra_arg)

    started = _dt.datetime.now(_dt.timezone.utc)
    proc = subprocess.run(argv_cmd, cwd=str(cwd) if cwd else None)
    ok = proc.returncode == 0

    # move generated project into the immutable target dir
    if not args.no_isolate and ok:
        for entry in Path(build_dir).iterdir():
            shutil.move(str(entry), str(target / entry.name))
        shutil.rmtree(build_dir, ignore_errors=True)

    ver = tool_version(args.tool)
    notes = args.notes or (f"exit={proc.returncode}; started={started.isoformat()}")
    command_str = loggable_command(args.tool, args.model, build_dir, rendered_file,
                                   prompt_sha, args.extra_arg)
    append_command_log(run_id, args.tool, command_str, notes)
    append_sessions_row({
        "run_id": run_id,
        "date": _dt.date.today().isoformat(),
        "session_type": "generation",
        "spec_id": args.spec,
        "tool": args.tool,
        "prompt_variant": args.variant,
        "tool_version": ver,
        "model": args.model,
        "rounds_to_runnable": args.rounds,
        "notes": notes,
    })

    print(f"run_id {run_id}: tool exit {proc.returncode}; output in {target}")
    print(f"  prompt: {rendered_file}  (sha256 {prompt_sha[:16]}...)")
    print("  logged to logs/commands.log and logs/sessions.csv")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
