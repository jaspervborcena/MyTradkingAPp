# Production Deployment Checklist

This checklist covers the background scanner runtime only. The scanner remains signal-only; it does not configure or deploy the separate Firebase Binance order API. See [docs/API.md](./API.md) for the manual live-order endpoint and its safeguards.

## 1. Pre-flight checks

- [ ] Confirm the repository is the source of truth and the code is clean.
- [ ] Verify NestJS tests and TypeScript compilation pass locally:
  ```powershell
  Set-Location backend
  npm ci
  npm test
  ```
- [ ] Verify the project is configured for signal-only mode.
- [ ] Confirm no exchange secrets, API keys, or Firebase service-account files are stored in the repo.
- [ ] Confirm the runtime is using testnet/public data only unless explicit production authorization is given.

## 2. Repository readiness

- [ ] Dockerfile exists and builds the app.
- [ ] Docker Compose is available for local smoke tests.
- [ ] `.dockerignore` excludes local caches and secrets.
- [ ] `config/*.json` contains only non-secret runtime settings.
- [ ] Confirm the scanner worker does not submit orders; live order configuration applies to the separate authenticated API.

## 3. Secret handling

- [ ] Store any deployment credentials in Google Secret Manager or a secure workload identity model.
- [ ] Do not commit `.env`, service-account JSON, or Binance/private keys.
- [ ] Ensure Firebase credentials are injected at runtime and never baked into the image.
- [ ] Keep the Firestore project ID and service identity separate from source-controlled config.
- [ ] Grant the API runtime identity Secret Accessor access only to the Binance secrets it needs; see [docs/SECRET_MANAGER.md](./SECRET_MANAGER.md).
- [ ] Confirm Binance API permissions match the deployed API scope. If manual order placement is enabled, Spot Trading permission is required and withdrawals must remain disabled.
- [ ] Confirm Firebase Auth enrollment is controlled: every authenticated user can place manual orders against the shared account when the order endpoint is enabled.

## 4. Local container validation

- [ ] Build the image:
  ```powershell
  docker build -t tradingapp .
  ```
- [ ] Run the container:
  ```powershell
  docker run --rm tradingapp
  ```
- [ ] Confirm startup logs show the app begins normally and exits gracefully on shutdown.
- [ ] Confirm local JSONL output files are created in `data/` without errors.

## 5. Cloud Run deployment

- [ ] Authenticate with Google Cloud:
  ```powershell
  gcloud auth login
  gcloud config set project jasperpos-dev
  ```
- [ ] Enable required APIs:
  ```powershell
  gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
  ```
- [ ] Create the image repository:
  ```powershell
  gcloud artifacts repositories create tradingapp-repo --repository-format=docker --location=us-central1
  ```
- [ ] Build and push the image:
  ```powershell
  gcloud builds submit --tag us-central1-docker.pkg.dev/jasperpos-dev/tradingapp-repo/tradingapp:latest .
  ```
- [ ] Deploy the service:
  ```powershell
  gcloud run deploy tradingapp --image us-central1-docker.pkg.dev/jasperpos-dev/tradingapp-repo/tradingapp:latest --platform managed --region us-central1 --allow-unauthenticated --memory 512Mi --cpu 1 --max-instances 1
  ```

## 6. Cloud Run safety checks

- [ ] Confirm this background worker remains signal-only and does not submit Binance orders.
- [ ] Confirm the startup interval is conservative and request pacing is safe.
- [ ] Confirm logs are structured and do not expose secrets.
- [ ] Confirm restart behavior is acceptable for a non-interactive worker.

## 7. Smoke tests after deployment

- [ ] Verify Cloud Run receives a successful container startup.
- [ ] Check log output for configuration load, startup, and market scan loops.
- [ ] Confirm scanner output is being written to local/app logs or Firestore where configured.
- [ ] Confirm no unauthorised external side effects are triggered.

## 8. Rollback and operations

- [ ] Keep a previous image tag available for rollback.
- [ ] Maintain a clear change log for config values and scanning intervals.
- [ ] Monitor Cloud Run errors and restart volume.
- [ ] Keep the scan cadence low enough to avoid exchange or Cloud quota issues.

## 9. Final sign-off

Only sign off for production deployment when all boxes above are checked and the scanner worker's signal-only behavior is documented. Live order capability belongs to the separate Binance API and requires the controls described in [docs/API.md](./API.md).
