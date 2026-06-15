# Claude Security Journal

Infrastructure and data-collection scaffolding for a security research study that
compares AI coding tools (e.g. `claude` vs `codex`) on the security properties of
the applications they generate.

This repository holds **only the scaffolding, specs, harness, and analysis
artifacts** — generated application code lives under `apps/` and is produced in
separate generation sessions.

## Repository layout

| Path | Purpose |
| --- | --- |
| `specs/` | The spec catalog (`catalog.json`), its JSON Schema (`catalog.schema.json`), and any per-spec detail files. |
| `prompts/` | Prompt templates and variants (A/B) used to drive the generation tools. |
| `apps/` | Generated application code, one subfolder per run. **Treated as immutable** (see rule below). |
| `harness/` | Tooling that supports the study — e.g. `validate_catalog.py`. |
| `analysis/` | Findings and analysis outputs, e.g. `findings_template.csv`. |
| `logs/` | Operational logs — `sessions.csv` tracks every session run. |
| `README.md` | This file. |

## The cardinal rule: generated code is never edited

> **Application code under `apps/` is NEVER edited after it is generated.**

Each generated app is a frozen experimental artifact. Once a generation session
produces an app, its source is treated as read-only evidence: we do not fix bugs,
patch vulnerabilities, reformat, or otherwise touch it. Any change in behavior must
come from a **new generation run** (logged as a new `run_id`), never from hand
edits. This keeps every measured security finding attributable to the tool and
prompt that produced it, not to post-hoc human intervention.

If an app does not run, that is itself a recorded data point (`rounds_to_runnable`
in `logs/sessions.csv`) — resolved by re-prompting the tool, not by editing.

## The spec catalog

`specs/catalog.json` is an array of up to 100 spec objects. It currently ships
**empty** and is meant to be filled in manually. Each object has the shape:

| Field | Type | Notes |
| --- | --- | --- |
| `spec_id` | string | Unique id, pattern `S###` (e.g. `S001`). |
| `name` | string | Human-readable app name. |
| `tier` | string | Complexity/risk tier, one of `T1`–`T4`. |
| `category` | string | Domain category (e.g. `auth`, `ecommerce`). |
| `language` | string | Primary language (e.g. `python`, `typescript`). |
| `framework` | string | Primary framework (e.g. `flask`, `express`). |
| `port` | integer | TCP port the app listens on (1–65535). |
| `functional_requirements` | string[] | What the app must do. |
| `target_classes` | string[] | Vulnerability classes in scope for this spec. |

The authoritative contract is `specs/catalog.schema.json` (JSON Schema
draft 2020-12).

### Validating the catalog

```bash
pip install jsonschema          # not installed yet, by design
python harness/validate_catalog.py
```

Exit code `0` = valid, `1` = schema violation, `2` = setup/IO error.

## Data files

- **`logs/sessions.csv`** — one row per session. Columns: `run_id`, `date`,
  `session_type` (`scaffolding`/`generation`/`analysis`), `spec_id`, `tool`
  (`claude`/`codex`), `prompt_variant` (`A`/`B`), `tool_version`, `model`,
  `rounds_to_runnable`, `notes`.
- **`analysis/findings_template.csv`** — one row per security finding. Columns:
  `run_id`, `spec_id`, `tool`, `prompt_variant`, `tier`, `language`,
  `vuln_class`, `owasp_category`, `cwe`, `severity`, `cvss`, `detection_method`,
  `tool_name`, `status`, `notes`.

## Reproducibility & audit

Two artifacts keep every run auditable:

- **`logs/commands.log`** — an **append-only** audit trail. Record every
  significant command (generation runs, `docker build`/`up`, snapshots, catalog
  validation, analysis steps). Always append, never overwrite or edit existing
  lines. Format is `<UTC timestamp> | <run_id> | <actor> | <command> | <notes>`;
  the file header shows ready-to-use append snippets for PowerShell and bash. (On
  Linux you can enforce append-only with `chmod a-w` + `sudo chattr +a logs/commands.log`.)

- **`harness/snapshot.sh`** — captures a timestamped, point-in-time snapshot to
  `logs/snapshot_<YYYYMMDD_HHMMSS>.txt`: the git commit hash + branch + dirty state,
  the docker image digests in use (`csj/*` app images and base images), and the CLI
  versions and model names of both agentic tools. Model names are not reliably
  auto-detectable, so pass them in for a complete record:

  ```bash
  CSJ_CLAUDE_MODEL=claude-opus-4-8 CSJ_CODEX_MODEL=<model> bash harness/snapshot.sh
  ```

  Run a snapshot at the start and end of each session (and after any rebuild).

## Generation pipeline (catalog → batch → resume)

The 100 specs are defined in `harness/build_catalog.py` (the single source of
truth), which emits `specs/catalog.json` and freezes its SHA-256 in
`specs/catalog.lock`. `functional_core` is the verbatim variant-A prompt text.

```bash
python harness/build_catalog.py          # (re)build + freeze the catalog

# Preview the plan (runs nothing, writes nothing):
python harness/run_batch.py --dry-run

# Generate with Claude (both variants), a few at a time, model pinned:
python harness/run_batch.py --tools claude --model claude-opus-4-8 --limit 10
```

`run_batch.py` drives `run_generation.py` per `spec × tool × variant` and records
progress in `logs/generation_state.json`, so it can be stopped and re-run and will
**continue where it left off** (a job is done if the state says so or the app dir is
non-empty). It verifies `catalog.lock` before running, defaults to `--tools claude`
(Codex jobs are marked `blocked` until Codex is installed, then auto-picked-up), and
supports `--variants`, `--specs S001-S025`, `--limit`, and `--retry-failed`.

## Reproducing the pipeline end to end

Another researcher can reproduce the whole study as follows. Generated app code is
**never edited** — divergence is resolved only by re-running generation.

1. **Clone the repo.**
   ```bash
   git clone <repo-url> claude_security_journal
   cd claude_security_journal
   ```

2. **Install prerequisites** (see `logs/environment.md` for the reference versions):
   Docker + Docker Compose, Python 3 + pip, Node + npm, the `claude` CLI, and the
   `codex` CLI. Then `pip install jsonschema` for catalog validation.

3. **Fill and validate the spec catalog.** Populate `specs/catalog.json` (up to 100
   specs) and validate it:
   ```bash
   python harness/validate_catalog.py
   ```

4. **Generate apps — one session per (spec, tool, variant).** Run each agentic tool
   against the spec and place its output under `apps/<spec_id>/<tool>/<variant>/`
   (e.g. `apps/S001/claude/A/`). For every session: capture a `snapshot.sh`, append
   the command to `logs/commands.log`, and add a row to `logs/sessions.csv`
   (`run_id`, `date`, `session_type=generation`, `spec_id`, `tool`, `prompt_variant`,
   `tool_version`, `model`, `rounds_to_runnable`, `notes`). **Do not edit generated
   code afterwards.**

5. **Generate the compose file** from the catalog + the apps tree:
   ```bash
   python harness/gen_compose.py        # writes docker-compose.generated.yml
   ```

6. **Build and run each app** (security-neutral containers, localhost-bound ports):
   ```bash
   docker compose -f docker-compose.generated.yml build
   docker compose -f docker-compose.generated.yml up -d s001-claude-a
   ```
   Reach it at `http://127.0.0.1:<host_port>/` (see `apps/README.md` for the port
   formula). Repeat per service for both tools and both variants.

7. **Record state** with `bash harness/snapshot.sh` (captures the built image
   digests), and keep appending to `logs/commands.log`.

8. **Analyse** each running app and record findings in a copy of
   `analysis/findings_template.csv`, one row per finding, keyed back to `run_id` /
   `spec_id` so results are attributable to a specific tool, variant, commit, and
   image digest.

## Status

Scaffolding only. No application code and no dependencies are installed in this
session.
