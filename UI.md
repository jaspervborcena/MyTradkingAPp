# Trading Dashboard UI TODO

## Goal

Build a dashboard for the scanner's **High**, **Medium**, and **Slow** risk profiles. The landing page is the **Overview**. The backend now supports manually confirmed Binance Spot market orders; any authenticated Firebase user can trade from the shared account, so the UI must clearly communicate that shared access and require review before submission. Automated trading, limit orders, withdrawals, and order history are not implemented.

The README describes the Angular dashboard as a separate project. Keep this file as the integration checklist for that frontend unless the project location or framework changes.

## Current Firestore State

- `app_config` is the global scanner pause/mode configuration. Its current function reads the first document in the collection; `enabled`, `mode`, and `interval_minutes` are configuration fields, and `last_run_at` is a Firestore Timestamp.
- `risk_profiles` contains `high`, `medium`, and `slow` documents. Each profile has its own `enabled`, optional `interval_minutes`/`last_run_at`, `symbols`, and nested `strategy` values.
- These risk profile documents are currently shared scanner configuration, not per-user preferences. A change to a profile affects the symbols and rules used by that scheduled profile for everyone.
- `market_events` is the live event collection, containing both observations and signals. Signals have `event_type: "signal"`; observations currently have a `candle` object but no `event_type`. Until normalized, identify observations by `candle` and signals by `event_type`.
- Event `captured_at`, candle times, and indicator values are written by Python as ISO-8601 strings. Do not assume they are Firestore Timestamp values. `app_config.last_run_at` and profile `last_run_at` are Firestore Timestamps.
- `market_observations`, `signals`, `trades`, and `users` are proposed future collections, not populated by the scanner. Do not build the UI as if they already contain data.
- The deployed scanner is in `test` mode and still reads Binance Spot Testnet data until the updated Cloud Run Job is deployed. The checked-in config now selects Binance's public production market-data endpoint for local runs and the next deployment. Neither source places orders. Accepted signals are not executed trades.

## Collections and Sample Documents

These examples describe the current frontend integration contract. Create these documents in Firestore for development; profile examples and thresholds are documented in detail in [docs/FIRESTORE_COLLECTIONS.md](docs/FIRESTORE_COLLECTIONS.md).

### `app_config/{documentId}`

The current scheduler reads the first document, so use one document for now. A stable document ID such as `scanner` is recommended for a future backend change.

```json
{
	"enabled": true,
	"mode": "test",
	"interval_minutes": 1,
	"last_run_at": "<Firestore Timestamp, managed by the scheduler>"
}
```

### `risk_profiles/high` (also `medium` and `slow`)

The profile document ID is the profile key. Use the full profile examples in the Firestore schema doc; the frontend should render the nested strategy values rather than hard-code them.

```json
{
	"profile_name": "high",
	"description": "High volatility assets with aggressive momentum thresholds",
	"enabled": true,
	"interval_minutes": 5,
	"last_run_at": "<Firestore Timestamp, managed by the scheduler>",
	"symbols": ["SOLUSDT", "AVAXUSDT"],
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

### `market_events` observation document

Observation documents currently have no `event_type`; use the `candle` field to identify them. Fields marked by the backend as profile-specific may be absent on older events.

```json
{
	"schema_version": 1,
	"event_id": "binance:SOLUSDT:1m:2026-10-10T17:14:00+00:00",
	"captured_at": "2026-10-10T17:15:00+00:00",
	"exchange": "binance",
	"symbol": "SOLUSDT",
	"timeframe": "1m",
	"profile_name": "high",
	"candle": {
		"open_time": "2026-10-10T17:14:00+00:00",
		"close_time": "2026-10-10T17:14:59+00:00",
		"open": 142.1,
		"high": 143.0,
		"low": 141.8,
		"close": 142.7,
		"volume": 1250.0
	}
}
```

### `market_events` signal document

`confidence` is stored from 0 to 1 (display as a percentage). `strategy_parameters` and `profile_name` are absent for legacy/local-config scans.

```json
{
	"schema_version": 1,
	"event_id": "signal:SOLUSDT:1m:2026-10-10T17:15:00+00:00",
	"event_type": "signal",
	"captured_at": "2026-10-10T17:15:00+00:00",
	"symbol": "SOLUSDT",
	"timeframe": "1m",
	"profile_name": "high",
	"strategy": "trend_follow",
	"side": "buy",
	"status": "accepted",
	"confidence": 0.785,
	"reasons": [],
	"indicator_snapshot": {
		"symbol": "SOLUSDT",
		"timeframe": "1m",
		"close": 142.7,
		"sma_fast": 142.5,
		"sma_slow": 140.0,
		"rsi": 68.4,
		"trend": "bullish",
		"confidence": 0.785
	},
	"strategy_parameters": {
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

The scanner currently writes no `trades` or user documents. Do not seed those collections with examples that could be mistaken for live data.

## Signal Defaults and Conditions

Use the **Medium** profile as the editable starter preset: `BTCUSDT` and `ETHUSDT`, 1-minute candles, SMA fast/slow `5`/`20`, RSI period `14`, and minimum confidence `60%`. The 1-minute timeframe is currently global in `config/binance.json`; it is not read from a profile document yet. High/Slow preset values and their example watchlists are in [docs/FIRESTORE_COLLECTIONS.md](docs/FIRESTORE_COLLECTIONS.md).

The current signal rule is:

- **BUY accepted:** latest close > fast SMA > slow SMA, and confidence meets the configured minimum.
- **SELL accepted:** latest close < fast SMA < slow SMA, and confidence meets the configured minimum.
- Otherwise, report hold/rejected; a rejected directional signal is not an actionable alert.

The controls that affect signal calculation now are the selected symbols, SMA fast/slow periods, RSI period, and minimum confidence. Target buy/sell spread and stop-loss values are currently stored as profile metadata only; do not present them as active signal conditions until their behavior is implemented and specified. Changing a profile affects the next scheduled scan, not a scan already running.

## Pages

### 1. Overview (Landing Page)

- [ ] Show scanner state from `app_config`: enabled/disabled, mode, configured interval, and last run time.
- [ ] Show the three profile states from `risk_profiles`: enabled/disabled, symbol count, strategy thresholds, and profile last-run time.
- [ ] Provide profile selection/filtering for Overview, Markets, and Signals; show a clear all-profiles state.
- [ ] Show data freshness: time since the newest market observation and newest signal.
- [ ] Show counts for observations and accepted/rejected signals in a selected time range.
- [ ] Show the latest BTCUSDT and ETHUSDT observations with candle time, close, and volume.
- [ ] Show the latest signals with symbol, side, strategy, confidence, status, and reasons.
- [ ] Treat only `status: "accepted"` BUY/SELL signals as actionable notifications; keep rejected results available for diagnostics.
- [ ] Link summary rows/cards to the corresponding filtered Markets or Signals page.
- [ ] Make stale data, disabled scanning, and missing configuration visually distinct from normal operation.

### 2. Markets

- [ ] Read observation events from `market_events` and display symbol, timeframe, candle close time, OHLC, and volume.
- [ ] Add profile, symbol, timeframe, and date-range filters.
- [ ] Provide a candle/price chart only after verifying the event timestamps and values are parsed correctly.
- [ ] Paginate results; do not load the full event history into the browser.
- [ ] Until observations have a consistent `event_type`, filter using the presence of `candle` and document this compatibility behavior.

### 3. Signals

- [ ] Read signal events from `market_events` where `event_type == "signal"`.
- [ ] Display captured time, symbol, timeframe, side, strategy, confidence, accepted/rejected status, reasons, and indicator snapshot.
- [ ] Add filters for profile, symbol, side, strategy, status, and date range.
- [ ] Display the effective strategy parameters when present; tolerate older signals without profile fields.
- [ ] Make it clear that a signal is analysis output, not an order or a promise of performance.
- [ ] Add Firestore indexes for the final filter and sort combinations once queries are chosen.

### 4. Trades

- [ ] Show the immediate response for a manually submitted Binance market order.
- [ ] Do not show mock trades as live data.
- [ ] Do not present idempotency records as an order-history API; a history endpoint is not implemented.

### 5. Users and Access

- [ ] Add Firebase Authentication before exposing dashboard data beyond a trusted development environment.
- [ ] Decide whether roles are stored as Firebase custom claims or in a protected `users` collection; the proposed `users` schema is not live functionality.
- [ ] Clearly communicate that every authenticated Firebase user can submit orders on the shared Binance account.
- [ ] Do not treat the UI confirmation as an access-control boundary; the backend accepts any authenticated Firebase user.
- [ ] Deny public reads and writes with Firestore Security Rules; never put service-account credentials in the browser.
- [ ] Defer user/role administration UI until the identity model and rules are tested.

### 6. System / Settings

- [ ] Show `app_config` state and the latest successful/failed scanner activity.
- [ ] Let the operator select one or more supported Binance Spot symbols for the chosen profile, with a search/select control and a visible active watchlist.
- [ ] Provide editable SMA fast/slow, RSI period, and minimum-confidence controls with the selected profile's defaults prefilled and validation before save.
- [ ] Show a preview of the resulting buy/sell conditions and clearly state they apply on the next scan.
- [ ] Restrict profile and scanner-setting writes to an authenticated admin/operator workflow, validate on the backend, and audit changes; never allow public Firestore writes.
- [ ] Keep spread and stop-loss controls hidden or clearly marked inactive until the backend uses them in signal logic.
- [ ] If controls to pause/resume scanning are added, restrict writes to authorized admins and audit changes.
- [ ] Explain that the Cloud Scheduler trigger runs every 5 minutes; `interval_minutes` is an additional minimum-interval gate, not a faster trigger.
- [ ] Link to operational logs or provide a concise error/freshness status without exposing credentials or sensitive infrastructure details.

## Backend and Data-Contract TODOs

- [ ] Normalize event shapes: add an explicit `event_type: "observation"` to observation events and keep `event_type: "signal"` on signal events.
- [ ] Ensure every scheduled event has `profile_name`; decide whether legacy events without a profile map to a named `default` profile or remain unassigned.
- [ ] Add a secured, validated way for the frontend to update a profile's watchlist and active strategy parameters; current profile documents are shared across users.
- [ ] Decide whether profiles should remain global operator settings or become per-user scanner configurations before supporting multiple dashboard users.
- [ ] Make timeframe profile-configurable if users should be able to change it; it is currently global Binance configuration.
- [ ] Define and implement how spread targets and stop-loss percentages affect a signal before exposing them as editable conditions.
- [ ] Validate selected symbols against Binance Spot's supported markets before scanning.
- [ ] Give `app_config` a stable document ID and update the scheduler to read that ID instead of `limit(1)`.
- [ ] Standardize time fields and confirm whether Firestore stores timestamps as Firestore Timestamp values or ISO strings. Migrate or support existing documents before relying on range queries.
- [ ] Decide whether the MVP continues using `market_events` as the single collection or later splits events into `market_observations` and `signals`. Avoid maintaining duplicate sources of truth.
- [ ] Add stable query fields and Firestore indexes for overview counts, filters, and pagination.
- [ ] Define retention and pagination limits for event history.
- [ ] Add and test Firestore Security Rules before connecting a public or hosted frontend.
- [ ] Add explicit UI-facing status/error records if `app_config.last_run_at` alone is insufficient to distinguish a successful run from a failed scan.

## Shared UI Requirements

- [ ] Provide loading, empty, error, permission-denied, and stale-data states on every data page.
- [ ] Use server-side Firestore filtering, ordering, and pagination for histories.
- [ ] Use a consistent timezone display and make the stored event time inspectable.
- [ ] Keep all pages responsive and accessible by keyboard; charts must have a tabular or textual equivalent.
- [ ] Avoid implying that accepted signals are executed trades.

## Suggested Build Order

1. [ ] Confirm the Angular project location, Firebase web app configuration, and authentication approach.
2. [ ] Implement authenticated read-only Firestore access and rules.
3. [ ] Build the Overview from `app_config` and `market_events`.
4. [ ] Add the risk-profile selector and profile summary from `risk_profiles`.
5. [ ] Build Markets and Signals views with profile filters and pagination.
6. [ ] Add the secured watchlist and active strategy editor after write validation and access rules are ready.
7. [ ] Normalize event types/timestamps and add indexes; remove temporary compatibility logic.
8. [ ] Add the System page and operational error/freshness visibility.
9. [ ] Add Trades and Users only after their backend schemas, data writers, and authorization rules exist.
10. [ ] Verify the dashboard with real Firestore data, denied-access tests, empty/error states, and desktop/mobile layouts.

## Overview Acceptance Checklist

- [ ] Opens first after login and clearly identifies scanner mode and enabled state.
- [ ] Shows when data was last updated and flags stale data.
- [ ] Shows live observation and signal summaries sourced from Firestore, not hard-coded samples.
- [ ] Clicking a summary takes the user to the relevant filtered page.
- [ ] A missing collection or permission error is explained without crashing the dashboard.
- [ ] Requires explicit review of market-order side, symbol, and amount before submit; no automated trading or profitability claims.
