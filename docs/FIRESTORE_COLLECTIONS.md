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

## 2. market_observations

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

## 3. signals

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

## 4. trades

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

## 5. users

Purpose: dashboard users, admin users, or account owners.

Suggested document shape:

```json
{
  "user_id": "uuid",
  "email": "user@example.com",
  "role": "admin|viewer|operator",
  "created_at": "2026-10-09T12:00:00Z",
  "status": "active|disabled"
}
```

## Default collection for the MVP

Use `market_events` as the primary collection for the current signal-only project. The rest are intended as the next logical collections as the system grows.

These collections should be created in the Firebase console, or with a Firebase admin bootstrap script, once the project is authenticated and the Firestore database exists.
