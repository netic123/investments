'use strict';

// Offline tests for the RESEARCH-ONLY long-history Fear & Greed variant.
// No network access anywhere in this file.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const mod = require('../research/fear_greed_long_history_proxy');
const marketfg = require('../marketfg');

const MODULE_PATH = path.join(__dirname, '..', 'research', 'fear_greed_long_history_proxy.js');

function dateAt(index) {
  const date = new Date('2018-01-01T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
}

function syntheticSeries(symbol, assetIndex, days) {
  const rows = [];
  let close = 40 + assetIndex * 11;
  for (let i = 0; i < days; i++) {
    const cyclical = 0.0017 * Math.sin(i / (11 + assetIndex)) + 0.0011 * Math.cos(i / (29 + assetIndex));
    const shock = i % (83 + assetIndex) === 0 ? -0.03 + assetIndex * 0.002 : 0;
    close *= Math.exp(0.0006 + assetIndex * 0.00002 + cyclical + shock);
    rows.push({ date: dateAt(i), close });
  }
  return {
    symbol, name: `${symbol} synthetic`, currency: 'USD', tz: 'UTC', rows,
    adjusted: true, lastDate: rows.at(-1).date, intraday: false, fetchedAt: '2026-08-28T00:00:00.000Z',
  };
}

function usaSeriesMap(days = 700) {
  const map = new Map();
  ['VFINX', 'FGOVX', 'VWEHX', 'VWESX', 'NAESX'].forEach((symbol, index) => {
    map.set(symbol, syntheticSeries(symbol, index, days));
  });
  return map;
}

function productionLikeMarketConfig() {
  // Same shape as data/config.json marketFearGreed, reduced to what
  // buildResearchConfig validates and consumes.
  return JSON.parse(fs.readFileSync(mod.CONFIG_PATH, 'utf8')).marketFearGreed;
}

function yahooPayloadBytes({ symbol, currency = 'USD', instrumentType, granularity = '1d', timezone = 'America/New_York', rows }) {
  return Buffer.from(JSON.stringify({
    chart: {
      error: null,
      result: [{
        meta: {
          symbol, currency, instrumentType,
          exchangeName: 'TEST', exchangeTimezoneName: timezone, dataGranularity: granularity,
          longName: `${symbol} long name`,
        },
        timestamp: rows.map(row => Math.floor(Date.parse(`${row.date}T15:00:00.000Z`) / 1000)),
        indicators: {
          quote: [{ close: rows.map(row => row.close) }],
          adjclose: [{ adjclose: rows.map(row => row.close) }],
        },
      }],
    },
  }));
}

test('status constant and disclosure posture are the frozen research-only contract', () => {
  assert.equal(mod.STATUS, 'RETROSPECTIVE_LONG_HISTORY_PROXY_DATA_ONLY_NOT_CONFIRMATORY');
  assert.equal(mod.FROZEN_MAPPING.containsStrategyOutcomes, false);
  assert.equal(mod.FROZEN_MAPPING.freezeMarker, 'FG_LONG_HISTORY_PROXY_FREEZE_MARKER: DRAFT_NOT_FROZEN_2026_08_28');
  assert.match(mod.FROZEN_MAPPING.noSpliceRule, /NO SPLICING/);
  const scores = mod.buildScoresArtifact({
    fetchedAt: '2026-08-28T00:00:00.000Z',
    computed: Object.fromEntries(mod.MARKET_ORDER.map(key => [key, { key, history: [] }])),
  });
  assert.equal(scores.containsStrategyOutcomes, false);
  assert.equal(scores.status, mod.STATUS);
});

test('committed mapping JSON matches the in-code config exactly (round-trip) with a valid sidecar', () => {
  const bytes = fs.readFileSync(mod.MAPPING_PATH);
  assert.equal(bytes.toString('utf8'), mod.stableJson(mod.FROZEN_MAPPING), 'committed freeze must be byte-identical to stableJson(FROZEN_MAPPING)');
  const parsed = JSON.parse(bytes.toString('utf8'));
  assert.deepEqual(parsed.researchMarketSymbols, JSON.parse(JSON.stringify(mod.RESEARCH_MARKET_SYMBOLS)));
  assert.deepEqual(parsed.engineParams, JSON.parse(JSON.stringify(mod.ENGINE_PARAMS)));
  const sidecar = fs.readFileSync(`${mod.MAPPING_PATH}.sha256`, 'utf8');
  assert.match(sidecar, /^[0-9a-f]{64}  FEAR_GREED_LONG_HISTORY_PROXY_MAPPING\.json\n$/);
  assert.equal(sidecar.slice(0, 64), mod.sha256Buffer(bytes));
  const verified = mod.verifyCommittedMapping();
  assert.equal(verified.sha256, sidecar.slice(0, 64));
  // 6 markets x 7 roles, every entry carrying a verbatim identity caveat.
  assert.equal(parsed.mapping.length, 42);
  for (const entry of parsed.mapping) {
    assert.ok(entry.market && entry.role && entry.instrument, `${entry.market}/${entry.role} incomplete`);
    assert.ok(typeof entry.identityCaveat === 'string' && entry.identityCaveat.length > 0);
  }
  assert.equal(parsed.projectedSpans.length, 6);
});

test('canonical serialization is recursively key-sorted, two-space, trailing-newline, and hash-stable', () => {
  const left = { z: 1, a: { y: 2, b: 3 }, list: [{ z: 4, a: 5 }] };
  const right = { list: [{ a: 5, z: 4 }], a: { b: 3, y: 2 }, z: 1 };
  assert.equal(mod.stableJson(left), mod.stableJson(right));
  assert.ok(mod.stableJson(left).endsWith('}\n'));
  assert.equal(mod.stableJson({ b: 1, a: 2 }), '{\n  "a": 2,\n  "b": 1\n}\n');
  assert.equal(mod.sha256Buffer(Buffer.from(mod.stableJson(left))), mod.sha256Buffer(Buffer.from(mod.stableJson(right))));
});

test('writeStableJson emits canonical bytes and the two-space sha256 sidecar format', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-longhist-'));
  const file = path.join(dir, 'artifact.json');
  const write = mod.writeStableJson(file, { b: 2, a: { d: 4, c: 3 } });
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString('utf8'), '{\n  "a": {\n    "c": 3,\n    "d": 4\n  },\n  "b": 2\n}\n');
  assert.equal(write.sha256, mod.sha256Buffer(bytes));
  assert.equal(fs.readFileSync(`${file}.sha256`, 'utf8'), `${write.sha256}  artifact.json\n`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI rejects all arguments before doing any work', () => {
  const result = spawnSync(process.execPath, [MODULE_PATH, '--help'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /accepts no arguments/);
  const second = spawnSync(process.execPath, [MODULE_PATH, 'run'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(second.status, 1);
  assert.match(second.stderr, /accepts no arguments/);
  assert.throws(() => mod.parseArgs(['--out-dir', 'x']), /accepts no arguments/);
  assert.deepEqual(mod.parseArgs([]), {});
});

test('research config pins ustech large explicitly to VFINX (never the null->index passthrough)', () => {
  const config = mod.buildResearchConfig(productionLikeMarketConfig());
  assert.equal(config.markets.ustech.symbols.large, 'VFINX');
  assert.equal(config.markets.ustech.symbols.index, '^IXIC');
  assert.notEqual(config.markets.ustech.symbols.large, null);
  // usa/global also pin the S&P 500 denominator; europe/sweden share VEURX.
  assert.equal(config.markets.usa.symbols.large, 'VFINX');
  assert.equal(config.markets.global.symbols.large, 'VFINX');
  assert.equal(config.markets.europe.symbols.large, 'VEURX');
  assert.equal(config.markets.europe.symbols.index, 'VEURX');
  assert.equal(config.markets.sweden.symbols.large, 'VEURX');
});

test('every market wires vol as the literal null realized-vol fallback', () => {
  const config = mod.buildResearchConfig(productionLikeMarketConfig());
  for (const key of mod.MARKET_ORDER) {
    assert.ok('vol' in config.markets[key].symbols, `${key} vol slot missing`);
    assert.strictEqual(config.markets[key].symbols.vol, null, `${key} vol slot must be literal null`);
  }
});

test('engine params must stay production-identical or the adapter refuses to build', () => {
  const production = productionLikeMarketConfig();
  assert.deepEqual(
    {
      modelId: production.modelId, version: production.version, range: production.range,
      window: production.window, minWindowPoints: production.minWindowPoints,
      minComponents: production.minComponents, fillDays: production.fillDays,
    },
    JSON.parse(JSON.stringify(mod.ENGINE_PARAMS)),
  );
  const drifted = JSON.parse(JSON.stringify(production));
  drifted.window = 200;
  assert.throws(() => mod.buildResearchConfig(drifted), /engine identity or parameters/);
});

test('crypto baskets carry the frozen fixed memberships and production bond/hy/ig/barPolicy', () => {
  const config = mod.buildResearchConfig(productionLikeMarketConfig());
  const symbols = config.markets.crypto.symbols;
  assert.equal(symbols.index.id, 'CRYPTO-BROAD-EW');
  assert.equal(symbols.index.method, 'equalWeightReturns');
  assert.deepEqual(symbols.index.symbols, ['BTC-USD', 'ETH-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD', 'BNB-USD']);
  assert.equal(symbols.small.id, 'CRYPTO-NONCORE-EW');
  assert.deepEqual(symbols.small.symbols, ['XRP-USD', 'ADA-USD', 'DOGE-USD', 'BNB-USD']);
  assert.equal(symbols.large.id, 'CRYPTO-CORE-EW');
  assert.deepEqual(symbols.large.symbols, ['BTC-USD', 'ETH-USD']);
  assert.equal(symbols.bond, 'IEF');
  assert.equal(symbols.hy, 'HYG');
  assert.equal(symbols.ig, 'LQD');
  assert.equal(config.markets.crypto.barPolicy, 'completed-utc-date');
  // SOL-USD must appear nowhere in the research crypto mapping (no splicing, fixed membership).
  assert.ok(!JSON.stringify(symbols).includes('SOL-USD'));
});

test('unique research symbol set matches the frozen identity contract', () => {
  const config = mod.buildResearchConfig(productionLikeMarketConfig());
  const symbols = mod.collectResearchSymbols(config);
  assert.deepEqual(symbols, Object.keys(mod.EXPECTED_INSTRUMENT_TYPES).sort());
  assert.equal(symbols.length, 19);
});

test('warnings carry every identity caveat verbatim plus every finalizer note', () => {
  const warnings = mod.buildWarnings();
  assert.equal(warnings.length, mod.FROZEN_MAPPING.mapping.length + mod.FROZEN_MAPPING.finalizerNotes.length);
  for (const entry of mod.FROZEN_MAPPING.mapping) {
    assert.ok(
      warnings.some(warning => warning.startsWith(`${entry.market}/${entry.role} `) && warning.endsWith(entry.identityCaveat)),
      `missing verbatim caveat for ${entry.market}/${entry.role}`,
    );
  }
  for (const note of mod.FROZEN_MAPPING.finalizerNotes) {
    assert.ok(warnings.includes(`finalizer-note: ${note}`), 'missing verbatim finalizer note');
  }
  const disclosureText = warnings.join('\n');
  assert.match(disclosureText, /1980-01-02.*feed floor|backfill floor/s);
  assert.match(disclosureText, /once-daily 4pm NAV/);
  assert.match(disclosureText, /FX translation/);
  assert.match(disclosureText, /universe-mismatched ratio/);
  assert.match(disclosureText, /\^IXIC is price-return/);
  assert.match(disclosureText, /realized/i);
  assert.match(disclosureText, /do NOT splice|no splicing/i);
});

test('Yahoo payload parser enforces identity, granularity, completed bars, and rejects non-finite closes', () => {
  const rows = [];
  for (let i = 0; i < 260; i++) rows.push({ date: dateAt(i), close: 100 + i });
  const fetchedAt = '2026-08-28T12:00:00.000Z';
  const good = mod.parseYahooChartPayload('IEF', yahooPayloadBytes({ symbol: 'IEF', instrumentType: 'ETF', rows }), fetchedAt);
  assert.equal(good.series.symbol, 'IEF');
  assert.equal(good.series.rows.length, 260);
  assert.equal(good.receipt.yahooMeta.instrumentType, 'ETF');
  assert.match(good.receipt.normalizedRowsSha256, /^[0-9a-f]{64}$/);

  // identity: wrong instrument type
  assert.throws(
    () => mod.parseYahooChartPayload('IEF', yahooPayloadBytes({ symbol: 'IEF', instrumentType: 'MUTUALFUND', rows }), fetchedAt),
    /instrumentType/,
  );
  // identity: wrong symbol echo
  assert.throws(
    () => mod.parseYahooChartPayload('IEF', yahooPayloadBytes({ symbol: 'HYG', instrumentType: 'ETF', rows }), fetchedAt),
    /meta\.symbol/,
  );
  // monthly-downgrade guard
  assert.throws(
    () => mod.parseYahooChartPayload('IEF', yahooPayloadBytes({ symbol: 'IEF', instrumentType: 'ETF', granularity: '1mo', rows }), fetchedAt),
    /dataGranularity/,
  );
  // completed bars only: a row on the retrieval-local date is excluded
  const withToday = rows.concat([{ date: '2026-08-28', close: 999 }]);
  const trimmed = mod.parseYahooChartPayload('IEF', yahooPayloadBytes({ symbol: 'IEF', instrumentType: 'ETF', timezone: 'UTC', rows: withToday }), fetchedAt);
  assert.equal(trimmed.series.lastDate, rows.at(-1).date);
  assert.equal(trimmed.receipt.excludedCurrentOrFutureRows, 1);
  // null gap padding is skipped and counted; NaN and non-positive closes abort
  const withNull = rows.map(row => ({ ...row }));
  withNull[5] = { date: withNull[5].date, close: null };
  const gapped = mod.parseYahooChartPayload('IEF', yahooPayloadBytes({ symbol: 'IEF', instrumentType: 'ETF', rows: withNull }), fetchedAt);
  assert.equal(gapped.receipt.skippedNullRows, 1);
  assert.equal(gapped.series.rows.length, 259);
  const withNaN = rows.map(row => ({ ...row }));
  withNaN[5] = { date: withNaN[5].date, close: 'not-a-number' };
  assert.throws(
    () => mod.parseYahooChartPayload('IEF', yahooPayloadBytes({ symbol: 'IEF', instrumentType: 'ETF', rows: withNaN }), fetchedAt),
    /non-finite or non-positive/,
  );
  const withZero = rows.map(row => ({ ...row }));
  withZero[5] = { date: withZero[5].date, close: 0 };
  assert.throws(
    () => mod.parseYahooChartPayload('IEF', yahooPayloadBytes({ symbol: 'IEF', instrumentType: 'ETF', rows: withZero }), fetchedAt),
    /non-finite or non-positive/,
  );
  // symbols outside the frozen mapping are refused
  assert.throws(
    () => mod.parseYahooChartPayload('SPY', yahooPayloadBytes({ symbol: 'SPY', instrumentType: 'ETF', rows }), fetchedAt),
    /not part of the frozen research mapping/,
  );
});

test('offline computeMarket smoke: the adapter produces all six components through the unmodified engine', () => {
  const config = mod.buildResearchConfig(productionLikeMarketConfig());
  const series = usaSeriesMap(700);
  const result = marketfg.computeMarket('usa', config.markets.usa, series, {
    window: mod.ENGINE_PARAMS.window,
    minWindowPoints: mod.ENGINE_PARAMS.minWindowPoints,
    minComponents: mod.ENGINE_PARAMS.minComponents,
    fillDays: mod.ENGINE_PARAMS.fillDays,
    includeHistoryParts: true,
  });
  assert.equal(result.total, 6);
  assert.equal(result.n, 6);
  assert.deepEqual(Object.keys(result.components).sort(), ['breadth', 'credit', 'momentum', 'safeHaven', 'strength', 'volatility']);
  assert.ok(result.history.length > 300, `expected a long six-component history, got ${result.history.length}`);
  for (const row of result.history) {
    assert.equal(row.n, 6);
    assert.ok(Number.isFinite(row.score) && row.score >= 0 && row.score <= 100);
    assert.deepEqual(Object.keys(row.parts).sort(), ['breadth', 'credit', 'momentum', 'safeHaven', 'strength', 'volatility']);
  }
  // volatility must be the realized fallback computed from the index series itself
  assert.deepEqual(result.components.volatility.symbols, ['VFINX']);
  assert.match(result.components.volatility.note, /realised 20-observation volatility/);
  // breadth denominator is the explicit VFINX pin
  assert.deepEqual(result.components.breadth.symbols, ['NAESX', 'VFINX']);
  assert.deepEqual(result.components.credit.symbols, ['VWEHX', 'VWESX']);
  assert.deepEqual(result.components.safeHaven.symbols, ['VFINX', 'FGOVX']);
  assert.equal(result.indexSymbol, 'VFINX');
  // and no strategy output leaks into the research artifact
  const trimmed = mod.trimMarketResult(result);
  assert.ok(!('expandingSignal' in trimmed));
  const spans = mod.achievedSpans({ ...Object.fromEntries(mod.MARKET_ORDER.map(key => [key, result])) });
  assert.equal(spans.length, 6);
  assert.equal(spans[0].market, 'usa');
  assert.equal(spans[0].firstScore, result.history[0].date);
  assert.equal(spans[0].lastScore, result.history.at(-1).date);
  assert.equal(spans[0].rows, result.history.length);
  assert.match(spans[0].projectedFirstScore, /1980-12-24/);
});

test('acquisition is injectable and offline-testable, honors pacing hooks, and produces receipts', async () => {
  const config = mod.buildResearchConfig(productionLikeMarketConfig());
  const rows = [];
  for (let i = 0; i < 260; i++) rows.push({ date: dateAt(i), close: 100 + i });
  const requested = [];
  const fetchImpl = async url => {
    requested.push(url);
    const symbol = decodeURIComponent(url.match(/\/chart\/([^?]+)\?/)[1]);
    const bytes = yahooPayloadBytes({
      symbol,
      instrumentType: mod.EXPECTED_INSTRUMENT_TYPES[symbol],
      timezone: symbol.endsWith('-USD') ? 'UTC' : 'America/New_York',
      rows,
    });
    return { ok: true, arrayBuffer: async () => bytes };
  };
  const acquisition = await mod.acquireAllSeries({
    researchConfig: config,
    fetchedAt: '2026-08-28T12:00:00.000Z',
    fetchImpl,
    sleepMs: 0,
  });
  assert.equal(acquisition.receipts.length, 19);
  assert.equal(acquisition.seriesMap.size, 19);
  assert.equal(requested.length, 19, 'one request per unique symbol when the first host succeeds');
  for (const url of requested) {
    assert.match(url, /^https:\/\/query1\.finance\.yahoo\.com\/v8\/finance\/chart\//);
    assert.match(url, /period1=0/);
    assert.match(url, /interval=1d/);
    assert.ok(!url.includes('range=max'), 'literal range=max would downgrade to monthly bars');
  }
  for (const receipt of acquisition.receipts) {
    assert.match(receipt.rawPayloadSha256, /^[0-9a-f]{64}$/);
    assert.ok(receipt.rawPayloadBase64.length > 0);
    assert.equal(Buffer.from(receipt.rawPayloadBase64, 'base64').length, receipt.rawResponseBytes);
    assert.equal(mod.sha256Buffer(Buffer.from(receipt.rawPayloadBase64, 'base64')), receipt.rawPayloadSha256);
  }
  // query2 is retried once when query1 fails
  const hostLog = [];
  const flaky = async url => {
    hostLog.push(url);
    if (url.includes('query1.')) throw new Error('query1 down');
    const symbol = decodeURIComponent(url.match(/\/chart\/([^?]+)\?/)[1]);
    const bytes = yahooPayloadBytes({ symbol, instrumentType: mod.EXPECTED_INSTRUMENT_TYPES[symbol], rows });
    return { ok: true, arrayBuffer: async () => bytes };
  };
  const single = await mod.fetchYahooSeriesWithReceipt('IEF', '2026-08-28T12:00:00.000Z', flaky);
  assert.equal(hostLog.length, 2);
  assert.match(hostLog[0], /query1\.finance\.yahoo\.com/);
  assert.match(hostLog[1], /query2\.finance\.yahoo\.com/);
  assert.match(single.receipt.sourceUrl, /query2\.finance\.yahoo\.com/);
});
