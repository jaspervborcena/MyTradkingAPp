# Binance credentials and Firebase access

The NestJS endpoint `GET /api/binance/account` reads the shared Binance credentials from Google Secret Manager and calls Binance's signed account-information endpoint. It does not submit orders or use trading endpoints.

## Secret names and project

The API reads the latest versions of these Secret Manager secrets:

- `BINANCE_API_KEY`
- `BINANCE_SECRET`

By default, the project ID comes from `config/firebase.json` (`jasperpos-dev`). Set `SECRET_MANAGER_PROJECT_ID` only if the secrets are stored in a different Google Cloud project. Secret IDs can be overridden with `BINANCE_API_KEY_SECRET_ID` and `BINANCE_SECRET_SECRET_ID`; do not set these to secret values.

## Runtime permissions

Enable the Secret Manager API in the project containing the secrets:

```powershell
gcloud services enable secretmanager.googleapis.com --project jasperpos-dev
```

Grant the deployed API's runtime service account access to only these two secrets. Replace the placeholder with the service account configured on the Cloud Run service that hosts the NestJS API:

```powershell
gcloud secrets add-iam-policy-binding BINANCE_API_KEY --project jasperpos-dev --member="serviceAccount:YOUR_RUNTIME_SERVICE_ACCOUNT" --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding BINANCE_SECRET --project jasperpos-dev --member="serviceAccount:YOUR_RUNTIME_SERVICE_ACCOUNT" --role="roles/secretmanager.secretAccessor"
```

For local development, use Application Default Credentials from an account that has Secret Accessor access to those secrets. Do not copy secret values into `.env`, source code, container build arguments, or logs.

## Firebase Auth gate

Requests to `/api/binance/*` must include a Firebase ID token in `Authorization: Bearer <id-token>`. The backend verifies the token, including revocation, against the Firebase project configured for the service. An authenticated Firebase user does not need a separate `users/{uid}/wallet/main` Firestore document.

Every authenticated user in that Firebase project can read balances from the same shared Binance account. Keep Firebase Auth user enrollment controlled accordingly. The Binance API key itself should have read-only permissions; do not enable withdrawals or trading permissions for this integration.

Example request (supply a short-lived Firebase ID token locally; never commit it):

```powershell
curl.exe -H "Authorization: Bearer $env:FIREBASE_ID_TOKEN" http://localhost:3000/api/binance/account
```

The service caches secret values in process memory after first use. Restart the service to pick up a newly rotated secret version.
