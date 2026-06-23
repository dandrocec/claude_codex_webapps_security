#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -q -r requirements.txt
./.venv/Scripts/python.exe smoke_test.py
