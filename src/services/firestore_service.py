"""Firestore event sink for production persistence with a mockable client interface."""

from __future__ import annotations

from typing import Any

from src.models.risk_profile import RiskProfile, RiskProfileError


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


class FirestoreRiskProfileRepository:
    """Load a risk profile document from Firestore."""

    def __init__(self, client: Any) -> None:
        self._client = client

    def get(self, profile_name: str) -> RiskProfile | None:
        snapshot = self._client.collection("risk_profiles").document(profile_name).get()
        if not snapshot.exists:
            raise RiskProfileError(f"Firestore document risk_profiles/{profile_name} does not exist")
        return RiskProfile.from_document(profile_name, snapshot.to_dict())
