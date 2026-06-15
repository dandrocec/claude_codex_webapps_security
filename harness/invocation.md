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

## OpenAI Codex CLI — PENDING (not installed; verify, then freeze)

Codex is not yet installed (see `logs/environment.md`). The intended equivalent is the
non-interactive `exec` subcommand with a working-directory flag, illustratively:

```bash
SPEC=S001; V=A   # V is A or B
mkdir -p "apps/$SPEC/codex/$V"
codex exec "$PROMPT" --cd "apps/$SPEC/codex/$V"
```

Before use, verify against the installed Codex version: the `exec` subcommand name,
the working-directory flag (`--cd`/`-C`), the model flag, and the non-interactive
approval/sandbox flags needed to let it write the project unattended (the Codex
equivalent of Claude's permission mode). Freeze the exact command here and record it
in `logs/commands.log` per run.

## Equivalence checklist (must hold for every run)

- [ ] `$PROMPT` is the mechanically-assembled prompt (functional core + run footer
      [+ security block for variant B]); byte-identical where §5.1 requires.
- [ ] Fresh, clean session — no prior context carried in.
- [ ] No extra guidance beyond `$PROMPT` (in variant A, no follow-up security hints).
- [ ] Output written under `apps/<SPEC>/<tool>/<V>/` (`<V>` is `A` or `B`).
- [ ] Exact command logged to `logs/commands.log`; version/model/rounds to
      `logs/sessions.csv`.
- [ ] Any unavoidable divergence between the two tools' invocations is written down.
