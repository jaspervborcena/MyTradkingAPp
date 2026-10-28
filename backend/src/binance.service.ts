import { createHash, createHmac } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import { AppConfigService } from './app-config.service';
import { BinanceSecretsService } from './binance-secrets.service';
import { firestore } from './firebase-admin';

export interface BinanceBalance {
  asset: string;
  free: number;
  locked: number;
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

@Injectable()
export class BinanceService {
  private readonly api = 'https://api.binance.com';

  constructor(
    private readonly secrets: BinanceSecretsService,
    private readonly appConfig: AppConfigService,
  ) {}

  async getUserStatus(uid: string): Promise<{ connected: boolean }> {
    const integration = await firestore.doc(`users/${uid}/integrations/binance`).get();
    return { connected: integration.exists && integration.data()?.['enabled'] === true };
  }

  async getAccount(): Promise<{ connected: true; balances: BinanceBalance[] }> {
    const credentials = await this.secrets.getCredentials();
    const payload = await this.fetchAccountPayload(credentials);

    const balances = payload.balances
      .filter((balance): balance is { asset: string; free: string; locked: string } =>
        typeof balance.asset === 'string'
        && typeof balance.free === 'string'
        && typeof balance.locked === 'string')
      .map(balance => ({
        asset: balance.asset,
        free: Number(balance.free),
        locked: Number(balance.locked),
      }))
      .filter(balance =>
        Number.isFinite(balance.free)
        && Number.isFinite(balance.locked)
        && (balance.free !== 0 || balance.locked !== 0))
      .sort((left, right) => right.free + right.locked - (left.free + left.locked))
      .slice(0, 100);

    return { connected: true, balances };
  }

  async placeMarketOrder(uid: string, input: unknown): Promise<BinanceMarketOrder> {
    if (!this.validateOrderConfig()) {
      throw new ServiceUnavailableException('Live Binance Spot orders are disabled by server configuration.');
    }

    const order = this.validateOrderInput(input);
    const requestHash = createHash('sha256')
      .update(JSON.stringify([uid, order.symbol, order.side, order.amount]))
      .digest('hex');
    const requestRef = firestore.collection('binance_order_requests').doc(order.clientOrderId);
    const reservation = await firestore.runTransaction(async transaction => {
      const existing = await transaction.get(requestRef);
      if (existing.exists) {
        const record = existing.data();
        if (record?.uid !== uid || record?.requestHash !== requestHash) {
          throw new ConflictException('This clientOrderId has already been used.');
        }
        if (record.status === 'completed' && record.response) {
          return record.response as BinanceMarketOrder;
        }
        throw new ConflictException(
          'This order request is already being processed or was not confirmed. Check Binance order history before submitting a new request.',
        );
      }

      transaction.create(requestRef, {
        uid,
        requestHash,
        symbol: order.symbol,
        side: order.side,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
      });
      return null;
    });

    if (reservation) {
      return { ...reservation, replayed: true };
    }

    let orderWasSubmitted = false;
    try {
      const credentials = await this.secrets.getCredentials();
      const account = await this.fetchAccountPayload(credentials);
      const baseAsset = order.symbol.slice(0, -4);
      const balanceAsset = order.side === 'BUY' ? 'USDT' : baseAsset;
      const freeBalance = account.balances.find(balance => balance.asset === balanceAsset)?.free;

      if (typeof freeBalance !== 'string' || compareDecimals(order.amount, freeBalance) > 0) {
        await this.updateOrderRequest(requestRef, 'rejected');
        throw new BadRequestException(
          `Order amount exceeds the available ${balanceAsset} balance.`,
        );
      }

      const parameters = new URLSearchParams({
        symbol: order.symbol,
        side: order.side,
        type: 'MARKET',
        newClientOrderId: order.clientOrderId,
        newOrderRespType: 'RESULT',
        recvWindow: '5000',
        timestamp: String(Date.now()),
      });
      parameters.set(order.side === 'BUY' ? 'quoteOrderQty' : 'quantity', order.amount);
      const signature = this.sign(parameters, credentials.apiSecret);
      parameters.set('signature', signature);

      orderWasSubmitted = true;
      let response: Response;
      try {
        response = await fetch(`${this.api}/api/v3/order`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-MBX-APIKEY': credentials.apiKey,
          },
          body: parameters.toString(),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new BadGatewayException(
          'Binance order submission timed out or could not be reached. Check Binance order history before retrying.',
        );
      }

      if (!response.ok) {
        await this.updateOrderRequest(requestRef, 'rejected');
        throw new BadGatewayException(
          `Binance rejected the market order (${response.status}). Check the symbol, balance, and API-key trading permission.`,
        );
      }

      const result = await this.parseOrderResponse(response, order);
      await this.updateOrderRequest(requestRef, 'completed', result);
      return { ...result, replayed: false };
    } catch (error) {
      if (!orderWasSubmitted && !(error instanceof BadRequestException)) {
        await this.updateOrderRequest(requestRef, 'rejected');
      }
      throw error;
    }
  }

  private validateOrderConfig(): boolean {
    return this.appConfig.config.trading.liveSpotOrdersEnabled;
  }

  private validateOrderInput(input: unknown): {
    symbol: string;
    side: 'BUY' | 'SELL';
    amount: string;
    clientOrderId: string;
  } {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Order body must be an object.');
    }

    const body = input as Record<string, unknown>;
    const allowedKeys = new Set([
      'symbol', 'side', 'quantity', 'quoteOrderQty', 'clientOrderId', 'confirm',
    ]);
    if (Object.keys(body).some(key => !allowedKeys.has(key))) {
      throw new BadRequestException('Order body contains unsupported fields.');
    }
    if (body.confirm !== true) {
      throw new BadRequestException('Set confirm to true after reviewing the order details.');
    }
    if (typeof body.symbol !== 'string' || !/^[A-Z0-9]{2,18}USDT$/.test(body.symbol)) {
      throw new BadRequestException('symbol must be an uppercase Binance Spot symbol quoted in USDT.');
    }
    const baseAsset = body.symbol.slice(0, -4);
    if (/(UP|DOWN|BULL|BEAR)$/.test(baseAsset)) {
      throw new BadRequestException('Leveraged token pairs are not supported.');
    }
    if (body.side !== 'BUY' && body.side !== 'SELL') {
      throw new BadRequestException('side must be BUY or SELL.');
    }
    if (
      typeof body.clientOrderId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.clientOrderId)
    ) {
      throw new BadRequestException('clientOrderId must be a UUID and must be unique for each new order.');
    }

    const amountField = body.side === 'BUY' ? 'quoteOrderQty' : 'quantity';
    const otherAmountField = body.side === 'BUY' ? 'quantity' : 'quoteOrderQty';
    if (otherAmountField in body) {
      throw new BadRequestException(`Use ${amountField} for a ${body.side} market order.`);
    }

    return {
      symbol: body.symbol,
      side: body.side,
      amount: parsePositiveDecimal(body[amountField], amountField),
      clientOrderId: body.clientOrderId,
    };
  }

  private async fetchAccountPayload(credentials: {
    apiKey: string;
    apiSecret: string;
  }): Promise<{ balances: Array<{ asset?: unknown; free?: unknown; locked?: unknown }> }> {
    const parameters = new URLSearchParams({
      recvWindow: '5000',
      timestamp: String(Date.now()),
    });
    const signature = this.sign(parameters, credentials.apiSecret);

    let response: Response;
    try {
      response = await fetch(
        `${this.api}/api/v3/account?${parameters.toString()}&signature=${signature}`,
        {
          headers: { 'X-MBX-APIKEY': credentials.apiKey },
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new BadGatewayException('Could not reach Binance to retrieve account data.');
    }

    if (!response.ok) {
      throw new BadGatewayException(`Binance rejected the account request (${response.status}).`);
    }

    let payload: { balances?: Array<{ asset?: unknown; free?: unknown; locked?: unknown }> };
    try {
      payload = await response.json() as typeof payload;
    } catch {
      throw new BadGatewayException('Binance returned an invalid account response.');
    }
    if (!Array.isArray(payload.balances)) {
      throw new BadGatewayException('Binance returned account data in an unexpected format.');
    }
    return payload as { balances: Array<{ asset?: unknown; free?: unknown; locked?: unknown }> };
  }

  private sign(parameters: URLSearchParams, apiSecret: string): string {
    return createHmac('sha256', apiSecret).update(parameters.toString()).digest('hex');
  }

  private async parseOrderResponse(
    response: Response,
    request: { symbol: string; side: 'BUY' | 'SELL'; clientOrderId: string },
  ): Promise<BinanceMarketOrder> {
    let payload: Record<string, unknown>;
    try {
      payload = await response.json() as Record<string, unknown>;
    } catch {
      throw new BadGatewayException(
        'Binance accepted the request but returned an unreadable response. Check Binance order history before retrying.',
      );
    }
    if (
      payload.symbol !== request.symbol
      || payload.side !== request.side
      || payload.type !== 'MARKET'
      || typeof payload.orderId !== 'number'
      || !Number.isSafeInteger(payload.orderId)
      || payload.orderId <= 0
      || payload.clientOrderId !== request.clientOrderId
      || typeof payload.status !== 'string'
      || typeof payload.executedQty !== 'string'
      || typeof payload.cummulativeQuoteQty !== 'string'
    ) {
      throw new BadGatewayException(
        'Binance may have accepted the order but returned unexpected data. Check Binance order history before retrying.',
      );
    }

    return {
      symbol: request.symbol,
      orderId: payload.orderId,
      clientOrderId: payload.clientOrderId,
      side: request.side,
      type: 'MARKET',
      status: payload.status,
      executedQty: payload.executedQty,
      cummulativeQuoteQty: payload.cummulativeQuoteQty,
      ...(typeof payload.transactTime === 'number' ? { transactTime: payload.transactTime } : {}),
      replayed: false,
    };
  }

  private async updateOrderRequest(
    requestRef: FirebaseFirestore.DocumentReference,
    status: 'rejected' | 'completed',
    response?: BinanceMarketOrder,
  ): Promise<void> {
    await requestRef.update({
      status,
      ...(response ? { response } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

function parsePositiveDecimal(value: unknown, field: string): string {
  if (
    typeof value !== 'string'
    || value.length > 38
    || !/^\d{1,20}(?:\.\d{1,18})?$/.test(value)
    || !/[1-9]/.test(value)
  ) {
    throw new BadRequestException(`${field} must be a positive decimal string.`);
  }
  return value;
}

function compareDecimals(left: string, right: string): number {
  if (right.length > 38 || !/^\d{1,20}(?:\.\d{1,18})?$/.test(right)) {
    throw new BadGatewayException('Binance returned an invalid available balance.');
  }
  const [leftWhole, leftFraction = ''] = left.split('.');
  const [rightWhole, rightFraction = ''] = right.split('.');
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftValue = BigInt(`${leftWhole}${leftFraction.padEnd(scale, '0')}`);
  const rightValue = BigInt(`${rightWhole}${rightFraction.padEnd(scale, '0')}`);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}
