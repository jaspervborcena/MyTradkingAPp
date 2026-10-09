"""Persistent event sink for signal and market audit records."""

from __future__ import annotations

import json
from pathlib import Path

from src.models.market import SignalEvent


class JsonlEventSink:
    """Append events to a JSONL file representing a durable event stream."""

    def __init__(self, path: Path) -> None:
        self._path = path

    def log_event(self, event: SignalEvent) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = event.to_dict()
        with self._path.open("a", encoding="utf-8") as data_file:
            data_file.write(json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n")
