# Equivalent non-interactive invocation of both tools (study §5.3)

Both tools are driven through equivalent non-interactive ("exec") entry points so
neither is advantaged by the calling convention. The principle that must hold:
**same prompt in → generated project out, with no extra guidance**, and any
divergence between the two invocations is documented.

> Exact command names, flags, and output handling differ between tool releases and
> change over time. The commands below are **frozen for this study** against the
> versions in `logs/environment.md`. Re-verify against each tool's own documentation
> before a study and freeze again if a version changes.

## Recording requirement

- Append the **exact** command + flags used for every run to `logs/commands.log`
  (append-only; format in that file's header).
- After each run, capture tool + model version and rounds-to-runnable, and append a
  row to `logs/sessions.csv`.

## Batch-runner (implementation)

`harness/run_generation.py` operationalises this protocol end to end: it assembles
the prompt mechanically per §5.1 (from `specs/catalog.json`, `prompts/*.tmpl`,
`specs/security_block.md` and `specs/addenda/`), invokes the tool through the frozen
command above, and writes both `logs/commands.log` and `logs/sessions.csv`.

```bash
# Inspect what would run (assembles + prints prompt and exact argv; changes nothing):
python harness/run_generation.py --spec S001 --tool claude --variant A --dry-run

# Real run (model must be pinned explicitly):
python harness/run_generation.py --spec S001 --tool claude --variant B --model claude-opus-4-8
```

Built-in guarantees:
- **Session hygiene** — by default the tool runs in an isolated temp dir *outside*
  the repo (so the study's own CLAUDE.md / project memory / settings cannot leak),
  then the generated project is moved into `apps/<spec>/<tool>/<variant>/`. Global
  user-level context is NOT isolated; add a bare/no-memory flag via `--extra-arg`
  if your study requires that, and document it.
- **Immutability** — refuses to write into an app directory that already contains a
  generated app; re-generation must target a clean directory (a new run).
- **Audit** — saves the exact rendered prompt to `prompts/rendered/<run_id>.txt` and
  logs the command by file reference + SHA-256 (the full prompt is not inlined).
- The prompt is **independent of the tool**, so the only difference between the two
  tools' runs is the tool, and the only difference between A and B is the block.

## Output location is set by the working directory, not a flag

Neither tool's illustrative `--output-dir` exists as shown. Claude Code writes files
relative to its **current working directory**; Codex `exec` takes a working-directory
flag. So the per-condition output path `apps/<SPEC>/<tool>/<V>` (where `<V>` is `A`
or `B`) is selected by running the tool **inside that directory** (create it first),
e.g. `cd` into it.

## Claude Code — VERIFIED for v2.1.169 (frozen)

`-p/--print` is the non-interactive mode. There is **no `--output-dir`**; the project
is written into the working directory. Files are created via the Edit/Write tools, so
a non-interactive run needs a permission mode that auto-approves writes.

```bash
SPEC=S001; V=A; MODEL=claude-opus-4-8   # V is A or B
mkdir -p "apps/$SPEC/claude/$V"
( cd "apps/$SPEC/claude/$V" \
  && claude -p "$PROMPT" \
       --model "$MODEL" \
       --permission-mode acceptEdits )
```

Notes / flags to freeze:
- `--permission-mode acceptEdits` auto-accepts file edits. For fully unattended batch
  runs in an isolated sandbox, `--dangerously-skip-permissions` may be needed so no
  Bash/tool prompt blocks the run — choose one, document it, and keep it identical
  across all Claude runs.
- `--output-format` controls **stdout** format only (text/json/stream-json); it does
  not change where project files are written.
- Record `--model` explicitly so the model is pinned per run (do not rely on defaults).

## OpenAI Codex CLI — VERIFIED for v0.140.0 (frozen)

Codex CLI `0.140.0` is installed (`C:\Users\Darko\AppData\Local\Programs\OpenAI\Codex\bin\codex`).
`codex exec` is the non-interactive mode (the Codex equivalent of `claude -p`). The
project is written into the directory passed via `--cd`; files are created/edited
directly, so a non-interactive run needs a sandbox policy that permits writes.

**Study model: `gpt-5.5`** (the latest GPT model) is pinned via `-m` for both A and B.

```bash
SPEC=S001; V=A; MODEL=gpt-5.5   # V is A or B
mkdir -p "apps/$SPEC/codex/$V"
codex exec "$PROMPT" \
     -m "$MODEL" \
     --cd "apps/$SPEC/codex/$V" \
     -s workspace-write \
     --skip-git-repo-check
```

Flags frozen for this study (verified against `codex exec --help` on v0.140.0):
- `exec` — non-interactive subcommand; `[PROMPT]` is positional (or read from stdin).
- `-m, --model gpt-5.5` — pin the model explicitly (do not rely on the config default).
- `-C, --cd <DIR>` — working root. `run_generation.py` points this at an isolated
  temp build dir, then moves the result into `apps/<spec>/codex/<V>/`.
- `-s, --sandbox workspace-write` — lets Codex write the project unattended. This is
  the Codex equivalent of Claude's `--permission-mode acceptEdits`: a *calling
  convention* that permits file writes, **security-NEUTRAL** (it hardens nothing in
  the generated app). Network is disabled under this sandbox, which is fine — the
  generation step only writes source; builds happen later in the Docker harness.
- `--skip-git-repo-check` — the isolated build dir is outside any git repo, which
  `codex exec` otherwise refuses to run in.

The exact command (prompt by file+SHA, not inlined) is appended to `logs/commands.log`
per run, and `tool_version` + `model` to `logs/sessions.csv`, exactly as for Claude.

### Documented divergence: Codex "generation-only" working agreement

Unlike Claude Code's `-p` print mode, `codex exec` with `gpt-5.5` is **agentic** — by
default it spends turns trying to *run, build, install, and test* the generated app
(spinning up `php -S`/`node`/`flask` servers, checking listeners), which is slow,
burns quota, and (under the Windows sandbox) fights the external build dir. The study
verifies every app separately in Docker, so this self-testing is wasteful noise.

To bring Codex's calling convention closer to Claude's "just produce the project"
behaviour, `run_generation.py` drops `harness/codex_no_run_AGENTS.md` into the build
dir as `AGENTS.md` **for Codex runs only**, then **removes it before the generated
project is moved** into `apps/<spec>/codex/<V>/`. Properties that keep this neutral:

- It is **not part of `$PROMPT`** — the assembled task prompt stays byte-identical
  between the two tools and between A and B.
- It **never lands in the generated app** (deleted before the move).
- It is **content- and security-neutral**: it says nothing about what to build, which
  framework to use, or any security property — only "write the files, don't execute
  the app." It is the Codex analogue of Claude's `--permission-mode acceptEdits`.

This is recorded here as the required write-down of an unavoidable per-tool invocation
divergence (see the equivalence checklist below).

## Equivalence checklist (must hold for every run)

- [ ] `$PROMPT` is the mechanically-assembled prompt (functional core + run footer
      [+ security block for variant B]); byte-identical where §5.1 requires.
- [ ] Fresh, clean session — no prior context carried in.
- [ ] No extra guidance beyond `$PROMPT` (in variant A, no follow-up security hints).
- [ ] Output written under `apps/<SPEC>/<tool>/<V>/` (`<V>` is `A` or `B`).
- [ ] Exact command logged to `logs/commands.log`; version/model/rounds to
      `logs/sessions.csv`.
- [ ] Any unavoidable divergence between the two tools' invocations is written down.
