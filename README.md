# Crypto Volatility Scanner

Python background service for scanning cryptocurrency markets, evaluating configurable strategies, and recording structured data for later analysis. The Angular dashboard will be built in a separate project and is out of scope here.

## Project Status

**Stage:** Phases 1 through 4 are in place; Phase 5 deployment scaffolding has started

### Done

- Agreed to build the Python background runner first; no Angular workspace in this repository.
- Confirmed the workspace is empty and the available local interpreter is Python 3.13.7.
- Established the intended first-release behavior: emit signals, but do not place live orders.
- Completed Phase 1: validated configuration, structured logging, async shutdown lifecycle, sample configs, and foundation tests.
- Completed Phase 2: public Binance spot klines, bounded retry and request pacing, closed-candle scanning, and local JSONL observations.
- Completed Phase 3: indicator calculations, trend and RSI-based confidence scoring, strategy evaluation, and rejected/accepted signal records.
- Completed Phase 4 foundation: versioned event models, JSONL event store, dedicated signal event schema, and a Firestore-ready sink for production persistence.
- Verified with `python -m unittest discover -s tests -v`: all 18 tests pass.

### Next

1. Add Docker/container documentation and deployment checks.
2. Validate the service in a container locally.
3. Document Cloud Run configuration and secret-handling requirements.
4. Finalize operations guidance for log retention, restart behavior, and production safety.

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
Configuration -> Async runner -> Binance market data -> Scanner -> Indicators
                                                   -> Strategy evaluation -> Risk checks
                                                                    -> Signal/event log
                                                                    -> Firestore
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

**Complete:** the service starts from the documented command, validates sample configuration, handles shutdown, and passes its config, logging, and lifecycle tests. The runner currently waits for shutdown; it does not yet fetch market data or scan assets.

### Phase 2: Market data and scanner

- [x] Add an exchange adapter for public Binance market data, with explicit testnet/production selection.
- [x] Fetch candle/market data asynchronously with serialized request pacing, timeouts, and bounded retry behavior.
- [x] Scan only configured assets and persist timestamped closed-candle observations to local JSONL.

**Complete:** all 11 unit tests pass with mocked exchange responses; live public testnet checks fetched 100 BTCUSDT candles and wrote observations for BTCUSDT and ETHUSDT. No credentials or order endpoints are used.

**Current defaults:** Binance Spot Testnet, symbols `BTCUSDT` and `ETHUSDT`, `1m` candles, 100 candles requested per symbol, and a 60-second scan interval. Change these in `config/binance.json`, `config/assets.json`, and `config/environment.json`. Production market-data access can be selected in config; order placement is not implemented.

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

**Complete:** tests verify event shape, local persistence, and a Firestore adapter contract; local JSONL remains the default test/development sink.

### Phase 5: Operations and deployment

- Default runtime mode is now `test` for the safe signal-only path.
- Add Docker build/run instructions, Cloud Run configuration, health behavior, and shutdown handling.
- Document secret provisioning with Google Cloud Secret Manager or service identity; never bake credentials into the image.
- Define operational limits such as request pacing, log retention, and restart behavior.

**Done when:** the container builds and runs locally, deployment steps are reproducible, and a Cloud Run smoke test can be performed without enabling live trading.

### Later, only after explicit approval

- Paper trading and order lifecycle simulation.
- Binance testnet order placement.
- Production order placement, with explicit authorization, safeguards, limits, and operational monitoring.
- Frontend integration in the separate Angular project.

## Decisions To Confirm

- **Indicators:** choose `pandas-ta` or TA-Lib based on Python 3.12+ and Cloud Run compatibility.
- **Markets:** current defaults are spot, `BTCUSDT`/`ETHUSDT`, `1m`, and 60 seconds; adjust if another market universe or cadence is intended.
- **Storage:** Firestore collection/event shape and retention expectations remain open; local JSONL currently records closed candles.
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

Start the background runner from the repository root. It connects to the configured public Binance market-data endpoint, scans the configured symbols, and appends closed-candle observations to `data/market_observations.jsonl`. It also writes signal events to `data/market_signals.jsonl` when a strategy evaluates. The default endpoint is Spot Testnet; no trading calls are made.

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

To smoke-test one public testnet request without starting the runner:

```powershell
python -c "import asyncio; from src.models.config import load_config; from src.services.binance_service import BinanceService; candles = asyncio.run(BinanceService(load_config().binance).fetch_candles('BTCUSDT')); print(f'Fetched {len(candles)} candles')"
```

## Firestore collection plan

For the Firebase-backed production design, see [docs/FIRESTORE_COLLECTIONS.md](docs/FIRESTORE_COLLECTIONS.md). The default MVP event stream is `market_events`, and the project is structured to expand into `market_observations`, `signals`, `trades`, and `users`.

## Firebase scheduled scan (recommended for production)

For a low-cost, low-risk schedule-based deployment, use Firebase Functions with Cloud Scheduler. The repository includes a prefixed function named `trading_scanMarket` in [functions/index.js](functions/index.js).

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

### 3. Deploy the function

```powershell
firebase deploy --only functions
```

The scheduler itself remains on a fixed Cloud Scheduler cadence, but the runtime behavior is controlled by the Firestore config document in the `app_config` collection. Update the `interval_minutes` value there to change the effective scan interval without redeploying the function. The function name is prefixed as `trading_scanMarket` so it is easy to locate in the Cloud Functions list.

Example Firestore document fields:

```json
{
  "interval_minutes": 15,
  "mode": "test",
  "enabled": true
}
```

The trigger can still be overridden with:

```powershell
$env:SCHEDULE_INTERVAL = "every 5 minutes"
firebase deploy --only functions
```

## Deploy to Google Cloud Run

For the final operational checklist, see [docs/DEPLOYMENT_CHECKLIST.md](docs/DEPLOYMENT_CHECKLIST.md).

The repo is prepared for a containerized deployment model, but Cloud Run configuration should be treated as a deployment step, not a secret-bearing source change.

### Prerequisites

- A Google Cloud project with billing enabled.
- `gcloud` installed and authenticated.
- The Cloud Run and Artifact Registry APIs enabled.
- A service account or ADC-based identity used by the container; never store raw secret files in the repo.

### 1. Set up the project

```powershell
gcloud auth login
gcloud config set project jasperpos-dev
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
```

### 2. Create a Docker repository

```powershell
gcloud artifacts repositories create tradingapp-repo --repository-format=docker --location=us-central1
```

### 3. Build and push the image

```powershell
gcloud builds submit --tag us-central1-docker.pkg.dev/jasperpos-dev/tradingapp-repo/tradingapp:latest .
```

### 4. Deploy to Cloud Run

```powershell
gcloud run deploy tradingapp --image us-central1-docker.pkg.dev/jasperpos-dev/tradingapp-repo/tradingapp:latest --platform managed --region us-central1 --allow-unauthenticated --memory 512Mi --cpu 1 --max-instances 1
```

### 5. Operational safety

- Keep secrets in Google Secret Manager or workload identity, not in the image or repository.
- Continue to keep order execution disabled by default.
- Use the public Binance testnet endpoint unless a later milestone explicitly authorizes production access.
- Always prefer the local JSONL sink for development and a Firestore-backed sink only when credentials are available through a secure project identity.

### 6. Health and restart behavior

- The service is designed to run as a long-lived background process and should be treated as a non-interactive worker.
- If the container exits, Cloud Run will restart it according to platform policy, but the service should still be configured with low-cost, low-risk market data polling.
- Keep the scan interval and request pacing conservative to avoid quota exhaustion.

> This repo is already structured for a signal-only background worker. It is not a live trading deployment and should not be marketed or configured as one without explicit authorization.
