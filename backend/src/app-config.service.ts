import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface BinanceConfig {
  environment: 'testnet' | 'production';
  timeframe: string;
  candle_limit: number;
  timeout_ms: number;
  max_retries: number;
}

export interface StrategyConfig {
  name: string;
  enabled: boolean;
  min_confidence: number;
}

export interface AppConfig {
  appEnvironment: string;
  logLevel: string;
  scanIntervalSeconds: number;
  trading: { liveSpotOrdersEnabled: boolean };
  binance: BinanceConfig;
  firebase: { enabled: boolean; project_id: string | null };
  strategies: StrategyConfig[];
  symbols: string[];
}

const ROOT_DIR = resolve(__dirname, '../../');

@Injectable()
export class AppConfigService {
  readonly rootDir = process.env.APP_ROOT ?? ROOT_DIR;
  readonly dataDir = resolve(this.rootDir, 'data');
  readonly config: AppConfig;

  constructor() {
    const configDir = process.env.CONFIG_DIR ?? resolve(this.rootDir, 'config');
    const environment = this.readObject(configDir, 'environment.json');
    const binance = this.readObject(configDir, 'binance.json');
    const trading = this.readObject(configDir, 'trading.json');
    const firebase = this.readObject(configDir, 'firebase.json');
    const strategiesDocument = this.readObject(configDir, 'strategies.json');
    const assetsDocument = this.readObject(configDir, 'assets.json');

    this.assertKeys(environment, 'environment.json', [
      'app_environment',
      'log_level',
      'scan_interval_seconds',
    ]);
    this.assertKeys(binance, 'binance.json', [
      'environment',
      'market_type',
      'timeframe',
      'candle_limit',
      'timeout_ms',
      'max_retries',
    ]);
    this.assertKeys(trading, 'trading.json', ['live_spot_orders_enabled']);
    this.assertKeys(firebase, 'firebase.json', ['enabled', 'project_id']);
    this.assertKeys(strategiesDocument, 'strategies.json', ['strategies']);
    this.assertKeys(assetsDocument, 'assets.json', ['symbols']);

    const appEnvironment = environment.app_environment;
    if (
      typeof appEnvironment !== 'string'
      || !['development', 'test', 'production'].includes(appEnvironment)
    ) {
      throw new Error('environment.json app_environment must be development, test, or production');
    }
    if (
      typeof environment.log_level !== 'string'
      || !['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'].includes(environment.log_level.toUpperCase())
    ) {
      throw new Error('environment.json log_level must be a standard logging level');
    }
    const scanIntervalSeconds = environment.scan_interval_seconds;
    this.assertPositiveInteger(scanIntervalSeconds, 'environment.json scan_interval_seconds');
    const binanceEnvironment = binance.environment;
    if (binanceEnvironment !== 'testnet' && binanceEnvironment !== 'production') {
      throw new Error('binance.json environment must be testnet or production');
    }
    if (binance.market_type !== 'spot') {
      throw new Error('binance.json market_type must be spot');
    }
    if (typeof trading.live_spot_orders_enabled !== 'boolean') {
      throw new Error('trading.json live_spot_orders_enabled must be a boolean');
    }
    const timeframes = new Set([
      '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M',
    ]);
    const timeframe = binance.timeframe;
    if (typeof timeframe !== 'string' || !timeframes.has(timeframe)) {
      throw new Error('binance.json timeframe must be a supported Binance kline interval');
    }
    const candleLimit = binance.candle_limit;
    if (
      typeof candleLimit !== 'number'
      || !Number.isInteger(candleLimit)
      || candleLimit < 2
      || candleLimit > 1000
    ) {
      throw new Error('binance.json candle_limit must be an integer between 2 and 1000');
    }
    const timeoutMs = binance.timeout_ms;
    this.assertPositiveInteger(timeoutMs, 'binance.json timeout_ms');
    const maxRetries = binance.max_retries;
    if (typeof maxRetries !== 'number' || !Number.isInteger(maxRetries) || maxRetries < 0) {
      throw new Error('binance.json max_retries must be a non-negative integer');
    }
    if (typeof firebase.enabled !== 'boolean') {
      throw new Error('firebase.json enabled must be a boolean');
    }
    const projectId = firebase.project_id;
    if (projectId !== null && (typeof projectId !== 'string' || !projectId.trim())) {
      throw new Error('firebase.json project_id must be a non-empty string or null');
    }
    if (firebase.enabled && (typeof projectId !== 'string' || !projectId)) {
      throw new Error('firebase.json project_id is required when Firestore is enabled');
    }
    const configuredStrategies = strategiesDocument.strategies;
    if (!Array.isArray(configuredStrategies)) {
      throw new Error('strategies.json strategies must be an array');
    }
    const strategies = configuredStrategies.map((strategy: unknown, index: number) => {
      if (!strategy || typeof strategy !== 'object' || Array.isArray(strategy)) {
        throw new Error(`strategies.json strategies[${index}] must be an object`);
      }
      const item = strategy as Record<string, unknown>;
      if (typeof item.name !== 'string' || !item.name.trim()) {
        throw new Error(`strategies.json strategies[${index}].name must be a non-empty string`);
      }
      if (typeof item.enabled !== 'boolean') {
        throw new Error(`strategies.json strategies[${index}].enabled must be a boolean`);
      }
      if (
        typeof item.min_confidence !== 'number'
        || !Number.isFinite(item.min_confidence)
        || item.min_confidence < 0
      ) {
        throw new Error(`strategies.json strategies[${index}].min_confidence must be a non-negative number`);
      }
      return {
        name: item.name,
        enabled: item.enabled,
        min_confidence: item.min_confidence,
      };
    });
    const symbols = assetsDocument.symbols;
    if (
      !Array.isArray(symbols)
      || !symbols.every((symbol: unknown): symbol is string =>
        typeof symbol === 'string' && Boolean(symbol.trim()))
    ) {
      throw new Error('assets.json symbols must be unique, non-empty strings');
    }
    if (new Set(symbols.map(symbol => symbol.toUpperCase())).size !== symbols.length) {
      throw new Error('assets.json symbols must be unique, non-empty strings');
    }

    this.config = {
      appEnvironment,
      logLevel: environment.log_level.toUpperCase(),
      scanIntervalSeconds,
      trading: {
        liveSpotOrdersEnabled: trading.live_spot_orders_enabled,
      },
      binance: {
        environment: binanceEnvironment,
        timeframe,
        candle_limit: candleLimit,
        timeout_ms: timeoutMs,
        max_retries: maxRetries,
      },
      firebase: {
        enabled: firebase.enabled,
        project_id: projectId,
      },
      strategies,
      symbols: symbols.map(symbol => symbol.toUpperCase()),
    };
  }

  private readObject(directory: string, filename: string): Record<string, unknown> {
    const filePath = resolve(directory, filename);
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    } catch (error) {
      throw new Error(`Cannot load configuration ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${filePath} must contain a JSON object`);
    }
    return value as Record<string, unknown>;
  }

  private assertKeys(value: Record<string, unknown>, filename: string, expected: string[]): void {
    const missing = expected.filter(key => !(key in value));
    const unknown = Object.keys(value).filter(key => !expected.includes(key));
    if (missing.length) {
      throw new Error(`${filename} is missing required keys: ${missing.sort().join(', ')}`);
    }
    if (unknown.length) {
      throw new Error(`${filename} has unknown keys: ${unknown.sort().join(', ')}`);
    }
  }

  private assertPositiveInteger(value: unknown, key: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      throw new Error(`${key} must be a positive integer`);
    }
  }
}
