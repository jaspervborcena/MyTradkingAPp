"""Firestore event sink for production persistence with a mockable client interface."""

from __future__ import annotations

from typing import Any


class FirestoreEventSink:
    """Thin adapter around a Firestore client for appending event documents."""

    def __init__(self, project_id: str, client: Any | None = None) -> None:
        self._project_id = project_id
        self._client = client

    def append(self, event: dict[str, Any]) -> None:
        if self._client is None:
            raise RuntimeError("Firestore client is not configured")
        collection = self._client.collection("market_events")
        collection.add(event)
