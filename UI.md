# Trading Dashboard UI TODO

## Goal

Build a read-only, signal-only dashboard for the scanner. The landing page is the **Overview**. Do not add order placement or trade execution controls; those are not implemented by the backend.

The README describes the Angular dashboard as a separate project. Keep this file as the integration checklist for that frontend unless the project location or framework changes.

## Current Firestore State

- `market_events` is the live event collection. It contains both market observations and signal events.
- Signal documents have `event_type: "signal"`. Observation documents currently have candle data but may not have an `event_type`; identify them by their `candle` field until the schema is normalized.
- `app_config` is live and controls the scanner with fields such as `enabled`, `mode`, `interval_minutes`, and `last_run_at`.
- `market_observations`, `signals`, `trades`, and `users` are documented future collections, not currently populated by the scanner. Do not build the UI as if they already contain data.
- The scanner is in `test` mode, reads Binance Spot Testnet data, and does not place orders.

## Pages

### 1. Overview (Landing Page)

- [ ] Show scanner state from `app_config`: enabled/disabled, mode, configured interval, and last run time.
- [ ] Show data freshness: time since the newest market observation and newest signal.
- [ ] Show counts for observations and accepted/rejected signals in a selected time range.
- [ ] Show the latest BTCUSDT and ETHUSDT observations with candle time, close, and volume.
- [ ] Show the latest signals with symbol, side, strategy, confidence, status, and reasons.
- [ ] Link summary rows/cards to the corresponding filtered Markets or Signals page.
- [ ] Make stale data, disabled scanning, and missing configuration visually distinct from normal operation.

### 2. Markets

- [ ] Read observation events from `market_events` and display symbol, timeframe, candle close time, OHLC, and volume.
- [ ] Add symbol, timeframe, and date-range filters.
- [ ] Provide a candle/price chart only after verifying the event timestamps and values are parsed correctly.
- [ ] Paginate results; do not load the full event history into the browser.
- [ ] Until observations have a consistent `event_type`, filter using the presence of `candle` and document this compatibility behavior.

### 3. Signals

- [ ] Read signal events from `market_events` where `event_type == "signal"`.
- [ ] Display captured time, symbol, timeframe, side, strategy, confidence, accepted/rejected status, reasons, and indicator snapshot.
- [ ] Add filters for symbol, side, strategy, status, and date range.
- [ ] Make it clear that a signal is analysis output, not an order or a promise of performance.
- [ ] Add Firestore indexes for the final filter and sort combinations once queries are chosen.

### 4. Trades

- [ ] Keep this page marked **Not available** until the backend writes trade or paper-trade lifecycle records.
- [ ] Do not show mock trades as live data.
- [ ] When execution is explicitly approved and implemented, define the trade schema and access controls before connecting this page to `trades`.

### 5. Users and Access

- [ ] Add Firebase Authentication before exposing dashboard data beyond a trusted development environment.
- [ ] Decide whether roles are stored as Firebase custom claims or in a protected `users` collection; the proposed `users` schema is not live functionality.
- [ ] Define viewer and admin capabilities. Start with authenticated read-only access.
- [ ] Deny public reads and writes with Firestore Security Rules; never put service-account credentials in the browser.
- [ ] Defer user/role administration UI until the identity model and rules are tested.

### 6. System / Settings

- [ ] Show `app_config` state and the latest successful/failed scanner activity.
- [ ] Start with read-only settings display. If controls to pause/resume scanning are added, restrict writes to authorized admins and audit changes.
- [ ] Explain that the Cloud Scheduler trigger runs every 5 minutes; `interval_minutes` is an additional minimum-interval gate, not a faster trigger.
- [ ] Link to operational logs or provide a concise error/freshness status without exposing credentials or sensitive infrastructure details.

## Backend and Data-Contract TODOs

- [ ] Normalize event shapes: add an explicit `event_type: "observation"` to observation events and keep `event_type: "signal"` on signal events.
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
4. [ ] Build Markets and Signals views with filters and pagination.
5. [ ] Normalize event types/timestamps and add indexes; remove temporary compatibility logic.
6. [ ] Add the System page and operational error/freshness visibility.
7. [ ] Add Trades and Users only after their backend schemas, data writers, and authorization rules exist.
8. [ ] Verify the dashboard with real Firestore data, denied-access tests, empty/error states, and desktop/mobile layouts.

## Overview Acceptance Checklist

- [ ] Opens first after login and clearly identifies scanner mode and enabled state.
- [ ] Shows when data was last updated and flags stale data.
- [ ] Shows live observation and signal summaries sourced from Firestore, not hard-coded samples.
- [ ] Clicking a summary takes the user to the relevant filtered page.
- [ ] A missing collection or permission error is explained without crashing the dashboard.
- [ ] Contains no order placement, trade execution, or misleading profitability controls.
