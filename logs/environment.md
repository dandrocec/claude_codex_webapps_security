# Environment

**Captured:** 2026-06-09
**Method:** read-and-record only — nothing was installed, upgraded, or changed.

## Operating system & architecture

| Item | Value |
| --- | --- |
| OS | Microsoft Windows 11 Pro |
| OS version | 10.0.26200 (build 26200) |
| OS architecture | 64-bit |
| Processor architecture | AMD64 / x64 |
| Node runtime platform | win32 / x64 |

## Core toolchain versions

| Tool | Version | Notes |
| --- | --- | --- |
| docker | 29.5.2 (build 79eb04c) | `docker --version` |
| docker compose | v5.1.3 | `docker compose version` (v2 plugin form) |
| git | 2.53.0.windows.2 | `git --version` |
| python3 | 3.14.3 | invoked as `python` (no `python3` alias on Windows) |
| pip | 26.0.1 | bound to Python 3.14 (pythoncore-3.14-64) |
| node | v24.16.0 | located at `D:\claude_code\tools\node-v24.16.0-win-x64` |
| npm | 11.13.0 | `npm --version` |

### Missing tools (not installed — left as-is)

| Tool | Status |
| --- | --- |
| **Codex CLI** | **Not found.** Not on PATH under `codex`, `codex-cli`, `codex.cmd`, or `codex.exe`, and not present as a global npm package (`@openai/codex`). Must be installed before any `codex` generation sessions can run. |

## AI coding tool versions

| Tool | CLI version | How obtained |
| --- | --- | --- |
| Claude Code | 2.1.169 | `claude --version` |
| Codex CLI | (not installed) | `codex --version` once installed |

## How to capture the model name + version for each session

Record these manually into `logs/sessions.csv` (`tool_version`, `model` columns) at
the start of **every** session, because the resolved model can change between runs.

### Claude Code

1. **CLI version** (the `tool_version` value):
   ```
   claude --version
   ```
   → e.g. `2.1.169 (Claude Code)`.

2. **Active model** (the `model` value): inside an interactive session, run the
   slash command:
   ```
   /status
   ```
   It prints the account, CLI version, and the **currently selected model**
   (model name and ID). Alternatively run `/model` to see and confirm the active
   model. The model ID (e.g. `claude-opus-4-8`) is the precise value to record.
   - If launched non-interactively with an explicit model, the value is whatever
     was passed to `--model` (e.g. `claude --model claude-opus-4-8 ...`); otherwise
     it resolves from settings — confirm with `/status` to avoid guessing.

### Codex CLI (once installed)

1. **CLI version** (the `tool_version` value):
   ```
   codex --version
   ```

2. **Active model** (the `model` value): inside the Codex TUI run the slash
   command:
   ```
   /model
   ```
   (or `/status`) to display the model currently in use. The persistent default
   is also recorded in the config file `~/.codex/config.toml` under the `model = "…"`
   key, and any per-run override is whatever was passed via `codex --model <name>`.
   Record the exact model string shown.

> Tip: capture `tool_version` + `model` **per session** rather than relying on this
> file, since both tools can be updated or switched to a different model between runs.
