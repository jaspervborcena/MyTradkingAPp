"""Indicator calculations used to convert candles into trend signals."""

from __future__ import annotations

from collections.abc import Sequence

import pandas as pd
import pandas_ta as ta

from src.models.market import Candle, IndicatorSnapshot


class IndicatorService:
    """Compute trend and momentum indicators from a sequence of candles."""

    @staticmethod
    def compute(
        candles: Sequence[Candle],
        symbol: str,
        timeframe: str,
        sma_fast: int = 5,
        sma_slow: int = 20,
        rsi_period: int = 14,
    ) -> IndicatorSnapshot:
        if sma_fast <= 0 or sma_slow <= sma_fast or rsi_period <= 0:
            raise ValueError("Indicator periods must be positive and sma_fast must be less than sma_slow")
        if len(candles) < max(sma_slow, rsi_period + 1):
            raise ValueError("Insufficient candles to compute configured indicators")

        closes = pd.Series([float(candle.close) for candle in candles], dtype="float64")
        fast_average = closes.rolling(window=sma_fast, min_periods=sma_fast).mean().iloc[-1]
        slow_average = closes.rolling(window=sma_slow, min_periods=sma_slow).mean().iloc[-1]

        rsi_values = ta.rsi(closes, length=rsi_period)
        rsi = float(rsi_values.iloc[-1]) if not pd.isna(rsi_values.iloc[-1]) else 50.0

        last_close = float(closes.iloc[-1])
        if last_close > fast_average > slow_average:
            trend = "bullish"
            confidence = max(0.0, min(1.0, 0.5 + ((rsi - 50.0) / 50.0)))
        elif last_close < fast_average < slow_average:
            trend = "bearish"
            confidence = max(0.0, min(1.0, 0.5 + ((50.0 - rsi) / 50.0)))
        else:
            trend = "neutral"
            confidence = 0.0

        return IndicatorSnapshot(
            symbol=symbol,
            timeframe=timeframe,
            close=last_close,
            sma_fast=float(fast_average),
            sma_slow=float(slow_average),
            rsi=float(rsi),
            trend=trend,
            confidence=float(confidence),
        )
