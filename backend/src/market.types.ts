export interface Candle {
  open_time: string;
  close_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorSnapshot {
  symbol: string;
  timeframe: string;
  close: number;
  sma_fast: number;
  sma_slow: number;
  rsi: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
}

export interface RiskProfile {
  profile_name: string;
  symbols: string[];
  sma_fast: number;
  sma_slow: number;
  rsi_period: number;
  min_confidence_score: number;
  target_buy_spread_pct: number;
  target_sell_spread_pct: number;
  stop_loss_pct: number;
}

export type MarketEvent = Record<string, unknown> & {
  schema_version: 1;
  event_id: string;
};
