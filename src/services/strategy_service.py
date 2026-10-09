"""Strategy evaluation for basic trend-based signals."""

from __future__ import annotations

from src.models.market import IndicatorSnapshot


class StrategyService:
    """Evaluate configured strategy thresholds against computed indicators."""

    @staticmethod
    def evaluate(snapshot: IndicatorSnapshot, strategy: dict[str, object]) -> dict[str, object]:
        enabled = bool(strategy.get("enabled", False))
        name = str(strategy.get("name", "trend_follow"))
        min_confidence = float(strategy.get("min_confidence", 0.0))

        if not enabled:
            return {
                "name": name,
                "side": "none",
                "accepted": False,
                "confidence": snapshot.confidence,
                "reasons": ["strategy is disabled"],
            }

        if snapshot.trend == "bullish":
            side = "buy"
        elif snapshot.trend == "bearish":
            side = "sell"
        else:
            side = "hold"

        reasons: list[str] = []
        if side == "hold":
            reasons.append("trend is neutral")
        elif snapshot.confidence < min_confidence:
            reasons.append(
                f"min_confidence not met: {snapshot.confidence:.4f} < {min_confidence:.4f}"
            )

        accepted = side != "hold" and not reasons
        return {
            "name": name,
            "side": side,
            "accepted": accepted,
            "confidence": snapshot.confidence,
            "reasons": reasons,
        }
