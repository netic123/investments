'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const strategy = require('../research/fear_greed_extreme_strategy');
const schema5 = require('../research/fear_greed_v2_validation');

function dateAt(index) {
  const date = new Date('2026-01-01T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
}

function approximately(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function componentScores(score) {
  return Object.fromEntries(schema5.COMPONENT_KEYS.map(key => [key, {
    score,
    raw: score,
    asOf: '2026-01-01',
  }]));
}

function signalRows(scores) {
  return scores.map((score, index) => ({
    date: dateAt(index),
    componentCount: 6,
    components: componentScores(score),
    publishedScore: score,
  }));
}

function rankedCandidate(id, overrides = {}) {
  return {
    candidate: {
      id,
      declarationOrder: overrides.declarationOrder == null ? 5 : overrides.declarationOrder,
    },
    gate: {
      pass: overrides.pass === true,
      diagnostics: {
        positiveFullMarkets: 0,
        positiveHalfCells: 0,
        medianFullExcessCagr: 0,
        meanFullExcessCagr: 0,
        worstFullExcessCagr: 0,
        ...(overrides.ranking || {}),
      },
    },
    scenarios: {
      stress: {
        common: {
          annualizedLogReturnExcess: overrides.ranking && overrides.ranking.commonAnnualizedLogExcess || 0,
        },
      },
    },
  };
}

function qualifyingGateInput() {
  const markets = ['crypto', 'sweden', 'usa', 'europe', 'global'];
  const excesses = [0.02, 0.015, 0.01, 0.005, -0.005];
  return {
    stressMarkets: Object.fromEntries(markets.map((market, index) => [market, {
      full: {
        terminalWealthDifference: index < 4 ? 0.2 : -0.005,
        annualizedLogReturnExcess: excesses[index],
        excessCagr: excesses[index],
        maximumDrawdownImprovement: index < 3 ? 0.05 : -0.05,
        strategy: {
          completedCashCycles: index < 4 ? 2 : 1,
        },
      },
      halves: [0, 1].map(half => ({
        terminalWealthDifference: half === 0 || index < 2 ? 0.05 : -0.05,
      })),
    }])),
    stressCommon: {
      strategyTerminalWealth: 1.05,
      buyAndHoldTerminalWealth: 1,
      annualizedLogReturnExcess: 0.01,
    },
  };
}

function fingerprintFixture(overrides = {}) {
  return {
    schemaVersion: 6,
    status: 'NO_SHARED_HISTORICAL_WINNER',
    frozenDesign: { candidateCount: 31 },
    protocol: { marker: 'FROZEN_SCHEMA6_EXTREME_STRATEGY_V1' },
    input: { snapshotSha256: 'a'.repeat(64) },
    commonBounds: { startDate: '2023-01-01', endDate: '2026-01-01' },
    ranking: [{ rank: 1, id: 'synthetic' }],
    canonicalProduction: { candidate: { id: 'P_F24_G75_S1' } },
    selected: { candidate: { id: 'synthetic' } },
    ...overrides,
  };
}

test('production two-stage rounding fixes the exact fear and greed boundaries', () => {
  assert.equal(strategy.displayedInteger(24.4), 24);
  assert.equal(strategy.displayedInteger(24.5), 25);
  assert.equal(strategy.displayedInteger(74.4), 74);
  assert.equal(strategy.displayedInteger(74.5), 75);

  assert.equal(strategy.queuedDecision(0, 24.4, 24, 75).side, 'buy');
  assert.equal(strategy.queuedDecision(0, 24.5, 24, 75), null);
  assert.equal(strategy.queuedDecision(1, 74.4, 24, 75), null);
  assert.equal(strategy.queuedDecision(1, 74.5, 24, 75).side, 'sell');
});

test('the frozen candidate family is exactly 31 unique shared definitions', () => {
  const candidates = strategy.buildCandidates();
  assert.equal(candidates.length, 31);
  assert.equal(new Set(candidates.map(candidate => candidate.id)).size, 31);
  assert.deepEqual(candidates.map(candidate => candidate.declarationOrder),
    Array.from({ length: 31 }, (_, index) => index));
  assert.deepEqual(strategy.buildCandidates(), candidates, 'candidate construction must be deterministic');

  const published = candidates.filter(candidate => /^P_F\d+_G\d+_S\d+$/.test(candidate.id));
  assert.equal(published.length, 18);
  const expectedPublishedIds = new Set();
  for (const fear of [15, 20, 24]) {
    for (const greed of [75, 80, 85]) {
      for (const smoothing of [1, 5]) expectedPublishedIds.add(`P_F${fear}_G${greed}_S${smoothing}`);
    }
  }
  assert.deepEqual(new Set(published.map(candidate => candidate.id)), expectedPublishedIds);

  const expectedComponentIds = schema5.buildCandidates()
    .map(candidate => candidate.id)
    .filter(id => !['equal_s1', 'equal_s5'].includes(id))
    .map(id => `W_${id}_F24_G75`);
  assert.deepEqual(
    candidates.filter(candidate => !candidate.id.startsWith('P_')).map(candidate => candidate.id),
    expectedComponentIds,
  );
  assert.ok(candidates.every(candidate => !Object.hasOwn(candidate, 'market') && !Object.hasOwn(candidate, 'marketKey')),
    'no frozen candidate may contain a market-specific override');

  const canonical = candidates.find(candidate => candidate.id === 'P_F24_G75_S1');
  assert.ok(canonical);
  assert.equal(canonical.fear, 24);
  assert.equal(canonical.greed, 75);
  assert.equal(canonical.smoothingObservations, 1);
});

test('published-score smoothing is trailing, causal and rounded only after averaging', () => {
  const original = signalRows([10, 20, 30, 40, 50, 60]);
  const first = strategy.trailingMeanScoreSeries(original, 5);
  assert.deepEqual(first.map(row => row.date), [dateAt(4), dateAt(5)]);
  approximately(first[0].score, 30);
  approximately(first[1].score, 40);
  assert.equal(strategy.displayedInteger(first[0].score), 30);

  const changedFuture = signalRows([10, 20, 30, 40, 50, 100]);
  const second = strategy.trailingMeanScoreSeries(changedFuture, 5);
  assert.deepEqual(second[0], first[0], 'changing a later observation must not alter an earlier score');
  approximately(second[1].score, 48);

  const roundingRows = strategy.trailingMeanScoreSeries(signalRows([24.4, 24.4, 24.4, 24.4, 24.9]), 5);
  approximately(roundingRows[0].score, 24.5);
  assert.equal(strategy.displayedInteger(roundingRows[0].score), 25);
});

test('all candidates share the 21st original signal as their first decision date', () => {
  const signals = signalRows(Array.from({ length: 26 }, (_, index) => 20 + index));
  const market = {
    key: 'synthetic',
    annualization: 252,
    signals,
    prices: {
      rows: signals.map((row, index) => ({ date: row.date, close: 100 + index })),
    },
  };
  const candidates = strategy.buildCandidates();
  const eligiblePrices = strategy.marketEligiblePrices(market);
  assert.equal(eligiblePrices[0].date, signals[20].date);
  assert.equal(eligiblePrices.length, 6);
  for (const candidate of candidates) {
    const scoreMap = strategy.buildCandidateScoreMap(market, candidate);
    assert.ok(Number.isFinite(scoreMap.get(signals[20].date)), `${candidate.id} must have a score at the common start`);
  }

  const twentyOne = candidates.find(candidate => candidate.id === 'equal_s21');
  assert.equal(twentyOne, undefined, 'component candidates keep a namespaced schema-6 ID');
  const component21 = candidates.find(candidate => candidate.sourceCandidateId === 'equal_s21');
  const series = strategy.buildCandidateScoreMap(market, component21);
  approximately(series.get(signals[20].date), 30);

  const changed = signalRows(Array.from({ length: 26 }, (_, index) => index <= 20 ? 20 + index : 0));
  const changedMarket = {
    ...market,
    signals: changed,
  };
  const changedSeries = strategy.buildCandidateScoreMap(changedMarket, component21);
  approximately(changedSeries.get(signals[20].date), series.get(signals[20].date));
});

test('a greed signal earns the full next bar return and fills at the next target close across calendar gaps', () => {
  const rows = [
    { date: '2026-01-02', close: 100, score: 75 },
    { date: '2026-01-12', close: 80, score: 50 },
    { date: '2026-01-13', close: 120, score: 50 },
  ];
  const scoreMap = new Map(rows.map(row => [row.date, row.score]));
  const result = strategy.simulateStrategy({
    prices: rows,
    scoreMap,
    fear: 24,
    greed: 75,
    cost: 0,
    initialPosition: 'long',
  });

  approximately(result.terminalWealth, 0.8);
  assert.equal(result.finalPosition, 'cash');
  assert.equal(result.fills, 1);
  assert.deepEqual(
    { side: result.events[0].side, signalDate: result.events[0].signalDate, executionDate: result.events[0].executionDate },
    { side: 'sell', signalDate: '2026-01-02', executionDate: '2026-01-12' },
  );
  approximately(result.maximumDrawdown, -0.2);
});

test('information at the execution close cannot cancel a queued order', () => {
  const rows = [
    { date: '2026-01-05', close: 100, score: 75 },
    { date: '2026-01-06', close: 100, score: 24 },
    { date: '2026-01-07', close: 100, score: 50 },
  ];
  const result = strategy.simulateStrategy({
    prices: rows,
    scoreMap: new Map(rows.map(row => [row.date, row.score])),
    fear: 24,
    greed: 75,
    cost: 0,
    initialPosition: 'long',
  });

  assert.deepEqual(result.events.filter(event => event.executionDate).map(fill => ({
    side: fill.side,
    signalDate: fill.signalDate,
    executionDate: fill.executionDate,
  })), [
    { side: 'sell', signalDate: '2026-01-05', executionDate: '2026-01-06' },
    { side: 'buy', signalDate: '2026-01-06', executionDate: '2026-01-07' },
  ]);
  assert.equal(result.finalPosition, 'long');
});

test('repeated extremes do not retrade and one-way costs apply once per actual fill', () => {
  const rows = [75, 80, 85, 20, 15, 10].map((score, index) => ({
    date: dateAt(index),
    close: 100,
    score,
  }));
  const candidate = { fear: 24, greed: 75 };
  const comparison = strategy.runWindow({
    prices: rows,
    scoreMap: new Map(rows.map(row => [row.date, row.score])),
    candidate,
    cost: 0.10,
    annualization: 252,
    initialPosition: 'long',
  });
  const result = comparison.strategy;
  const compactComparison = strategy.runWindow({
    prices: rows,
    scoreMap: new Map(rows.map(row => [row.date, row.score])),
    candidate,
    cost: 0.10,
    annualization: 252,
    initialPosition: 'long',
    includeDetails: false,
  });

  assert.deepEqual(result.events.filter(event => event.executionDate).map(fill => fill.side), ['sell', 'buy']);
  assert.equal(result.fills, 2);
  assert.equal(result.signalSells, 1);
  assert.equal(result.signalBuys, 1);
  assert.equal(result.completedCashCycles, 1);
  approximately(result.terminalWealth, 0.9 * 0.9);
  approximately(comparison.relativeCostHaircut, 1 - 0.9 * 0.9);
  approximately(comparison.absoluteCostHaircut, 1 - 0.9 * 0.9);
  approximately(result.exposure, 2 / 5);
  approximately(result.cashShare, 3 / 5);
  assert.equal(result.longestInvestedRunBars, 1);
  assert.equal(result.longestCashRunBars, 3);
  approximately(compactComparison.strategy.terminalWealth, result.terminalWealth);
  assert.equal(Object.hasOwn(compactComparison.strategy, 'wealthCurve'), false);
  assert.equal(Object.hasOwn(compactComparison.strategy, 'events'), false);
});

test('a fear entry is delayed one bar and a final queued order remains unfilled without liquidation', () => {
  const entryRows = [
    { date: '2026-02-02', close: 100, score: 24 },
    { date: '2026-02-03', close: 80, score: 50 },
    { date: '2026-02-04', close: 120, score: 50 },
  ];
  const entry = strategy.simulateStrategy({
    prices: entryRows,
    scoreMap: new Map(entryRows.map(row => [row.date, row.score])),
    fear: 24,
    greed: 75,
    cost: 0.10,
    initialPosition: 'cash',
  });
  approximately(entry.terminalWealth, 0.9 * 1.5);
  assert.deepEqual(
    { side: entry.events[0].side, signalDate: entry.events[0].signalDate, executionDate: entry.events[0].executionDate },
    { side: 'buy', signalDate: '2026-02-02', executionDate: '2026-02-03' },
  );

  const terminalRows = [
    { date: '2026-03-02', close: 100, score: 50 },
    { date: '2026-03-03', close: 110, score: 75 },
  ];
  const terminal = strategy.simulateStrategy({
    prices: terminalRows,
    scoreMap: new Map(terminalRows.map(row => [row.date, row.score])),
    fear: 24,
    greed: 75,
    cost: 0.10,
    initialPosition: 'long',
  });
  approximately(terminal.terminalWealth, 1.1);
  assert.equal(terminal.finalPosition, 'long');
  assert.equal(terminal.fills, 0);
  assert.equal(terminal.unfilledTerminalOrders, 1);
  assert.equal(terminal.events.at(-1).executionDate, null);
  assert.equal(terminal.events.at(-1).cost, 0);
});

test('matched interval performance metrics reproduce wealth, drawdown, CAGR, volatility and Sharpe', () => {
  const prices = [
    { date: '2024-01-01', close: 100 },
    { date: '2025-01-01', close: 110 },
    { date: '2026-01-01', close: 88 },
    { date: '2027-01-01', close: 105.6 },
  ];
  const returns = [0.1, -0.2, 0.2];
  const wealthPath = [1, 1.1, 0.88, 1.056];
  const metrics = strategy.summarizePath({
    prices,
    returns,
    wealthPath,
    annualization: 1,
    terminalWealth: wealthPath.at(-1),
  });
  const years = (Date.parse('2027-01-01T00:00:00.000Z') - Date.parse('2024-01-01T00:00:00.000Z')) /
    (365.2425 * 24 * 60 * 60 * 1000);
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (returns.length - 1);
  const volatility = Math.sqrt(variance);

  assert.equal(metrics.startDate, '2024-01-01');
  assert.equal(metrics.endDate, '2027-01-01');
  assert.equal(metrics.targetBars, 4);
  approximately(metrics.calendarYears, years);
  approximately(metrics.terminalWealth, 1.056);
  approximately(metrics.totalReturn, 0.056);
  approximately(metrics.cagr, 1.056 ** (1 / years) - 1);
  approximately(metrics.annualizedLogReturn, Math.log(1.056) / years);
  approximately(metrics.annualizedVolatility, volatility);
  approximately(metrics.sharpe, mean / volatility);
  approximately(metrics.maximumDrawdown, -0.20);

  const neutralRows = [
    { date: '2024-01-01', close: 100, score: 50 },
    { date: '2025-01-01', close: 110, score: 50 },
    { date: '2026-01-01', close: 88, score: 50 },
    { date: '2027-01-01', close: 105.6, score: 50 },
  ];
  const continuouslyLong = strategy.simulateStrategy({
    prices: neutralRows,
    scoreMap: new Map(neutralRows.map(row => [row.date, row.score])),
    fear: 24,
    greed: 75,
    cost: 0,
    initialPosition: 'long',
  });
  approximately(continuouslyLong.terminalWealth, neutralRows.at(-1).close / neutralRows[0].close);
  assert.equal(continuouslyLong.fills, 0);

  const buyAndHold = strategy.benchmarkBuyHold({ prices: neutralRows, annualization: 1 });
  approximately(buyAndHold.terminalWealth, neutralRows.at(-1).close / neutralRows[0].close);
  assert.equal(buyAndHold.startDate, continuouslyLong.startDate);
  assert.equal(buyAndHold.endDate, continuouslyLong.endDate);
});

test('odd interval halves use floor(N/2) first and inclusive boundary closes', () => {
  const prices = Array.from({ length: 6 }, (_, index) => ({ date: dateAt(index), close: 100 + index }));
  const [first, second] = strategy.splitPriceWindows(prices);
  assert.deepEqual(first.map(row => row.date), prices.slice(0, 3).map(row => row.date));
  assert.deepEqual(second.map(row => row.date), prices.slice(2).map(row => row.date));
  assert.equal(first.length - 1, 2);
  assert.equal(second.length - 1, 3);
  assert.equal(first.at(-1).date, second[0].date, 'the shared boundary close must be included in both halves');
});

test('the seven frozen historical pass gates accept only a fully qualifying shared result', () => {
  const qualifying = qualifyingGateInput();
  const passed = strategy.evaluateGate(qualifying.stressMarkets, qualifying.stressCommon, true);
  assert.equal(passed.pass, true);
  assert.equal(Object.keys(passed.gates).length, 7);
  assert.ok(Object.values(passed.gates).every(Boolean));

  const failedInput = structuredClone(qualifying);
  failedInput.stressMarkets.global.full.annualizedLogReturnExcess = -0.02;
  const failed = strategy.evaluateGate(failedInput.stressMarkets, failedInput.stressCommon, true);
  assert.equal(failed.pass, false);
  assert.equal(Object.values(failed.gates).filter(value => !value).length, 1);
  assert.equal(failed.gates.fullHistoryDistribution, false);
});

test('candidate ranking follows every frozen key and declaration order breaks exact ties', () => {
  const rankingCases = [
    [rankedCandidate('better', { pass: true }), rankedCandidate('worse')],
    [rankedCandidate('better', { ranking: { positiveFullMarkets: 2 } }), rankedCandidate('worse', { ranking: { positiveFullMarkets: 1 } })],
    [rankedCandidate('better', { ranking: { positiveHalfCells: 3 } }), rankedCandidate('worse', { ranking: { positiveHalfCells: 2 } })],
    [rankedCandidate('better', { ranking: { commonAnnualizedLogExcess: 0.02 } }), rankedCandidate('worse', { ranking: { commonAnnualizedLogExcess: 0.01 } })],
    [rankedCandidate('better', { ranking: { medianFullExcessCagr: 0.02 } }), rankedCandidate('worse', { ranking: { medianFullExcessCagr: 0.01 } })],
    [rankedCandidate('better', { ranking: { meanFullExcessCagr: 0.02 } }), rankedCandidate('worse', { ranking: { meanFullExcessCagr: 0.01 } })],
    [rankedCandidate('better', { ranking: { worstFullExcessCagr: -0.01 } }), rankedCandidate('worse', { ranking: { worstFullExcessCagr: -0.02 } })],
    [rankedCandidate('better', { declarationOrder: 2 }), rankedCandidate('worse', { declarationOrder: 3 })],
  ];

  for (const [better, worse] of rankingCases) {
    assert.deepEqual([worse, better].sort(strategy.compareRanked).map(result => result.candidate.id), ['better', 'worse']);
    assert.ok(strategy.compareRanked(better, worse) < 0);
    assert.ok(strategy.compareRanked(worse, better) > 0);
  }
});

test('canonical serialization and analytical fingerprints replay deterministically', () => {
  const left = { z: [3, { b: 2, a: 1 }], a: 'same' };
  const right = { a: 'same', z: [3, { a: 1, b: 2 }] };
  assert.equal(strategy.canonicalJson(left), strategy.canonicalJson(right));
  const first = fingerprintFixture();
  const reordered = {
    selected: first.selected,
    canonicalProduction: first.canonicalProduction,
    ranking: first.ranking,
    commonBounds: first.commonBounds,
    input: first.input,
    protocol: first.protocol,
    frozenDesign: first.frozenDesign,
    status: first.status,
    schemaVersion: first.schemaVersion,
  };
  assert.equal(strategy.fingerprintAnalysis(first), strategy.fingerprintAnalysis(reordered));
  assert.notEqual(
    strategy.fingerprintAnalysis(first),
    strategy.fingerprintAnalysis(fingerprintFixture({ status: 'HISTORICALLY_WORKS_RETROSPECTIVELY' })),
  );
});

test('frozen protocol hash, network denial, deterministic replay and distinct sidecars are enforced', () => {
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(strategy.PROTOCOL_PATH)).digest('hex'),
    strategy.REQUIRED_PROTOCOL_SHA256,
  );
  assert.doesNotThrow(() => strategy.assertProtocolFrozen());

  const originalFetch = global.fetch;
  const networkResult = strategy.withNetworkDisabled(() => {
    assert.throws(() => global.fetch('https://example.invalid'), /forbids all network access/);
    return 'offline';
  });
  assert.equal(networkResult, 'offline');
  assert.equal(global.fetch, originalFetch, 'global fetch must be restored after the replay guard');

  const stableFactory = () => {
    const result = { value: 1 };
    result.analysisFingerprintSha256 = strategy.fingerprint(result);
    return result;
  };
  assert.deepEqual(strategy.verifyDeterministicResults(stableFactory), stableFactory());
  let invocation = 0;
  assert.throws(() => strategy.verifyDeterministicResults(() => {
    const result = { value: ++invocation };
    result.analysisFingerprintSha256 = strategy.fingerprint(result);
    return result;
  }), /deterministic replay verification failed/);

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'schema6-sidecars-'));
  try {
    const json = strategy.writeWithSidecar(path.join(temporaryDirectory, 'artifact.json'), '{}\n');
    const markdown = strategy.writeWithSidecar(path.join(temporaryDirectory, 'artifact.md'), '# report\n');
    assert.notEqual(json.checksumFile, markdown.checksumFile);
    for (const artifact of [json, markdown]) {
      const expected = fs.readFileSync(artifact.checksumFile, 'utf8').trim().split(/\s+/)[0];
      const actual = crypto.createHash('sha256').update(fs.readFileSync(artifact.file)).digest('hex');
      assert.equal(actual, expected);
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
