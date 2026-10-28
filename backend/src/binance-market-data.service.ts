import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from './app-config.service';
import type { Candle } from './market.types';

export class MarketDataError extends Error {}

export interface Binance24HourTicker {
  lastPrice: number;
  openPrice: number;
  priceChangePercent: number;
  volume: number;
  closeTime: string;
}

interface RetryableMarketDataError extends Error {
  retryAfter?: number;
}

@Injectable()
export class BinanceMarketDataService {
  private readonly logger = new Logger(BinanceMarketDataService.name);
  private readonly baseUrl: string;
  private nextRequestAt = 0;
  private requestQueue: Promise<void> = Promise.resolve();

  constructor(private readonly appConfig: AppConfigService) {
    this.baseUrl = appConfig.config.binance.environment === 'testnet'
      ? 'https://testnet.binance.vision'
      : 'https://api.binance.com';
  }

  async fetchCandles(symbol: string): Promise<Candle[]> {
    const settings = this.appConfig.config.binance;
    const query = new URLSearchParams({
      symbol: symbol.toUpperCase(),
      interval: settings.timeframe,
      limit: String(settings.candle_limit),
    });
    const url = `${this.baseUrl}/api/v3/klines?${query.toString()}`;
    return this.parseCandles(await this.requestWithRetries(url));
  }

  async fetch24HourTicker(symbol: string): Promise<Binance24HourTicker> {
    const query = new URLSearchParams({ symbol: symbol.toUpperCase() });
    const url = `${this.baseUrl}/api/v3/ticker/24hr?${query.toString()}`;
    const payload = await this.requestWithRetries(url);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new MarketDataError('Binance returned an invalid 24-hour ticker');
    }

    const ticker = payload as Record<string, unknown>;
    const lastPrice = Number(ticker.lastPrice);
    const openPrice = Number(ticker.openPrice);
    const volume = Number(ticker.volume);
    const closeTime = Number(ticker.closeTime);
    if (
      !Number.isFinite(lastPrice) || lastPrice <= 0
      || !Number.isFinite(openPrice) || openPrice <= 0
      || !Number.isFinite(volume) || volume < 0
      || !Number.isFinite(closeTime) || closeTime <= 0
      || Number.isNaN(new Date(closeTime).getTime())
    ) {
      throw new MarketDataError('Binance returned invalid 24-hour ticker values');
    }

    return {
      lastPrice,
      openPrice,
      priceChangePercent: ((lastPrice - openPrice) / openPrice) * 100,
      volume,
      closeTime: new Date(closeTime).toISOString(),
    };
  }

  private async requestWithRetries(url: string): Promise<unknown> {
    const settings = this.appConfig.config.binance;
    for (let attempt = 0; attempt <= settings.max_retries; attempt += 1) {
      try {
        return await this.requestJson(url, settings.timeout_ms);
      } catch (error) {
        if (!(error instanceof Error) || !('retryAfter' in error)) {
          throw error;
        }
        const retryable = error as RetryableMarketDataError;
        if (attempt >= settings.max_retries) {
          throw new MarketDataError(
            `Binance request failed after ${attempt + 1} attempts: ${retryable.message}`,
          );
        }
        const delay = retryable.retryAfter ?? Math.min(2 ** attempt, 8);
        this.logger.warn(`binance_retry attempt=${attempt + 1} delay_seconds=${delay}`);
        await this.sleep(delay * 1000);
      }
    }
    throw new MarketDataError('Binance request exhausted retries');
  }

  private async requestJson(url: string, timeoutMs: number): Promise<unknown> {
    await this.waitForRateLimit();
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': 'crypto-volatility-scanner/1.0' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const retryable = new Error(`Binance network request failed: ${error instanceof Error ? error.message : String(error)}`) as RetryableMarketDataError;
      retryable.retryAfter = undefined;
      throw retryable;
    }

    if (!response.ok) {
      if (response.status === 418 || response.status === 429 || response.status >= 500) {
        const retryable = new Error(`Binance returned HTTP ${response.status}`) as RetryableMarketDataError;
        retryable.retryAfter = this.parseRetryAfter(response.headers.get('Retry-After'));
        throw retryable;
      }
      throw new MarketDataError(`Binance returned HTTP ${response.status}`);
    }
    try {
      return await response.json() as unknown;
    } catch {
      throw new MarketDataError('Binance returned an invalid JSON response');
    }
  }

  private async waitForRateLimit(): Promise<void> {
    const request = this.requestQueue.then(async () => {
      const delay = this.nextRequestAt - Date.now();
      if (delay > 0) {
        await this.sleep(delay);
      }
      this.nextRequestAt = Date.now() + 100;
    });
    this.requestQueue = request.catch(() => undefined);
    await request;
  }

  private parseCandles(payload: unknown): Candle[] {
    if (!Array.isArray(payload)) {
      throw new MarketDataError('Binance kline response must be an array');
    }

    const candles = payload.map((row, index): Candle => {
      if (!Array.isArray(row) || row.length < 7) {
        throw new MarketDataError(`Binance returned a malformed kline: row ${index} has fewer than seven fields`);
      }
      const timestampValues = [row[0], row[6]];
      const numericValues = row.slice(1, 6);
      const validNumericValue = (value: unknown): boolean =>
        (typeof value === 'number' || typeof value === 'string' && value.trim() !== '')
        && Number.isFinite(Number(value));
      if (![...timestampValues, ...numericValues].every(validNumericValue)) {
        throw new MarketDataError(`Binance returned a malformed kline: row ${index} has invalid numeric fields`);
      }
      const openTime = Number(row[0]);
      const closeTime = Number(row[6]);
      const [open, high, low, close, volume] = numericValues.map(Number);
      const openDate = new Date(openTime);
      const closeDate = new Date(closeTime);
      if (
        Number.isNaN(openDate.getTime())
        || Number.isNaN(closeDate.getTime())
        || Math.min(open, high, low, close) <= 0
        || volume < 0
        || high < Math.max(open, close, low)
        || low > Math.min(open, close, high)
      ) {
        throw new MarketDataError(`Binance returned a malformed kline: row ${index} has inconsistent OHLCV values`);
      }
      return {
        open_time: openDate.toISOString(),
        close_time: closeDate.toISOString(),
        open,
        high,
        low,
        close,
        volume,
      };
    });

    if (candles.some((candle, index) =>
      index > 0 && Date.parse(candles[index - 1].open_time) >= Date.parse(candle.open_time))) {
      throw new MarketDataError('Binance kline response is not in chronological order');
    }
    return candles;
  }

  private parseRetryAfter(value: string | null): number | undefined {
    if (!value) {
      return undefined;
    }
    const seconds = Number(value);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds);
    }
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? undefined : Math.max(0, (timestamp - Date.now()) / 1000);
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }
}
