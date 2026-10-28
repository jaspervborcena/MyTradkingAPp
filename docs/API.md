# NestJS API and UI integration

This document describes the HTTP API currently implemented in `backend/` and how an authenticated UI can call it. This is a read-only API: it can check a user's Binance integration flag and read balances from the server's shared Binance account. It does not expose order placement, trade execution, or market-signal query endpoints.

## Base URL

Use the URL of the deployed NestJS **Cloud Run service** in production, for example:

```text
https://YOUR_CLOUD_RUN_SERVICE-<region>.a.run.app
```

For local development, start the backend and use:

```text
http://localhost:3000
```

When deployed as the Firebase HTTPS function `binanceApi`, use:

```text
https://binanceapi-3evfzkw3na-uc.a.run.app
```

The function is deployed in `us-central1` in Firebase project `mytradingapp-50d29`. The route path is appended to the base, for example `...a.run.app/api/binance/account`. The equivalent Firebase URL is `https://us-central1-mytradingapp-50d29.cloudfunctions.net/binanceApi`. The scanner's Cloud Run Job is a separate process and is not the HTTP API base URL. Configure the base URL in the UI's environment configuration; do not hard-code it in shared components.

## Authentication

Every `/api/binance/*` endpoint requires a Firebase Authentication ID token:

```http
Authorization: Bearer <Firebase ID token>
```

The backend verifies the token with Firebase Admin, including checking revocation. A valid Firebase user in the configured Firebase project is accepted; no `users/{uid}/wallet/main` document is required. The decoded Firebase UID is used only by the status endpoint to find that user's integration setting.

Never put Firebase Admin credentials, Binance credentials, or service-account keys in the UI. The UI obtains a short-lived ID token from the Firebase client SDK and sends it to the API. The Binance credentials are fetched server-side from Secret Manager. See [SECRET_MANAGER.md](./SECRET_MANAGER.md) for runtime IAM setup.

## Endpoints

### `GET /api/binance/status`

Returns whether the signed-in Firebase user's Binance integration is enabled in Firestore.

Firestore lookup:

```text
users/{firebaseUid}/integrations/binance
```

The document's `enabled` field must be exactly `true`. A missing document or any other value returns `connected: false`; it does not provision or modify the document.

Example response:

```json
{
  "connected": true
}
```

The `connected` flag here represents the user's Firestore integration setting. It does not verify that Binance credentials work. Use `/api/binance/account` to check the shared server-side Binance connection.

### `GET /api/binance/account`

Reads the Binance account associated with the API's server-side `BINANCE_API_KEY` and `BINANCE_SECRET` Secret Manager secrets. All authorized Firebase users access the same shared Binance account.

Example response:

```json
{
  "connected": true,
  "balances": [
    {
      "asset": "BTC",
      "free": 0.125,
      "locked": 0
    },
    {
      "asset": "USDT",
      "free": 250,
      "locked": 10
    }
  ]
}
```

Only balances with a non-zero free or locked amount are returned. The array is capped at 100 entries and sorted by the numeric sum of the asset's free and locked quantities. These quantities are not converted to a common currency, so the UI must not present that ordering or sum as account value.

This endpoint requires a Binance API key that has account-read permission. Keep trading and withdrawal permissions disabled. The backend calls Binance's signed account-information endpoint only; it does not send orders.

## Errors

Errors use NestJS's standard JSON exception response. The UI should handle HTTP status codes rather than relying on one exact message string.

| HTTP status | Meaning | UI behavior |
|---|---|---|
| `401 Unauthorized` | Missing, invalid, expired, or revoked Firebase ID token | Refresh/sign in again, then retry once if appropriate. |
| `503 Service Unavailable` | Binance Secret Manager credentials are unavailable, empty, or inaccessible | Show a service-configuration message; don't ask the user to re-enter Binance credentials in the UI. |
| `502 Bad Gateway` | Binance could not be reached, rejected the request, or returned invalid account data | Show a temporary connection error and offer retry. |
| `500 Internal Server Error` | Unexpected backend/Firestore failure | Show a generic error and log a request/correlation ID if the UI has one. |

Example NestJS error:

```json
{
  "statusCode": 401,
  "message": "The Firebase ID token is invalid or expired.",
  "error": "Unauthorized"
}
```

## Browser CORS

The backend allows requests with `Authorization` and `Content-Type` headers and the `GET`/`OPTIONS` methods. Current browser origins allowed by the application are:

- Any `http://localhost:<port>` origin
- `https://mytradingapp-50d29.web.app`
- `https://mytradingapp-50d29.firebaseapp.com`

If the UI is hosted on another origin, add that exact origin to the backend's allowlist and redeploy. Do not solve CORS by allowing every production origin.

## Angular UI example

Inject the Firebase Auth instance and API base URL through the UI's normal providers/environment configuration. Request a current ID token immediately before each API call; do not store tokens in local storage yourself.

```typescript
import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';

export interface BinanceStatus {
  connected: boolean;
}

export interface BinanceBalance {
  asset: string;
  free: number;
  locked: number;
}

export interface BinanceAccount {
  connected: true;
  balances: BinanceBalance[];
}

@Injectable({ providedIn: 'root' })
export class BinanceApiService {
  private readonly auth = inject(Auth);
  private readonly baseUrl = 'https://YOUR_CLOUD_RUN_SERVICE-<region>.a.run.app';

  async getStatus(): Promise<BinanceStatus> {
    return this.get<BinanceStatus>('/api/binance/status');
  }

  async getAccount(): Promise<BinanceAccount> {
    return this.get<BinanceAccount>('/api/binance/account');
  }

  private async get<T>(path: string): Promise<T> {
    const user = this.auth.currentUser;
    if (!user) {
      throw new Error('Sign in before requesting Binance data.');
    }

    const token = await user.getIdToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => undefined) as
        | { message?: string }
        | undefined;
      throw new Error(error?.message ?? `API request failed (${response.status}).`);
    }
    return response.json() as Promise<T>;
  }
}
```

For observable/async UI patterns, adapt the example to the project's existing HTTP client and error handling. Avoid logging authorization headers, ID tokens, or account responses. Treat `connected: false` from the status endpoint as “not enabled for this user”; treat account retrieval errors separately as service/API failures.

## UI flow

1. Sign in with Firebase Authentication.
2. Request `GET /api/binance/status` and render the per-user integration flag.
3. When the account panel is opened or refreshed, request `GET /api/binance/account`.
4. Show loading, empty, stale, and error states. Display each asset's free and locked quantities separately.
5. Do not infer USD/fiat valuation from the returned balances; the API does not provide prices or converted totals.
6. Do not add a browser-side Binance client or expose the server's secrets.

The API currently has no endpoint for connecting a user's own Binance key, updating the Firestore integration flag, querying signals, or placing orders. Those features need explicit backend routes, authorization rules, and validation before the UI can use them.
