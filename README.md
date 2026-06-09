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

## Status

Scaffolding only. No application code and no dependencies are installed in this
session.
