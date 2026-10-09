"""Typed application settings and JSON configuration loading."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class ConfigError(ValueError):
    """Raised when application configuration is missing or invalid."""


@dataclass(frozen=True, slots=True)
class EnvironmentConfig:
    app_environment: str
    log_level: str
    scan_interval_seconds: int


@dataclass(frozen=True, slots=True)
class BinanceConfig:
    environment: str
    market_type: str
    timeframe: str
    candle_limit: int
    timeout_seconds: int
    max_retries: int


@dataclass(frozen=True, slots=True)
class FirebaseConfig:
    enabled: bool
    project_id: str | None


@dataclass(frozen=True, slots=True)
class AppConfig:
    environment: EnvironmentConfig
    binance: BinanceConfig
    firebase: FirebaseConfig
    strategies: tuple[dict[str, Any], ...]
    symbols: tuple[str, ...]


def _read_object(config_dir: Path, filename: str) -> dict[str, Any]:
    path = config_dir / filename
    try:
        with path.open(encoding="utf-8") as config_file:
            value = json.load(config_file)
    except FileNotFoundError as error:
        raise ConfigError(f"Missing configuration file: {path}") from error
    except json.JSONDecodeError as error:
        raise ConfigError(
            f"Invalid JSON in {path} at line {error.lineno}, column {error.colno}"
        ) from error
    except OSError as error:
        raise ConfigError(f"Cannot read configuration file {path}: {error}") from error

    if not isinstance(value, dict):
        raise ConfigError(f"{path} must contain a JSON object")
    return value


def _check_keys(
    value: dict[str, Any], filename: str, expected: set[str]
) -> None:
    missing = expected - value.keys()
    unknown = value.keys() - expected
    if missing:
        raise ConfigError(f"{filename} is missing required keys: {', '.join(sorted(missing))}")
    if unknown:
        raise ConfigError(f"{filename} has unknown keys: {', '.join(sorted(unknown))}")


def load_config(config_dir: Path = Path("config")) -> AppConfig:
    """Load and validate all runtime settings from the JSON files."""
    environment = _read_object(config_dir, "environment.json")
    _check_keys(
        environment,
        "environment.json",
        {"app_environment", "log_level", "scan_interval_seconds"},
    )

    app_environment = environment["app_environment"]
    if not isinstance(app_environment, str) or app_environment not in {
        "development",
        "test",
        "production",
    }:
        raise ConfigError("environment.json app_environment must be development, test, or production")

    log_level = environment["log_level"]
    if not isinstance(log_level, str) or log_level.upper() not in {
        "DEBUG",
        "INFO",
        "WARNING",
        "ERROR",
        "CRITICAL",
    }:
        raise ConfigError("environment.json log_level must be a standard logging level")

    scan_interval = environment["scan_interval_seconds"]
    if type(scan_interval) is not int or scan_interval <= 0:
        raise ConfigError("environment.json scan_interval_seconds must be a positive integer")

    binance = _read_object(config_dir, "binance.json")
    _check_keys(
        binance,
        "binance.json",
        {
            "environment",
            "market_type",
            "timeframe",
            "candle_limit",
            "timeout_seconds",
            "max_retries",
        },
    )
    if not isinstance(binance["environment"], str) or binance["environment"] not in {
        "testnet",
        "production",
    }:
        raise ConfigError("binance.json environment must be testnet or production")
    if binance["market_type"] != "spot":
        raise ConfigError("binance.json market_type must be spot")
    supported_timeframes = {"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"}
    if not isinstance(binance["timeframe"], str) or binance["timeframe"] not in supported_timeframes:
        raise ConfigError("binance.json timeframe must be a supported Binance kline interval")
    if type(binance["candle_limit"]) is not int or not 2 <= binance["candle_limit"] <= 1000:
        raise ConfigError("binance.json candle_limit must be an integer between 2 and 1000")
    if type(binance["timeout_seconds"]) is not int or binance["timeout_seconds"] <= 0:
        raise ConfigError("binance.json timeout_seconds must be a positive integer")
    if type(binance["max_retries"]) is not int or binance["max_retries"] < 0:
        raise ConfigError("binance.json max_retries must be a non-negative integer")

    firebase = _read_object(config_dir, "firebase.json")
    _check_keys(firebase, "firebase.json", {"enabled", "project_id"})
    if type(firebase["enabled"]) is not bool:
        raise ConfigError("firebase.json enabled must be a boolean")
    project_id = firebase["project_id"]
    if project_id is not None and (not isinstance(project_id, str) or not project_id.strip()):
        raise ConfigError("firebase.json project_id must be a non-empty string or null")
    if firebase["enabled"] and project_id is None:
        raise ConfigError("firebase.json project_id is required when Firestore is enabled")

    strategies_document = _read_object(config_dir, "strategies.json")
    _check_keys(strategies_document, "strategies.json", {"strategies"})
    strategies = strategies_document["strategies"]
    if not isinstance(strategies, list) or any(not isinstance(item, dict) for item in strategies):
        raise ConfigError("strategies.json strategies must be an array of objects")
    for index, strategy in enumerate(strategies):
        if "name" not in strategy or not isinstance(strategy["name"], str) or not strategy["name"].strip():
            raise ConfigError(f"strategies.json strategies[{index}].name must be a non-empty string")
        if "enabled" not in strategy or type(strategy["enabled"]) is not bool:
            raise ConfigError(f"strategies.json strategies[{index}].enabled must be a boolean")
        min_confidence = strategy.get("min_confidence")
        if not isinstance(min_confidence, (int, float)) or min_confidence < 0:
            raise ConfigError(
                f"strategies.json strategies[{index}].min_confidence must be a non-negative number"
            )

    assets_document = _read_object(config_dir, "assets.json")
    _check_keys(assets_document, "assets.json", {"symbols"})
    symbols = assets_document["symbols"]
    if (
        not isinstance(symbols, list)
        or any(not isinstance(symbol, str) or not symbol.strip() for symbol in symbols)
        or len({symbol.upper() for symbol in symbols}) != len(symbols)
    ):
        raise ConfigError("assets.json symbols must be unique, non-empty strings")

    return AppConfig(
        environment=EnvironmentConfig(
            app_environment=app_environment,
            log_level=log_level.upper(),
            scan_interval_seconds=scan_interval,
        ),
        binance=BinanceConfig(
            environment=binance["environment"],
            market_type=binance["market_type"],
            timeframe=binance["timeframe"],
            candle_limit=binance["candle_limit"],
            timeout_seconds=binance["timeout_seconds"],
            max_retries=binance["max_retries"],
        ),
        firebase=FirebaseConfig(enabled=firebase["enabled"], project_id=project_id),
        strategies=tuple(strategies),
        symbols=tuple(symbol.upper() for symbol in symbols),
    )