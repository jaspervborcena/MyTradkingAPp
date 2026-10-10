"""Scan configured symbols and persist their latest closed candles."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from src.models.config import BinanceConfig
from src.models.market import MarketObservation, SignalEvent
from src.models.risk_profile import RiskProfile
from src.services.binance_service import BinanceService
from src.services.data_logger_service import JsonlDataLogger
from src.services.indicator_service import IndicatorService
from src.services.strategy_service import StrategyService

LOGGER = logging.getLogger("crypto_bot.scanner")


class ScannerEngine:
    def __init__(
        self,
        symbols: tuple[str, ...],
        binance_config: BinanceConfig,
        market_data: BinanceService,
        data_logger: JsonlDataLogger,
        strategies: tuple[dict[str, object], ...] = (),
        risk_profile: RiskProfile | None = None,
    ) -> None:
        self._symbols = symbols
        self._config = binance_config
        self._market_data = market_data
        self._data_logger = data_logger
        self._strategies = strategies
        self._risk_profile = risk_profile
        self._last_logged_open_time: dict[str, datetime] = {}

    async def scan_once(self) -> None:
        for symbol in self._symbols:
            try:
                await self._scan_symbol(symbol)
            except Exception:
                LOGGER.exception("market_scan_failed symbol=%s", symbol)

    async def _scan_symbol(self, symbol: str) -> None:
        candles = await self._market_data.fetch_candles(symbol)
        now = datetime.now(timezone.utc)
        closed_candles = [candle for candle in candles if candle.close_time <= now]
        if not closed_candles:
            LOGGER.warning("no_closed_candle symbol=%s", symbol)
            return

        candle = closed_candles[-1]
        last_logged_open_time = self._last_logged_open_time.get(symbol)
        if last_logged_open_time is not None and candle.open_time <= last_logged_open_time:
            return

        observation = MarketObservation(
            event_id=f"binance:{symbol}:{self._config.timeframe}:{candle.open_time.isoformat()}",
            captured_at=now,
            exchange="binance",
            symbol=symbol,
            timeframe=self._config.timeframe,
            candle=candle,
            profile_name=self._risk_profile.profile_name if self._risk_profile else None,
        )
        await self._data_logger.log_observation(observation)
        self._last_logged_open_time[symbol] = candle.open_time

        try:
            snapshot = IndicatorService.compute(
                candles,
                symbol,
                self._config.timeframe,
                sma_fast=self._risk_profile.sma_fast if self._risk_profile else 5,
                sma_slow=self._risk_profile.sma_slow if self._risk_profile else 20,
                rsi_period=self._risk_profile.rsi_period if self._risk_profile else 14,
            )
            for strategy in self._strategies:
                signal = StrategyService.evaluate(snapshot, strategy)
                signal_event = SignalEvent(
                    event_id=f"signal:{symbol}:{self._config.timeframe}:{now.isoformat()}",
                    captured_at=now,
                    symbol=symbol,
                    timeframe=self._config.timeframe,
                    strategy=str(signal["name"]),
                    side=str(signal["side"]),
                    status="accepted" if signal["accepted"] else "rejected",
                    confidence=float(signal["confidence"]),
                    reasons=tuple(str(reason) for reason in signal["reasons"]),
                    indicator_snapshot=snapshot.to_dict(),
                    profile_name=self._risk_profile.profile_name if self._risk_profile else None,
                    strategy_parameters=(
                        self._risk_profile.strategy_parameters() if self._risk_profile else None
                    ),
                )
                await self._data_logger.log_signal(signal_event)
        except ValueError:
            LOGGER.warning("indicator_computation_skipped symbol=%s reason=%s", symbol, "insufficient_history")

        LOGGER.info(
            "market_observation_recorded symbol=%s timeframe=%s open_time=%s",
            symbol,
            self._config.timeframe,
            candle.open_time.isoformat(),
        )