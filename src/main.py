"""Async background runner entry point."""

from __future__ import annotations

import asyncio
import logging
import signal
from pathlib import Path

from src.engines.scanner_engine import ScannerEngine
from src.models.config import ConfigError, load_config
from src.services.binance_service import BinanceService
from src.services.data_logger_service import JsonlDataLogger
from src.services.firestore_service import FirestoreEventSink
from src.utils.logger import configure_logging

LOGGER = logging.getLogger("crypto_bot")


async def run(
    stop_event: asyncio.Event,
    scanner: ScannerEngine,
    scan_interval_seconds: int,
) -> None:
    """Scan configured markets until the process receives a shutdown signal."""
    LOGGER.info("runner_started")
    try:
        while not stop_event.is_set():
            await scanner.scan_once()
            if not stop_event.is_set():
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=scan_interval_seconds)
                except TimeoutError:
                    pass
    finally:
        LOGGER.info("runner_stopped")


def _install_signal_handlers(stop_event: asyncio.Event) -> None:
    loop = asyncio.get_running_loop()
    for handled_signal in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(handled_signal, stop_event.set)
        except (NotImplementedError, RuntimeError):
            signal.signal(
                handled_signal,
                lambda _signum, _frame: loop.call_soon_threadsafe(stop_event.set),
            )


def _build_firestore_sink(config) -> FirestoreEventSink | None:
    if not config.firebase.enabled:
        return None
    try:
        from google.cloud import firestore
    except ImportError:
        LOGGER.warning("firestore_client_unavailable project_id=%s", config.firebase.project_id)
        return None
    try:
        client = firestore.Client(project=config.firebase.project_id)
    except Exception as error:  # pragma: no cover - defensive runtime guard
        LOGGER.warning("firestore_client_init_failed project_id=%s error=%s", config.firebase.project_id, error)
        return None
    return FirestoreEventSink(config.firebase.project_id, client=client)


async def _run_service(config) -> None:
    stop_event = asyncio.Event()
    _install_signal_handlers(stop_event)
    market_data = BinanceService(config.binance)
    remote_sink = _build_firestore_sink(config)
    data_logger = JsonlDataLogger(
        Path("data/market_observations.jsonl"),
        remote_sink=remote_sink,
    )
    scanner = ScannerEngine(
        config.symbols,
        config.binance,
        market_data,
        data_logger,
        config.strategies,
    )
    await run(stop_event, scanner, config.environment.scan_interval_seconds)


def main() -> int:
    try:
        config = load_config()
    except ConfigError as error:
        logging.basicConfig(level=logging.ERROR)
        LOGGER.error("configuration_error: %s", error)
        return 2

    configure_logging(config.environment.log_level)
    try:
        asyncio.run(_run_service(config))
    except KeyboardInterrupt:
        LOGGER.info("runner_interrupted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())