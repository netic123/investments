'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

const validation = require('../research/fear_greed_v2_validation');

// data/config.json has deliberately grown beyond the schema-5 freeze (the
// ustech market was added 2026-08-27 and production moved to expanding-history
// v3). The frozen runner must keep refusing that evolved config — asserted in the last test below — while every other
// frozen-behaviour test needs the runner to see exactly the five frozen
// production markets it was sealed against. Reads of data/config.json are
// therefore served the frozen-five subset of the real file; the five frozen
// mappings themselves are still compared against the live file untouched.
const FROZEN_PRODUCTION_KEYS = ['crypto', 'europe', 'global', 'sweden', 'usa'];
const CONFIG_FILE = path.resolve(__dirname, '..', 'data', 'config.json');
const realReadFileSync = fs.readFileSync.bind(fs);
function frozenFiveConfigText() {
  const full = JSON.parse(realReadFileSync(CONFIG_FILE, 'utf8'));
  Object.assign(full.marketFearGreed, {
    modelId: validation.MODEL_CONTRACT.id,
    version: validation.MODEL_CONTRACT.version,
    range: validation.MODEL_CONTRACT.range,
    window: validation.MODEL_CONTRACT.window,
    minWindowPoints: validation.MODEL_CONTRACT.minWindowPoints,
    minComponents: validation.MODEL_CONTRACT.minComponents,
    fillDays: validation.MODEL_CONTRACT.fillDays,
  });
  delete full.marketFearGreed.percentileMode;
  delete full.marketFearGreed.strengthWindow;
  delete full.marketFearGreed.percentileMinPoints;
  full.marketFearGreed.markets = Object.fromEntries(
    FROZEN_PRODUCTION_KEYS.map(key => [key, full.marketFearGreed.markets[key]]));
  return JSON.stringify(full);
}
fs.readFileSync = function readFileSyncServingFrozenConfig(file, options) {
  if (typeof file === 'string' && path.resolve(file) === CONFIG_FILE) {
    const text = frozenFiveConfigText();
    const encoding = typeof options === 'string' ? options : options && options.encoding;
    return encoding ? text : Buffer.from(text);
  }
  return realReadFileSync(file, options);
};

const TEST_PROTOCOL_STATE = Object.freeze({
  marker: validation.REQUIRED_FROZEN_PROTOCOL_MARKER,
  frozenAt: '2026-08-24T00:00:00.000Z',
  mode: validation.REQUIRED_FROZEN_MODE,
});
const COLLECTION_TIME = '2026-08-25T00:00:00.000Z';

function isoDate(index) {
  const date = new Date('2019-01-01T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sourceCodeIdentity() {
  const root = path.join(__dirname, '..');
  const files = {
    marketfgSha256: path.join(root, 'marketfg.js'),
    configSha256: path.join(root, 'data', 'config.json'),
    runnerSha256: path.join(root, 'research', 'fear_greed_v2_validation.js'),
    protocolSha256: path.join(root, 'research', 'FEAR_GREED_V2_VALIDATION_PROTOCOL.md'),
    schema4MathSha256: path.join(root, 'research', 'fear_greed_model_search.js'),
  };
  return {
    nodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
    ...Object.fromEntries(Object.entries(files).map(([key, file]) => [key, sha256File(file)])),
  };
}

function syntheticYahooPayload(symbol, symbolIndex, points) {
  let close = 70 + symbolIndex * 2.7;
  const closes = [];
  for (let index = 0; index < points; index++) {
    const logReturn = 0.0003 +
      0.0028 * Math.sin((index + symbolIndex * 3) / (8.3 + (symbolIndex % 5))) +
      0.0015 * Math.cos((index + symbolIndex * 7) / (21.1 + (symbolIndex % 3))) +
      0.0007 * Math.sin(index / (3.6 + (symbolIndex % 4) * 0.2));
    close *= Math.exp(logReturn);
    closes.push(close);
  }
  return JSON.stringify({
    chart: {
      result: [{
        meta: { symbol, exchangeTimezoneName: 'UTC', longName: `Synthetic ${symbol}`, currency: 'USD' },
        timestamp: Array.from({ length: points }, (_, index) => Date.parse(`${isoDate(index)}T12:00:00.000Z`) / 1000),
        indicators: { quote: [{ close: closes }], adjclose: [{ adjclose: closes.slice() }] },
      }],
      error: null,
    },
  });
}

function syntheticYahooUrl(symbol) {
  const period2 = Math.floor(Date.parse(COLLECTION_TIME) / 1000) + 86400;
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=0&period2=${period2}&interval=1d&events=div%2Csplits`;
}

function syntheticRawSeries(points = 600) {
  return new Map(validation.frozenDependencySymbols().map((symbol, index) => {
    const payload = syntheticYahooPayload(symbol, index, points);
    const series = validation.normalizeYahooPayload(payload, {
      symbol,
      fetchedAt: COLLECTION_TIME,
      sourceUrl: syntheticYahooUrl(symbol),
    });
    return [symbol, series];
  }));
}

function syntheticSnapshot(points = 600) {
  const rawSeries = syntheticRawSeries(points);
  const markets = validation.MARKET_SPECS.map(spec => {
    const target = validation.resolveProductionTarget(spec, rawSeries);
    const construction = target.construction || (target.adjusted
      ? 'direct Yahoo completed adjusted-close series'
      : 'direct Yahoo completed raw-close series');
    return {
      key: spec.key,
      name: spec.name,
      targetId: spec.targetId,
      targetSpec: deepClone(spec.targetSpec),
      annualization: spec.annualization,
      requiredComponents: 6,
      productionMapping: {
        barPolicy: spec.barPolicy || 'exchange-local daily bars',
        symbols: deepClone(validation.FROZEN_MARKET_SYMBOLS[spec.key]),
      },
      signals: validation.reconstructFrozenSignals(spec, rawSeries, COLLECTION_TIME.slice(0, 10)),
      prices: {
        symbol: target.symbol,
        name: target.name,
        currency: target.currency || null,
        timezone: target.tz || null,
        adjusted: !!target.adjusted,
        fetchedAt: target.fetchedAt,
        construction,
        sourceSymbols: target.sourceSymbols || [target.symbol],
        rows: target.rows.map(row => ({ date: row.date, close: row.close })),
      },
    };
  });
  return {
    schemaVersion: 5,
    createdAt: COLLECTION_TIME,
    freezeAt: TEST_PROTOCOL_STATE.frozenAt,
    protocolFreeze: deepClone(TEST_PROTOCOL_STATE),
    status: validation.STATUS,
    purpose: 'synthetic schema-5 replay fixture',
    frozenDesign: deepClone(validation.FROZEN_DESIGN),
    analysisPlan: { rankChallengers: true },
    sourceCode: sourceCodeIdentity(),
    sources: {
      yahoo: {
        endpointTemplate: 'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}',
        fetchedAt: COLLECTION_TIME,
        effectiveCryptoUtcCutoff: COLLECTION_TIME.slice(0, 10),
        partialBarPolicy: validation.YAHOO_PARTIAL_BAR_POLICY,
        adjustmentPolicy: validation.YAHOO_ADJUSTMENT_POLICY,
        normalizedSeriesInventory: validation.rawSeriesInventory(rawSeries),
      },
      targets: {
        identity: 'synthetic exact configured targets',
        normalizedSeriesInventory: validation.targetSeriesInventory(markets),
      },
    },
    assumptions: { historyStatus: 'synthetic retrospective development only' },
    markets,
  };
}

function snapshotOptions() {
  return { protocolState: TEST_PROTOCOL_STATE };
}

function assertSidecarMatches(file, checksumFile) {
  const recorded = fs.readFileSync(checksumFile, 'utf8').trim().split(/\s+/)[0];
  assert.equal(recorded, sha256File(file));
}

test('protocol parser accepts only the deliberate draft/frozen gate states and draft blocks live', () => {
  const draft = validation.parseProtocolFreezeState([
    '<!-- SCHEMA5_FREEZE_MARKER: DRAFT_NOT_FROZEN -->',
    '<!-- SCHEMA5_FREEZE_AT: NOT_FROZEN -->',
    '<!-- SCHEMA5_FREEZE_MODE: rankChallengers=true -->',
  ].join('\n'));
  assert.equal(draft.marker, validation.DRAFT_PROTOCOL_MARKER);
  assert.equal(draft.frozenAt, null);
  assert.throws(() => validation.assertProtocolFrozen(draft), /live schema-5 collection is disabled/);

  const current = validation.parseProtocolFreezeState();
  if (current.marker === validation.DRAFT_PROTOCOL_MARKER) assert.equal(current.frozenAt, null);
  else assert.equal(validation.assertProtocolFrozen(current), current);
});

test('all five production mappings, complete candidate definitions and the 15-candidate ceiling are frozen', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'config.json'), 'utf8')).marketFearGreed;
  assert.equal(validation.validateModelConfig(config), config);
  const badSweden = deepClone(config);
  badSweden.markets.sweden.symbols.bond = 'WRONG';
  assert.throws(() => validation.validateModelConfig(badSweden), /sweden complete production symbols/);
  const badCryptoPolicy = deepClone(config);
  badCryptoPolicy.markets.crypto.barPolicy = 'exchange-local daily bars';
  assert.throws(() => validation.validateModelConfig(badCryptoPolicy), /bar policy drifted/);

  const candidates = validation.buildCandidates();
  assert.equal(candidates.length, 15);
  assert.equal(validation.MAXIMUM_CANDIDATES, 15);
  assert.deepEqual(validation.FROZEN_DESIGN.candidates, candidates);
  assert.deepEqual(validation.FROZEN_DESIGN.dependencySymbols, validation.frozenDependencySymbols());
  assert.throws(() => validation.buildCommonObservations(syntheticSnapshot().markets[0], [...candidates, { ...candidates[0], id: 'candidate_16' }]), /exactly 15/);

  const drifted = syntheticSnapshot();
  drifted.frozenDesign.candidates[0].normalizedWeights[0] += 0.01;
  assert.throws(() => validation.validateSnapshot(drifted, snapshotOptions()), /frozen design/);

  const rawCloseMarket = syntheticSnapshot().markets[1];
  rawCloseMarket.prices.construction = null;
  rawCloseMarket.prices.adjusted = false;
  assert.equal(
    validation.targetSeriesInventory([rawCloseMarket])[0].construction,
    'direct Yahoo completed raw-close series',
  );
});

test('production Crypto target is the strict-common-date equalWeightReturns identity', () => {
  const sources = new Map();
  const dayReturns = [0.10, 0.20, -0.10, 0, 0.05, -0.05, 0.15];
  validation.CRYPTO_CONSTITUENTS.forEach((symbol, index) => {
    const second = 100 * (1 + dayReturns[index]);
    const rows = [
      { date: '2026-01-01', close: 100 },
      { date: '2026-01-02', close: second },
      { date: '2026-01-03', close: second * 1.10 },
    ];
    if (index === 0) rows.push({ date: '2026-01-04', close: second * 1.11 });
    sources.set(symbol, { symbol, currency: 'USD', adjusted: true, fetchedAt: '2026-01-05T00:00:00.000Z', rows });
  });
  const target = validation.resolveProductionTarget(validation.MARKET_SPECS[0], sources);
  assert.equal(target.symbol, 'CRYPTO-BROAD-EW');
  assert.deepEqual(target.rows.map(row => row.date), ['2026-01-01', '2026-01-02', '2026-01-03']);
  assert.ok(Math.abs(target.rows[1].close - 105) < 1e-12);
  assert.ok(Math.abs(target.rows[2].close - 115.5) < 1e-12);
  sources.delete('BNB-USD');
  assert.throws(() => validation.resolveProductionTarget(validation.MARKET_SPECS[0], sources), /could not be constructed/);
});

test('exact published equal_s1 identity and all challenger smoothing are causal', () => {
  const snapshot = syntheticSnapshot();
  const original = snapshot.markets[0];
  const changed = deepClone(original);
  const cutoff = 430;
  for (const signal of changed.signals) {
    if (signal.date > isoDate(cutoff)) {
      for (const key of validation.COMPONENT_KEYS) signal.components[key].score = 100 - signal.components[key].score;
      signal.publishedScore = validation.productionRoundedScore(signal.components);
    }
  }
  const first = validation.buildCommonObservations(original).returnRows;
  const second = validation.buildCommonObservations(changed).returnRows;
  assert.deepEqual(second.filter(row => row.signalDate <= isoDate(cutoff)), first.filter(row => row.signalDate <= isoDate(cutoff)));
  assert.notDeepEqual(
    second.filter(row => row.signalDate > isoDate(cutoff)).map(row => row.candidateScores.trend_breadth_s21),
    first.filter(row => row.signalDate > isoDate(cutoff)).map(row => row.candidateScores.trend_breadth_s21),
  );
  for (const row of first) assert.equal(row.candidateScores.equal_s1, row.publishedProductionScore);
  assert.equal(first[0].signalDate, original.signals[20].date);

  const mismatch = deepClone(snapshot);
  mismatch.markets[0].signals[0].publishedScore += 0.1;
  assert.throws(() => validation.validateSnapshot(mismatch, snapshotOptions()), /published equal_s1 score differs/);
});

test('zero future volatility removes only the secondary risk row, never the primary return row', () => {
  const market = deepClone(syntheticSnapshot().markets[0]);
  const constant = market.prices.rows[300].close;
  for (let index = 300; index <= 321; index++) market.prices.rows[index].close = constant;
  const common = validation.buildCommonObservations(market);
  const signalDate = market.prices.rows[299].date;
  assert.ok(common.returnRows.some(row => row.signalDate === signalDate), 'the zero-volatility outcome must remain in primary returns');
  assert.ok(!common.riskRows.some(row => row.signalDate === signalDate), 'the same row must be absent only from secondary risk');
  assert.equal(common.returnRows.length - common.riskRows.length, common.audit.zeroFutureVolatility);
});

test('t, t+1, t+22, controls, return and risk timing match hand calculations', () => {
  const market = syntheticSnapshot().markets[2];
  const common = validation.buildCommonObservations(market);
  const row = common.returnRows.find(candidate => candidate.signalIndex === 350);
  const riskRow = common.riskRows.find(candidate => candidate.signalDate === row.signalDate);
  const prices = market.prices.rows;
  assert.equal(row.entryIndex, 351);
  assert.equal(row.exitIndex, 372);
  assert.equal(row.entryDate, prices[351].date);
  assert.equal(row.exitDate, prices[372].date);
  assert.ok(Math.abs(row.forwardReturn - (prices[372].close / prices[351].close - 1)) < 1e-15);
  assert.ok(Math.abs(row.controls.lagReturn1 - (prices[350].close / prices[349].close - 1)) < 1e-15);
  assert.ok(Math.abs(row.controls.lagReturn5 - (prices[350].close / prices[345].close - 1)) < 1e-15);
  assert.ok(Math.abs(row.controls.lagReturn20 - (prices[350].close / prices[330].close - 1)) < 1e-15);
  const average125 = prices.slice(226, 351).reduce((sum, item) => sum + item.close, 0) / 125;
  assert.ok(Math.abs(row.controls.trend125 - (prices[350].close / average125 - 1)) < 1e-15);
  const trailingLogs = [];
  for (let index = 331; index <= 350; index++) trailingLogs.push(Math.log(prices[index].close / prices[index - 1].close));
  const trailingMean = trailingLogs.reduce((sum, value) => sum + value, 0) / trailingLogs.length;
  const trailingSd = Math.sqrt(trailingLogs.reduce((sum, value) => sum + ((value - trailingMean) ** 2), 0) / (trailingLogs.length - 1));
  assert.ok(Math.abs(row.controls.realizedVol20 - trailingSd * Math.sqrt(252)) < 1e-15);
  const futureLogs = [];
  for (let index = 352; index <= 372; index++) futureLogs.push(Math.log(prices[index].close / prices[index - 1].close));
  const futureMean = futureLogs.reduce((sum, value) => sum + value, 0) / futureLogs.length;
  const futureSd = Math.sqrt(futureLogs.reduce((sum, value) => sum + ((value - futureMean) ** 2), 0) / (futureLogs.length - 1));
  assert.ok(Math.abs(riskRow.futureLogVol - Math.log(futureSd * Math.sqrt(252))) < 1e-15);
});

test('selection, nomination thresholds and incomplete five-tab BH family are exact', () => {
  const candidates = validation.buildCandidates();
  const ledger = [
    { candidate: candidates[0], validAllMarkets: true, positiveMarketCount: 5, worstMarketImprovement: 0.01, equalMarketMeanImprovement: 0.03 },
    { candidate: candidates[1], validAllMarkets: true, positiveMarketCount: 5, worstMarketImprovement: 0.02, equalMarketMeanImprovement: 0.025 },
    { candidate: candidates[2], validAllMarkets: true, positiveMarketCount: 4, worstMarketImprovement: 0.04, equalMarketMeanImprovement: 0.05 },
  ];
  assert.equal(validation.selectDevelopmentCandidate(ledger).candidate.id, candidates[1].id);

  const selected = {
    candidate: candidates[1],
    positiveMarketCount: 5,
    equalMarketMeanImprovement: 0.005,
    markets: Object.fromEntries(validation.MARKET_SPECS.map(spec => [spec.key, {
      scoreCoefficientSigns: { positiveFraction: 0.70, negativeFraction: 0.30 },
    }])),
  };
  assert.equal(validation.nominationDecision(selected).nominated, true);
  selected.markets.global.scoreCoefficientSigns.positiveFraction = 0.69;
  assert.equal(validation.nominationDecision(selected).nominated, false);

  const byMarket = Object.fromEntries(validation.MARKET_SPECS.map(spec => [spec.key, {
    ok: true,
    pairedLossDifferences: Array.from({ length: 40 }, (_, index) => ({ signalDate: isoDate(index), lossDifference: 0.1 + index / 1000 })),
  }]));
  byMarket.global = { ok: false, reason: 'synthetic missing statistic' };
  const inference = validation.addDescriptiveInference(byMarket);
  assert.equal(inference.completeFamily, false);
  assert.ok(inference.tests.every(item => item.qValue === null));
});

test('snapshot replay rejects payload, non-target rows, symbols, score dates and runtime provenance tampering', () => {
  const original = syntheticSnapshot();
  const options = snapshotOptions();
  assert.equal(validation.validateSnapshot(original, options), original);

  const rawPayload = deepClone(original);
  const rawEntry = rawPayload.sources.yahoo.normalizedSeriesInventory[0];
  const bytes = Buffer.from(rawEntry.rawResponsePayloadBase64, 'base64');
  bytes[0] ^= 1;
  rawEntry.rawResponsePayloadBase64 = bytes.toString('base64');
  assert.throws(() => validation.validateSnapshot(rawPayload, options), /raw Yahoo payload hash\/length mismatch/);

  const wrongRequest = deepClone(original);
  wrongRequest.sources.yahoo.normalizedSeriesInventory[0].sourceUrl = 'https://example.com/v8/finance/chart/WRONG?period1=0&period2=1&interval=1d&events=div%2Csplits';
  assert.throws(() => validation.validateSnapshot(wrongRequest, options), /source host/);
  const wrongMetaSymbol = deepClone(original);
  const metaEntry = wrongMetaSymbol.sources.yahoo.normalizedSeriesInventory[0];
  const metaPayload = JSON.parse(Buffer.from(metaEntry.rawResponsePayloadBase64, 'base64').toString('utf8'));
  metaPayload.chart.result[0].meta.symbol = 'WRONG';
  const metaBytes = Buffer.from(JSON.stringify(metaPayload), 'utf8');
  metaEntry.rawResponsePayloadBase64 = metaBytes.toString('base64');
  metaEntry.rawResponseBytes = metaBytes.length;
  metaEntry.rawResponseSha256 = validation.sha256Buffer(metaBytes);
  assert.throws(() => validation.validateSnapshot(wrongMetaSymbol, options), /meta\.symbol differs/);

  const normalizedNonTarget = deepClone(original);
  const nonTarget = normalizedNonTarget.sources.yahoo.normalizedSeriesInventory.find(entry => entry.symbol === 'HYG');
  nonTarget.normalizedRows[10].close += 1;
  assert.throws(() => validation.validateSnapshot(normalizedNonTarget, options), /replayed Yahoo normalization/);

  const coordinatedSignalTamper = deepClone(original);
  const changedSignal = coordinatedSignalTamper.markets[0].signals[40];
  for (const key of validation.COMPONENT_KEYS) changedSignal.components[key].score += 0.01;
  changedSignal.publishedScore = validation.productionRoundedScore(changedSignal.components);
  assert.throws(() => validation.validateSnapshot(coordinatedSignalTamper, options), /complete signals reconstructed/);

  const missingSymbol = deepClone(original);
  missingSymbol.sources.yahoo.normalizedSeriesInventory.pop();
  assert.throws(() => validation.validateSnapshot(missingSymbol, options), /dependency symbol set/);
  const duplicateSymbol = deepClone(original);
  duplicateSymbol.sources.yahoo.normalizedSeriesInventory.push(deepClone(duplicateSymbol.sources.yahoo.normalizedSeriesInventory[0]));
  assert.throws(() => validation.validateSnapshot(duplicateSymbol, options), /duplicate symbol/);

  const badAsOf = deepClone(original);
  const signal = badAsOf.markets[0].signals[0];
  signal.components.momentum.asOf = isoDate(120);
  assert.throws(() => validation.validateSnapshot(badAsOf, options), /invalid\/non-causal momentum/);
  const badSignalDate = deepClone(original);
  badSignalDate.markets[0].signals[0].date = '2018-01-01';
  assert.throws(() => validation.validateSnapshot(badSignalDate, options), /invalid signal/);
  const runtimeDrift = deepClone(original);
  runtimeDrift.sourceCode.platform = 'different-platform';
  assert.throws(() => validation.validateSnapshot(runtimeDrift, options), /Node version\/platform/);
  const freezeIdentityDrift = deepClone(original);
  freezeIdentityDrift.freezeAt = '2026-08-23T00:00:00.000Z';
  assert.throws(() => validation.validateSnapshot(freezeIdentityDrift, options), /freezeAt differs/);
  const collectionBeforeFreeze = deepClone(original);
  collectionBeforeFreeze.createdAt = '2026-08-23T00:00:00.000Z';
  assert.throws(() => validation.validateSnapshot(collectionBeforeFreeze, options), /createdAt precedes/);
});

test('saved replay is network-free, deterministic, checksum-verified and never confirmatory', { timeout: 60000 }, async t => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-v2-replay-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const snapshot = syntheticSnapshot();
  const written = validation.writeSnapshot(snapshot, temporaryRoot, 'synthetic', snapshotOptions());
  assertSidecarMatches(written.file, written.checksumFile);
  const reread = validation.readSnapshot(written.file, snapshotOptions());
  assert.equal(reread.checksumVerified, true);

  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('network access attempted during replay'); };
  t.after(() => { global.fetch = originalFetch; });
  const first = await validation.runStudy(
    { snapshot: written.file, outDir: path.join(temporaryRoot, 'first'), rankChallengers: null },
    validation.createSyntheticTestRuntime({ stamp: 'first', protocolState: TEST_PROTOCOL_STATE }),
  );
  const second = await validation.runStudy(
    { snapshot: written.file, outDir: path.join(temporaryRoot, 'second'), rankChallengers: null },
    validation.createSyntheticTestRuntime({ stamp: 'second', protocolState: TEST_PROTOCOL_STATE }),
  );
  assert.equal(first.execution.networkUsed, false);
  assert.equal(first.results.analysisFingerprintSha256, second.results.analysisFingerprintSha256);
  assert.equal(first.results.status, validation.STATUS);
  assert.equal(first.results.confirmatoryOutcomeAvailable, false);
  assert.equal(first.results.historicalFinalOrHoldoutUsed, false);
  assert.equal(first.results.historicalReliabilityClaimAllowed, false);
  assert.equal(first.results.challengers.evaluatedCandidates, 15);
  assert.equal(first.results.challengers.ledger.length, 15);
  assert.match(first.results.conclusion, /NO_CONFIRMATORY_OUTCOME/);
  for (const spec of validation.MARKET_SPECS) {
    assert.ok(first.results.production.return[spec.key].blocks.every(block => block.outcomeAvailabilityVerified));
    assert.ok(first.results.production.return[spec.key].blocks.every(block => block.maximumTrainingExitIndex <= block.forecastOriginSignalIndex));
    assert.equal(typeof first.results.adequacy[spec.key].forecastRows, 'number');
  }
  assertSidecarMatches(first.outputs.jsonFile, first.outputs.jsonChecksumFile);
  assertSidecarMatches(first.outputs.reportFile, first.outputs.reportChecksumFile);
});

test('draft/failure gates prevent network and one successful synthetic live snapshot permanently consumes the live gate', { timeout: 60000 }, async t => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-v2-live-gate-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const lockPath = path.join(temporaryRoot, 'global.lock');
  const receiptPath = path.join(temporaryRoot, 'receipt.json');
  const args = { snapshot: null, outDir: path.join(temporaryRoot, 'out'), rankChallengers: true };
  let collectorCalls = 0;
  await assert.rejects(
    validation.runStudy(args, {
      protocolState: TEST_PROTOCOL_STATE,
      liveLockPath: lockPath,
      liveReceiptPath: receiptPath,
      collectLiveSnapshot: async () => { collectorCalls++; return syntheticSnapshot(600); },
    }),
    /runtime overrides are restricted/,
  );
  assert.equal(collectorCalls, 0);
  await assert.rejects(
    validation.runStudy(args, validation.createSyntheticTestRuntime({
      protocolState: { marker: validation.DRAFT_PROTOCOL_MARKER, frozenAt: null, mode: validation.REQUIRED_FROZEN_MODE },
      liveLockPath: lockPath, liveReceiptPath: receiptPath,
      collectLiveSnapshot: async () => { collectorCalls++; throw new Error('must not be called'); },
    })),
    /live schema-5 collection is disabled/,
  );
  assert.equal(collectorCalls, 0);
  assert.equal(fs.existsSync(lockPath), false);

  await assert.rejects(
    validation.runStudy(args, validation.createSyntheticTestRuntime({
      protocolState: TEST_PROTOCOL_STATE, liveLockPath: lockPath, liveReceiptPath: receiptPath,
      collectLiveSnapshot: async () => { throw new Error('synthetic pre-snapshot fetch failure'); },
    })),
    /synthetic pre-snapshot fetch failure/,
  );
  assert.equal(fs.existsSync(lockPath), false, 'a failed pre-snapshot collection may release only its own lock');
  assert.equal(fs.existsSync(receiptPath), false);

  const snapshot = syntheticSnapshot(600);
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('network must not be used by injected synthetic collector'); };
  t.after(() => { global.fetch = originalFetch; });
  const successRuntime = validation.createSyntheticTestRuntime({
    protocolState: TEST_PROTOCOL_STATE,
    liveLockPath: lockPath,
    liveReceiptPath: receiptPath,
    stamp: 'single-success',
    collectLiveSnapshot: async () => { collectorCalls++; return snapshot; },
  });
  const completed = await validation.runStudy(args, successRuntime);
  assert.equal(completed.results.status, validation.STATUS);
  assert.equal(fs.existsSync(receiptPath), true);
  assert.equal(fs.existsSync(lockPath), false);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.snapshotSha256, completed.snapshotWritten.sha256);
  assert.equal(receipt.status, 'SUCCESSFUL_LIVE_SNAPSHOT_WRITTEN_NO_SECOND_COLLECTION_ALLOWED');

  await assert.rejects(validation.runStudy(args, successRuntime), /already consumed/);
  assert.equal(collectorCalls, 1, 'the second live attempt must fail before invoking any collector');
});

test('production config evolved to v3: frozen five mappings remain intact and the frozen v2 runner refuses it', () => {
  const live = JSON.parse(realReadFileSync(CONFIG_FILE, 'utf8')).marketFearGreed;
  for (const key of FROZEN_PRODUCTION_KEYS) {
    assert.deepEqual(live.markets[key].symbols, validation.FROZEN_MARKET_SYMBOLS[key], `${key} frozen production mapping drifted in the live config`);
  }
  assert.ok(Object.keys(live.markets).includes('ustech'), 'the additive ustech market is expected in the live config');
  assert.throws(() => validation.validateModelConfig(live), /production model contract drifted/);
});
