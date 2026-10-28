# Crypto Volatility Scanner

NestJS service for scanning cryptocurrency markets, evaluating configurable strategies, and recording structured data for analysis. The separate Angular dashboard is not part of this repository.

## What it does

The service requests public Binance Spot candle data for configured symbols, evaluates only closed candles, calculates moving-average and RSI indicators, and writes versioned observation and signal events. The default configuration scans `BTCUSDT` and `ETHUSDT` using one-minute candles. It writes local JSONL files under `data/` and, when enabled, appends the same events to Firestore's `market_events` collection.

Signals are analysis output only. The scanner does not place orders or require Binance credentials for public market data. Existing JSONL history remains compatible: observations keep their `schema_version`, `event_id`, `captured_at`, and `candle` fields, and signals keep their versioned `indicator_snapshot` and decision fields.

The NestJS application exposes the existing Firebase-authenticated Binance endpoints and runs the scanner on the configured interval. For scheduled Firebase scans, `SCAN_ONCE=true` runs one scan and exits, with an optional `PROFILE=high|medium|slow` loaded from Firestore.

## Project layout

```text
backend/
  src/                    # NestJS API, scanner, Binance, indicators, and persistence
  test/                   # Node.js unit tests
config/                   # Non-secret JSON runtime configuration
data/                     # Local JSONL observations/signals (git-ignored)
functions/                # Firebase scheduled Cloud Run Job launcher
docs/                     # Deployment and Firestore documentation
Dockerfile
docker-compose.yml
```

Runtime settings are in `config/`: `environment.json` controls log/scan cadence, `binance.json` selects the public endpoint and candle parameters, `assets.json` lists symbols, `strategies.json` configures signal thresholds, and `firebase.json` controls Firestore persistence.

## Run locally

Requires Node.js 20 or newer.

```powershell
Set-Location backend
npm ci
npm test
npm run start:dev
```

The API listens on port 3000 by default; set `PORT` to override it. The scanner starts immediately and then follows `config/environment.json`. Local JSONL output is appended to `data/market_observations.jsonl` and `data/market_signals.jsonl`.

The repository root is also an npm workspace so Cloud Run source builds can detect the Node.js app. To build/start from the repository root, use `npm ci`, `npm run build`, and `npm start`.

Run one scan and exit:

```powershell
$env:SCAN_ONCE = "true"
npm run start:dev
```

For profile-driven scans, set `PROFILE` to `high`, `medium`, or `slow`; the process identity must have Firestore read access for `risk_profiles/{PROFILE}`. Firestore writes require the configured service identity and appropriate permissions. Do not add service-account keys to the repository.

The authenticated `GET /api/binance/account` endpoint reads its Binance credentials from Google Secret Manager. Configure the runtime identity and Firebase Auth access as described in [docs/SECRET_MANAGER.md](docs/SECRET_MANAGER.md). The API key must be read-only; the endpoint does not place orders.

## Docker

```powershell
docker build -t tradingapp .
docker run --rm -p 3000:3000 -v "${PWD}/data:/app/data" tradingapp
```

Or use Compose:

```powershell
docker compose up --build
```

To use the image as a one-shot Cloud Run Job, set `SCAN_ONCE=true`. The scheduled Firebase functions set `PROFILE` for each risk-profile execution.

## Firebase scheduled scans

The functions `trading_scanMarket_high`, `trading_scanMarket_medium`, and `trading_scanMarket_slow` submit one-shot executions to the shared Cloud Run Job `trading-market-scan`. They pass the profile name through `PROFILE`; the NestJS worker reads and validates the corresponding `risk_profiles/{PROFILE}` document before requesting market data.

```powershell
gcloud run jobs deploy trading-market-scan --source . --project jasperpos-dev --region asia-southeast1 --set-env-vars SCAN_ONCE=true --tasks 1 --max-retries 1 --task-timeout 540s
firebase deploy --only functions --project jasperpos-dev
```

The Firebase function also checks `app_config.enabled` and the profile's `enabled` and `interval_minutes` fields before starting a job. Grant the Cloud Run Job identity Firestore read/write permissions and the scheduled-function identity permission to execute the job. See [docs/FIRESTORE_COLLECTIONS.md](docs/FIRESTORE_COLLECTIONS.md) for collection and profile shapes and [docs/DEPLOYMENT_CHECKLIST.md](docs/DEPLOYMENT_CHECKLIST.md) for operational checks.

## Safety and configuration

- The scanner is read-only and uses public Binance market-data endpoints. No trading keys or order APIs are used.
- Keep secrets outside source control and use workload identity or Secret Manager for Firebase credentials.
- Keep signal generation separate from any future order-execution milestone.
- Binance environment, interval, and candle count are configured in `config/binance.json`; symbols and strategy settings are in `config/assets.json` and `config/strategies.json`.
- Firestore is enabled by the checked-in config. Use an authenticated runtime identity where remote persistence is expected.

This is a signal-only market scanner, not a live-trading system or financial advice.
