import { Injectable } from '@nestjs/common';
import type { Candle, IndicatorSnapshot } from './market.types';

@Injectable()
export class IndicatorService {
  computeWatchlist(candles: Candle[]): {
    latestClose: number | null;
    latestCandleCloseTime: string | null;
    ema20: number | null;
    ema50: number | null;
    rsi14: number | null;
  } {
    const closes = candles.map(candle => candle.close);
    return {
      latestClose: closes.at(-1) ?? null,
      latestCandleCloseTime: candles.at(-1)?.close_time ?? null,
      ema20: closes.length >= 20 ? this.ema(closes, 20) : null,
      ema50: closes.length >= 50 ? this.ema(closes, 50) : null,
      rsi14: closes.length >= 15 ? this.rsi(closes, 14) : null,
    };
  }

  compute(
    candles: Candle[],
    symbol: string,
    timeframe: string,
    smaFast = 5,
    smaSlow = 20,
    rsiPeriod = 14,
  ): IndicatorSnapshot {
    if (smaFast <= 0 || smaSlow <= smaFast || rsiPeriod <= 0) {
      throw new Error('Indicator periods must be positive and sma_fast must be less than sma_slow');
    }
    if (candles.length < Math.max(smaSlow, rsiPeriod + 1)) {
      throw new Error('Insufficient candles to compute configured indicators');
    }

    const closes = candles.map(candle => candle.close);
    const fastAverage = this.average(closes.slice(-smaFast));
    const slowAverage = this.average(closes.slice(-smaSlow));
    const rsi = this.rsi(closes, rsiPeriod);
    const lastClose = closes[closes.length - 1];
    let trend: IndicatorSnapshot['trend'] = 'neutral';
    let confidence = 0;
    if (lastClose > fastAverage && fastAverage > slowAverage) {
      trend = 'bullish';
      confidence = Math.max(0, Math.min(1, 0.5 + (rsi - 50) / 50));
    } else if (lastClose < fastAverage && fastAverage < slowAverage) {
      trend = 'bearish';
      confidence = Math.max(0, Math.min(1, 0.5 + (50 - rsi) / 50));
    }

    return {
      symbol,
      timeframe,
      close: lastClose,
      sma_fast: fastAverage,
      sma_slow: slowAverage,
      rsi,
      trend,
      confidence,
    };
  }

  private average(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private ema(values: number[], period: number): number {
    let ema = this.average(values.slice(0, period));
    const multiplier = 2 / (period + 1);
    for (const value of values.slice(period)) {
      ema = (value - ema) * multiplier + ema;
    }
    return ema;
  }

  private rsi(closes: number[], period: number): number {
    let averageGain = 0;
    let averageLoss = 0;
    for (let index = 1; index <= period; index += 1) {
      const change = closes[index] - closes[index - 1];
      averageGain += Math.max(change, 0);
      averageLoss += Math.max(-change, 0);
    }
    averageGain /= period;
    averageLoss /= period;
    for (let index = period + 1; index < closes.length; index += 1) {
      const change = closes[index] - closes[index - 1];
      averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
      averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    }
    if (averageLoss === 0) {
      return averageGain === 0 ? 50 : 100;
    }
    const relativeStrength = averageGain / averageLoss;
    return 100 - 100 / (1 + relativeStrength);
  }
}
