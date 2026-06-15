#!/usr/bin/env python3
"""Validate specs/catalog.json against specs/catalog.schema.json.

Usage:
    python harness/validate_catalog.py [catalog.json] [catalog.schema.json]

Exit codes:
    0  catalog is valid
    1  catalog is invalid (schema violation)
    2  usage / IO / setup error (e.g. missing jsonschema package)

Requires the `jsonschema` package (not installed yet by design):
    pip install jsonschema
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CATALOG = REPO_ROOT / "specs" / "catalog.json"
DEFAULT_SCHEMA = REPO_ROOT / "specs" / "catalog.schema.json"


def _load_json(path: Path) -> object:
    try:
        with path.open(encoding="utf-8-sig") as fh:
            return json.load(fh)
    except FileNotFoundError:
        print(f"error: file not found: {path}", file=sys.stderr)
        sys.exit(2)
    except json.JSONDecodeError as exc:
        print(f"error: invalid JSON in {path}: {exc}", file=sys.stderr)
        sys.exit(2)


def main(argv: list[str]) -> int:
    catalog_path = Path(argv[1]) if len(argv) > 1 else DEFAULT_CATALOG
    schema_path = Path(argv[2]) if len(argv) > 2 else DEFAULT_SCHEMA

    try:
        import jsonschema
        from jsonschema import Draft202012Validator
    except ImportError:
        print(
            "error: the 'jsonschema' package is required.\n"
            "       install it with: pip install jsonschema",
            file=sys.stderr,
        )
        return 2

    catalog = _load_json(catalog_path)
    schema = _load_json(schema_path)

    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(catalog), key=lambda e: list(e.path))

    if not errors:
        count = len(catalog) if isinstance(catalog, list) else "?"
        print(f"OK: {catalog_path} is valid ({count} entries).")
        return 0

    print(f"INVALID: {catalog_path} has {len(errors)} error(s):", file=sys.stderr)
    for err in errors:
        location = "/".join(str(p) for p in err.absolute_path) or "<root>"
        print(f"  - at {location}: {err.message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
