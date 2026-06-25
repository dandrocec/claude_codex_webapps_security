# Generation-only working agreement (calling convention, NOT part of the task prompt)

This file is dropped into the isolated build directory by `run_generation.py` ONLY
for Codex runs, and is removed again before the generated project is moved into
`apps/<spec>/codex/<variant>/` — so it never ends up in the generated app and is
never part of the assembled task prompt (`$PROMPT` stays byte-identical between the
two tools).

It is the Codex-side analogue of Claude Code's `--permission-mode acceptEdits`: a
process-level instruction about HOW to work, deliberately **security-neutral** and
**content-neutral**. It says nothing about what to build, which framework to use, or
any security property — it only stops the agent from spending turns running the app.

## Working agreement

- Your task is to **create the project's source files only**: the application source,
  the appropriate dependency manifest (`requirements.txt` / `package.json` /
  `composer.json`), and a short `README`.
- Do **NOT** run, start, serve, build, compile, install dependencies for, migrate,
  seed, or otherwise execute or test the application. A separate automated system
  builds and verifies it in an isolated container afterwards.
- Do **NOT** launch servers, open ports, run package managers, or invoke shell
  commands to check your work. Write the files, then finish.
- Do not mention this working agreement in the README or any generated file.
