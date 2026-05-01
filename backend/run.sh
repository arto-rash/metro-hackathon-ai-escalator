#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Pin to Python 3.10-3.12 — torch / ultralytics / pydantic-core wheels for
# 3.13+ lag months behind, and falling back to a source build needs Rust and
# fails on pyo3<0.23 (which is what current pydantic-core ships).
PY=""
for cand in python3.12 python3.11 python3.10; do
  if command -v "$cand" >/dev/null 2>&1; then
    PY="$cand"
    break
  fi
done

if [ -z "$PY" ]; then
  echo "" >&2
  echo "ERROR: need Python 3.10, 3.11, or 3.12 (you only have 3.14)." >&2
  echo "Install Python 3.12:" >&2
  echo "    brew install python@3.12" >&2
  echo "Then re-run: ./run.sh" >&2
  exit 1
fi

# Recreate venv if it was built with a different interpreter.
if [ -d ".venv" ]; then
  current=$(.venv/bin/python -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || echo "missing")
  wanted=$("$PY" -c 'import sys; print("%d.%d" % sys.version_info[:2])')
  if [ "$current" != "$wanted" ]; then
    echo "Removing old venv (Python $current) — will rebuild with $PY ($wanted)…"
    rm -rf .venv
  fi
fi

if [ ! -d ".venv" ]; then
  "$PY" -m venv .venv
fi

source .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
