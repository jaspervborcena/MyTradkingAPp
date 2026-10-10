# Crypto Volatility Scanner

Python background service for scanning cryptocurrency markets, evaluating configurable strategies, and recording structured data for later analysis. The Angular dashboard will be built in a separate project and is out of scope here.

## What the app does

This repository runs a read-only cryptocurrency market scanner. It requests public Binance Spot candle data for configured symbols, waits for candles to close, calculates trend indicators, evaluates enabled strategies, and records both market observations and accepted or rejected signal events. The current strategy uses 5- and 20-candle simple moving averages to identify a trend, RSI to estimate confidence, and a configured minimum-confidence threshold to decide whether a buy/sell signal is accepted. A signal is analysis output only; it is not an order.

With the checked-in configuration, it scans `BTCUSDT` and `ETHUSDT` using one-minute candles from Binance's public production Spot market-data endpoint. This is real market data and does not require an API key. It appends observations and signals to JSONL files under `data/`, and writes the same event types to Firestore's `market_events` collection when Firestore is enabled and credentials are available. Each scan handles the latest closed candle for each symbol; the local runner avoids logging the same candle twice during that process run.

The app can run as a local background process or as a one-shot Cloud Run Job submitted by the scheduled Firebase function. The local runner interval is configured in `config/environment.json`. In the scheduled deployment, `app_config` controls whether the function launches a scan and its minimum-interval gate; the scheduler itself triggers every five minutes. Binance endpoint, symbols, timeframe, and strategy thresholds are configured separately in `config/`. The checked-in config now selects production public market data; the already-deployed Cloud Run Job continues to use its previous testnet image until it is rebuilt and redeployed. Neither path places orders.

There is no frontend in this repository. The Angular dashboard is a separate planned project, and trade execution, paper-trade lifecycle tracking, and user administration are not implemented here.

## Project Status

**Stage:** Phases 1 through 4 are complete. Phase 5 is deployed and verified for scheduled, signal-only scanning with Firestore persistence.

### Done

- Agreed to build the Python background runner first; no Angular workspace in this repository.
- Confirmed the workspace is empty and the available local interpreter is Python 3.13.7.
- Established the intended first-release behavior: emit signals, but do not place live orders.
- Completed Phase 1: validated configuration, structured logging, async shutdown lifecycle, sample configs, and foundation tests.
- Completed Phase 2: public Binance spot klines, bounded retry and request pacing, closed-candle scanning, and local JSONL observations.
- Completed Phase 3: indicator calculations, trend and RSI-based confidence scoring, strategy evaluation, and rejected/accepted signal records.
- Completed Phase 4 foundation: versioned event models, JSONL event store, dedicated signal event schema, and a Firestore-ready sink for production persistence.
- Last full test run: 17 tests passed; one configuration test still expects Firestore to be disabled while the active runtime configuration enables it.
- Pushed the repository to GitHub on the `main` branch.
- Switched the Firebase default project to `jasperpos-dev`.
- Added the scheduled Firebase function named `trading_scanMarket`.
- Deployed the Python scanner as the Cloud Run Job `trading-market-scan` in `asia-southeast1`.
- Verified that scheduled scans write market observations and signals to the Firestore `market_events` collection.

### Current live configuration

The currently deployed scanner is enabled in test mode. It reads public Binance Spot Testnet market data and does not place orders. The checked-in `config/binance.json` now selects production public market data for local runs and the next Job deployment:

```json
{
  "enabled": true,
  "mode": "test",
  "interval_minutes": 1
}
```

Cloud Scheduler triggers the Firebase function every 5 minutes. `interval_minutes` is an additional Firestore gate; the effective scan frequency cannot be faster than the scheduler cadence.

### Current status

- Local Python app: working; one existing test assertion disagrees with the enabled Firebase config
- GitHub: synced and pushed
- Firebase project target: `jasperpos-dev`
- Cloud Scheduler: active, every 5 minutes
- Firebase functions: `trading_scanMarket_high`, `trading_scanMarket_medium`, and `trading_scanMarket_slow`, submit profile-specific executions of the Python Cloud Run Job
- Cloud Run Job: `trading-market-scan` in `asia-southeast1`
- Firestore: verified observation and signal documents in `market_events`
- Runtime model: signal-only test mode, no live trading enabled

### Next

1. Keep the scanner in test mode; no order execution is implemented.
2. Monitor `app_config.last_run_at`, Cloud Run Job logs, and `market_events` for ongoing runs.
3. Review provider and regional availability before changing the Binance endpoint or Job region.
4. Add any trading or production execution capability only as a separately reviewed and explicitly approved milestone.

## Scope

### In this repository

- Python 3.12+ asynchronous background process.
- Configurable Binance market-data access, supporting testnet and production endpoints.
- Volatility scanning and configurable strategy evaluation.
- Risk checks and auditable signal/trade-event models.
- Structured market, indicator, signal, and execution-event logging for future machine-learning analysis.
- Firebase Firestore persistence, with credentials supplied outside source control.
- Containerization and Google Cloud Run deployment guidance.

### Not in this repository

- Angular frontend or frontend workspace. It will be created in another project and can later read approved data from Firestore.
- Frontend access to Binance credentials or direct Binance API calls.
- Live order placement in the initial implementation unless explicitly approved as a separate milestone.

## Proposed Architecture

```text
Firestore app_config -> Firebase scheduled function -> Cloud Run Job (asia-southeast1)
                                                        -> Python scanner -> Binance Spot public market data
                                                        -> observations/signals -> Firestore market_events
```

Keep exchange access, persistence, indicator calculation, strategy evaluation, and orchestration behind separate modules so they can be tested independently. The runner should support graceful shutdown, bounded retries, and useful health/status logs; a failure in one market scan should not silently terminate the service.

## Repository Layout

```text
config/
  environment.json       # Non-secret runtime settings
  binance.json           # Endpoint and market-data settings; no API secrets
  firebase.json          # Firestore settings; no service-account key material
  strategies.json        # Strategy parameters and enablement
  assets.json            # Symbols/markets to scan
src/
  models/                # Configuration, market, strategy, trade, and log records
  services/              # Binance, Firestore, indicators, and data logging
  engines/               # Scanner, strategy, and (later) trading orchestration
  utils/                 # Application logging and risk controls
  main.py                # Background process entry point
tests/                   # Unit and integration tests
Dockerfile
requirements.txt
README.md
```

The Angular `frontend/` directory from the original outline is intentionally omitted. Keep tests and any packaging metadata needed to run them in this Python repository.

## Delivery Plan

### Phase 1: Runnable foundation

- [x] Establish package structure, dependency constraints, sample configuration, and test setup.
- [x] Load and validate configuration; fail early with actionable errors for invalid settings.
- [x] Add structured console logging and an asyncio runner with clean startup and shutdown.
- [x] Keep secrets out of checked-in JSON and logs.

**Complete:** the service starts from the documented command, validates configuration, handles shutdown, and provides the foundation used by the market scanner.

### Phase 2: Market data and scanner

- [x] Add an exchange adapter for public Binance market data, with explicit testnet/production selection.
- [x] Fetch candle/market data asynchronously with serialized request pacing, timeouts, and bounded retry behavior.
- [x] Scan only configured assets and persist timestamped closed-candle observations to local JSONL.

**Complete:** all 11 unit tests pass with mocked exchange responses; live public testnet checks fetched 100 BTCUSDT candles and wrote observations for BTCUSDT and ETHUSDT. No credentials or order endpoints are used.

**Current config:** Binance Spot production public market data, symbols `BTCUSDT` and `ETHUSDT`, `1m` candles, 100 candles requested per symbol, and a 300-second local runner interval. Change these in `config/binance.json`, `config/assets.json`, and `config/environment.json`. The existing Cloud Run Job remains on its deployed testnet image until redeployed; order placement is not implemented.

### Phase 3: Indicators, strategies, and risk

- [x] Select and document the indicator implementation (`pandas-ta` is used for Python 3.13 compatibility and Cloud-compatible operation).
- [x] Calculate indicators from validated candle data and evaluate JSON-configured strategies.
- [x] Apply risk checks before emitting an actionable signal; record rejected as well as accepted signals with reasons.
- [x] Keep the first release signal-only; do not send orders to Binance.

**Complete:** deterministic sample data produces expected indicator values and strategy outcomes, and tests cover accepted and rejected signal states.

### Phase 4: Persistence and analysis data

- [x] Define versioned event records for market observations, indicator snapshots, signals, and future trade lifecycle events.
- [x] Implement local structured-file logging as a reliable development/test sink and a Firestore-ready production sink.
- [x] Make writes timestamped, traceable, and structured for downstream analysis.

**Complete:** tests verify event shape, local persistence, and the Firestore adapter contract. Live scheduled runs have also been verified writing observations and signals to `market_events`; local JSONL remains available for development.

### Phase 5: Operations and deployment

- [x] Keep the runtime in `test` mode on the signal-only path.
- [x] Deploy a Firebase scheduled function that submits a one-shot Python Cloud Run Job.
- [x] Verify Binance testnet access and Firestore writes from the Job in `asia-southeast1`.
- [x] Use service identities for Firestore writes and Cloud Run Job execution; do not bake credentials into the image.
- [ ] Review log retention, alerting, and operational limits before treating the deployment as production-ready.

**Current result:** the Job builds, runs one scan per execution, and writes events without enabling live trading. Production readiness still requires an operational review.

### Later, only after explicit approval

- Paper trading and order lifecycle simulation.
- Binance testnet order placement.
- Production order placement, with explicit authorization, safeguards, limits, and operational monitoring.
- Frontend integration in the separate Angular project.

## Decisions To Confirm

- **Indicators:** `pandas-ta` is selected for Python 3.13 compatibility.
- **Markets:** checked-in config uses Binance Spot production public data for `BTCUSDT`/`ETHUSDT`, `1m` candles, and a 300-second local runner interval. The deployed Cloud Run Job remains on testnet until redeployed; scheduled Cloud scans are triggered every 5 minutes.
- **Storage:** observations and signal events are currently written to `market_events`; retention and future collection separation remain open.
- **Runtime configuration:** JSON files for non-secret settings; environment variables or managed identity for credentials and deployment-specific values.

## Safety and Configuration

- Default to no order execution. A configuration flag alone should not silently enable production trading.
- Use public endpoints for market-data-only operation; do not request or store exchange trading keys unless a later execution milestone is approved.
- Do not commit Firebase service-account keys, Binance secrets, tokens, or `.env` files.
- Validate symbols, numeric thresholds, and time intervals at startup. Use explicit limits and log why a signal was accepted or rejected.
- Treat this as software scaffolding, not financial advice or a profitability guarantee.

## Development Checks

The implementation should provide documented commands for installing dependencies, running tests, and launching the runner. At minimum, CI/local validation should cover unit tests, formatting/linting, and type checking if adopted. Exchange and Firestore tests should use mocks, testnet, or an emulator; routine tests must not submit live orders or write to production collections.

## Run Locally

Requires Python 3.12 or newer.

Run the tests:

```powershell
python -m unittest discover -s tests -v
```

Start the background runner from the repository root. It connects to the configured public Binance market-data endpoint, scans the configured symbols, and appends closed-candle observations to `data/market_observations.jsonl`. It also writes signal events to `data/market_signals.jsonl` when a strategy evaluates. The checked-in endpoint is Spot production; only public market data is requested, and no trading calls are made.

```powershell
python -m src.main
```

Run with Docker:

```powershell
docker build -t tradingapp .
docker run --rm tradingapp
```

Or with Docker Compose:

```powershell
docker compose up --build
```

To smoke-test one public production-market-data request without starting the runner:

```powershell
python -c "import asyncio; from src.models.config import load_config; from src.services.binance_service import BinanceService; candles = asyncio.run(BinanceService(load_config().binance).fetch_candles('BTCUSDT')); print(f'Fetched {len(candles)} candles')"
```

## Firestore collection plan

For the Firebase-backed production design, see [docs/FIRESTORE_COLLECTIONS.md](docs/FIRESTORE_COLLECTIONS.md). The default MVP event stream is `market_events`, and the project is structured to expand into `market_observations`, `signals`, `trades`, and `users`.

## Firebase scheduled scan

For a low-cost, low-risk schedule-based deployment, use Firebase Functions with Cloud Scheduler. The repository includes a prefixed function named `trading_scanMarket` in [functions/index.js](functions/index.js).

The scheduled functions `trading_scanMarket_high`, `trading_scanMarket_medium`, and `trading_scanMarket_slow` submit one-shot Python executions to the shared Cloud Run Job `trading-market-scan`, passing the corresponding `PROFILE` override. Each execution loads `risk_profiles/{PROFILE}` from Firestore before requesting Binance data. The Job is deployed in `asia-southeast1` because Binance testnet returned HTTP 451 from `us-central1`. Keep the Job's runtime identity authorized for Firestore reads and writes and the function identity authorized to execute Cloud Run Jobs. See [docs/FIRESTORE_COLLECTIONS.md](docs/FIRESTORE_COLLECTIONS.md) for the profile schema.

### 1. Install Firebase tools

```powershell
gcloud auth login
npm install -g firebase-tools
```

### 2. Initialize the Firebase project

```powershell
firebase login
firebase use jasperpos-dev
```

### 3. Deploy the scanner Job and function

```powershell
gcloud run jobs deploy trading-market-scan --source . --project jasperpos-dev --region asia-southeast1 --set-env-vars SCAN_ONCE=true --tasks 1 --max-retries 1 --task-timeout 540s
firebase deploy --only functions --project jasperpos-dev
```

The live scheduler runs every 5 minutes. `app_config.enabled` is a global pause switch; each `risk_profiles/{high|medium|slow}` document independently controls its scan with `enabled` and optional `interval_minutes`. Keep `mode` set to `test`. The effective cadence cannot exceed the Cloud Scheduler cadence.

Example Firestore document fields:

```json
{
  "enabled": true,
  "mode": "test",
  "interval_minutes": 1
}
```

The Job runtime identity needs Firestore write access, and the function runtime identity needs permission to execute Cloud Run Jobs. Keep the Job in a region where the configured market-data endpoint is reachable; Binance testnet returned HTTP 451 from `us-central1` in this deployment.

The trigger can still be overridden with:

```powershell
$env:SCHEDULE_INTERVAL = "every 5 minutes"
firebase deploy --only functions
```

## Cloud Run Job operations

For the final operational checklist, see [docs/DEPLOYMENT_CHECKLIST.md](docs/DEPLOYMENT_CHECKLIST.md).

The scanner runs as a one-shot Cloud Run Job, not as an unauthenticated, long-running web service. `SCAN_ONCE=true` makes the container scan once and exit. Rebuild and deploy the Job after changing Python code or dependencies, then deploy the Firebase function if its code changes.

List recent executions:

```powershell
gcloud run jobs executions list --job=trading-market-scan --project jasperpos-dev --region asia-southeast1
```

Read scanner logs:

```powershell
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="trading-market-scan" AND resource.labels.location="asia-southeast1"' --project jasperpos-dev --limit 50
```

### Operational safety

- Keep secrets in Google Secret Manager or workload identity, not in the image or repository.
- Continue to keep order execution disabled by default.
- Use only public market-data endpoints for scanning. Production market data is unauthenticated; keep trading endpoints and order placement disabled unless separately approved.
- The Job uses its service identity for Firestore writes; do not add service-account key files to the repository.
- Keep request pacing and scheduled frequency conservative.

> This is a signal-only market scanner, not a live trading deployment. It does not place orders.
