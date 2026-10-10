"""Market candle and observation records."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class Candle:
    open_time: datetime
    close_time: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True, slots=True)
class IndicatorSnapshot:
    symbol: str
    timeframe: str
    close: float
    sma_fast: float
    sma_slow: float
    rsi: float
    trend: str
    confidence: float

    def to_dict(self) -> dict[str, object]:
        return {
            "symbol": self.symbol,
            "timeframe": self.timeframe,
            "close": self.close,
            "sma_fast": self.sma_fast,
            "sma_slow": self.sma_slow,
            "rsi": self.rsi,
            "trend": self.trend,
            "confidence": self.confidence,
        }


@dataclass(frozen=True, slots=True)
class SignalEvent:
    event_id: str
    captured_at: datetime
    symbol: str
    timeframe: str
    strategy: str
    side: str
    status: str
    confidence: float
    reasons: tuple[str, ...]
    indicator_snapshot: dict[str, object]
    profile_name: str | None = None
    strategy_parameters: dict[str, int | float] | None = None

    def to_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "schema_version": 1,
            "event_id": self.event_id,
            "event_type": "signal",
            "captured_at": self.captured_at.isoformat(),
            "symbol": self.symbol,
            "timeframe": self.timeframe,
            "strategy": self.strategy,
            "side": self.side,
            "status": self.status,
            "confidence": self.confidence,
            "reasons": list(self.reasons),
            "indicator_snapshot": self.indicator_snapshot,
        }
        if self.profile_name is not None:
            payload["profile_name"] = self.profile_name
            payload["strategy_parameters"] = self.strategy_parameters
        return payload


@dataclass(frozen=True, slots=True)
class MarketObservation:
    event_id: str
    captured_at: datetime
    exchange: str
    symbol: str
    timeframe: str
    candle: Candle
    profile_name: str | None = None

    def to_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "schema_version": 1,
            "event_id": self.event_id,
            "captured_at": self.captured_at.isoformat(),
            "exchange": self.exchange,
            "symbol": self.symbol,
            "timeframe": self.timeframe,
            "candle": {
                "open_time": self.candle.open_time.isoformat(),
                "close_time": self.candle.close_time.isoformat(),
                "open": self.candle.open,
                "high": self.candle.high,
                "low": self.candle.low,
                "close": self.candle.close,
                "volume": self.candle.volume,
            },
        }
        if self.profile_name is not None:
            payload["profile_name"] = self.profile_name
        return payload