"""Validated runtime settings loaded from a Firestore risk profile."""

from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from typing import Any


class RiskProfileError(ValueError):
    """Raised when a Firestore risk profile is missing or invalid."""


@dataclass(frozen=True, slots=True)
class RiskProfile:
    profile_name: str
    symbols: tuple[str, ...]
    sma_fast: int
    sma_slow: int
    rsi_period: int
    min_confidence_score: float
    target_buy_spread_pct: float
    target_sell_spread_pct: float
    stop_loss_pct: float

    @classmethod
    def from_document(cls, profile_name: str, document: Any) -> RiskProfile | None:
        if profile_name not in {"high", "medium", "slow"}:
            raise RiskProfileError("PROFILE must be high, medium, or slow")
        if not isinstance(document, dict):
            raise RiskProfileError(f"risk_profiles/{profile_name} must contain an object")
        if type(document.get("enabled")) is not bool:
            raise RiskProfileError(f"risk_profiles/{profile_name}.enabled must be a boolean")
        if not document["enabled"]:
            return None
        if document.get("profile_name", profile_name) != profile_name:
            raise RiskProfileError(f"risk_profiles/{profile_name}.profile_name must match its document ID")

        symbols = document.get("symbols")
        if (
            not isinstance(symbols, list)
            or not symbols
            or any(
                not isinstance(symbol, str)
                or not symbol.strip()
                or any(character.isspace() for character in symbol)
                for symbol in symbols
            )
            or len({symbol.upper() for symbol in symbols}) != len(symbols)
        ):
            raise RiskProfileError(f"risk_profiles/{profile_name}.symbols must be unique non-empty strings")

        strategy = document.get("strategy")
        if not isinstance(strategy, dict):
            raise RiskProfileError(f"risk_profiles/{profile_name}.strategy must be an object")

        sma_fast = cls._positive_integer(strategy, "sma_fast", profile_name)
        sma_slow = cls._positive_integer(strategy, "sma_slow", profile_name)
        rsi_period = cls._positive_integer(strategy, "rsi_period", profile_name)
        if sma_fast >= sma_slow:
            raise RiskProfileError(f"risk_profiles/{profile_name}.strategy.sma_fast must be less than sma_slow")

        return cls(
            profile_name=profile_name,
            symbols=tuple(symbol.upper() for symbol in symbols),
            sma_fast=sma_fast,
            sma_slow=sma_slow,
            rsi_period=rsi_period,
            min_confidence_score=cls._number(strategy, "min_confidence_score", profile_name, 0, 100),
            target_buy_spread_pct=cls._number(strategy, "target_buy_spread_pct", profile_name, 0),
            target_sell_spread_pct=cls._number(strategy, "target_sell_spread_pct", profile_name, 0),
            stop_loss_pct=cls._number(strategy, "stop_loss_pct", profile_name, 0),
        )

    def strategy_config(self) -> dict[str, object]:
        return {
            "name": "trend_follow",
            "enabled": True,
            "min_confidence": self.min_confidence_score / 100.0,
        }

    def strategy_parameters(self) -> dict[str, int | float]:
        return {
            "sma_fast": self.sma_fast,
            "sma_slow": self.sma_slow,
            "rsi_period": self.rsi_period,
            "min_confidence_score": self.min_confidence_score,
            "target_buy_spread_pct": self.target_buy_spread_pct,
            "target_sell_spread_pct": self.target_sell_spread_pct,
            "stop_loss_pct": self.stop_loss_pct,
        }

    @staticmethod
    def _positive_integer(strategy: dict[str, Any], key: str, profile_name: str) -> int:
        value = strategy.get(key)
        if type(value) is not int or value <= 0:
            raise RiskProfileError(f"risk_profiles/{profile_name}.strategy.{key} must be a positive integer")
        return value

    @staticmethod
    def _number(
        strategy: dict[str, Any],
        key: str,
        profile_name: str,
        minimum: float,
        maximum: float | None = None,
    ) -> float:
        value = strategy.get(key)
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not isfinite(value)
            or value < minimum
        ):
            raise RiskProfileError(f"risk_profiles/{profile_name}.strategy.{key} must be at least {minimum}")
        if maximum is not None and value > maximum:
            raise RiskProfileError(f"risk_profiles/{profile_name}.strategy.{key} must be at most {maximum}")
        return float(value)