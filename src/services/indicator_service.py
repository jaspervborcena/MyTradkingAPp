"""Indicator calculations used to convert candles into trend signals."""

from __future__ import annotations

from collections.abc import Sequence

import pandas as pd
import pandas_ta as ta

from src.models.market import Candle, IndicatorSnapshot


class IndicatorService:
    """Compute trend and momentum indicators from a sequence of candles."""

    @staticmethod
    def compute(candles: Sequence[Candle], symbol: str, timeframe: str) -> IndicatorSnapshot:
        if len(candles) < 20:
            raise ValueError("At least 20 candles are required to compute trend indicators")

        closes = pd.Series([float(candle.close) for candle in candles], dtype="float64")
        sma_fast = closes.rolling(window=5, min_periods=5).mean().iloc[-1]
        sma_slow = closes.rolling(window=20, min_periods=20).mean().iloc[-1]

        rsi_values = ta.rsi(closes, length=14)
        rsi = float(rsi_values.iloc[-1]) if not pd.isna(rsi_values.iloc[-1]) else 50.0

        last_close = float(closes.iloc[-1])
        if last_close > sma_fast > sma_slow:
            trend = "bullish"
            confidence = max(0.0, min(1.0, 0.5 + ((rsi - 50.0) / 50.0)))
        elif last_close < sma_fast < sma_slow:
            trend = "bearish"
            confidence = max(0.0, min(1.0, 0.5 + ((50.0 - rsi) / 50.0)))
        else:
            trend = "neutral"
            confidence = 0.0

        return IndicatorSnapshot(
            symbol=symbol,
            timeframe=timeframe,
            close=last_close,
            sma_fast=float(sma_fast),
            sma_slow=float(sma_slow),
            rsi=float(rsi),
            trend=trend,
            confidence=float(confidence),
        )
