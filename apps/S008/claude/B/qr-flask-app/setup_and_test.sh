#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
python -m venv .venv
.venv/Scripts/python.exe -m pip install -q -r requirements.txt
echo "=== installed ==="
export SECRET_KEY=test_key_for_smoke
export FLASK_ENV=development
.venv/Scripts/python.exe smoke_test.py
