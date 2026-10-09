from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from src.main import run
from src.models.config import ConfigError, load_config
from src.utils.logger import JsonFormatter


ROOT = Path(__file__).resolve().parents[1]


class ConfigTests(unittest.TestCase):
    def test_loads_sample_configuration(self) -> None:
        config = load_config(ROOT / "config")

        self.assertEqual(config.environment.app_environment, "test")
        self.assertEqual(config.binance.environment, "testnet")
        self.assertEqual(config.symbols, ("BTCUSDT", "ETHUSDT"))
        self.assertFalse(config.firebase.enabled)

    def test_rejects_non_positive_scan_interval(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            config_dir = Path(temporary_directory) / "config"
            shutil.copytree(ROOT / "config", config_dir)
            environment_path = config_dir / "environment.json"
            environment = json.loads(environment_path.read_text(encoding="utf-8"))
            environment["scan_interval_seconds"] = 0
            environment_path.write_text(json.dumps(environment), encoding="utf-8")

            with self.assertRaisesRegex(ConfigError, "scan_interval_seconds"):
                load_config(config_dir)

    def test_requires_project_id_when_firestore_enabled(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            config_dir = Path(temporary_directory) / "config"
            shutil.copytree(ROOT / "config", config_dir)
            firebase_path = config_dir / "firebase.json"
            firebase_path.write_text(
                json.dumps({"enabled": True, "project_id": None}), encoding="utf-8"
            )

            with self.assertRaisesRegex(ConfigError, "project_id is required"):
                load_config(config_dir)

    def test_rejects_invalid_binance_environment_type(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            config_dir = Path(temporary_directory) / "config"
            shutil.copytree(ROOT / "config", config_dir)
            binance_path = config_dir / "binance.json"
            binance = json.loads(binance_path.read_text(encoding="utf-8"))
            binance["environment"] = []
            binance_path.write_text(json.dumps(binance), encoding="utf-8")

            with self.assertRaisesRegex(ConfigError, "environment must be testnet or production"):
                load_config(config_dir)


class LoggingTests(unittest.TestCase):
    def test_formatter_emits_json_log_record(self) -> None:
        import logging

        record = logging.LogRecord("test", logging.INFO, "", 0, "runner_started", (), None)
        entry = json.loads(JsonFormatter().format(record))

        self.assertEqual(entry["level"], "INFO")
        self.assertEqual(entry["message"], "runner_started")
        self.assertIn("timestamp", entry)


class RunnerTests(unittest.IsolatedAsyncioTestCase):
    async def test_runner_scans_then_stops_when_event_is_set(self) -> None:
        stop_event = asyncio.Event()

        class StopAfterScan:
            async def scan_once(self) -> None:
                stop_event.set()

        await asyncio.wait_for(run(stop_event, StopAfterScan(), 60), timeout=1)


if __name__ == "__main__":
    unittest.main()