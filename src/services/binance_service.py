"""Async client for Binance's public spot kline REST endpoint."""

from __future__ import annotations

import asyncio
import json
import logging
import math
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from src.models.config import BinanceConfig
from src.models.market import Candle

LOGGER = logging.getLogger("crypto_bot.binance")


class MarketDataError(RuntimeError):
    """Raised when Binance market data cannot be fetched or validated."""


class _RetryableMarketDataError(MarketDataError):
    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class BinanceService:
    """Fetch public OHLCV candles without exchange credentials or order APIs."""

    _MIN_REQUEST_INTERVAL_SECONDS = 0.1
    _BASE_URLS = {
        "production": "https://api.binance.com",
        "testnet": "https://testnet.binance.vision",
    }

    def __init__(self, config: BinanceConfig) -> None:
        self._config = config
        self._base_url = self._BASE_URLS[config.environment]
        self._request_lock = asyncio.Lock()
        self._next_request_at = 0.0

    async def fetch_candles(self, symbol: str) -> tuple[Candle, ...]:
        query = urlencode(
            {
                "symbol": symbol.upper(),
                "interval": self._config.timeframe,
                "limit": self._config.candle_limit,
            }
        )
        url = f"{self._base_url}/api/v3/klines?{query}"

        for attempt in range(self._config.max_retries + 1):
            try:
                payload = await self._get_rate_limited_json(url)
                return self._parse_candles(payload)
            except _RetryableMarketDataError as error:
                if attempt >= self._config.max_retries:
                    raise MarketDataError(
                        f"Binance request failed after {attempt + 1} attempts: {error}"
                    ) from error
                delay = error.retry_after or min(2**attempt, 8)
                LOGGER.warning("binance_retry attempt=%s delay_seconds=%s", attempt + 1, delay)
                await asyncio.sleep(delay)

        raise MarketDataError("Binance request exhausted retries")

    async def _get_rate_limited_json(self, url: str) -> object:
        async with self._request_lock:
            loop = asyncio.get_running_loop()
            delay = self._next_request_at - loop.time()
            if delay > 0:
                await asyncio.sleep(delay)
            self._next_request_at = loop.time() + self._MIN_REQUEST_INTERVAL_SECONDS
            return await asyncio.to_thread(self._get_json, url)

    def _get_json(self, url: str) -> object:
        request = Request(url, headers={"User-Agent": "crypto-volatility-scanner/1.0"})
        try:
            with urlopen(request, timeout=self._config.timeout_seconds / 1000) as response:
                return json.loads(response.read())
        except HTTPError as error:
            if error.code in {418, 429} or error.code >= 500:
                retry_after = self._retry_after_seconds(
                    error.headers.get("Retry-After") if error.headers else None
                )
                raise _RetryableMarketDataError(
                    f"Binance returned HTTP {error.code}", retry_after
                ) from error
            raise MarketDataError(f"Binance returned HTTP {error.code}") from error
        except (OSError, TimeoutError) as error:
            raise _RetryableMarketDataError(f"Binance network request failed: {error}") from error
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise MarketDataError("Binance returned an invalid JSON response") from error

    @staticmethod
    def _retry_after_seconds(value: str | None) -> float | None:
        if value is None:
            return None
        try:
            return max(0.0, float(value))
        except ValueError:
            try:
                retry_at = parsedate_to_datetime(value)
            except (TypeError, ValueError):
                return None
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=timezone.utc)
            return max(0.0, (retry_at - datetime.now(timezone.utc)).total_seconds())

    @staticmethod
    def _parse_candles(payload: object) -> tuple[Candle, ...]:
        if not isinstance(payload, list):
            raise MarketDataError("Binance kline response must be an array")

        candles: list[Candle] = []
        try:
            for row in payload:
                if not isinstance(row, list) or len(row) < 7:
                    raise ValueError("kline row has fewer than seven fields")
                values = [float(row[index]) for index in range(1, 6)]
                if not all(math.isfinite(value) for value in values):
                    raise ValueError("kline contains a non-finite number")
                open_price, high, low, close, volume = values
                if (
                    min(open_price, high, low, close) <= 0
                    or volume < 0
                    or high < max(open_price, close, low)
                    or low > min(open_price, close, high)
                ):
                    raise ValueError("kline contains inconsistent OHLCV values")
                candles.append(
                    Candle(
                        open_time=datetime.fromtimestamp(int(row[0]) / 1000, timezone.utc),
                        close_time=datetime.fromtimestamp(int(row[6]) / 1000, timezone.utc),
                        open=open_price,
                        high=high,
                        low=low,
                        close=close,
                        volume=volume,
                    )
                )
        except (IndexError, TypeError, ValueError, OverflowError) as error:
            raise MarketDataError(f"Binance returned a malformed kline: {error}") from error

        if any(
            candles[index].open_time >= candles[index + 1].open_time
            for index in range(len(candles) - 1)
        ):
            raise MarketDataError("Binance kline response is not in chronological order")
        return tuple(candles)