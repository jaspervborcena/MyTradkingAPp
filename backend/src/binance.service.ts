import { createHmac } from 'node:crypto';
import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { firestore } from './firebase-admin';

export interface BinanceBalance {
  asset: string;
  free: number;
  locked: number;
}

@Injectable()
export class BinanceService {
  private readonly api = 'https://api.binance.com';

  async getUserStatus(uid: string): Promise<{ connected: boolean }> {
    const integration = await firestore.doc(`users/${uid}/integrations/binance`).get();
    return { connected: integration.exists && integration.data()?.['enabled'] === true };
  }

  async getAccount(): Promise<{ connected: true; balances: BinanceBalance[] }> {
    const apiKey = process.env.BINANCE_API_KEY;
    const apiSecret = process.env.BINANCE_SECRET;
    if (!apiKey || !apiSecret) {
      throw new ServiceUnavailableException('Binance API secrets are not configured on the server.');
    }

    const parameters = new URLSearchParams({
      recvWindow: '5000',
      timestamp: String(Date.now()),
    });
    const signature = createHmac('sha256', apiSecret)
      .update(parameters.toString())
      .digest('hex');

    let response: Response;
    try {
      response = await fetch(
        `${this.api}/api/v3/account?${parameters.toString()}&signature=${signature}`,
        {
          headers: { 'X-MBX-APIKEY': apiKey },
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
}
