# NestJS API and UI integration

This document describes the HTTP API implemented in `backend/` and how an authenticated UI can call it. The API checks a user's Binance integration flag, reads balances, supports manually confirmed Binance Spot market buy/sell orders, and provides informational OpenAI analysis of the signed-in user's watchlist. It does not provide automated strategy execution, limit orders, withdrawals, or market-signal query endpoints.

## Firebase region

All Firebase Functions APIs documented here are deployed in `asia-east1`. Use the Asia endpoint URLs below and initialize the Firebase Functions client with the explicit `asia-east1` region for callable functions. Do not rely on the Firebase SDK's default region.

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

### `GET /api/market-trends/tickers`

Returns validated Binance Spot 24-hour ticker data for USDT-quoted pairs, including each symbol's last price, 24-hour percentage change, base/quote volume, high, low, and close time. `source` is `Binance Spot` and `fetchedAt` is the server fetch time. The UI obtains the authenticated user's Firebase ID token and calls this endpoint through the `binanceApi` base URL:

```http
GET https://asia-east1-mytradingapp-50d29.cloudfunctions.net/binanceApi/api/market-trends/tickers
Authorization: Bearer <Firebase ID token>
```

Example response:

```json
{
  "source": "Binance Spot",
  "fetchedAt": "2026-10-28T12:00:00.000Z",
  "tickers": [
    {
      "symbol": "BTCUSDT",
      "lastPrice": 67000,
      "openPrice": 66000,
      "priceChangePercent": 1.5151515151515151,
      "volume": 123.45,
      "quoteVolume": 8250000,
      "highPrice": 67500,
      "lowPrice": 65500,
      "closeTime": "2026-10-28T12:00:00.000Z"
    }
  ]
}
```

This endpoint replaces the former third-party market-metadata request for the Market Trends ticker list. Binance Spot does not provide market capitalization, circulating supply, token categories, or recently-listed classifications; this response must not be presented as containing those fields.

### `POST /api/analysis/watchlist`

Analyzes symbols from the authenticated user's Firestore watchlist using fresh public Binance Spot data and the server-configured OpenAI model. The user identity always comes from the verified Firebase ID token; request bodies do not accept a UID.

The watchlist is read from `users/{firebaseUid}.watchlist`, an array of uppercase USDT Spot symbols. Omit `symbols` to analyze the full watchlist, or provide a non-empty selection of up to 20 symbols. Every requested symbol must already be in that user's watchlist.

The UI should call this NestJS HTTP endpoint (not the `getBinanceStatus` callable) using the `binanceApi` base URL from the [Base URL](#base-url) section:

```http
POST https://asia-east1-mytradingapp-50d29.cloudfunctions.net/binanceApi/api/analysis/watchlist
Authorization: Bearer <Firebase ID token>
Content-Type: application/json
```

```json
{
  "symbols": ["BTCUSDT", "ETHUSDT"]
}
```

The backend fetches Binance's 24-hour Spot ticker and configured interval klines, discards unclosed candles, then computes EMA 20, EMA 50, RSI 14, 24-hour percentage change, and 24-hour base-asset volume. If candles are unavailable or fewer than 50 closed candles are available, missing indicators are `null`; stale/missing data is marked and described rather than inferred. Numeric `supportingIndicators` and `dataFreshness` fields are backend-sourced facts. The model generates cautious explanations only; the result is informational, not financial advice, and is not a prediction or guarantee.

Successful responses have this shape:

```json
{
  "requestId": "server-generated-request-id",
  "generatedAt": "2026-10-28T12:00:00.000Z",
  "source": "Binance Spot",
  "timeframe": "1m",
  "informationalOnly": true,
  "overview": "A concise, cautious watchlist summary.",
  "results": [
    {
      "symbol": "BTCUSDT",
      "trend": "bullish",
      "momentumSummary": "Price and EMA structure indicate positive momentum.",
      "supportingIndicators": {
        "lastPrice": 67000,
        "change24hPercent": 1.25,
        "volume24h": 12345.6,
        "ema20": 66500,
        "ema50": 65000,
        "rsi14": 58.2,
        "latestCandleClose": 67000
      },
      "risks": ["Momentum can change quickly."],
      "timeframeSummaries": [
        { "timeframe": "1m", "summary": "Short-term trend is positive." }
      ],
      "explanation": "The latest price is above both computed moving averages.",
      "dataStatus": "complete",
      "dataFreshness": {
        "source": "Binance Spot",
        "fetchedAt": "2026-10-28T12:00:00.000Z",
        "tickerAsOf": "2026-10-28T12:00:00.000Z",
        "candlesAsOf": "2026-10-28T12:00:00.000Z",
        "stale": false,
        "candleCount": 500
      }
    }
  ]
}
```

`trend` is `bullish`, `neutral`, `bearish`, or `unavailable`; `dataStatus` is `complete` or `partial`. Indicator and ticker fields may be `null` when unavailable. Render the backend values and freshness metadata as supplied; do not treat model prose as authoritative market data.

This endpoint has a Firestore-backed limit of five requests per authenticated user per minute. It returns `400` for invalid input, an empty/missing watchlist, or symbols outside the user's watchlist; `401` for missing/invalid authentication; `429` when the request limit is exceeded; `502` when the upstream analysis fails; and `503` when analysis is not configured or required backend data services are unavailable. Client responses do not include upstream credentials or raw provider errors.

The Firebase function reads the `OPENAI_SECRET` Secret Manager secret and the backend reads `OPENAI_MODEL` as a server-side environment variable. The key must never be exposed to the UI. See [SECRET_MANAGER.md](./SECRET_MANAGER.md).

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

The Firebase callable function `getBinanceStatus` is also deployed in `asia-east1` for clients using the Firebase Functions SDK. It returns the same user-specific integration status and requires a signed-in Firebase user. The callable endpoint is:

```text
https://asia-east1-mytradingapp-50d29.cloudfunctions.net/getBinanceStatus
```

Invoke it with the Firebase Functions SDK, which attaches the current user's Firebase Auth token:

```typescript
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions(firebaseApp, 'asia-east1');
const getBinanceStatus = httpsCallable<void, BinanceStatus>(
  functions,
  'getBinanceStatus',
);
const result = await getBinanceStatus();
const status = result.data;
```

Initialize the client with `getFunctions(firebaseApp, 'asia-east1')`; do not rely on an SDK default or select another region. The callable is deployed in `asia-east1`, and requests sent to another region may fail. Do not fetch the callable URL directly; invoke it using `httpsCallable`, which uses Firebase's callable protocol and attaches the current user's Auth token.

This callable allows the hosted dashboard origin `https://tradingdashboard--mytradingapp-50d29.asia-east1.hosted.app`. It is only for checking status. For watchlist analysis, account reads, and orders, use the authenticated NestJS HTTP endpoints at the `binanceApi` base URL.

### Per-user Binance account callable used by the Portfolio UI

The Angular Portfolio UI uses the Firebase callable `getBinanceAccount` for the **signed-in user's own linked Binance account**. Invoke it with `httpsCallable` and the explicit `asia-east1` region; Firebase attaches the signed-in user's Auth context. Do not send a UID or credentials in the callable request.

The function reads the encrypted credentials at `users/{firebaseUid}/integrations/binance`, calls Binance Spot `GET /api/v3/account`, and returns non-zero balances. On a successful read it replaces the private sync snapshot at `users/{firebaseUid}/portfolio_binance_sync/current`:

```typescript
interface BinanceAccountSnapshot {
  connected: true;
  balances: Array<{ asset: string; free: number; locked: number }>;
  syncedAt: string;
}

const getBinanceAccount = httpsCallable<void, BinanceAccountSnapshot>(
  getFunctions(firebaseApp, 'asia-east1'),
  'getBinanceAccount',
);
const { data } = await getBinanceAccount();
```

Calling this function again (including the Portfolio page's **Refresh and sync** action) replaces the snapshot with the latest successful Binance account response. A failed request must be surfaced as an error; it must not clear or report the old snapshot as newly synced. The snapshot is separate from tracked Binance order lots and the simulated wallet. Binance account balances do not contain cost basis, so the UI must not derive a buy price or P&L from this response. Disconnecting the per-user Binance integration deletes the sync snapshot.

This callable uses the per-user credentials stored by the dashboard's `connectBinance` callable. It is not the NestJS shared-account endpoint below. Changes to Firebase callable source must be deployed with the Firebase Functions deployment for them to take effect.

### `GET /api/binance/account`

Reads the Binance account associated with the API's server-side `BINANCE_API_KEY` and `BINANCE_SECRET` Secret Manager secrets. All authorized Firebase users access the same shared Binance account.

This endpoint is separate from the per-user `getBinanceAccount` callable above. It reads a shared server-side account, does not update `users/{firebaseUid}/portfolio_binance_sync/current`, and should only be used by UI features explicitly labeled as the shared account.

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

The NestJS HTTP API allows requests with `Authorization` and `Content-Type` headers and the `GET`, `POST`, and `OPTIONS` methods. Its current browser origins are:

- Any `http://localhost:<port>` origin
- `https://mytradingapp-50d29.web.app`
- `https://mytradingapp-50d29.firebaseapp.com`
- `https://tradingdashboard--mytradingapp-50d29.asia-east1.hosted.app`

If the UI is hosted on another origin, add that exact origin to the backend's allowlist and redeploy. Do not solve CORS by allowing every production origin.

The `getBinanceStatus` Firebase callable has a separate CORS configuration in `functions/index.js`. Its allowed origin is listed above; updating the NestJS HTTP API allowlist does not change the callable's CORS policy.

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
