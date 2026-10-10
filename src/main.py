"""Async background runner entry point."""

from __future__ import annotations

import asyncio
import logging
import os
import signal
from pathlib import Path

from src.engines.scanner_engine import ScannerEngine
from src.models.config import ConfigError, load_config
from src.models.risk_profile import RiskProfileError
from src.services.binance_service import BinanceService
from src.services.data_logger_service import JsonlDataLogger
from src.services.firestore_service import FirestoreEventSink, FirestoreRiskProfileRepository
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


def _build_firestore_client(config):
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
    return client


async def _run_service(config) -> None:
    stop_event = asyncio.Event()
    _install_signal_handlers(stop_event)
    market_data = BinanceService(config.binance)
    profile_name = os.environ.get("PROFILE")
    firestore_client = _build_firestore_client(config)
    if profile_name and firestore_client is None:
        raise RuntimeError("PROFILE requires Firestore to be enabled and available")
    risk_profile = None
    if profile_name:
        risk_profile = await asyncio.to_thread(
            FirestoreRiskProfileRepository(firestore_client).get,
            profile_name,
        )
        if risk_profile is None:
            LOGGER.info("risk_profile_disabled profile_name=%s", profile_name)
            return
        if max(risk_profile.sma_slow, risk_profile.rsi_period + 1) > config.binance.candle_limit:
            raise RiskProfileError("profile indicator periods cannot exceed Binance candle_limit")
        LOGGER.info(
            "risk_profile_loaded profile_name=%s symbols=%d",
            risk_profile.profile_name,
            len(risk_profile.symbols),
        )
    remote_sink = FirestoreEventSink(config.firebase.project_id, client=firestore_client) if firestore_client else None
    data_logger = JsonlDataLogger(
        Path("data/market_observations.jsonl"),
        remote_sink=remote_sink,
    )
    scanner = ScannerEngine(
        risk_profile.symbols if risk_profile else config.symbols,
        config.binance,
        market_data,
        data_logger,
        (risk_profile.strategy_config(),) if risk_profile else config.strategies,
        risk_profile=risk_profile,
    )
    if os.environ.get("SCAN_ONCE", "").lower() == "true":
        LOGGER.info("single_scan_started")
        await scanner.scan_once()
        LOGGER.info("single_scan_completed")
        return
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
    except (RiskProfileError, RuntimeError) as error:
        LOGGER.error("configuration_error: %s", error)
        return 2
    except KeyboardInterrupt:
        LOGGER.info("runner_interrupted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())