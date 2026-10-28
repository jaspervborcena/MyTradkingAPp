import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { firestore } from './firebase-admin';
import { AppConfigService } from './app-config.service';
import { BinanceMarketDataService } from './binance-market-data.service';
import { IndicatorService } from './indicator.service';
import { MarketDataLoggerService } from './market-data-logger.service';
import type { Candle, IndicatorSnapshot, MarketEvent, RiskProfile } from './market.types';
import { StrategyService } from './strategy.service';

@Injectable()
export class ScannerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ScannerService.name);
  private readonly lastLoggedOpenTime = new Map<string, number>();
  private profile: RiskProfile | undefined;
  private timer: NodeJS.Timeout | undefined;
  private scanning = false;

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly marketData: BinanceMarketDataService,
    private readonly dataLogger: MarketDataLoggerService,
    private readonly indicators: IndicatorService,
    private readonly strategies: StrategyService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const profileName = process.env.PROFILE;
    if (profileName) {
      this.profile = await this.loadProfile(profileName);
      if (!this.profile) {
        this.logger.log(`risk_profile_disabled profile_name=${profileName}`);
        return;
      }
      const maxPeriod = Math.max(this.profile.sma_slow, this.profile.rsi_period + 1);
      if (maxPeriod > this.appConfig.config.binance.candle_limit) {
        throw new Error('profile indicator periods cannot exceed Binance candle_limit');
      }
      this.logger.log(`risk_profile_loaded profile_name=${this.profile.profile_name} symbols=${this.profile.symbols.length}`);
    }

    if (process.env.SCAN_ONCE?.toLowerCase() === 'true') {
      this.logger.log('single_scan_started');
      await this.scanOnce();
      this.logger.log('single_scan_completed');
      return;
    }

    void this.scanOnce().catch(error => this.logScanFailure(error));
    this.timer = setInterval(() => {
      void this.scanOnce().catch(error => this.logScanFailure(error));
    }, this.appConfig.config.scanIntervalSeconds * 1000);
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async scanOnce(): Promise<void> {
    if (this.scanning) {
      this.logger.warn('market_scan_skipped reason=previous_scan_still_running');
      return;
    }
    this.scanning = true;
    try {
      const profile = this.profile;
      const symbols = profile?.symbols ?? this.appConfig.config.symbols;
      const strategies = profile
        ? [{
            name: 'trend_follow',
            enabled: true,
            min_confidence: profile.min_confidence_score / 100,
          }]
        : this.appConfig.config.strategies;

      for (const symbol of symbols) {
        try {
          await this.scanSymbol(symbol, profile, strategies);
        } catch (error) {
          this.logger.error(
            `market_scan_failed symbol=${symbol} error=${error instanceof Error ? error.message : String(error)}`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    } finally {
      this.scanning = false;
    }
  }

  private logScanFailure(error: unknown): void {
    this.logger.error(
      `market_scan_failed error=${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error.stack : undefined,
    );
  }

  private async scanSymbol(
    symbol: string,
    profile: RiskProfile | undefined,
    strategies: Array<{ name: string; enabled: boolean; min_confidence: number }>,
  ): Promise<void> {
    const candles = await this.marketData.fetchCandles(symbol);
    const now = new Date();
    const closedCandles = candles.filter(candle => Date.parse(candle.close_time) <= now.getTime());
    if (!closedCandles.length) {
      this.logger.warn(`no_closed_candle symbol=${symbol}`);
      return;
    }
    const candle = closedCandles[closedCandles.length - 1];
    const openTime = Date.parse(candle.open_time);
    if (openTime <= (this.lastLoggedOpenTime.get(symbol) ?? -Infinity)) {
      return;
    }

    const timeframe = this.appConfig.config.binance.timeframe;
    const observation: MarketEvent = {
      schema_version: 1,
      event_id: `binance:${symbol}:${timeframe}:${candle.open_time}`,
      captured_at: now.toISOString(),
      exchange: 'binance',
      symbol,
      timeframe,
      candle,
      ...(profile ? { profile_name: profile.profile_name } : {}),
    };
    await this.dataLogger.logObservation(observation);
    this.lastLoggedOpenTime.set(symbol, openTime);

    let snapshot: IndicatorSnapshot;
    try {
      snapshot = this.indicators.compute(
        candles,
        symbol,
        timeframe,
        profile?.sma_fast ?? 5,
        profile?.sma_slow ?? 20,
        profile?.rsi_period ?? 14,
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'Insufficient candles to compute configured indicators') {
        this.logger.warn(`indicator_computation_skipped symbol=${symbol} reason=insufficient_history`);
        return;
      }
      throw error;
    }

    for (const strategy of strategies) {
      const result = this.strategies.evaluate(snapshot, strategy);
      const event: MarketEvent = {
        schema_version: 1,
        event_id: `signal:${symbol}:${timeframe}:${now.toISOString()}`,
        event_type: 'signal',
        captured_at: now.toISOString(),
        symbol,
        timeframe,
        strategy: result.name,
        side: result.side,
        status: result.accepted ? 'accepted' : 'rejected',
        confidence: result.confidence,
        reasons: result.reasons,
        indicator_snapshot: snapshot,
        ...(profile
          ? {
              profile_name: profile.profile_name,
              strategy_parameters: {
                sma_fast: profile.sma_fast,
                sma_slow: profile.sma_slow,
                rsi_period: profile.rsi_period,
                min_confidence_score: profile.min_confidence_score,
                target_buy_spread_pct: profile.target_buy_spread_pct,
                target_sell_spread_pct: profile.target_sell_spread_pct,
                stop_loss_pct: profile.stop_loss_pct,
              },
            }
          : {}),
      };
      await this.dataLogger.logSignal(event);
    }
    this.logger.log(`market_observation_recorded symbol=${symbol} timeframe=${timeframe} open_time=${candle.open_time}`);
  }

  private async loadProfile(profileName: string): Promise<RiskProfile | undefined> {
    if (!['high', 'medium', 'slow'].includes(profileName)) {
      throw new Error('PROFILE must be high, medium, or slow');
    }
    if (!this.appConfig.config.firebase.enabled) {
      throw new Error('PROFILE requires Firestore to be enabled and available');
    }
    const snapshot = await firestore.collection('risk_profiles').doc(profileName).get();
    if (!snapshot.exists) {
      throw new Error(`Firestore document risk_profiles/${profileName} does not exist`);
    }
    const document = snapshot.data();
    if (!document || typeof document.enabled !== 'boolean') {
      throw new Error(`risk_profiles/${profileName}.enabled must be a boolean`);
    }
    if (!document.enabled) {
      return undefined;
    }
    if (document.profile_name !== undefined && document.profile_name !== profileName) {
      throw new Error(`risk_profiles/${profileName}.profile_name must match its document ID`);
    }
    if (
      !Array.isArray(document.symbols)
      || !document.symbols.length
      || document.symbols.some((symbol: unknown) =>
        typeof symbol !== 'string' || !symbol.trim() || /\s/.test(symbol))
      || new Set(document.symbols.map((symbol: string) => symbol.toUpperCase())).size !== document.symbols.length
    ) {
      throw new Error(`risk_profiles/${profileName}.symbols must be unique non-empty strings`);
    }
    const strategy = document.strategy;
    if (!strategy || typeof strategy !== 'object' || Array.isArray(strategy)) {
      throw new Error(`risk_profiles/${profileName}.strategy must be an object`);
    }
    const smaFast = this.positiveInteger(strategy.sma_fast, profileName, 'sma_fast');
    const smaSlow = this.positiveInteger(strategy.sma_slow, profileName, 'sma_slow');
    const rsiPeriod = this.positiveInteger(strategy.rsi_period, profileName, 'rsi_period');
    if (smaFast >= smaSlow) {
      throw new Error(`risk_profiles/${profileName}.strategy.sma_fast must be less than sma_slow`);
    }
    return {
      profile_name: profileName,
      symbols: document.symbols.map((symbol: string) => symbol.toUpperCase()),
      sma_fast: smaFast,
      sma_slow: smaSlow,
      rsi_period: rsiPeriod,
      min_confidence_score: this.number(strategy.min_confidence_score, profileName, 'min_confidence_score', 0, 100),
      target_buy_spread_pct: this.number(strategy.target_buy_spread_pct, profileName, 'target_buy_spread_pct', 0),
      target_sell_spread_pct: this.number(strategy.target_sell_spread_pct, profileName, 'target_sell_spread_pct', 0),
      stop_loss_pct: this.number(strategy.stop_loss_pct, profileName, 'stop_loss_pct', 0),
    };
  }

  private positiveInteger(value: unknown, profile: string, key: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      throw new Error(`risk_profiles/${profile}.strategy.${key} must be a positive integer`);
    }
    return value;
  }

  private number(
    value: unknown,
    profile: string,
    key: string,
    minimum: number,
    maximum?: number,
  ): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
      throw new Error(`risk_profiles/${profile}.strategy.${key} must be at least ${minimum}`);
    }
    if (maximum !== undefined && value > maximum) {
      throw new Error(`risk_profiles/${profile}.strategy.${key} must be at most ${maximum}`);
    }
    return value;
  }
}
