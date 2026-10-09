"""Append-only local JSONL sink for market observations."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from src.models.market import MarketObservation, SignalEvent
from src.services.event_sink_service import JsonlEventSink


class JsonlDataLogger:
    def __init__(
        self,
        path: Path = Path("data/market_observations.jsonl"),
        signal_sink: JsonlEventSink | None = None,
        remote_sink: Any | None = None,
    ) -> None:
        self._path = path
        self._signal_sink = signal_sink or JsonlEventSink(self._path.with_name("market_signals.jsonl"))
        self._remote_sink = remote_sink

    async def log_observation(self, observation: MarketObservation) -> None:
        payload = observation.to_dict()
        await asyncio.to_thread(self._append_line, json.dumps(payload, separators=(",", ":"), allow_nan=False), self._path)
        if self._remote_sink is not None:
            await asyncio.to_thread(self._remote_sink.append, payload)

    async def log_signal(self, signal: SignalEvent) -> None:
        payload = signal.to_dict()
        await asyncio.to_thread(self._signal_sink.log_event, signal)
        if self._remote_sink is not None:
            await asyncio.to_thread(self._remote_sink.append, payload)

    def _append_line(self, line: str, target_path: Path) -> None:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        with target_path.open("a", encoding="utf-8") as data_file:
            data_file.write(line + "\n")