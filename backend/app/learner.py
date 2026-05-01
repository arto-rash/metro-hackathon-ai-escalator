"""Persistent self-learning threshold offsets per signal.

Each signal carries an offset that is added to its base trigger threshold.
"incorrect" feedback raises the offset (less sensitive); "correct" lowers it.
State is a tiny JSON file; safe to delete to reset.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path

SIGNALS = ("fall", "sitting", "counterflow", "facing_back", "running", "stuff")
_STATE_PATH = Path(__file__).resolve().parent.parent / "learner_state.json"
_LOCK = threading.Lock()
_BUMP = 0.06
_DECAY = 0.02
_MAX = 0.5


def _default() -> dict[str, float]:
    return {s: 0.0 for s in SIGNALS}


def _load() -> dict[str, float]:
    if not _STATE_PATH.exists():
        return _default()
    try:
        raw = json.loads(_STATE_PATH.read_text())
        return {s: float(raw.get(s, 0.0)) for s in SIGNALS}
    except Exception:
        return _default()


def _save(state: dict[str, float]) -> None:
    _STATE_PATH.write_text(json.dumps(state, indent=2))


def get_offsets() -> dict[str, float]:
    with _LOCK:
        return _load()


def record_feedback(signal: str, verdict: str) -> dict[str, float]:
    if signal not in SIGNALS:
        raise ValueError(f"unknown signal: {signal}")
    if verdict not in ("correct", "incorrect"):
        raise ValueError(f"unknown verdict: {verdict}")
    with _LOCK:
        state = _load()
        if verdict == "incorrect":
            state[signal] = min(_MAX, state[signal] + _BUMP)
        else:
            state[signal] = max(0.0, state[signal] - _DECAY)
        _save(state)
        return state


def reset() -> dict[str, float]:
    with _LOCK:
        state = _default()
        _save(state)
        return state
