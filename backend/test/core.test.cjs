const assert = require('node:assert/strict');
const { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { AppConfigService } = require('../dist/app-config.service');
const { BinanceMarketDataService } = require('../dist/binance-market-data.service');
const { BinanceSecretsService } = require('../dist/binance-secrets.service');
const { BinanceService } = require('../dist/binance.service');
const { FirebaseAuthGuard } = require('../dist/firebase-auth.guard');
const { IndicatorService } = require('../dist/indicator.service');
const { MarketDataLoggerService } = require('../dist/market-data-logger.service');
const { NetworkDiagnosticsController } = require('../dist/network-diagnostics.controller');
const { ScannerService } = require('../dist/scanner.service');
const { StrategyService } = require('../dist/strategy.service');
const { WatchlistAnalysisService } = require('../dist/watchlist-analysis.service');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');

function mockOrderRequestStore() {
  const { firestore } = require('../dist/firebase-admin');
  const originalCollection = firestore.collection;
  const originalRunTransaction = firestore.runTransaction;
  const records = new Map();

  firestore.collection = () => ({
    doc: id => ({
      id,
      update: async updates => records.set(id, { ...records.get(id), ...updates }),
    }),
  });
  firestore.runTransaction = async operation => operation({
    get: async reference => ({
      exists: records.has(reference.id),
      data: () => records.get(reference.id),
    }),
    create: (reference, value) => records.set(reference.id, value),
  });

  return {
    records,
    restore: () => {
      firestore.collection = originalCollection;
      firestore.runTransaction = originalRunTransaction;
    },
  };
}

test('loads checked-in scanner configuration', () => {
  const config = new AppConfigService().config;
  assert.deepEqual(config.symbols, ['BTCUSDT', 'ETHUSDT']);
  assert.equal(config.binance.timeframe, '1m');
  assert.equal(config.binance.timeout_ms, 10_000);
  assert.equal(config.trading.liveSpotOrdersEnabled, true);
  assert.equal(config.firebase.enabled, true);
});

test('Firebase Auth users can access protected API routes without a wallet document', async () => {
  const { firebaseAuth } = require('../dist/firebase-admin');
  const originalVerify = firebaseAuth.verifyIdToken;
  const decodedToken = { uid: 'firebase-user-uuid' };
  firebaseAuth.verifyIdToken = async () => decodedToken;
  const request = { headers: { authorization: 'Bearer valid-firebase-id-token' } };
  const guard = new FirebaseAuthGuard();
  try {
    const allowed = await guard.canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
    });
    assert.equal(allowed, true);
    assert.equal(request.firebaseUser, decodedToken);
  } finally {
    firebaseAuth.verifyIdToken = originalVerify;
  }
});

test('returns a valid public egress IP from the backend runtime', async () => {
  const originalFetch = global.fetch;
  global.fetch = async url => {
    assert.equal(url, 'https://api.ipify.org?format=json');
    return new Response(JSON.stringify({ ip: '203.0.113.42' }), { status: 200 });
  };

  try {
    const result = await new NetworkDiagnosticsController().getEgressIp();
    assert.deepEqual(result, { ip: '203.0.113.42' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('rejects invalid public egress IP responses', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ ip: 'not-an-ip' }), { status: 200 });

  try {
    await assert.rejects(
      new NetworkDiagnosticsController().getEgressIp(),
      error => error.status === 502 && /invalid IP address/.test(error.message),
    );
  } finally {
    global.fetch = originalFetch;
  }
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

test('computes watchlist EMA and RSI indicators from closed candles', () => {
  const candles = Array.from({ length: 60 }, (_, index) => {
    const closeTime = Date.now() - 3_600_000 + index * 60_000;
    return {
      open_time: new Date(closeTime - 59_999).toISOString(),
      close_time: new Date(closeTime).toISOString(),
      open: index + 1,
      high: index + 2,
      low: index + 0.5,
      close: index + 1,
      volume: 1,
    };
  });
  const result = new IndicatorService().computeWatchlist(candles);

  assert.equal(result.ema20, 50.5);
  assert.equal(result.ema50, 35.5);
  assert.equal(result.rsi14, 100);
  assert.equal(result.latestClose, 60);
  assert.equal(new IndicatorService().computeWatchlist(candles.slice(0, 49)).ema50, null);
});

test('validates watchlist analysis input without accepting a client user ID', () => {
  const service = new WatchlistAnalysisService(
    new AppConfigService(),
    {},
    new IndicatorService(),
  );

  assert.deepEqual(service.validateRequest({ symbols: ['BTCUSDT'] }), ['BTCUSDT']);
  assert.equal(service.validateRequest({}), undefined);
  assert.throws(
    () => service.validateRequest({ userId: 'other-user', symbols: ['BTCUSDT'] }),
    error => error.status === 400,
  );
  assert.throws(
    () => service.validateRequest({ symbols: ['BTCUSDT', 'BTCUSDT'] }),
    error => error.status === 400,
  );
  assert.throws(
    () => service.validateRequest({ symbols: Array(21).fill('BTCUSDT') }),
    error => error.status === 400,
  );
  assert.throws(
    () => service.selectSymbols(['ETHUSDT'], ['BTCUSDT']),
    error => error.status === 400,
  );
});

test('enforces a transactional per-user watchlist analysis quota', async () => {
  const { firestore } = require('../dist/firebase-admin');
  const originalCollection = firestore.collection;
  const originalRunTransaction = firestore.runTransaction;
  const records = new Map();
  firestore.collection = name => {
    assert.equal(name, 'analysis_request_quotas');
    return { doc: id => ({ id }) };
  };
  firestore.runTransaction = async operation => operation({
    get: async reference => ({
      exists: records.has(reference.id),
      data: () => records.get(reference.id),
    }),
    set: (reference, value) => records.set(reference.id, value),
  });

  try {
    const service = new WatchlistAnalysisService(
      new AppConfigService(),
      {},
      new IndicatorService(),
    );
    for (let request = 0; request < 5; request += 1) {
      await service.consumeQuota('quota-user', `request-${request}`);
    }
    await assert.rejects(
      service.consumeQuota('quota-user', 'request-six'),
      error => error.status === 429,
    );
  } finally {
    firestore.collection = originalCollection;
    firestore.runTransaction = originalRunTransaction;
  }
});

test('uses OpenAI Responses API strict Structured Outputs', async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_SECRET;
  const originalModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_SECRET = 'test-secret';
  process.env.OPENAI_MODEL = 'test-model';
  global.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'test-model');
    assert.equal(request.text.format.type, 'json_schema');
    assert.equal(request.text.format.strict, true);
    return new Response(JSON.stringify({
      id: 'resp_test',
      object: 'response',
      created_at: 1,
      status: 'completed',
      model: 'test-model',
      output: [{
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{
          type: 'output_text',
          text: JSON.stringify({ overview: 'Informational.', results: [] }),
          annotations: [],
        }],
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const service = new WatchlistAnalysisService(
      new AppConfigService(),
      {},
      new IndicatorService(),
    );
    assert.deepEqual(
      await service.requestAnalysis([], 'test-request-id'),
      { overview: 'Informational.', results: [] },
    );
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_SECRET;
    else process.env.OPENAI_SECRET = originalApiKey;
    if (originalModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = originalModel;
  }
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

test('Binance client parses fresh 24-hour Spot ticker values', async () => {
  const originalFetch = global.fetch;
  const closeTime = Date.now();
  global.fetch = async url => {
    assert.match(url, /\/api\/v3\/ticker\/24hr\?symbol=BTCUSDT$/);
    return new Response(JSON.stringify({
      symbol: 'BTCUSDT',
      lastPrice: '105.25',
      openPrice: '100',
      volume: '1234.5',
      quoteVolume: '98765.4',
      highPrice: '110',
      lowPrice: '95',
      closeTime,
    }), { status: 200 });
  };

  try {
    const ticker = await new BinanceMarketDataService(new AppConfigService())
      .fetch24HourTicker('btcusdt');
    assert.deepEqual(ticker, {
      symbol: 'BTCUSDT',
      lastPrice: 105.25,
      openPrice: 100,
      priceChangePercent: 5.25,
      volume: 1234.5,
      quoteVolume: 98765.4,
      highPrice: 110,
      lowPrice: 95,
      closeTime: new Date(closeTime).toISOString(),
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetches validated USDT ticker rows for Market Trends', async () => {
  const originalFetch = global.fetch;
  const closeTime = Date.now();
  global.fetch = async url => {
    assert.equal(url, 'https://api.binance.com/api/v3/ticker/24hr');
    return new Response(JSON.stringify([
      {
        symbol: 'BTCUSDT',
        lastPrice: '105.25',
        openPrice: '100',
        volume: '1234.5',
        quoteVolume: '98765.4',
        highPrice: '110',
        lowPrice: '95',
        closeTime,
      },
      {
        symbol: 'ETHBTC',
        lastPrice: '0.05',
        openPrice: '0.04',
        volume: '100',
        quoteVolume: '5',
        highPrice: '0.06',
        lowPrice: '0.03',
        closeTime,
      },
    ]), { status: 200 });
  };

  try {
    const result = await new BinanceMarketDataService(new AppConfigService())
      .fetchMarketTrendTickers();
    assert.equal(result.source, 'Binance Spot');
    assert.equal(result.tickers.length, 1);
    assert.deepEqual(result.tickers[0], {
      symbol: 'BTCUSDT',
      lastPrice: 105.25,
      openPrice: 100,
      priceChangePercent: 5.25,
      volume: 1234.5,
      quoteVolume: 98765.4,
      highPrice: 110,
      lowPrice: 95,
      closeTime: new Date(closeTime).toISOString(),
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('loads Binance credentials from Secret Manager and caches their versions', async () => {
  const service = new BinanceSecretsService(new AppConfigService());
  const accessed = [];
  service.client.accessSecretVersion = async request => {
    accessed.push(request.name);
    const value = request.name.endsWith('/BINANCE_API_KEY/versions/latest')
      ? 'test-api-key'
      : 'test-api-secret';
    return [{ payload: { data: Buffer.from(value) } }];
  };

  const credentials = await service.getCredentials();
  await service.getCredentials();

  assert.deepEqual(credentials, {
    apiKey: 'test-api-key',
    apiSecret: 'test-api-secret',
  });
  assert.deepEqual(accessed.sort(), [
    'projects/jasperpos-dev/secrets/BINANCE_API_KEY/versions/latest',
    'projects/jasperpos-dev/secrets/BINANCE_SECRET/versions/latest',
  ]);
});

test('Binance account endpoint signs a read-only account request with fetched credentials', async () => {
  const originalFetch = global.fetch;
  const apiKey = 'test-api-key';
  const apiSecret = 'test-api-secret';
  let requestUrl;
  let requestOptions;
  global.fetch = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return new Response(JSON.stringify({ balances: [
      { asset: 'BTC', free: '0.5', locked: '0' },
      { asset: 'ZERO', free: '0', locked: '0' },
    ] }), { status: 200 });
  };

  try {
    const service = new BinanceService(
      { getCredentials: async () => ({ apiKey, apiSecret }) },
      new AppConfigService(),
    );
    const account = await service.getAccount();

    assert.equal(new URL(requestUrl).pathname, '/api/v3/account');
    assert.equal(requestOptions.headers['X-MBX-APIKEY'], apiKey);
    const request = new URL(requestUrl);
    const signature = request.searchParams.get('signature');
    request.searchParams.delete('signature');
    const expected = require('node:crypto')
      .createHmac('sha256', apiSecret)
      .update(request.searchParams.toString())
      .digest('hex');
    assert.equal(signature, expected);
    assert.deepEqual(account, {
      connected: true,
      balances: [{ asset: 'BTC', free: 0.5, locked: 0 }],
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('places a confirmed market buy using available USDT and replays its idempotent result', async () => {
  const originalFetch = global.fetch;
  const store = mockOrderRequestStore();
  const apiKey = 'test-api-key';
  const apiSecret = 'test-api-secret';
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    if (new URL(url).pathname === '/api/v3/account') {
      return new Response(JSON.stringify({ balances: [
        { asset: 'USDT', free: '100.00', locked: '0' },
        { asset: 'BTC', free: '0.5', locked: '0' },
      ] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      symbol: 'BTCUSDT',
      orderId: 123,
      clientOrderId: '550e8400-e29b-41d4-a716-446655440000',
      side: 'BUY',
      type: 'MARKET',
      status: 'FILLED',
      executedQty: '0.0005',
      cummulativeQuoteQty: '25.00',
      transactTime: 123456789,
    }), { status: 200 });
  };

  try {
    const service = new BinanceService(
      { getCredentials: async () => ({ apiKey, apiSecret }) },
      new AppConfigService(),
    );
    const order = await service.placeMarketOrder('firebase-user-1', {
      symbol: 'BTCUSDT',
      side: 'BUY',
      quoteOrderQty: '25.00',
      clientOrderId: '550e8400-e29b-41d4-a716-446655440000',
      confirm: true,
    });

    assert.equal(requests.length, 2);
    assert.equal(new URL(requests[1].url).pathname, '/api/v3/order');
    assert.equal(requests[1].options.method, 'POST');
    assert.equal(requests[1].options.headers['X-MBX-APIKEY'], apiKey);
    const parameters = new URLSearchParams(requests[1].options.body);
    const signature = parameters.get('signature');
    parameters.delete('signature');
    assert.equal(
      signature,
      require('node:crypto').createHmac('sha256', apiSecret)
        .update(parameters.toString())
        .digest('hex'),
    );
    assert.equal(parameters.get('side'), 'BUY');
    assert.equal(parameters.get('quoteOrderQty'), '25.00');
    assert.equal(parameters.has('quantity'), false);
    assert.deepEqual(order, {
      symbol: 'BTCUSDT',
      orderId: 123,
      clientOrderId: '550e8400-e29b-41d4-a716-446655440000',
      side: 'BUY',
      type: 'MARKET',
      status: 'FILLED',
      executedQty: '0.0005',
      cummulativeQuoteQty: '25.00',
      transactTime: 123456789,
      replayed: false,
    });
    assert.equal(
      store.records.get('550e8400-e29b-41d4-a716-446655440000').status,
      'completed',
    );

    const replay = await service.placeMarketOrder('firebase-user-1', {
      symbol: 'BTCUSDT',
      side: 'BUY',
      quoteOrderQty: '25.00',
      clientOrderId: '550e8400-e29b-41d4-a716-446655440000',
      confirm: true,
    });
    assert.equal(requests.length, 2);
    assert.equal(replay.replayed, true);
    assert.equal(replay.orderId, 123);
  } finally {
    global.fetch = originalFetch;
    store.restore();
  }
});

test('rejects market orders that exceed available balance without submitting them', async () => {
  const originalFetch = global.fetch;
  const store = mockOrderRequestStore();
  const requests = [];
  global.fetch = async url => {
    requests.push(url);
    return new Response(JSON.stringify({ balances: [
      { asset: 'USDT', free: '10.00', locked: '50.00' },
    ] }), { status: 200 });
  };

  try {
    const service = new BinanceService(
      { getCredentials: async () => ({ apiKey: 'key', apiSecret: 'secret' }) },
      new AppConfigService(),
    );
    await assert.rejects(
      service.placeMarketOrder('firebase-user-1', {
        symbol: 'BTCUSDT',
        side: 'BUY',
        quoteOrderQty: '10.01',
        clientOrderId: '550e8400-e29b-41d4-a716-446655440001',
        confirm: true,
      }),
      error => error.status === 400 && /available USDT balance/.test(error.message),
    );

    assert.equal(requests.length, 1);
    assert.equal(
      store.records.get('550e8400-e29b-41d4-a716-446655440001').status,
      'rejected',
    );
  } finally {
    global.fetch = originalFetch;
    store.restore();
  }
});

test('places a confirmed market sell using available base-asset quantity', async () => {
  const originalFetch = global.fetch;
  const store = mockOrderRequestStore();
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    if (new URL(url).pathname === '/api/v3/account') {
      return new Response(JSON.stringify({ balances: [
        { asset: 'BTC', free: '0.01000000', locked: '0.00500000' },
      ] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      symbol: 'BTCUSDT',
      orderId: 456,
      clientOrderId: '550e8400-e29b-41d4-a716-446655440002',
      side: 'SELL',
      type: 'MARKET',
      status: 'FILLED',
      executedQty: '0.001',
      cummulativeQuoteQty: '75.00',
    }), { status: 200 });
  };

  try {
    const service = new BinanceService(
      { getCredentials: async () => ({ apiKey: 'key', apiSecret: 'secret' }) },
      new AppConfigService(),
    );
    const order = await service.placeMarketOrder('firebase-user-1', {
      symbol: 'BTCUSDT',
      side: 'SELL',
      quantity: '0.001',
      clientOrderId: '550e8400-e29b-41d4-a716-446655440002',
      confirm: true,
    });

    const parameters = new URLSearchParams(requests[1].options.body);
    assert.equal(parameters.get('quantity'), '0.001');
    assert.equal(parameters.has('quoteOrderQty'), false);
    assert.equal(order.side, 'SELL');
    assert.equal(order.status, 'FILLED');
  } finally {
    global.fetch = originalFetch;
    store.restore();
  }
});

test('rejects market orders when live trading is disabled', async () => {
  const originalFetch = global.fetch;
  let fetchCount = 0;
  global.fetch = async () => {
    fetchCount += 1;
    throw new Error('fetch should not be called');
  };

  try {
    const service = new BinanceService(
      { getCredentials: async () => ({ apiKey: 'key', apiSecret: 'secret' }) },
      { config: { trading: { liveSpotOrdersEnabled: false } } },
    );
    await assert.rejects(
      service.placeMarketOrder('firebase-user-1', {}),
      error => error.status === 503 && /disabled/.test(error.message),
    );
    assert.equal(fetchCount, 0);
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
    for (const filename of ['environment.json', 'binance.json', 'trading.json', 'strategies.json']) {
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
