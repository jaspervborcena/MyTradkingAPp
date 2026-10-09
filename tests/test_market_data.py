from __future__ import annotations

import asyncio
import io
import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, Mock, patch
from urllib.error import URLError
from urllib.parse import parse_qs, urlparse

from src.engines.scanner_engine import ScannerEngine
from src.models.config import BinanceConfig, load_config
from src.models.market import Candle, SignalEvent
from src.services.binance_service import BinanceService, MarketDataError
from src.services.data_logger_service import JsonlDataLogger
from src.services.event_sink_service import JsonlEventSink
from src.services.event_store_service import JsonlEventStore
from src.services.firestore_service import FirestoreEventSink
from src.services.indicator_service import IndicatorService
from src.services.strategy_service import StrategyService


ROOT = Path(__file__).resolve().parents[1]
CONFIG = load_config(ROOT / "config")


def sample_kline(open_time: int = 1_725_000_000_000) -> list[object]:
    return [open_time, "100.0", "110.0", "95.0", "105.0", "12.5", open_time + 59_999]


class BinanceServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_uses_configured_testnet_and_parses_candle(self) -> None:
        service = BinanceService(CONFIG.binance)
        with patch.object(service, "_get_json", return_value=[sample_kline()]) as request:
            candles = await service.fetch_candles("btcusdt")

        request_url = request.call_args.args[0]
        parsed_url = urlparse(request_url)
        query = parse_qs(parsed_url.query)
        self.assertEqual(parsed_url.netloc, "testnet.binance.vision")
        self.assertEqual(query["symbol"], ["BTCUSDT"])
        self.assertEqual(query["interval"], ["1m"])
        self.assertEqual(query["limit"], ["100"])
        self.assertEqual(len(candles), 1)
        self.assertEqual(candles[0].close, 105.0)
        self.assertEqual(candles[0].open_time.tzinfo, timezone.utc)

    async def test_retries_transient_network_error(self) -> None:
        service = BinanceService(CONFIG.binance)
        response = io.BytesIO(json.dumps([sample_kline()]).encode("utf-8"))
        with (
            patch(
                "src.services.binance_service.urlopen",
                side_effect=[URLError("offline"), response],
            ) as request,
            patch("src.services.binance_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            candles = await service.fetch_candles("BTCUSDT")

        self.assertEqual(len(candles), 1)
        self.assertEqual(request.call_count, 2)

    async def test_paces_concurrent_requests(self) -> None:
        service = BinanceService(CONFIG.binance)
        first_response = io.BytesIO(json.dumps([sample_kline()]).encode("utf-8"))
        second_response = io.BytesIO(json.dumps([sample_kline() + [None]]).encode("utf-8"))
        with (
            patch(
                "src.services.binance_service.urlopen",
                side_effect=[first_response, second_response],
            ),
            patch(
                "src.services.binance_service.asyncio.sleep", new_callable=AsyncMock
            ) as sleep,
        ):
            await asyncio.gather(
                service.fetch_candles("BTCUSDT"),
                service.fetch_candles("ETHUSDT"),
            )

        sleep.assert_awaited_once()

    async def test_rejects_malformed_kline(self) -> None:
        service = BinanceService(CONFIG.binance)
        malformed = sample_kline()
        malformed[2] = "90.0"
        with patch.object(service, "_get_json", return_value=[malformed]):
            with self.assertRaisesRegex(MarketDataError, "inconsistent OHLCV"):
                await service.fetch_candles("BTCUSDT")


class ScannerTests(unittest.IsolatedAsyncioTestCase):
    async def test_logs_latest_closed_candle_once_per_symbol(self) -> None:
        now = datetime.now(timezone.utc)
        candles = (
            Candle(
                open_time=now - timedelta(minutes=2),
                close_time=now - timedelta(minutes=1),
                open=100,
                high=110,
                low=95,
                close=105,
                volume=10,
            ),
            Candle(
                open_time=now - timedelta(minutes=1),
                close_time=now - timedelta(seconds=5),
                open=105,
                high=115,
                low=100,
                close=110,
                volume=12,
            ),
        )

        class StubMarketData:
            async def fetch_candles(self, symbol: str) -> tuple[Candle, ...]:
                return candles

        with TemporaryDirectory() as temporary_directory:
            output_path = Path(temporary_directory) / "observations.jsonl"
            scanner = ScannerEngine(
                CONFIG.symbols,
                CONFIG.binance,
                StubMarketData(),
                JsonlDataLogger(output_path),
            )

            await scanner.scan_once()
            await scanner.scan_once()

            entries = [json.loads(line) for line in output_path.read_text(encoding="utf-8").splitlines()]

        self.assertEqual(len(entries), len(CONFIG.symbols))
        self.assertEqual({entry["symbol"] for entry in entries}, set(CONFIG.symbols))
        self.assertTrue(all(entry["candle"]["close"] == 110 for entry in entries))
        self.assertTrue(all(entry["schema_version"] == 1 for entry in entries))


class Phase3StrategyTests(unittest.TestCase):
    def test_indicator_service_produces_bullish_snapshot(self) -> None:
        candles = tuple(
            Candle(
                open_time=datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=i),
                close_time=datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=i, seconds=59),
                open=float(100 + i),
                high=float(101 + i),
                low=float(99 + i),
                close=float(100 + i + 1),
                volume=100.0,
            )
            for i in range(35)
        )

        snapshot = IndicatorService.compute(candles, "BTCUSDT", "1m")

        self.assertEqual(snapshot.symbol, "BTCUSDT")
        self.assertEqual(snapshot.timeframe, "1m")
        self.assertEqual(snapshot.trend, "bullish")
        self.assertGreater(snapshot.sma_fast, 0)
        self.assertGreater(snapshot.rsi, 0)
        self.assertLessEqual(snapshot.rsi, 100)

    def test_strategy_service_accepts_bullish_signal(self) -> None:
        candles = tuple(
            Candle(
                open_time=datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=i),
                close_time=datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=i, seconds=59),
                open=float(100 + i),
                high=float(101 + i),
                low=float(99 + i),
                close=float(100 + i + 1),
                volume=100.0,
            )
            for i in range(35)
        )
        snapshot = IndicatorService.compute(candles, "ETHUSDT", "1m")
        strategy = {"name": "trend_follow", "enabled": True, "min_confidence": 0.3}

        signal = StrategyService.evaluate(snapshot, strategy)

        self.assertEqual(signal["side"], "buy")
        self.assertTrue(signal["accepted"])
        self.assertGreater(signal["confidence"], 0.0)

    def test_strategy_service_rejects_low_confidence_signal(self) -> None:
        candles = tuple(
            Candle(
                open_time=datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=i),
                close_time=datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=i, seconds=59),
                open=float(100 + i),
                high=float(101 + i),
                low=float(99 + i),
                close=float(100 + i + 1),
                volume=100.0,
            )
            for i in range(35)
        )
        snapshot = IndicatorService.compute(candles, "BTCUSDT", "1m")
        strategy = {"name": "trend_follow", "enabled": True, "min_confidence": 10.0}

        signal = StrategyService.evaluate(snapshot, strategy)

        self.assertEqual(signal["side"], "buy")
        self.assertFalse(signal["accepted"])
        self.assertIn("min_confidence", signal["reasons"][0])

    def test_signal_event_schema_has_expected_fields(self) -> None:
        event = SignalEvent(
            event_id="signal:BTCUSDT:1m:2024-01-01T00:00:00+00:00",
            captured_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
            symbol="BTCUSDT",
            timeframe="1m",
            strategy="trend_follow",
            side="buy",
            status="accepted",
            confidence=0.89,
            reasons=("trend is bullish",),
            indicator_snapshot={"trend": "bullish", "rsi": 78.0},
        )

        payload = event.to_dict()

        self.assertEqual(payload["schema_version"], 1)
        self.assertEqual(payload["symbol"], "BTCUSDT")
        self.assertEqual(payload["side"], "buy")
        self.assertEqual(payload["status"], "accepted")
        self.assertIn("indicator_snapshot", payload)

    def test_jsonl_event_sink_persists_signal_event(self) -> None:
        with TemporaryDirectory() as temporary_directory:
            output_dir = Path(temporary_directory)
            sink = JsonlEventSink(output_dir / "signal-events.jsonl")
            event = SignalEvent(
                event_id="signal:ETHUSDT:1m:2024-01-01T00:00:00+00:00",
                captured_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
                symbol="ETHUSDT",
                timeframe="1m",
                strategy="trend_follow",
                side="sell",
                status="rejected",
                confidence=0.21,
                reasons=("min_confidence not met",),
                indicator_snapshot={"trend": "bearish", "rsi": 41.0},
            )

            sink.log_event(event)

            lines = (output_dir / "signal-events.jsonl").read_text(encoding="utf-8").splitlines()
            payload = json.loads(lines[0])

        self.assertEqual(payload["event_type"], "signal")
        self.assertEqual(payload["status"], "rejected")
        self.assertEqual(payload["strategy"], "trend_follow")
        self.assertEqual(payload["schema_version"], 1)

    def test_jsonl_event_store_persists_structured_events(self) -> None:
        with TemporaryDirectory() as temporary_directory:
            output_path = Path(temporary_directory) / "events.jsonl"
            store = JsonlEventStore(output_path)
            observation = {
                "schema_version": 1,
                "event_type": "market_observation",
                "symbol": "BTCUSDT",
                "timeframe": "1m",
                "captured_at": "2024-01-01T00:00:00+00:00",
                "exchange": "binance",
            }
            signal = {
                "schema_version": 1,
                "event_type": "signal",
                "symbol": "BTCUSDT",
                "timeframe": "1m",
                "captured_at": "2024-01-01T00:00:01+00:00",
                "status": "accepted",
                "strategy": "trend_follow",
            }

            store.append(observation)
            store.append(signal)
            events = store.read_events()

        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["event_type"], "market_observation")
        self.assertEqual(events[1]["status"], "accepted")
        self.assertTrue(all(event["schema_version"] == 1 for event in events))

    def test_firestore_event_sink_writes_event_document(self) -> None:
        collection = Mock()
        client = Mock()
        client.collection.return_value = collection

        sink = FirestoreEventSink("demo-project", client=client)
        event = {
            "schema_version": 1,
            "event_type": "signal",
            "symbol": "ETHUSDT",
            "timeframe": "1m",
            "status": "accepted",
            "strategy": "trend_follow",
        }

        sink.append(event)

        client.collection.assert_called_once_with("market_events")
        collection.add.assert_called_once_with(event)


if __name__ == "__main__":
    unittest.main()