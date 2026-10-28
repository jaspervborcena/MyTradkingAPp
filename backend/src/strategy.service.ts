import { Injectable } from '@nestjs/common';
import type { StrategyConfig } from './app-config.service';
import type { IndicatorSnapshot } from './market.types';

@Injectable()
export class StrategyService {
  evaluate(snapshot: IndicatorSnapshot, strategy: StrategyConfig): {
    name: string;
    side: 'buy' | 'sell' | 'hold' | 'none';
    accepted: boolean;
    confidence: number;
    reasons: string[];
  } {
    if (!strategy.enabled) {
      return {
        name: strategy.name,
        side: 'none',
        accepted: false,
        confidence: snapshot.confidence,
        reasons: ['strategy is disabled'],
      };
    }

    const side = snapshot.trend === 'bullish'
      ? 'buy'
      : snapshot.trend === 'bearish'
        ? 'sell'
        : 'hold';
    const reasons: string[] = [];
    if (side === 'hold') {
      reasons.push('trend is neutral');
    } else if (snapshot.confidence < strategy.min_confidence) {
      reasons.push(
        `min_confidence not met: ${snapshot.confidence.toFixed(4)} < ${strategy.min_confidence.toFixed(4)}`,
      );
    }
    return {
      name: strategy.name,
      side,
      accepted: side !== 'hold' && reasons.length === 0,
      confidence: snapshot.confidence,
      reasons,
    };
  }
}
