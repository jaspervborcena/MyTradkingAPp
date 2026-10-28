# Firestore collection schema

This project is designed around a small set of collections for signal scanning and later execution. These collections are the intended default structure for the Firebase deployment.

## 1. market_events

Purpose: main event log for runtime activity and structured events.

Suggested document shape:

```json
{
  "event_id": "uuid",
  "schema_version": 1,
  "event_type": "signal|observation|system|error",
  "symbol": "BTCUSDT",
  "timestamp": "2026-10-09T12:00:00Z",
  "source": "scanner|binance|firestore|system",
  "payload": {
    "side": "BUY",
    "confidence": 0.72,
    "accepted": true,
    "reasons": ["bullish_trend"]
  }
}
```

Profile-driven observation and signal events also include `profile_name`. Signal events include the effective strategy parameters used for that decision.

## 2. risk_profiles

Use one document per profile, with the document ID matching `profile_name`: `high`, `medium`, or `slow`. The scheduled functions `trading_scanMarket_high`, `trading_scanMarket_medium`, and `trading_scanMarket_slow` each submit the shared NestJS Cloud Run Job with the corresponding `PROFILE` environment variable. Each profile is loaded and validated by the NestJS scanner before it requests market data.

Example `risk_profiles/high` document:

```json
{
  "profile_name": "high",
  "description": "High volatility assets with aggressive momentum thresholds",
  "enabled": true,
  "interval_minutes": 5,
  "symbols": ["SOLUSDT", "AVAXUSDT", "DOGEUSDT", "NEARUSDT", "RENDERUSDT", "FETUSDT", "PEPEUSDT", "INJUSDT", "APTUSDT", "SUIUSDT"],
  "strategy": {
    "sma_fast": 3,
    "sma_slow": 10,
    "rsi_period": 14,
    "min_confidence_score": 75.0,
    "target_buy_spread_pct": 1.5,
    "target_sell_spread_pct": 2.5,
    "stop_loss_pct": 3.0
  }
}
```

Example `risk_profiles/medium` document:

```json
{
  "profile_name": "medium",
  "description": "Mid-cap assets with balanced trend-following rules",
  "enabled": true,
  "interval_minutes": 5,
  "symbols": ["BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "LINKUSDT", "MATICUSDT", "DOTUSDT", "UNIUSDT", "ATOMUSDT"],
  "strategy": {
    "sma_fast": 5,
    "sma_slow": 20,
    "rsi_period": 14,
    "min_confidence_score": 60.0,
    "target_buy_spread_pct": 1.0,
    "target_sell_spread_pct": 1.8,
    "stop_loss_pct": 2.0
  }
}
```

Example `risk_profiles/slow` document:

```json
{
  "profile_name": "slow",
  "description": "Top-tier assets with conservative thresholds",
  "enabled": true,
  "interval_minutes": 5,
  "symbols": ["BTCUSDT", "ETHUSDT"],
  "strategy": {
    "sma_fast": 10,
    "sma_slow": 50,
    "rsi_period": 14,
    "min_confidence_score": 85.0,
    "target_buy_spread_pct": 0.5,
    "target_sell_spread_pct": 1.0,
    "stop_loss_pct": 1.0
  }
}
```

```json
{
  "profile_name": "medium",
  "description": "Balanced trend-following rules",
  "enabled": true,
  "interval_minutes": 5,
  "symbols": ["BTCUSDT", "ETHUSDT"],
  "strategy": {
    "sma_fast": 5,
    "sma_slow": 20,
    "rsi_period": 14,
    "min_confidence_score": 60.0,
    "target_buy_spread_pct": 1.0,
    "target_sell_spread_pct": 1.8,
    "stop_loss_pct": 2.0
  }
}
```

`interval_minutes` is an optional per-profile scheduler gate and defaults to 5. Confidence is expressed as 0-100 in Firestore and normalized to 0-1 internally. Spread targets and stop loss are recorded with signals as configuration metadata; this signal-only scanner does not simulate trade completion or stop-loss execution. The `slow` profile uses more conservative signal parameters, but is not a guarantee of lower risk.

## 3. market_observations

Purpose: raw market snapshot data, usually one document per symbol scan or one per candle bundle.

Suggested document shape:

```json
{
  "observation_id": "uuid",
  "symbol": "BTCUSDT",
  "timestamp": "2026-10-09T12:00:00Z",
  "timeframe": "1m",
  "candles": [
    {
      "open_time": "2026-10-09T11:59:00Z",
      "close_time": "2026-10-09T12:00:00Z",
      "open": 62000,
      "high": 62120,
      "low": 61940,
      "close": 62080,
      "volume": 142.5
    }
  ],
  "source": "binance"
}
```

## 4. signals

Purpose: filtered signal records with the trading decision outcome.

Suggested document shape:

```json
{
  "signal_id": "uuid",
  "symbol": "ETHUSDT",
  "signal_type": "BUY",
  "confidence": 0.68,
  "accepted": true,
  "timestamp": "2026-10-09T12:00:00Z",
  "reasons": ["rsi_bullish", "sma_uptrend"],
  "strategy": "trend_follow",
  "status": "pending|approved|rejected"
}
```

## 5. trades

Purpose: execution or paper-trade lifecycle records.

Suggested document shape:

```json
{
  "trade_id": "uuid",
  "symbol": "BTCUSDT",
  "side": "BUY",
  "status": "open|closed|paper",
  "entry_price": 62000,
  "exit_price": 62500,
  "quantity": 0.12,
  "timestamp": "2026-10-09T12:00:00Z"
}
```

## 6. users

Purpose: dashboard users, admin users, or account owners.

Suggested document shape:

```json
{
  "user_id": "uuid",
  "email": "user@example.com",
  "role": "admin|viewer|operator",
  "created_at": "2026-10-09T12:00:00Z",
  "status": "active|disabled",
  "watchlist": ["BTCUSDT", "ETHUSDT"]
}
```

The authenticated analysis endpoint reads `watchlist` from `users/{firebaseUid}`. Store uppercase USDT-quoted Binance Spot symbols in this array; the API limits any single analysis request to 20 symbols. Per-user request counters are stored separately in `analysis_request_quotas/{firebaseUid}` and are operational data, not a user-facing watchlist.

## Default collection for the MVP

Use `market_events` as the primary collection for the current signal-only project. The rest are intended as the next logical collections as the system grows.

These collections should be created in the Firebase console, or with a Firebase admin bootstrap script, once the project is authenticated and the Firestore database exists.
