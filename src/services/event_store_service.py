"""Versioned event persistence for local development and later Firestore sinks."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class EventStore:
    """Simple event-store interface for versioned persistence."""

    def append(self, event: dict[str, Any]) -> None:
        raise NotImplementedError

    def read_events(self) -> list[dict[str, Any]]:
        raise NotImplementedError


class JsonlEventStore(EventStore):
    """Append-only JSONL store for development and local auditing."""

    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, event: dict[str, Any]) -> None:
        payload = dict(event)
        payload.setdefault("schema_version", 1)
        with self._path.open("a", encoding="utf-8") as data_file:
            data_file.write(json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n")

    def read_events(self) -> list[dict[str, Any]]:
        if not self._path.exists():
            return []

        events: list[dict[str, Any]] = []
        with self._path.open("r", encoding="utf-8") as data_file:
            for raw_line in data_file:
                line = raw_line.strip()
                if line:
                    events.append(json.loads(line))
        return events
