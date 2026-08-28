'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  beforeRetrievalLocalDate, clearCache, computeMarket, equalWeightReturnSeries,
  getMarketFearGreed, getMarketFearGreedResearchHistory, labelOf, pctScores,
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
  window: 252, minWindowPoints: 126, minComponents: 6, fillDays: 7,
};

test('midrank percentiles use only the trailing window', () => {
  assert.deepEqual(pctScores([1, 2, 3, 1000], 3, 1).map(x => Math.round(x * 10) / 10), [50, 75, 83.3, 83.3]);
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

test('unified model v2 deterministic golden vector stays frozen', () => {
  const result = computeMarket('crypto', MARKET, fixture(), OPTIONS);
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

test('public score history is never truncated by the legacy historyPoints option', () => {
  const result = computeMarket('crypto', MARKET, fixture(), { ...OPTIONS, historyPoints: 25 });
  assert.ok(result.history.length > 25);
  assert.deepEqual(result.history, computeMarket('crypto', MARKET, fixture(), OPTIONS).history);
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
        meta: { longName: 'Private recovery fixture', currency: 'USD', exchangeTimezoneName: 'UTC' },
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
  assert.equal(signal.modelId, 'FG-ONLINE-RIDGE-PREQ-V1');
  assert.ok(['BUY', 'SELL'].includes(signal.action));
  assert.equal(signal.actionMeaning, 'TARGET_POSITION');
  assert.ok([0, 1].includes(signal.targetRiskyWeight));
  assert.ok([0, 1].includes(signal.currentRiskyWeight));
  assert.equal(typeof signal.tradeRequired, 'boolean');
  assert.equal(signal.historyStart, result.history[0].date);
  assert.equal(signal.historyEnd, result.history.at(-1).date);
  assert.equal(signal.historyObservations, result.history.length);
  assert.equal(signal.historyTruncated, false);
  assert.equal(signal.historyScope, 'ALL_USABLE_SCORE_ROWS_FROM_CURRENT_PROVIDER_MAX_RESPONSE');
  assert.equal(signal.learnerUsesAllSuppliedHistory, true);
  assert.equal(signal.providerHistoryCompleteness, 'UNVERIFIED');
  assert.equal(signal.expectedTargetId, 'CRYPTO-BROAD-EW');
  assert.equal(signal.targetId, signal.expectedTargetId);
  assert.ok(signal.trainingRows >= 252);
  assert.equal(signal.x2ClaimAllowed, false);
  assert.match(signal.evidenceStatus, /NOT_VALIDATED/);
  assert.match(signal.decisionSha256, /^[0-9a-f]{64}$/);
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
  assert.equal(labelOf(24.5), 'Fear');
  assert.equal(labelOf(44.4), 'Fear');
  assert.equal(labelOf(44.5), 'Neutral');
  assert.equal(labelOf(55.4), 'Neutral');
  assert.equal(labelOf(55.5), 'Greed');
  assert.equal(labelOf(74.4), 'Greed');
  assert.equal(labelOf(74.5), 'Extreme Greed');
});

test('config exposes one model identity and five market mappings', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'config.json'), 'utf8'));
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'cryptoFearGreed'), false);
  assert.equal(config.marketFearGreed.modelId, 'investments-unified-fear-greed');
  assert.equal(config.marketFearGreed.version, 2);
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
