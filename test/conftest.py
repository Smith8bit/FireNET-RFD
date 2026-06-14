"""Shared test config.

Tests import the backend `app` package directly. The backend lives in a sibling
folder with its own venv, so run the suite with that interpreter:

    backend/venv/Scripts/python.exe -m pytest test/

Pure-logic tests need no database. The DB-integration tests skip themselves when
Postgres isn't reachable (see test_db_integration.py).
"""
import sys
from pathlib import Path

# make `import app...` resolve against the backend package
BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
