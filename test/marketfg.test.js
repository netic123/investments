'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  beforeRetrievalLocalDate, clearCache, computeMarket, equalWeightReturnSeries, expandingPctScores,
  fetchSeries, getMarketFearGreed, getMarketFearGreedResearchHistory, labelOf,
  hashPublicDecision, hashPublishedScoreHistory, makeExchangeDateFormatter, pctScores,
} = require('../marketfg');

const CRYPTO = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD', 'BNB-USD'];
const RAW_SYMBOLS = [...CRYPTO, 'IEF', 'HYG', 'LQD'];
const CRYPTO_INDEX = {
  id: 'CRYPTO-BROAD-EW', name: 'Broad crypto equal-weight basket', method: 'equalWeightReturns',
  currency: 'USD', timezone: 'UTC', symbols: CRYPTO,
};

function dateAt(index) {
  const date = new Date('2020-01-01T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
}

function fixture(days = 1000) {
  const map = new Map();
  RAW_SYMBOLS.forEach((symbol, assetIndex) => {
    const rows = [];
    let close = 25 + assetIndex * 8;
    for (let i = 0; i < days; i++) {
      const cyclical = 0.0018 * Math.sin(i / (13 + assetIndex)) + 0.0012 * Math.cos(i / (31 + assetIndex));
      const shock = i % (91 + assetIndex) === 0 ? -0.035 + assetIndex * 0.001 : 0;
      close *= Math.exp(0.0007 + assetIndex * 0.000015 + cyclical + shock);
      rows.push({ date: dateAt(i), close });
    }
    map.set(symbol, {
      symbol, name: symbol, currency: 'USD', tz: 'UTC', rows,
      lastDate: rows.at(-1).date, fetchedAt: '2026-08-24T00:00:00Z', adjusted: true, intraday: false,
      sourceHost: 'query1.finance.yahoo.com', providerSymbol: symbol,
    });
  });
  return map;
}

const MARKET = {
  name: 'Crypto — broad 7-asset index',
  currency: 'USD',
  barPolicy: 'completed-utc-date',
  symbols: {
    index: CRYPTO_INDEX, vol: null, bond: 'IEF', hy: 'HYG', ig: 'LQD',
    small: {
      id: 'CRYPTO-NONCORE-EW', name: 'Non-core basket', method: 'equalWeightReturns',
      symbols: ['SOL-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD', 'BNB-USD'],
    },
    large: {
      id: 'CRYPTO-CORE-EW', name: 'Core basket', method: 'equalWeightReturns',
      symbols: ['BTC-USD', 'ETH-USD'],
    },
  },
};

const OPTIONS = {
  modelId: 'investments-unified-fear-greed', version: 3,
  percentileMode: 'expanding', strengthWindow: 252, percentileMinPoints: 126,
  minComponents: 6, fillDays: 7,
};
const LEGACY_V2_OPTIONS = {
  window: 252, minWindowPoints: 126, minComponents: 6, fillDays: 7,
};

test('legacy v2 midrank percentiles use only the trailing window', () => {
  assert.deepEqual(pctScores([1, 2, 3, 1000], 3, 1).map(x => Math.round(x * 10) / 10), [50, 75, 83.3, 83.3]);
});

test('v3 midrank percentiles use every finite observation available through each row', () => {
  assert.deepEqual(expandingPctScores([1, 2, 3, 1000], 1).map(x => Math.round(x * 10) / 10), [50, 75, 83.3, 87.5]);
  assert.deepEqual(
    expandingPctScores([null, 1, NaN, 1, Infinity, 2], 2).map(x => x == null ? null : Math.round(x * 10) / 10),
    [null, null, null, 50, null, 83.3],
  );
});

test('v3 expanding ranks cannot forget observations older than 252 rows', () => {
  const sharedTail = Array.from({ length: 252 }, (_, index) => 100 + index);
  const lowEarlyHistory = [...Array.from({ length: 48 }, (_, index) => index), ...sharedTail];
  const highEarlyHistory = [...Array.from({ length: 48 }, (_, index) => 1000 + index), ...sharedTail];
  const lowScore = expandingPctScores(lowEarlyHistory, 1).at(-1);
  const highScore = expandingPctScores(highEarlyHistory, 1).at(-1);
  assert.notEqual(lowScore, highScore);
  assert.equal(pctScores(lowEarlyHistory, 252, 1).at(-1), pctScores(highEarlyHistory, 252, 1).at(-1));
});

test('v3 expanding ranks are prefix invariant even when future values fall between past values', () => {
  const prefix = [3, 1, 4, 1, 5, 9];
  const extended = [...prefix, 2, 6, 5, 3, 5];
  assert.deepEqual(expandingPctScores(extended, 1).slice(0, prefix.length), expandingPctScores(prefix, 1));
});

test('daily-rebalanced equal-weight series uses the arithmetic mean constituent return', () => {
  const source = new Map([
    ['A', { symbol: 'A', name: 'A', currency: 'USD', adjusted: true, rows: [
      { date: '2026-01-01', close: 100 }, { date: '2026-01-02', close: 110 }, { date: '2026-01-03', close: 110 },
    ] }],
    ['B', { symbol: 'B', name: 'B', currency: 'USD', adjusted: true, rows: [
      { date: '2026-01-01', close: 100 }, { date: '2026-01-02', close: 100 }, { date: '2026-01-03', close: 90 },
    ] }],
  ]);
  const result = equalWeightReturnSeries({ id: 'EW', method: 'equalWeightReturns', symbols: ['A', 'B'] }, source);
  assert.deepEqual(result.rows.map(row => [row.date, Number(row.close.toFixed(4))]), [
    ['2026-01-01', 100], ['2026-01-02', 105], ['2026-01-03', 99.75],
  ]);
});

test('completed-bar wrapper excludes each source retrieval-local date', () => {
  const source = {
    symbol: 'TEST', tz: 'Europe/Stockholm', fetchedAt: '2026-08-28T09:15:00.000Z', intraday: true,
    rows: [
      { date: '2026-08-27', close: 100 },
      { date: '2026-08-28', close: 101 },
      { date: '2026-08-29', close: 102 },
    ],
  };
  const completed = beforeRetrievalLocalDate(source);
  assert.deepEqual(completed.rows, [{ date: '2026-08-27', close: 100 }]);
  assert.equal(completed.completedBeforeLocalDate, '2026-08-28');
  assert.equal(completed.sourceFetchedAt, source.fetchedAt);
  assert.equal(completed.intraday, false);
  assert.equal(beforeRetrievalLocalDate({ ...source, tz: 'Not/A-Timezone' }), null);
});

test('all markets use one bounded, labelled, exactly equal-weighted six-component engine', () => {
  const series = fixture();
  const crypto = computeMarket('crypto', MARKET, series, OPTIONS);
  const sameInputsDifferentKey = computeMarket('control', { ...MARKET, name: 'Control' }, series, OPTIONS);
  assert.equal(crypto.total, 6);
  assert.equal(crypto.n, 6);
  assert.ok(crypto.history.length > 300);
  assert.ok(crypto.score >= 0 && crypto.score <= 100);
  assert.equal(crypto.label, labelOf(crypto.score));
  assert.deepEqual(crypto.history, sameInputsDifferentKey.history);
  assert.deepEqual(Object.keys(crypto.components).sort(), ['breadth', 'credit', 'momentum', 'safeHaven', 'strength', 'volatility']);
  for (const row of crypto.history) {
    assert.ok(Number.isFinite(row.score));
    assert.ok(row.score >= 0 && row.score <= 100);
    assert.equal(row.label, labelOf(row.score));
    assert.equal(row.n, 6);
  }
  const displayedMean = Object.values(crypto.components).reduce((sum, component) => sum + component.score, 0) / 6;
  assert.ok(Math.abs(crypto.score - displayedMean) <= 0.11, `rounded equal-weight mean differs: ${crypto.score} vs ${displayedMean}`);
  assert.equal(crypto.components.volatility.dir, -1);
  assert.equal(crypto.indexSymbol, 'CRYPTO-BROAD-EW');
  assert.equal(crypto.indexName, 'Broad crypto equal-weight basket');
  for (const component of ['momentum', 'strength', 'volatility']) {
    assert.deepEqual(crypto.components[component].symbols, ['CRYPTO-BROAD-EW']);
  }
  assert.deepEqual(crypto.components.safeHaven.symbols, ['CRYPTO-BROAD-EW', 'IEF']);
});

test('legacy unified model v2 deterministic golden vector stays frozen', () => {
  const result = computeMarket('crypto', MARKET, fixture(), LEGACY_V2_OPTIONS);
  const projection = {
    score: result.score, label: result.label, n: result.n, total: result.total,
    components: Object.fromEntries(Object.entries(result.components).sort().map(([key, value]) => [key, {
      raw: value.raw, score: value.score, asOf: value.asOf, symbols: value.symbols,
    }])),
    history: result.history,
  };
  const digest = crypto.createHash('sha256').update(JSON.stringify(projection)).digest('hex');
  assert.equal(digest, 'ff834603b4ee8c842e4d47feb730aa9897201252315ba2770bf69dd46d2e8110', 'unified model behavior changed: bump the model version and deliberately replace the golden vector');
});

test('unified model v3 expanding-history deterministic golden vector stays frozen', () => {
  const result = computeMarket('crypto', MARKET, fixture(), OPTIONS);
  const projection = {
    score: result.score, label: result.label, n: result.n, total: result.total,
    components: Object.fromEntries(Object.entries(result.components).sort().map(([key, value]) => [key, {
      raw: value.raw, score: value.score, asOf: value.asOf, symbols: value.symbols,
    }])),
    history: result.history,
  };
  const digest = crypto.createHash('sha256').update(JSON.stringify(projection)).digest('hex');
  assert.equal(digest, 'aa1bcfbb910774da5ac2ecb3341172b2494a2fc76cd66017ea08c985cdebf6f9', 'unified model v3 behavior changed: bump the model version and deliberately replace the golden vector');
});

test('future observations cannot change earlier shared-model scores', () => {
  const original = fixture();
  const changed = fixture();
  for (const series of changed.values()) {
    for (let i = 900; i < series.rows.length; i++) series.rows[i].close *= 1 + (i - 899) * 0.15;
  }
  const first = computeMarket('crypto', MARKET, original, OPTIONS);
  const second = computeMarket('crypto', MARKET, changed, OPTIONS);
  const cutoff = dateAt(899);
  assert.deepEqual(
    second.history.filter(row => row.date <= cutoff),
    first.history.filter(row => row.date <= cutoff),
  );
});

test('causal component history is opt-in research data and does not change public rows', () => {
  const series = fixture();
  const publicResult = computeMarket('crypto', MARKET, series, OPTIONS);
  const researchResult = computeMarket('crypto', MARKET, series, { ...OPTIONS, includeHistoryParts: true });
  assert.equal(publicResult.history.some(row => Object.prototype.hasOwnProperty.call(row, 'parts')), false);
  assert.ok(researchResult.history.length > 300);
  for (const row of researchResult.history) {
    assert.deepEqual(Object.keys(row.parts).sort(), ['breadth', 'credit', 'momentum', 'safeHaven', 'strength', 'volatility']);
    assert.ok(Object.values(row.parts).every(part => Number.isFinite(part.score) && Number.isFinite(part.raw)));
  }
  assert.deepEqual(
    researchResult.history.map(({ parts, ...row }) => row),
    publicResult.history,
  );
});

test('public signal acquisition rejects every provider range except exact max', async () => {
  const originalFetch = global.fetch;
  let requested = false;
  global.fetch = async () => {
    requested = true;
    throw new Error('network must not be reached');
  };
  try {
    await assert.rejects(
      getMarketFearGreed({ range: '5y', markets: { usa: { symbols: { index: 'SPY' } } } }),
      /PUBLIC_FULL_HISTORY_RANGE_REQUIRED/,
    );
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(requested, false);
});

test('public signal acquisition requires the version 3 expanding identity explicitly rather than inheriting defaults', async () => {
  const originalFetch = global.fetch;
  let requested = false;
  global.fetch = async () => {
    requested = true;
    throw new Error('network must not be reached');
  };
  try {
    await assert.rejects(
      getMarketFearGreed({ range: 'max', markets: {} }),
      /PUBLIC_FULL_HISTORY_SCORING_REQUIRED/,
    );
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(requested, false);
});

test('Yahoo acquisition retries the independent chart host without changing the requested full-history daily shape', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  const firstTimestamp = Date.parse('2020-01-01T00:00:00Z') / 1000;
  const timestamps = Array.from({ length: 40 }, (_, i) => firstTimestamp + i * 86400);
  const closes = timestamps.map((_, i) => 100 + i);
  global.fetch = async url => {
    calls.push(String(url));
    if (String(url).startsWith('https://query1.finance.yahoo.com/')) {
      return { ok: true, status: 200, json: async () => ({ chart: { result: null, error: null } }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ chart: { result: [{
        meta: { symbol: 'HOST-FALLBACK-TEST', longName: 'Fallback fixture', currency: 'USD', exchangeTimezoneName: 'UTC' },
        timestamp: timestamps,
        indicators: { quote: [{ close: closes }], adjclose: [{ adjclose: closes }] },
      }], error: null } }),
    };
  };
  try {
    const result = await fetchSeries('HOST-FALLBACK-TEST', 'max');
    assert.equal(result.rows.length, 40);
    assert.equal(result.sourceHost, 'query2.finance.yahoo.com');
    assert.equal(calls.length, 2);
    assert.match(calls[0], /^https:\/\/query1\.finance\.yahoo\.com\//);
    assert.match(calls[1], /^https:\/\/query2\.finance\.yahoo\.com\//);
    for (const url of calls) {
      assert.match(url, /[?&]period1=0(?:&|$)/);
      assert.match(url, /[?&]interval=1d(?:&|$)/);
      assert.doesNotMatch(url, /[?&]range=max(?:&|$)/);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('Yahoo acquisition rejects a response bound to the wrong provider symbol on both hosts', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ chart: { result: [{
        meta: { symbol: 'WRONG-SYMBOL', exchangeTimezoneName: 'UTC' },
        timestamp: [],
        indicators: { quote: [{ close: [] }], adjclose: [{ adjclose: [] }] },
      }], error: null } }),
    };
  };
  try {
    await assert.rejects(fetchSeries('EXPECTED-SYMBOL', 'max'), /symbol identity mismatch/);
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('reused exchange-date formatter preserves the prior source-local date mapping across time zones and DST edges', () => {
  const instants = [
    '2026-03-29T00:30:00.000Z',
    '2026-03-29T01:30:00.000Z',
    '2026-10-25T00:30:00.000Z',
    '2026-10-25T01:30:00.000Z',
    '2026-12-31T23:30:00.000Z',
  ].map(value => new Date(value));
  for (const timeZone of ['UTC', 'Europe/London', 'Europe/Stockholm', 'America/New_York', 'Asia/Tokyo']) {
    const formatter = makeExchangeDateFormatter(timeZone);
    for (const instant of instants) {
      const actual = formatter.format(instant);
      assert.equal(actual, instant.toLocaleDateString('sv-SE', { timeZone }));
      assert.match(actual, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
  assert.throws(() => makeExchangeDateFormatter('Not/A-Timezone'), /time zone/i);
});

test('shared Yahoo deadline rejects even when a fetch implementation ignores abort signals', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Promise(() => {});
  clearCache();
  const started = Date.now();
  try {
    await assert.rejects(
      getMarketFearGreedResearchHistory({
        range: 'max', timeoutMs: 25, concurrency: 1,
        markets: { usa: { name: 'USA', symbols: { index: 'NEVER-SETTLES' } } },
      }),
      /Yahoo did not respond within 0 s/,
    );
    assert.ok(Date.now() - started < 1000, `hard deadline took ${Date.now() - started} ms`);
  } finally {
    clearCache();
    global.fetch = originalFetch;
  }
});

test('public signal acquisition rejects rolling or silently substituted score models before network access', async () => {
  const originalFetch = global.fetch;
  let requested = false;
  global.fetch = async () => {
    requested = true;
    throw new Error('network must not be reached');
  };
  try {
    await assert.rejects(
      getMarketFearGreed({
        modelId: 'investments-unified-fear-greed', version: 2, range: 'max',
        window: 252, minWindowPoints: 126, minComponents: 6, fillDays: 7,
        markets: { usa: { symbols: { index: 'SPY' } } },
      }),
      /PUBLIC_FULL_HISTORY_SCORING_REQUIRED/,
    );
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(requested, false);
});

test('bounded private recovery can acquire rows but cannot emit a public signal', async () => {
  const originalFetch = global.fetch;
  let requested = 0;
  const firstTimestamp = Date.parse('2020-01-01T00:00:00Z') / 1000;
  const timestamps = Array.from({ length: 40 }, (_, i) => firstTimestamp + i * 86400);
  const closes = timestamps.map((_, i) => 100 + i);
  global.fetch = async () => {
    requested++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ chart: { result: [{
        meta: { symbol: 'PRIVATE-RECOVERY-TEST', longName: 'Private recovery fixture', currency: 'USD', exchangeTimezoneName: 'UTC' },
        timestamp: timestamps,
        indicators: { quote: [{ close: closes }], adjclose: [{ adjclose: closes }] },
      }], error: null } }),
    };
  };
  clearCache();
  try {
    const result = await getMarketFearGreedResearchHistory({
      range: '5y', timeoutMs: 1000, concurrency: 1,
      markets: { usa: { name: 'USA', currency: 'USD', symbols: { index: 'PRIVATE-RECOVERY-TEST' } } },
    });
    assert.equal(requested, 1);
    assert.equal(result.model.range, '5y');
    assert.equal(Object.prototype.hasOwnProperty.call(result.model, 'expandingSignal'), false);
    assert.equal(Object.values(result.markets).some(market => Object.prototype.hasOwnProperty.call(market, 'expandingSignal')), false);
  } finally {
    clearCache();
    global.fetch = originalFetch;
  }
});

test('expanding learner uses full internal prices and parts but publishes only a binary decision summary', () => {
  const result = computeMarket('crypto', MARKET, fixture(), { ...OPTIONS, includeExpandingSignal: true });
  const signal = result.expandingSignal;
  assert.ok(signal);
  assert.equal(signal.modelId, 'FG-ONLINE-RIDGE-PREQ-FG3-V1');
  assert.equal(signal.modelVersion, 1);
  assert.equal(signal.learnerModelId, 'FG-ONLINE-RIDGE-PREQ-V1');
  assert.equal(signal.learnerModelVersion, 1);
  assert.equal(signal.upstreamScoreModelId, OPTIONS.modelId);
  assert.equal(signal.upstreamScoreModelVersion, OPTIONS.version);
  assert.equal(signal.upstreamScorePercentileMode, 'expanding');
  assert.equal(signal.upstreamScorePercentileScope, 'ALL_FINITE_COMPONENT_RAW_OBSERVATIONS_FROM_CURRENT_PROVIDER_MAX_RESPONSE_THROUGH_EACH_DATE');
  assert.ok(['BUY', 'SELL'].includes(signal.action));
  assert.equal(signal.actionMeaning, 'TARGET_POSITION');
  assert.equal(signal.targetPosition, signal.action === 'BUY' ? 'LONG' : 'CASH');
  assert.equal(signal.positionStateMeaning, 'RETROSPECTIVE_SIMULATION_ONLY_NOT_ACTUAL_HOLDING_OR_EXECUTION');
  assert.ok(['LONG', 'CASH'].includes(signal.simulatedFilledPosition));
  assert.ok([0, 1].includes(signal.targetRiskyWeight));
  assert.ok([0, 1].includes(signal.simulatedFilledRiskyWeight));
  assert.equal(signal.targetRiskyWeight, signal.targetPosition === 'LONG' ? 1 : 0);
  assert.equal(signal.simulatedFilledRiskyWeight, signal.simulatedFilledPosition === 'LONG' ? 1 : 0);
  assert.equal(typeof signal.simulatedTransitionRequired, 'boolean');
  assert.equal(signal.simulatedTransitionRequired, signal.targetPosition !== signal.simulatedFilledPosition);
  assert.equal(Object.prototype.hasOwnProperty.call(signal, 'currentPosition'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(signal, 'tradeRequired'), false);
  assert.equal(signal.historyStart, result.history[0].date);
  assert.equal(signal.historyEnd, result.history.at(-1).date);
  assert.equal(signal.historyObservations, result.history.length);
  assert.equal(signal.historyTruncated, false);
  assert.equal(signal.historyScope, 'ALL_USABLE_SCORE_ROWS_FROM_CURRENT_PROVIDER_MAX_RESPONSE');
  assert.match(signal.publishedScoreHistorySha256, /^[0-9a-f]{64}$/);
  assert.equal(signal.publishedScoreHistorySha256, hashPublishedScoreHistory(result.history));
  assert.match(signal.learnerInputHistorySha256, /^[0-9a-f]{64}$/);
  assert.equal(signal.learnerUsesAllSuppliedHistory, true);
  assert.equal(signal.providerHistoryCompleteness, 'UNVERIFIED');
  assert.deepEqual(signal.sourceHosts, ['query1.finance.yahoo.com']);
  assert.equal(signal.sourceHostFallbackUsed, false);
  assert.deepEqual(Object.keys(signal.sourceHostBySymbol).sort(), [...RAW_SYMBOLS].sort());
  assert.deepEqual(signal.providerSymbolByRequestedSymbol, Object.fromEntries(RAW_SYMBOLS.map(symbol => [symbol, symbol])));
  assert.ok(Object.values(signal.sourceHostBySymbol).every(host => host === 'query1.finance.yahoo.com'));
  assert.equal(signal.expectedTargetId, 'CRYPTO-BROAD-EW');
  assert.equal(signal.targetId, signal.expectedTargetId);
  assert.ok(signal.trainingRows >= 252);
  assert.equal(signal.x2ClaimAllowed, false);
  assert.match(signal.evidenceStatus, /REQUIRES_REVALIDATION.*NOT_VALIDATED/);
  assert.match(signal.learnerDecisionSha256, /^[0-9a-f]{64}$/);
  assert.match(signal.decisionSha256, /^[0-9a-f]{64}$/);
  assert.notEqual(signal.decisionSha256, signal.learnerDecisionSha256);
  assert.equal(signal.decisionSha256, hashPublicDecision(signal));
  assert.notEqual(signal.decisionSha256, hashPublicDecision({ ...signal, action: signal.action === 'BUY' ? 'SELL' : 'BUY' }));
  assert.notEqual(signal.decisionSha256, hashPublicDecision({ ...signal, sourceHostFallbackUsed: true }));
  assert.equal(Object.prototype.hasOwnProperty.call(signal, 'prices'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(signal, 'components'), false);
  assert.equal(result.history.some(row => Object.prototype.hasOwnProperty.call(row, 'parts')), false);
});

test('reviewed ETF targets fail closed when Yahoo falls back to unadjusted closes', () => {
  const series = fixture();
  const source = series.get('BTC-USD');
  series.set('SPY', { ...source, symbol: 'SPY', name: 'SPY', adjusted: false });
  const usaMarket = {
    ...MARKET,
    name: 'USA',
    barPolicy: 'exchange-local daily bars',
    symbols: { ...MARKET.symbols, index: 'SPY' },
  };
  const result = computeMarket('usa', usaMarket, series, { ...OPTIONS, includeExpandingSignal: true });
  assert.equal(result.expandingSignal.action, 'SELL');
  assert.equal(result.expandingSignal.reason, 'FAIL_CLOSED_DATA_INVALID');
  assert.equal(result.expandingSignal.inputsCompleted, false);
  assert.equal(result.expandingSignal.expectedTargetId, 'SPY');
  assert.equal(result.expandingSignal.targetSuitability, 'UNADJUSTED_CLOSE_NOT_TOTAL_RETURN');
});

test('a missing broad-index constituent cannot silently narrow the Crypto benchmark', () => {
  const missing = fixture();
  missing.delete('SOL-USD');
  assert.throws(() => computeMarket('crypto', MARKET, missing, OPTIONS), /index series \(CRYPTO-BROAD-EW\) missing/);
});

test('Crypto completed-UTC policy excludes the current and future UTC dates', () => {
  const result = computeMarket('crypto', MARKET, fixture(2600), OPTIONS);
  const utcToday = new Date().toISOString().slice(0, 10);
  assert.ok(result.asOf < utcToday);
  assert.ok(result.history.every(row => row.date < utcToday));
  assert.equal(result.intraday, false);
  assert.equal(result.mapping.barPolicy, 'completed-utc-date');
});

test('weekday macro components carry over a Crypto weekend without changing their as-of dates', () => {
  const series = fixture(999); // 2022-09-25, a Sunday
  for (const symbol of ['IEF', 'HYG', 'LQD']) {
    const source = series.get(symbol);
    source.rows = source.rows.filter(row => {
      const day = new Date(`${row.date}T00:00:00Z`).getUTCDay();
      return day !== 0 && day !== 6;
    });
    source.lastDate = source.rows.at(-1).date;
  }
  const result = computeMarket('crypto', MARKET, series, OPTIONS);
  assert.equal(new Date(`${result.asOf}T00:00:00Z`).getUTCDay(), 0);
  assert.equal(result.components.momentum.asOf, result.asOf);
  assert.equal(result.components.breadth.asOf, result.asOf);
  assert.equal(new Date(`${result.components.safeHaven.asOf}T00:00:00Z`).getUTCDay(), 5);
  assert.equal(new Date(`${result.components.credit.asOf}T00:00:00Z`).getUTCDay(), 5);
  assert.equal(result.components.safeHaven.lag, true);
  assert.equal(result.components.credit.lag, true);
  assert.equal(result.n, 6);
});

test('configured volatility, investment-grade and core inputs never silently fall back', () => {
  const series = fixture();
  const addAlias = (source, alias) => {
    const original = series.get(source);
    series.set(alias, { ...original, symbol: alias, name: alias, rows: original.rows.map(row => ({ ...row })) });
  };
  addAlias('ETH-USD', 'VOL');
  addAlias('BTC-USD', 'LARGE');
  const configured = {
    ...MARKET,
    symbols: { ...MARKET.symbols, vol: 'VOL', large: 'LARGE' },
  };
  assert.equal(computeMarket('control', configured, series, OPTIONS).n, 6);

  for (const symbol of ['VOL', 'LQD', 'LARGE']) {
    const missing = new Map(series);
    missing.delete(symbol);
    assert.throws(
      () => computeMarket('control', configured, missing, OPTIONS),
      /too few indicators with data/,
      `${symbol} was silently replaced by another series`,
    );
  }
});

test('display-rounded label boundaries are stable', () => {
  assert.equal(labelOf(24.4), 'Extreme Fear');
  assert.equal(labelOf(24.5), 'Extreme Fear');
  assert.equal(labelOf(24.9), 'Extreme Fear');
  assert.equal(labelOf(25), 'Fear');
  assert.equal(labelOf(44.4), 'Fear');
  assert.equal(labelOf(44.5), 'Fear');
  assert.equal(labelOf(45), 'Neutral');
  assert.equal(labelOf(55.4), 'Neutral');
  assert.equal(labelOf(55.5), 'Neutral');
  assert.equal(labelOf(56), 'Greed');
  assert.equal(labelOf(74.4), 'Greed');
  assert.equal(labelOf(74.5), 'Greed');
  assert.equal(labelOf(74.9), 'Greed');
  assert.equal(labelOf(75), 'Extreme Greed');
});

test('config exposes the versioned full-history model identity and six market mappings', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'config.json'), 'utf8'));
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'cryptoFearGreed'), false);
  assert.equal(config.marketFearGreed.modelId, 'investments-unified-fear-greed');
  assert.equal(config.marketFearGreed.version, 3);
  assert.equal(config.marketFearGreed.range, 'max');
  assert.equal(config.marketFearGreed.percentileMode, 'expanding');
  assert.equal(config.marketFearGreed.strengthWindow, 252);
  assert.equal(config.marketFearGreed.percentileMinPoints, 126);
  assert.equal(Object.prototype.hasOwnProperty.call(config.marketFearGreed, 'window'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(config.marketFearGreed, 'minWindowPoints'), false);
  assert.equal(config.marketFearGreed.minComponents, 6);
  assert.deepEqual(Object.keys(config.marketFearGreed.markets).sort(), ['crypto', 'europe', 'global', 'sweden', 'usa', 'ustech']);
  assert.deepEqual(config.marketFearGreed.markets.crypto.symbols.index, {
    id: 'CRYPTO-BROAD-EW',
    name: 'Broad crypto equal-weight basket',
    method: 'equalWeightReturns',
    currency: 'USD',
    timezone: 'UTC',
    symbols: CRYPTO,
  });
  assert.equal(config.marketFearGreed.markets.crypto.symbols.small.method, 'equalWeightReturns');
});
