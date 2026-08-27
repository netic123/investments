'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

const search = require('../research/fear_greed_model_search');

function isoDate(index) {
  const date = new Date('2019-01-01T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
}

function dateFrom(base, days) {
  const date = new Date(`${base}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function adequacyRows(count, calendarSpanDays = 1600) {
  return Array.from({ length: count }, (_, index) => ({
    signalIndex: index,
    entryIndex: index,
    exitIndex: index + 21,
    entryDate: index === 0 ? '2020-01-01' : dateFrom('2020-01-01', Math.floor(calendarSpanDays * index / Math.max(1, count - 1))),
    exitDate: index === count - 1 ? dateFrom('2020-01-01', calendarSpanDays) : dateFrom('2020-01-01', Math.floor(calendarSpanDays * index / Math.max(1, count - 1)) + 21),
  }));
}

function signalRows(count = 90) {
  return Array.from({ length: count }, (_, index) => ({
    date: isoDate(index),
    componentCount: 6,
    components: Object.fromEntries(search.COMPONENT_KEYS.map((key, componentIndex) => [key, {
      score: 50 + 18 * Math.sin((index + componentIndex * 7) / (9 + componentIndex)) + 6 * Math.cos(index / (17 + componentIndex)),
      raw: index + componentIndex / 10,
      asOf: isoDate(index),
    }])),
  }));
}

function rawModel() {
  return {
    id: 'investments-unified-fear-greed',
    version: 1,
    window: 252,
    minWindowPoints: 126,
    minComponents: 6,
    fillDays: 7,
  };
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function syntheticSnapshot(points = 780) {
  const candidates = search.buildCandidates();
  assert.equal(candidates.length, 15);
  const markets = search.MARKET_SPECS.map((spec, marketIndex) => {
    let close = 90 + marketIndex * 11;
    const priceRows = [];
    for (let index = 0; index < points; index++) {
      const periodicShock = index % (83 + marketIndex * 3) === 0 ? -0.009 + marketIndex * 0.0004 : 0;
      const logReturn = 0.00025 + 0.0032 * Math.sin((index + marketIndex * 5) / 8.5) +
        0.0019 * Math.cos((index + marketIndex * 11) / 21.3) +
        0.0009 * Math.sin(index / (3.7 + marketIndex * 0.2)) + periodicShock;
      close *= Math.exp(logReturn);
      priceRows.push({ date: isoDate(index), close });
    }
    const signals = [];
    for (let index = 135; index < points; index++) {
      const components = {};
      for (let componentIndex = 0; componentIndex < search.COMPONENT_KEYS.length; componentIndex++) {
        const key = search.COMPONENT_KEYS[componentIndex];
        const score = 50 +
          21 * Math.sin((index + componentIndex * 13 + marketIndex * 7) / (11.2 + componentIndex * 2.1)) +
          8 * Math.cos((index + componentIndex * 5) / (29.5 + marketIndex * 1.7));
        components[key] = {
          score: Math.max(0.01, Math.min(99.99, score)),
          raw: 2 + componentIndex + Math.sin(index / (7 + componentIndex)),
          asOf: isoDate(index),
        };
      }
      signals.push({ date: isoDate(index), componentCount: 6, components });
    }
    return {
      ...spec,
      signalIdentity: 'synthetic test fixture',
      requiredComponents: 6,
      componentCarryDays: 7,
      researchMapping: {
        barPolicy: spec.key === 'crypto' ? 'completed provider New York close' : 'synthetic completed bars',
        symbols: spec.key === 'crypto'
          ? { ...search.EXPERIMENTAL_CRYPTO_MAPPING }
          : { index: spec.target, vol: null, bond: `BOND-${marketIndex}`, hy: `HY-${marketIndex}`, ig: `IG-${marketIndex}`, small: `SMALL-${marketIndex}`, large: `LARGE-${marketIndex}` },
      },
      signals,
      prices: {
        symbol: spec.target,
        rows: priceRows,
        adjustmentMode: 'synthetic',
        ...(spec.key === 'crypto' ? {
          parserContract: search.CMBITM_PARSER_CONTRACT,
          rawResponseSha256: 'a'.repeat(64),
          rawResponseBytes: 123456,
          rawRowCount: points,
          acceptedRawRowCount: points,
          completedRowCount: points,
          excludedAfterRetrieval: 0,
          firstAcceptedTimestamp: `${isoDate(0)}T20:00:00.000Z`,
          lastAcceptedTimestamp: `${isoDate(points - 1)}T20:00:00.000Z`,
          firstCompletedDate: isoDate(0),
          lastCompletedDate: isoDate(points - 1),
        } : {}),
      },
    };
  });
  const cryptoPrices = markets.find(market => market.key === 'crypto').prices;
  const cmbitmEvidence = {
    parserContract: cryptoPrices.parserContract,
    rawResponseSha256: cryptoPrices.rawResponseSha256,
    rawResponseBytes: cryptoPrices.rawResponseBytes,
    rawRowCount: cryptoPrices.rawRowCount,
    acceptedRawRowCount: cryptoPrices.acceptedRawRowCount,
    completedRowCount: cryptoPrices.completedRowCount,
    excludedAfterRetrieval: cryptoPrices.excludedAfterRetrieval,
    firstAcceptedTimestamp: cryptoPrices.firstAcceptedTimestamp,
    lastAcceptedTimestamp: cryptoPrices.lastAcceptedTimestamp,
    firstCompletedDate: cryptoPrices.firstCompletedDate,
    lastCompletedDate: cryptoPrices.lastCompletedDate,
  };
  const runnerPath = path.join(__dirname, '..', 'research', 'fear_greed_model_search.js');
  const protocolPath = path.join(__dirname, '..', 'research', 'FEAR_GREED_MODEL_SEARCH_PROTOCOL.md');
  const marketfgPath = path.join(__dirname, '..', 'marketfg.js');
  const configPath = path.join(__dirname, '..', 'data', 'config.json');
  const targetRowsBySymbol = new Map(markets.map(market => [market.target, market.prices.rows]));
  const inventorySymbols = [...new Set(markets.flatMap(market => Object.values(market.researchMapping.symbols).flatMap(specification => {
    if (typeof specification === 'string') return [specification];
    return specification && Array.isArray(specification.symbols) ? specification.symbols : [];
  })))].sort();
  const normalizedSeriesInventory = inventorySymbols.map(symbol => {
    const rows = targetRowsBySymbol.get(symbol) || [{ date: isoDate(0), close: 100 }, { date: isoDate(points - 1), close: 101 }];
    return {
      symbol,
      sourceUrl: `synthetic://${encodeURIComponent(symbol)}`,
      timezone: 'UTC',
      adjustmentMode: 'synthetic',
      fetchedAt: '2026-08-25T00:00:00.000Z',
      rowCount: rows.length,
      firstDate: rows[0].date,
      lastDate: rows.at(-1).date,
      normalizedRowsSha256: search.sha256Buffer(Buffer.from(search.canonicalJson(rows), 'utf8')),
    };
  });
  return {
    schemaVersion: 4,
    createdAt: '2026-08-25T00:00:00.000Z',
    purpose: 'synthetic schema-4 replay fixture',
    frozenDesign: JSON.parse(JSON.stringify(search.FROZEN_DESIGN)),
    sourceCode: {
      runnerPath: 'research/fear_greed_model_search.js',
      runnerSha256: sha256File(runnerPath),
      protocolPath: 'research/FEAR_GREED_MODEL_SEARCH_PROTOCOL.md',
      protocolSha256: sha256File(protocolPath),
      marketfgPath: 'marketfg.js',
      marketfgSha256: sha256File(marketfgPath),
      configPath: 'data/config.json',
      configSha256: sha256File(configPath),
    },
    sources: {
      componentScores: { rawModel: rawModel(), coinMetricsCmbitmRawResponse: cmbitmEvidence },
      normalizedSeriesInventory,
    },
    mappings: { experimentalCryptoMapping: { ...search.EXPERIMENTAL_CRYPTO_MAPPING } },
    markets,
  };
}

test('frozen family contains exactly five templates times three causal smoothing windows', () => {
  const candidates = search.buildCandidates();
  assert.equal(candidates.length, 15);
  assert.deepEqual(candidates.map(candidate => candidate.id), [
    'equal_s1', 'equal_s5', 'equal_s21',
    'trend_breadth_s1', 'trend_breadth_s5', 'trend_breadth_s21',
    'defensive_risk_s1', 'defensive_risk_s5', 'defensive_risk_s21',
    'price_regime_s1', 'price_regime_s5', 'price_regime_s21',
    'cross_asset_risk_s1', 'cross_asset_risk_s5', 'cross_asset_risk_s21',
  ]);
  for (const candidate of candidates) {
    assert.equal(candidate.normalizedWeights.length, 6);
    assert.ok(candidate.normalizedWeights.every(weight => weight > 0));
    assert.ok(Math.abs(candidate.normalizedWeights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12);
    assert.ok([1, 5, 21].includes(candidate.smoothingObservations));
  }
});

test('trailing smoothing is causal and future component changes cannot alter earlier scores', () => {
  const original = signalRows();
  const changed = JSON.parse(JSON.stringify(original));
  for (let index = 55; index < changed.length; index++) {
    for (const key of search.COMPONENT_KEYS) changed[index].components[key].score = 100 - changed[index].components[key].score;
  }
  const candidate = search.buildCandidates().find(item => item.id === 'trend_breadth_s21');
  const first = search.computeCandidateSeries(original, candidate);
  const second = search.computeCandidateSeries(changed, candidate);
  assert.equal(first[0].date, original[20].date, 'a 21-observation mean must require a full 21-row history');
  assert.deepEqual(
    second.filter(row => row.date <= original[54].date),
    first.filter(row => row.date <= original[54].date),
  );
  assert.notDeepEqual(
    second.filter(row => row.date > original[54].date),
    first.filter(row => row.date > original[54].date),
  );
});

test('50/25/25 split and expanding training purge every outcome unknown at the refit origin', () => {
  const rows = Array.from({ length: 200 }, (_, index) => ({
    signalDate: isoDate(index),
    signalIndex: 200 + index,
    exitIndex: 222 + index,
    exitDate: isoDate(index + 22),
  }));
  const split = search.splitCommonRows(rows);
  assert.equal(split.initial.count, 100);
  assert.equal(split.development.count, 50);
  assert.equal(split.final.count, 50);
  const origin = rows[split.development.start];
  const training = search.availableTrainingRows(rows, origin);
  assert.equal(training.length, 79, 'the last 21 nominal initial rows still have unknown t+22 outcomes');
  assert.ok(training.every(row => row.signalIndex < origin.signalIndex));
  assert.ok(training.every(row => row.exitIndex <= origin.signalIndex));
});

test('data-adequacy boundaries are exact at 755/756 rows, 35/36 non-overlaps and 1094/1095 days', () => {
  const whole = rows => ({ start: 0, end: rows.length, count: rows.length });
  const rows755 = adequacyRows(755);
  const rows756 = adequacyRows(756);
  assert.equal(search.assessSegmentAdequacy(rows755, whole(rows755)).gates.forecastRowsAtLeast756, false);
  assert.equal(search.assessSegmentAdequacy(rows756, whole(rows756)).gates.forecastRowsAtLeast756, true);

  const outcomes35 = adequacyRows(735);
  const outcomes36 = adequacyRows(736);
  assert.equal(search.assessSegmentAdequacy(outcomes35, whole(outcomes35)).nonOverlappingOutcomes, 35);
  assert.equal(search.assessSegmentAdequacy(outcomes35, whole(outcomes35)).gates.nonOverlappingOutcomesAtLeast36, false);
  assert.equal(search.assessSegmentAdequacy(outcomes36, whole(outcomes36)).nonOverlappingOutcomes, 36);
  assert.equal(search.assessSegmentAdequacy(outcomes36, whole(outcomes36)).gates.nonOverlappingOutcomesAtLeast36, true);

  const span1094 = adequacyRows(756, 1094);
  const span1095 = adequacyRows(756, 1095);
  assert.equal(search.assessSegmentAdequacy(span1094, whole(span1094)).calendarSpanDays, 1094);
  assert.equal(search.assessSegmentAdequacy(span1094, whole(span1094)).gates.calendarSpanAtLeast1095Days, false);
  assert.equal(search.assessSegmentAdequacy(span1095, whole(span1095)).calendarSpanDays, 1095);
  assert.equal(search.assessSegmentAdequacy(span1095, whole(span1095)).gates.calendarSpanAtLeast1095Days, true);
  assert.equal(search.assessSegmentAdequacy(span1095, whole(span1095)).pass, true);
});

test('Benjamini-Hochberg five-test adjustment and one-sided Newey-West direction are sane', () => {
  const adjusted = search.benjaminiHochberg([
    { id: 'a', pValue: 0.01 },
    { id: 'b', pValue: 0.02 },
    { id: 'c', pValue: 0.03 },
    { id: 'd', pValue: 0.20 },
    { id: 'e', pValue: 0.50 },
  ]);
  assert.deepEqual(Object.fromEntries(adjusted.map(row => [row.id, Number(row.qValue.toFixed(6))])), {
    a: 0.05, b: 0.05, c: 0.05, d: 0.25, e: 0.5,
  });

  const positive = Array.from({ length: 140 }, (_, index) => 0.4 + 0.12 * Math.sin(index / 4) + 0.05 * Math.cos(index / 13));
  const negative = positive.map(value => -value);
  const positiveTest = search.neweyWestMeanTest(positive, 21);
  const negativeTest = search.neweyWestMeanTest(negative, 21);
  assert.ok(positiveTest.bandwidth >= 21);
  assert.ok(positiveTest.mean > 0);
  assert.ok(positiveTest.pValueOneSidedPositive < 0.05);
  assert.ok(negativeTest.mean < 0);
  assert.ok(negativeTest.pValueOneSidedPositive > 0.95);
});

test('schema-4 saved-snapshot replay is checksum-verified, network-free and fingerprint-deterministic', { timeout: 60000 }, async t => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-model-search-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const snapshot = syntheticSnapshot();
  const drifted = JSON.parse(JSON.stringify(snapshot));
  drifted.sourceCode.configSha256 = '0'.repeat(64);
  assert.throws(() => search.validateSnapshot(drifted), /configSha256/);
  const written = search.writeSnapshot(snapshot, temporaryRoot, 'synthetic');
  assert.ok(fs.existsSync(written.file));
  assert.ok(fs.existsSync(written.checksumFile));
  const reread = search.readSnapshot(written.file);
  assert.equal(reread.sha256, written.sha256);
  assert.equal(reread.checksumVerified, true);
  const replayCrypto = reread.snapshot.markets.find(market => market.key === 'crypto');
  assert.equal(replayCrypto.prices.parserContract, search.CMBITM_PARSER_CONTRACT);
  assert.equal(replayCrypto.prices.rawResponseSha256, 'a'.repeat(64));
  assert.equal(replayCrypto.prices.completedRowCount, replayCrypto.prices.rows.length);
  assert.deepEqual(
    reread.snapshot.sources.componentScores.coinMetricsCmbitmRawResponse,
    {
      parserContract: replayCrypto.prices.parserContract,
      rawResponseSha256: replayCrypto.prices.rawResponseSha256,
      rawResponseBytes: replayCrypto.prices.rawResponseBytes,
      rawRowCount: replayCrypto.prices.rawRowCount,
      acceptedRawRowCount: replayCrypto.prices.acceptedRawRowCount,
      completedRowCount: replayCrypto.prices.completedRowCount,
      excludedAfterRetrieval: replayCrypto.prices.excludedAfterRetrieval,
      firstAcceptedTimestamp: replayCrypto.prices.firstAcceptedTimestamp,
      lastAcceptedTimestamp: replayCrypto.prices.lastAcceptedTimestamp,
      firstCompletedDate: replayCrypto.prices.firstCompletedDate,
      lastCompletedDate: replayCrypto.prices.lastCompletedDate,
    },
  );

  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('network access attempted during saved replay'); };
  t.after(() => { global.fetch = originalFetch; });
  const firstOut = path.join(temporaryRoot, 'first');
  const secondOut = path.join(temporaryRoot, 'second');
  const first = await search.runStudy({ snapshot: written.file, outDir: firstOut }, { stamp: 'first' });
  const second = await search.runStudy({ snapshot: written.file, outDir: secondOut }, { stamp: 'second' });
  assert.equal(first.execution.networkUsed, false);
  assert.equal(second.execution.networkUsed, false);
  assert.equal(first.results.analysisFingerprintSha256, second.results.analysisFingerprintSha256);
  assert.equal(first.results.status, 'EXPLORATORY_UNDERPOWERED');
  assert.equal(first.results.decisions.dataAdequacy.allDevelopmentAndFinalSegmentsPass, false);
  assert.equal(first.results.decisions.return.sharedHistoricalGatePass, false);
  assert.equal(first.results.decisions.futureRisk.sharedHistoricalGatePass, false);
  assert.equal(first.results.development.return.length, 15);
  assert.equal(first.results.development.futureRisk.length, 15);
  assert.equal(first.results.final.return.bhFamilySize, 5);
  assert.equal(first.results.final.futureRisk.bhFamilySize, 5);
  for (const target of ['return', 'futureRisk']) {
    for (const entry of first.results.development[target]) {
      for (const market of Object.values(entry.markets)) {
        assert.ok(market.blocks.every(block => block.outcomeAvailabilityVerified));
        assert.ok(market.blocks.every(block => block.maximumTrainingExitIndex <= block.forecastOriginSignalIndex));
      }
    }
  }
  for (const file of [
    first.outputs.jsonFile,
    first.outputs.reportFile,
    first.outputs.jsonChecksumFile,
    first.outputs.reportChecksumFile,
  ]) assert.ok(fs.existsSync(file), `missing replay artifact: ${file}`);
});
