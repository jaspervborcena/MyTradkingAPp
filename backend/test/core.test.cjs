const assert = require('node:assert/strict');
const { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { AppConfigService } = require('../dist/app-config.service');
const { BinanceMarketDataService } = require('../dist/binance-market-data.service');
const { IndicatorService } = require('../dist/indicator.service');
const { MarketDataLoggerService } = require('../dist/market-data-logger.service');
const { ScannerService } = require('../dist/scanner.service');
const { StrategyService } = require('../dist/strategy.service');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');

test('loads checked-in scanner configuration', () => {
  const config = new AppConfigService().config;
  assert.deepEqual(config.symbols, ['BTCUSDT', 'ETHUSDT']);
  assert.equal(config.binance.timeframe, '1m');
  assert.equal(config.binance.timeout_ms, 10_000);
  assert.equal(config.firebase.enabled, true);
});

test('computes a bullish indicator snapshot from rising candles', () => {
  const candles = Array.from({ length: 35 }, (_, index) => ({
    open_time: new Date(index * 60_000).toISOString(),
    close_time: new Date(index * 60_000 + 59_999).toISOString(),
    open: index + 1,
    high: index + 2,
    low: index + 0.5,
    close: index + 1,
    volume: 1,
  }));
  const snapshot = new IndicatorService().compute(candles, 'BTCUSDT', '1m');

  assert.equal(snapshot.trend, 'bullish');
  assert.equal(snapshot.sma_fast, 33);
  assert.equal(snapshot.sma_slow, 25.5);
  assert.equal(snapshot.rsi, 100);
  assert.equal(snapshot.confidence, 1);
});

test('strategy acceptance respects confidence threshold', () => {
  const strategy = new StrategyService();
  const snapshot = {
    symbol: 'BTCUSDT',
    timeframe: '1m',
    close: 10,
    sma_fast: 9,
    sma_slow: 8,
    rsi: 60,
    trend: 'bullish',
    confidence: 0.25,
  };
  const result = strategy.evaluate(snapshot, {
    name: 'trend_follow',
    enabled: true,
    min_confidence: 0.3,
  });

  assert.equal(result.side, 'buy');
  assert.equal(result.accepted, false);
  assert.deepEqual(result.reasons, ['min_confidence not met: 0.2500 < 0.3000']);
});

test('scanner writes the latest closed candle and avoids duplicate observations', async () => {
  const candles = Array.from({ length: 35 }, (_, index) => {
    const openTime = Date.now() - 3_600_000 + index * 60_000;
    return {
      open_time: new Date(openTime).toISOString(),
      close_time: new Date(openTime + 59_999).toISOString(),
      open: index + 1,
      high: index + 2,
      low: index + 0.5,
      close: index + 1,
      volume: 1,
    };
  });
  const observations = [];
  const signals = [];
  const scanner = new ScannerService(
    {
      config: {
        symbols: ['BTCUSDT'],
        binance: { timeframe: '1m' },
        strategies: [{ name: 'trend_follow', enabled: true, min_confidence: 0.3 }],
      },
    },
    { fetchCandles: async () => candles },
    {
      logObservation: async event => observations.push(event),
      logSignal: async event => signals.push(event),
    },
    new IndicatorService(),
    new StrategyService(),
  );

  await scanner.scanOnce();
  await scanner.scanOnce();

  assert.equal(observations.length, 1);
  assert.equal(observations[0].event_id, `binance:BTCUSDT:1m:${candles.at(-1).open_time}`);
  assert.equal(observations[0].candle.close, candles.at(-1).close);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].event_type, 'signal');
  assert.equal(signals[0].status, 'accepted');
});

test('Binance client parses valid public klines', async () => {
  const originalFetch = global.fetch;
  const openTime = Date.now() - 120_000;
  global.fetch = async () => new Response(JSON.stringify([[
    openTime,
    '100.0',
    '110.0',
    '95.0',
    '105.0',
    '12.5',
    openTime + 59_999,
  ]]), { status: 200 });

  try {
    const service = new BinanceMarketDataService(new AppConfigService());
    const candles = await service.fetchCandles('btcusdt');
    assert.equal(candles.length, 1);
    assert.equal(candles[0].close, 105);
    assert.equal(candles[0].open_time, new Date(openTime).toISOString());
  } finally {
    global.fetch = originalFetch;
  }
});

test('writes observation and signal events using the existing JSONL paths', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tradingapp-data-'));
  try {
    const logger = new MarketDataLoggerService({
      dataDir,
      config: { firebase: { enabled: false } },
    });
    const observation = {
      schema_version: 1,
      event_id: 'binance:BTCUSDT:1m:2026-10-28T00:00:00.000Z',
      captured_at: '2026-10-28T00:01:00.000Z',
      exchange: 'binance',
      symbol: 'BTCUSDT',
      timeframe: '1m',
      candle: {
        open_time: '2026-10-28T00:00:00.000Z',
        close_time: '2026-10-28T00:00:59.999Z',
        open: 100,
        high: 105,
        low: 99,
        close: 104,
        volume: 12,
      },
    };
    const signal = {
      schema_version: 1,
      event_id: 'signal:BTCUSDT:1m:2026-10-28T00:01:00.000Z',
      event_type: 'signal',
      symbol: 'BTCUSDT',
      timeframe: '1m',
      status: 'accepted',
    };
    await logger.logObservation(observation);
    await logger.logSignal(signal);

    const savedObservation = JSON.parse(readFileSync(join(dataDir, 'market_observations.jsonl'), 'utf8'));
    const savedSignal = JSON.parse(readFileSync(join(dataDir, 'market_signals.jsonl'), 'utf8'));
    assert.deepEqual(savedObservation, observation);
    assert.deepEqual(savedSignal, signal);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('boots the Nest application context for a one-shot scan', async () => {
  const configDir = mkdtempSync(join(tmpdir(), 'tradingapp-config-'));
  const sourceConfigDir = join(__dirname, '..', '..', 'config');
  const previousConfigDir = process.env.CONFIG_DIR;
  const previousScanOnce = process.env.SCAN_ONCE;
  try {
    for (const filename of ['environment.json', 'binance.json', 'strategies.json']) {
      copyFileSync(join(sourceConfigDir, filename), join(configDir, filename));
    }
    writeFileSync(join(configDir, 'assets.json'), JSON.stringify({ symbols: [] }));
    writeFileSync(join(configDir, 'firebase.json'), JSON.stringify({ enabled: false, project_id: null }));
    process.env.CONFIG_DIR = configDir;
    process.env.SCAN_ONCE = 'true';
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    await app.close();
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.CONFIG_DIR;
    } else {
      process.env.CONFIG_DIR = previousConfigDir;
    }
    if (previousScanOnce === undefined) {
      delete process.env.SCAN_ONCE;
    } else {
      process.env.SCAN_ONCE = previousScanOnce;
    }
    rmSync(configDir, { recursive: true, force: true });
  }
});
