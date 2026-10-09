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

    def to_dict(self) -> dict[str, object]:
        return {
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


@dataclass(frozen=True, slots=True)
class MarketObservation:
    event_id: str
    captured_at: datetime
    exchange: str
    symbol: str
    timeframe: str
    candle: Candle

    def to_dict(self) -> dict[str, object]:
        return {
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