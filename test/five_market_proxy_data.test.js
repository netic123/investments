'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const data = require('../research/five_market_proxy_data');

function yahooPayload(definition, rows) {
  return Buffer.from(JSON.stringify({
    chart: {
      error: null,
      result: [{
        meta: {
          symbol: definition.ticker,
          currency: 'USD',
          instrumentType: 'ETF',
          exchangeName: 'PCX',
          exchangeTimezoneName: 'America/New_York',
          dataGranularity: '1d',
        },
        timestamp: rows.map(row => Math.floor(Date.parse(`${row.date}T20:00:00.000Z`) / 1000)),
        indicators: { adjclose: [{ adjclose: rows.map(row => row.value) }] },
      }],
    },
  }));
}

test('return types state the economic boundary and crypto is never executable', () => {
  assert.equal(data.RETURN_TYPES.CRYPTO, 'PRICE_RETURN_NONINVESTABLE_BACKCAST');
  assert.equal(data.RETURN_TYPES.ETF, 'USD_ETF_ADJUSTED_CLOSE_TOTAL_RETURN_PROXY');
  assert.equal(data.RETURN_TYPES.CASH, 'RECONSTRUCTED_91_DAY_TBILL_ACCRUAL_PROXY');
  assert.notEqual(data.RETURN_TYPES.CRYPTO, data.RETURN_TYPES.ETF);
});

test('stable JSON is recursively ordered and deterministic', () => {
  const left = { z: 1, a: { y: 2, b: 3 }, list: [{ z: 4, a: 5 }] };
  const right = { list: [{ a: 5, z: 4 }], a: { b: 3, y: 2 }, z: 1 };
  assert.equal(data.stableJson(left), data.stableJson(right));
  assert.equal(data.sha256(Buffer.from(data.stableJson(left))), data.sha256(Buffer.from(data.stableJson(right))));
  assert.equal(data.stableArtifactPath(data.DEFAULT_CMBITM_SNAPSHOT), 'research/local-artifacts/final-frozen/inputs/fear-greed-model-search-input-2026-08-24T22-13-44Z.json');
});

test('91-day cash wealth uses only a yield dated strictly before each accrual start', () => {
  const dailyAtOne = (1 / (1 - 0.01 * 91 / 360)) ** (1 / 91);
  const dailyAtTwo = (1 / (1 - 0.02 * 91 / 360)) ** (1 / 91);
  assert.ok(Math.abs(data.bankDiscountDailyFactor(2) - dailyAtTwo) < 1e-15);
  const built = data.buildDailyCashWealth([
    { date: '2020-01-02', percent: 1 },
    { date: '2020-01-03', percent: 2 },
    { date: '2020-01-06', percent: 3 },
  ], '2020-01-06');
  assert.deepEqual(built.rows.map(row => row.date), ['2020-01-03', '2020-01-04', '2020-01-05', '2020-01-06']);
  // Jan 3 -> Jan 4 must use Jan 2's rate, not the same-dated Jan 3 rate.
  assert.ok(Math.abs(built.rows[1].value - dailyAtOne) < 1e-14);
  assert.ok(Math.abs(built.rows.at(-1).value - dailyAtOne * dailyAtTwo ** 2) < 1e-14);
});

test('cash normalization stops when a DTB3 observation would be stale', () => {
  assert.throws(
    () => data.buildDailyCashWealth([
      { date: '2020-01-01', percent: 2 },
      { date: '2020-01-20', percent: 2 },
    ], '2020-01-20', 7),
    error => error && error.code === 'DATA_REQUIRED' && /stale/.test(error.message),
  );
});

test('normalizer rejects duplicate and post-cutoff rows rather than silently choosing data', () => {
  assert.throws(
    () => data.normalizePositiveRows([
      { date: '2026-08-24', close: 1 },
      { date: '2026-08-24', close: 2 },
    ], 'close', '2026-08-24', 'duplicate-fixture'),
    /duplicate date/,
  );
  assert.throws(
    () => data.normalizePositiveRows([
      { date: '2026-08-24', close: 1 },
      { date: '2026-08-25', close: 2 },
    ], 'close', '2026-08-24', 'future-fixture'),
    /after the completed-close cutoff/,
  );
});

test('Yahoo parser requires the expected USD ETF identity and excludes post-as-of rows', () => {
  const definition = data.ROBUSTNESS_ETFS[0];
  const bytes = yahooPayload(definition, [
    { date: '2026-08-23', value: 100 },
    { date: '2026-08-24', value: 101 },
    { date: '2026-08-25', value: 102 },
  ]);
  const parsed = data.parseYahooAdjustedClose(bytes, definition, '2026-08-24');
  assert.deepEqual(parsed.rows, [
    { date: '2026-08-23', value: 100 },
    { date: '2026-08-24', value: 101 },
  ]);

  const wrong = JSON.parse(bytes.toString('utf8'));
  wrong.chart.result[0].meta.currency = 'EUR';
  assert.throws(() => data.parseYahooAdjustedClose(Buffer.from(JSON.stringify(wrong)), definition, '2026-08-24'), /expected USD ETF/);
});

test('robustness collector preserves independent raw bytes, URLs, retrieval time and hashes', async () => {
  const sourceRows = [
    { date: '2026-08-23', value: 100 },
    { date: '2026-08-24', value: 101 },
  ];
  const payloads = new Map(data.ROBUSTNESS_ETFS.map(definition => [definition.ticker, yahooPayload(definition, sourceRows)]));
  const cache = await data.collectRobustnessCache({
    asOfDate: '2026-08-24',
    retrievedAt: '2026-08-25T20:00:00.000Z',
    fetchImpl: async url => {
      const ticker = data.ROBUSTNESS_ETFS.find(item => url.includes(`/${item.ticker}?`)).ticker;
      const bytes = payloads.get(ticker);
      return { ok: true, arrayBuffer: async () => bytes };
    },
  });
  assert.equal(cache.sources.length, 3);
  for (const source of cache.sources) {
    const raw = Buffer.from(source.rawPayloadBase64, 'base64');
    assert.equal(source.retrievedAt, '2026-08-25T20:00:00.000Z');
    assert.equal(source.rawResponseBytes, raw.length);
    assert.equal(source.rawPayloadSha256, data.sha256(raw));
    assert.match(source.sourceUrl, /^https:\/\/query1\.finance\.yahoo\.com\//);
    assert.equal(source.lastDate, '2026-08-24');
  }
});

test('sourceArtifact refuses a changed frozen file hash', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'five-market-proxy-'));
  const file = path.join(directory, 'source.json');
  fs.writeFileSync(file, '{"schema":1}\n');
  assert.throws(
    () => data.sourceArtifact(file, '0'.repeat(64)),
    error => error && error.code === 'DATA_REQUIRED' && /hash mismatch/.test(error.message),
  );
});

test('stable writer creates a byte-verifiable adjacent SHA-256 receipt', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'five-market-proxy-'));
  const file = path.join(directory, 'artifact.json');
  const written = data.writeStableJson(file, { z: 1, a: 2 });
  const bytes = fs.readFileSync(file);
  assert.equal(written.sha256, data.sha256(bytes));
  assert.equal(fs.readFileSync(`${file}.sha256`, 'utf8'), `${written.sha256}  artifact.json\n`);
  assert.equal(bytes.toString('utf8'), data.stableJson({ z: 1, a: 2 }));
});

const frozenSourcesAvailable = [
  data.DEFAULT_CMBITM_SNAPSHOT,
  data.DEFAULT_EQUITY_CACHE,
  data.DEFAULT_ROBUSTNESS_CACHE,
].every(file => fs.existsSync(file));

test('actual frozen caches normalize reproducibly with exact provenance and no strategy outcomes', { skip: !frozenSourcesAvailable }, () => {
  const cmbitmArtifact = data.sourceArtifact(data.DEFAULT_CMBITM_SNAPSHOT, data.EXPECTED_CMBITM_SNAPSHOT_SHA256);
  const equityArtifact = data.sourceArtifact(data.DEFAULT_EQUITY_CACHE, data.EXPECTED_EQUITY_CACHE_SHA256);
  const robustnessArtifact = data.sourceArtifact(data.DEFAULT_ROBUSTNESS_CACHE);
  const first = data.buildInput({ cmbitmArtifact, equityArtifact, robustnessArtifact, asOfDate: '2026-08-24' });
  const second = data.buildInput({ cmbitmArtifact, equityArtifact, robustnessArtifact, asOfDate: '2026-08-24' });
  assert.equal(data.stableJson(first), data.stableJson(second));
  assert.equal(first.sourceCorrection.prohibitedDescription, 'Do not describe CMBITM as sourced from schemaVersion 5.');
  assert.deepEqual(first.markets.map(item => item.primary.ticker), ['CMBITM', 'EWD', 'IYY', 'IEV', 'ACWI']);
  assert.equal(first.markets[0].primary.returnType, 'PRICE_RETURN_NONINVESTABLE_BACKCAST');
  assert.equal(first.markets[0].primary.executable, false);
  assert.equal(first.markets[0].primary.source.rawPayloadSha256, data.EXPECTED_CMBITM_RAW_SHA256);
  assert.deepEqual(first.markets.flatMap(item => item.robustness).map(item => item.ticker), ['SPY', 'VGK', 'SPGM']);
  assert.ok(first.markets.flatMap(item => item.robustness).every(item => item.replacementPolicy === 'PREDECLARED_ROBUSTNESS_ONLY_NEVER_POST_RESULT_PRIMARY_REPLACEMENT'));
  assert.equal(first.historyPanels.investableEquityPrimaryLongHistory.strictCommonHistory.firstDate, '2008-03-28');
  assert.equal(first.historyPanels.fiveMarketPrimary.strictCommonHistory.firstDate, '2019-07-01');
  assert.equal(first.historyPanels.fiveMarketPrimary.strictCommonHistory.lastDate, '2026-08-24');
  assert.equal(first.cash.returnType, 'RECONSTRUCTED_91_DAY_TBILL_ACCRUAL_PROXY');
  assert.equal(first.cash.executable, false);
  assert.equal(first.cash.source.informationLagRule, 'STRICTLY_PRIOR_OBSERVATION_DATE_FOR_EACH_ACCRUAL_START_DATE');

  const inputBytes = Buffer.from(data.stableJson(first));
  const manifest = data.freezeManifest(first, {
    absolutePath: data.DEFAULT_OUTPUT,
    bytes: inputBytes.length,
    sha256: data.sha256(inputBytes),
  }, [cmbitmArtifact, equityArtifact, robustnessArtifact]);
  for (const receipt of [...manifest.primarySeries, ...manifest.robustnessSeries, manifest.cash]) {
    assert.match(receipt.sourceUrl, /^https:\/\//);
    assert.match(receipt.retrievedAt, /^2026-08-(24|25)T/);
    assert.match(receipt.rawPayloadSha256, /^[0-9a-f]{64}$/);
    assert.match(receipt.sourceArtifactSha256, /^[0-9a-f]{64}$/);
  }

  const forbiddenKeys = new Set(['cagr', 'sharpe', 'terminalWealth', 'signal', 'signals', 'weights', 'allocation', 'forecast']);
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `forbidden strategy-outcome key present: ${key}`);
      visit(child);
    }
  };
  visit(first);
});

test('tampering a robustness raw payload fails before normalization', { skip: !frozenSourcesAvailable }, () => {
  const raw = JSON.parse(fs.readFileSync(data.DEFAULT_ROBUSTNESS_CACHE, 'utf8'));
  raw.sources[0].rawPayloadBase64 = Buffer.from('tampered').toString('base64');
  assert.throws(
    () => data.buildRobustnessEtfSeries(raw, { path: 'fixture', sha256: 'a'.repeat(64) }, data.ROBUSTNESS_ETFS[0], '2026-08-24'),
    error => error && error.code === 'DATA_REQUIRED' && /bytes\/hash mismatch/.test(error.message),
  );
});
