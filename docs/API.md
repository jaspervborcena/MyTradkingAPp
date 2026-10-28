# NestJS API and UI integration

This document describes the HTTP API implemented in `backend/` and how an authenticated UI can call it. The API checks a user's Binance integration flag, reads balances, and supports manually confirmed Binance Spot market buy/sell orders. It does not provide automated strategy execution, limit orders, withdrawals, or market-signal query endpoints.

## Base URL

The deployed Firebase HTTPS function `binanceApi` in project `mytradingapp-50d29` is in `asia-east1`. Use this base URL in production:

```text
https://asia-east1-mytradingapp-50d29.cloudfunctions.net/binanceApi
```

For local development, start the backend and use:

```text
http://localhost:3000
```

Append the route path to the base URL, for example `/api/binance/account`. For standalone Cloud Run deployments, use that service's assigned URL instead. The scanner's Cloud Run Job is a separate process and is not the HTTP API base URL. Configure the base URL in the UI's environment configuration; do not hard-code it in shared components.

## Authentication

Every API endpoint requires a Firebase Authentication ID token:

```http
Authorization: Bearer <Firebase ID token>
```

The backend verifies the token with Firebase Admin, including checking revocation. A valid Firebase user in the configured Firebase project is accepted; no `users/{uid}/wallet/main` document is required. The decoded Firebase UID is used only by the status endpoint to find that user's integration setting.

Never put Firebase Admin credentials, Binance credentials, or service-account keys in the UI. The UI obtains a short-lived ID token from the Firebase client SDK and sends it to the API. The Binance credentials are fetched server-side from Secret Manager. See [SECRET_MANAGER.md](./SECRET_MANAGER.md) for runtime IAM setup.

## Endpoints

### `GET /ip`

Returns the public IP address observed by `api.ipify.org` when called from the function runtime:

```json
{
  "ip": "203.0.113.42"
}
```

Call `GET https://asia-east1-mytradingapp-50d29.cloudfunctions.net/binanceApi/ip` with a Firebase ID token in the `Authorization: Bearer <token>` header. Example:

```powershell
curl.exe -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" https://asia-east1-mytradingapp-50d29.cloudfunctions.net/binanceApi/ip
```

The endpoint returns JSON such as `{"ip":"203.0.113.42"}`. This diagnostic makes an outbound request to ipify and exposes the function's observed public egress IP.

This value is useful for diagnostics, but it does not prove that egress is fixed or guaranteed to match every Binance request. Firebase Cloud Functions do not automatically use a reserved static IP. To use a reserved address reliably, configure VPC egress through a Serverless VPC Access connector and Cloud NAT with that address, deploy the function with the corresponding connector and all-traffic egress, then verify the IP with this endpoint. Network policy and routing changes must be completed separately.

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

This endpoint requires a Binance API key with account-read permission.

### `POST /api/binance/order`

Submits one Binance Spot **market** order after checking the current free balance. This endpoint uses the server's shared Binance account. Every authenticated Firebase user in the project can submit orders against that same account; orders are not isolated by Firebase UID.

Live order placement is controlled by `config/trading.json`:

```json
{
  "live_spot_orders_enabled": true
}
```

The Binance API key must have Spot Trading permission for this endpoint to succeed. Keep withdrawals disabled. Do not enable this permission unless the shared-account access policy is understood and intended.

The UI must show the exact side, symbol, and amount and get explicit user confirmation before sending the request. This repository contains the API, not the separate Angular UI; a client-side confirmation screen still needs to be implemented in that UI. The API's `confirm: true` field is only a deliberate-submit requirement, not a security barrier: any authenticated user can call the endpoint directly.

Request a market buy using the amount of USDT to spend:

```http
POST /api/binance/order
Authorization: Bearer <Firebase ID token>
Content-Type: application/json
```

```json
{
  "symbol": "BTCUSDT",
  "side": "BUY",
  "quoteOrderQty": "25.00",
  "clientOrderId": "550e8400-e29b-41d4-a716-446655440000",
  "confirm": true
}
```

Request a market sell using the amount of the base asset to sell:

```json
{
  "symbol": "BTCUSDT",
  "side": "SELL",
  "quantity": "0.001",
  "clientOrderId": "550e8400-e29b-41d4-a716-446655440001",
  "confirm": true
}
```

Amounts must be positive decimal strings. Symbols must be uppercase USDT-quoted Spot pairs; leveraged-token pairs are rejected. Buy amounts are checked against free USDT, and sell quantities against the free balance of the base asset, immediately before submission. Binance applies its own market, precision, and minimum-notional filters. Market orders execute at available market prices; the final price may differ from the price shown during review.

Successful response:

```json
{
  "symbol": "BTCUSDT",
  "orderId": 123456789,
  "clientOrderId": "550e8400-e29b-41d4-a716-446655440000",
  "side": "BUY",
  "type": "MARKET",
  "status": "FILLED",
  "executedQty": "0.0005",
  "cummulativeQuoteQty": "25.00",
  "transactTime": 1793160000000,
  "replayed": false
}
```

Generate one UUID `clientOrderId` for each intentional order. A successful retry with the same ID and same Firebase UID returns the recorded result with `replayed: true`; it does not submit another order. Reusing an ID with different details or a request still pending returns `409 Conflict`. If a request times out or returns an unexpected response, check Binance order history before creating a new ID: the exchange may have accepted the order even though the API did not receive a usable response. Do not automatically retry with a new ID.

The idempotency record is stored in Firestore at `binance_order_requests/{clientOrderId}`. It records the Firebase UID, symbol, side, request hash, status, and successful response. It is for server-side replay protection; the UI should not use it as an order-history API.

## Errors

Errors use NestJS's standard JSON exception response. The UI should handle HTTP status codes rather than relying on one exact message string.

| HTTP status | Meaning | UI behavior |
|---|---|---|
| `401 Unauthorized` | Missing, invalid, expired, or revoked Firebase ID token | Refresh/sign in again, then retry once if appropriate. |
| `400 Bad Request` | Invalid order fields, missing `confirm: true`, or amount above free balance | Show the validation message and require the user to review before submitting a corrected order. |
| `409 Conflict` | Duplicate ID with different details, or the prior request is pending/uncertain | Do not retry automatically. Check Binance order history first. |
| `503 Service Unavailable` | Binance Secret Manager credentials are unavailable, empty, or inaccessible, or live orders are disabled in server config | Show a service-configuration message; don't ask the user to re-enter Binance credentials in the UI. |
| `502 Bad Gateway` | Binance could not be reached, rejected an order, or returned invalid data | For orders, do not automatically retry; first check Binance order history. |
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

The backend allows requests with `Authorization` and `Content-Type` headers and the `GET`, `POST`, and `OPTIONS` methods. Current browser origins allowed by the application are:

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

export interface BinanceMarketOrder {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET';
  status: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  transactTime?: number;
  replayed: boolean;
}

@Injectable({ providedIn: 'root' })
export class BinanceApiService {
  private readonly auth = inject(Auth);
  private readonly baseUrl = 'https://asia-east1-mytradingapp-50d29.cloudfunctions.net/binanceApi';

  async getStatus(): Promise<BinanceStatus> {
    return this.get<BinanceStatus>('/api/binance/status');
  }

  async getAccount(): Promise<BinanceAccount> {
    return this.get<BinanceAccount>('/api/binance/account');
  }

  async placeMarketOrder(order: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quoteOrderQty?: string;
    quantity?: string;
    clientOrderId: string;
  }, confirmedByUser: boolean): Promise<BinanceMarketOrder> {
    const user = this.auth.currentUser;
    if (!user) {
      throw new Error('Sign in before placing a Binance order.');
    }
    if (!confirmedByUser) {
      throw new Error('Review and confirm the order before submitting.');
    }

    const token = await user.getIdToken();
    const response = await fetch(`${this.baseUrl}/api/binance/order`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...order, confirm: confirmedByUser }),
    });
    return this.readResponse<BinanceMarketOrder>(response);
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

    return this.readResponse<T>(response);
  }

  private async readResponse<T>(response: Response): Promise<T> {
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

Before calling `placeMarketOrder`, render a review step with the symbol, side, and amount, and pass `true` only after the user explicitly confirms. Create a UUID once per new order and preserve it if retrying that same request. Never automatically resubmit an order after a timeout or uncertain response. Rejected requests also consume their ID; use a new UUID only for a newly reviewed order. For observable/async UI patterns, adapt the example to the project's existing HTTP client and error handling. Avoid logging authorization headers, ID tokens, or account responses. Treat `connected: false` from the status endpoint as “not enabled for this user”; treat account retrieval errors separately as service/API failures.

## UI flow

1. Sign in with Firebase Authentication.
2. Request `GET /api/binance/status` and render the per-user integration flag.
3. When the account panel is opened or refreshed, request `GET /api/binance/account`.
4. Show loading, empty, stale, and error states. Display each asset's free and locked quantities separately.
5. Do not infer USD/fiat valuation from the returned balances; the API does not provide prices or converted totals.
6. For a buy/sell, require a manual review of the exact symbol, side, and amount before submission. Show that the account is shared with every authenticated Firebase user.
7. Do not add a browser-side Binance client or expose the server's secrets.

The API currently has no endpoint for connecting a user's own Binance key, updating the Firestore integration flag, querying signals, limit orders, automated trading, withdrawals, or order history.
