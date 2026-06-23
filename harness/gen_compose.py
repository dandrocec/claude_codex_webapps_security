#!/usr/bin/env python3
"""Generate a docker-compose file from specs/catalog.json and the apps/ tree.

This is SECURITY-NEUTRAL scaffolding. The emitted compose file provides ONLY
isolation and a runtime. It deliberately contains NO security_opt, NO cap_drop,
NO read_only, NO `user:` override, NO hardening of any kind — adding such
controls would contaminate the experiment.

What it does:
  * Reads spec metadata (language, framework, port) from specs/catalog.json.
  * Discovers generated apps under   apps/<spec_id>/<tool>/<variant>/
    (e.g. apps/S001/claude/A), one service per non-empty app directory.
  * Emits one service per app:
      - build context = the app directory (so COPY . copies only that app)
      - dockerfile    = the per-language template in harness/docker/
      - a distinct, deterministic, localhost-bound host port
      - attached to a single isolated bridge network
  * NEVER reads or writes application source; it only inspects the tree.

Usage:
    python harness/gen_compose.py [--output docker-compose.generated.yml]
                                  [--catalog specs/catalog.json]
                                  [--apps-dir apps]
                                  [--base-port 20000]
                                  [--internal]

`--internal` marks the network `internal: true`, which cuts ALL external
egress. It is OFF by default so apps that legitimately need outbound access
still work ("no external egress beyond what the app needs").
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DOCKER_DIR = REPO_ROOT / "harness" / "docker"

# language -> Dockerfile template basename
LANGUAGE_TEMPLATE = {
    "python": "Dockerfile.python",
    "javascript": "Dockerfile.node",
    "typescript": "Dockerfile.node",
    "node": "Dockerfile.node",
    "php": "Dockerfile.php",
}

# Default start command per framework. ${APP_PORT} is expanded at runtime by the
# container shell. These are RUNTIME CONVENIENCE DEFAULTS, not security choices,
# and can be overridden per app with a `.runcmd` sidecar file in the app dir.
FRAMEWORK_START = {
    "flask": "flask run --host=0.0.0.0 --port=${APP_PORT}",
    "fastapi": "uvicorn main:app --host 0.0.0.0 --port ${APP_PORT}",
    "django": "python manage.py runserver 0.0.0.0:${APP_PORT}",
    "express": "npm start",
    "nestjs": "npm run start",
    "koa": "npm start",
}

# Fallback start command per language (when framework is unknown).
LANGUAGE_START = {
    "python": "python app.py",
    "javascript": "npm start",
    "typescript": "npm start",
    "node": "npm start",
    # These generated single-file PHP apps expect the built-in server on the
    # stated port (per their READMEs); serve the app root there. Falls back to
    # Apache only if this is unset (see Dockerfile.php).
    "php": "php -S 0.0.0.0:${APP_PORT} -t /var/www/html",
}

# Deterministic host-port assignment so a given (spec, tool, variant) always
# maps to the same localhost port regardless of which other apps exist:
#     host_port = base + spec_num*4 + tool_index*2 + variant_index
# This gives each spec a 4-slot block: claude/A, claude/B, codex/A, codex/B.
TOOL_INDEX = {"claude": 0, "codex": 1}
VARIANT_INDEX = {"A": 0, "B": 1}


def load_catalog(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        print(f"error: catalog not found: {path}", file=sys.stderr)
        sys.exit(2)
    except json.JSONDecodeError as exc:
        print(f"error: invalid JSON in {path}: {exc}", file=sys.stderr)
        sys.exit(2)
    if not isinstance(data, list):
        print("error: catalog root must be a JSON array", file=sys.stderr)
        sys.exit(2)
    return {entry["spec_id"]: entry for entry in data if "spec_id" in entry}


def discover_apps(apps_dir: Path):
    """Yield (spec_id, tool, variant, app_dir) for each non-empty app dir."""
    if not apps_dir.is_dir():
        return
    for spec_dir in sorted(p for p in apps_dir.iterdir() if p.is_dir()):
        for tool_dir in sorted(p for p in spec_dir.iterdir() if p.is_dir()):
            for variant_dir in sorted(p for p in tool_dir.iterdir() if p.is_dir()):
                # skip empty / placeholder-only directories
                contents = [c for c in variant_dir.iterdir() if c.name != ".gitkeep"]
                if not contents:
                    continue
                yield (spec_dir.name, tool_dir.name, variant_dir.name, variant_dir)


def host_port(base: int, spec_id: str, tool: str, variant: str) -> int:
    spec_num = int(spec_id[1:]) if spec_id[1:].isdigit() else abs(hash(spec_id)) % 1000
    return (
        base
        + spec_num * 4
        + TOOL_INDEX.get(tool, 2) * 2
        + VARIANT_INDEX.get(variant, 0)
    )


def load_overrides(path: Path) -> dict:
    """Per-service runtime overrides (security-neutral). See overrides.json."""
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    return {k: v for k, v in data.items() if not k.startswith("_")}


# Conventional framework default per language, used only when file-based stack
# detection overrides the catalog (so start_cmd matches what was generated).
LANGUAGE_DEFAULT_FRAMEWORK = {
    "python": "flask",
    "node": "express",
    "php": "",  # falls back to LANGUAGE_START['php'] (built-in server)
}


def detect_language(app_dir: Path, catalog_language: str) -> str:
    """Detect the actual stack from the generated manifest files.

    The generation prompt is deliberately language-neutral (it asks for "the
    appropriate dependency manifest (requirements.txt / package.json /
    composer.json)"), so the model may build a spec in a different language than
    the catalog planned (e.g. S057 is catalogued as node/express but Claude
    produced a Flask app). Trust the manifest that is actually present; fall back
    to the catalog language only when the signal is absent or ambiguous.

    Security-NEUTRAL: this only points the harness at the correct Dockerfile and
    start command for what was generated; it changes no application code.
    """
    present = [
        lang for lang, exists in (
            ("node", (app_dir / "package.json").is_file()),
            ("php", (app_dir / "composer.json").is_file()),
            ("python", (app_dir / "requirements.txt").is_file()
                       or (app_dir / "app.py").is_file()),
        ) if exists
    ]
    if len(present) == 1:
        return present[0]
    return (catalog_language or "").lower()


def resolve_start_cmd(app_dir: Path, framework: str, language: str) -> str | None:
    sidecar = app_dir / ".runcmd"
    if sidecar.is_file():
        line = sidecar.read_text(encoding="utf-8-sig").strip()
        if line:
            return line
    if framework and framework.lower() in FRAMEWORK_START:
        return FRAMEWORK_START[framework.lower()]
    return LANGUAGE_START.get((language or "").lower(), None)


def rel(path: Path, start: Path) -> str:
    """POSIX relative path (compose needs forward slashes on every OS)."""
    import os

    return os.path.relpath(path, start).replace("\\", "/")


def build_services(args) -> tuple[list[str], int]:
    catalog = load_catalog(Path(args.catalog))
    apps_dir = Path(args.apps_dir)
    output_dir = Path(args.output).resolve().parent

    # Uniform, security-NEUTRAL placeholder secrets applied to every container
    # (identical for A and B) so apps that correctly read secrets from the
    # environment can start. Providing a secret value is runtime config, not a
    # security control. Disable with --no-secrets.
    secrets_rel = None
    if not args.no_secrets:
        secrets_path = Path(args.secrets_env)
        if secrets_path.is_file():
            secrets_rel = rel(secrets_path.resolve(), output_dir)
        else:
            print(f"warning: secrets env file not found: {secrets_path} "
                  f"(services will have no env_file)", file=sys.stderr)

    overrides = load_overrides(Path(args.overrides))

    lines: list[str] = []
    seen_ports: dict[int, str] = {}
    count = 0

    for spec_id, tool, variant, app_dir in discover_apps(apps_dir):
        spec = catalog.get(spec_id)
        if spec is None:
            print(f"warning: no catalog entry for {spec_id}; skipping {app_dir}",
                  file=sys.stderr)
            continue

        catalog_language = str(spec.get("language", "")).lower()
        framework = str(spec.get("framework", ""))
        # The prompt is language-neutral, so trust the generated files over the
        # catalog's planned language (neutral; see detect_language).
        language = detect_language(app_dir, catalog_language)
        if language != catalog_language:
            print(f"note: {spec_id} {tool}/{variant} catalogued as "
                  f"'{catalog_language}' but generated as '{language}'; using "
                  f"detected stack", file=sys.stderr)
            framework = LANGUAGE_DEFAULT_FRAMEWORK.get(language, "")
        template_name = LANGUAGE_TEMPLATE.get(language)
        if template_name is None:
            print(f"warning: unknown language '{language}' for {spec_id}; skipping",
                  file=sys.stderr)
            continue

        container_port = spec.get("port")
        if not isinstance(container_port, int):
            print(f"warning: {spec_id} has no integer port; skipping {app_dir}",
                  file=sys.stderr)
            continue

        service = f"{spec_id}-{tool}-{variant}".lower()
        hport = host_port(args.base_port, spec_id, tool, variant)
        if hport in seen_ports:
            print(f"error: host port collision {hport}: {service} vs "
                  f"{seen_ports[hport]}", file=sys.stderr)
            sys.exit(1)
        seen_ports[hport] = service

        # Apply per-service neutral runtime overrides (see overrides.json):
        #   context_subdir -> rebase build context to the app's own project root
        #   start_cmd      -> use the app's declared entry point (README), not the
        #                     framework default.
        ov = overrides.get(service, {})
        context_dir = app_dir
        if ov.get("context_subdir"):
            context_dir = app_dir / ov["context_subdir"]

        template_path = DOCKER_DIR / template_name
        context_rel = rel(context_dir.resolve(), output_dir)
        dockerfile_rel = rel(template_path.resolve(), context_dir.resolve())
        start_cmd = ov.get("start_cmd") or resolve_start_cmd(
            app_dir, framework, language)

        lines.append(f"  {service}:")
        lines.append("    build:")
        lines.append(f"      context: {context_rel}")
        lines.append(f"      dockerfile: {dockerfile_rel}")
        lines.append("      args:")
        lines.append(f"        APP_PORT: \"{container_port}\"")
        if start_cmd is not None:
            # Bake the concrete port in directly: a literal ${APP_PORT} here would
            # be interpolated (to blank) by docker compose at parse time.
            start_cmd = start_cmd.replace("${APP_PORT}", str(container_port))
            esc = start_cmd.replace("'", "''")
            lines.append(f"        START_CMD: '{esc}'")
        lines.append("    image: "
                     f"csj/{service}")
        # Uniform, security-NEUTRAL placeholder secrets (identical for A and B,
        # identical across all apps) so apps that correctly read secrets from the
        # environment can start. Providing a value is runtime config, not a
        # security control; it advantages no app or variant. Disable --no-secrets.
        if secrets_rel:
            lines.append("    env_file:")
            lines.append(f"      - {secrets_rel}")
        # Per-service neutral env overrides (e.g. HOST=0.0.0.0 for an app that
        # defaults to a localhost-only bind). Runtime config, not hardening.
        if ov.get("env"):
            lines.append("    environment:")
            for k, v in ov["env"].items():
                lines.append(f"      {k}: \"{v}\"")
        # Bind only to localhost on a distinct port: host -> container.
        lines.append("    ports:")
        lines.append(f"      - \"127.0.0.1:{hport}:{container_port}\"")
        lines.append("    networks:")
        lines.append("      - appnet")
        # Explicit, neutral: do not auto-restart (a crash should stay visible).
        lines.append("    restart: \"no\"")
        lines.append("")
        count += 1

    return lines, count


def render(args, service_lines: list[str], count: int) -> str:
    header = [
        "# AUTO-GENERATED by harness/gen_compose.py -- do not edit by hand.",
        "# Security-NEUTRAL: this file intentionally contains NO security_opt,",
        "# NO cap_drop, NO read_only, NO `user:` override, and NO other hardening.",
        "# It provides isolation + runtime only.",
        f"# Services generated: {count}",
        "",
        "services:",
    ]
    if count == 0:
        header.append("  # (no non-empty apps found under the apps/ tree yet)")
        header.append("")
    body = header + service_lines

    internal_line = "    internal: true" if args.internal else \
        "    # internal: true   # set (or pass --internal) to cut ALL external egress"
    network = [
        "networks:",
        "  # Single isolated bridge network. Containers can reach each other and,",
        "  # by default, the outside world (so apps needing egress still work).",
        "  appnet:",
        "    name: csj_appnet",
        "    driver: bridge",
        internal_line,
        "",
    ]
    return "\n".join(body + network)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", default=str(REPO_ROOT / "docker-compose.generated.yml"))
    parser.add_argument("--catalog", default=str(REPO_ROOT / "specs" / "catalog.json"))
    parser.add_argument("--apps-dir", default=str(REPO_ROOT / "apps"))
    parser.add_argument("--base-port", type=int, default=20000)
    parser.add_argument("--internal", action="store_true",
                        help="mark the bridge network internal (no external egress)")
    parser.add_argument("--secrets-env", default=str(DOCKER_DIR / "verify.env"),
                        help="env_file of uniform placeholder secrets attached to "
                             "every service (neutral runtime config, not hardening)")
    parser.add_argument("--no-secrets", action="store_true",
                        help="do not attach the placeholder secrets env_file")
    parser.add_argument("--overrides", default=str(DOCKER_DIR / "overrides.json"),
                        help="per-service neutral runtime overrides (start_cmd / "
                             "context_subdir); see harness/docker/overrides.json")
    args = parser.parse_args(argv[1:])

    service_lines, count = build_services(args)
    text = render(args, service_lines, count)
    Path(args.output).write_text(text, encoding="utf-8")
    print(f"wrote {args.output} ({count} service(s))")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
