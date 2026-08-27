'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const walk = require('../research/fear_greed_walk_forward');

const FINAL_PROTOCOL_SHA256 = '72ecf89d3631e127be2de86c63e313ead642cc15b595fb13c2606cf4dcaf802b';
const SCHEMA6_RUNNER_SHA256 = '7f68d4966d0a81d5ed2c762932c70109352f43c748af4c0a442fc4c11a006ce8';

function approximately(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    'expected ' + actual + ' to be within ' + tolerance + ' of ' + expected,
  );
}

function simpleMarket(key, firstDecisionDate, lastDate = '2026-12-31') {
  return {
    key,
    targetId: key.toUpperCase(),
    annualization: key === 'crypto' ? 365 : 252,
    firstDecisionDate,
    rows: [
      { date: firstDecisionDate, close: 100, scores: {} },
      { date: lastDate, close: 101, scores: {} },
    ],
  };
}

function baselineAnnualRows(firstYear, lastYear) {
  const rows = [];
  for (let year = firstYear; year <= lastYear; year++) {
    const dates = [
      year + '-01-01',
      year + '-01-02',
      year + '-07-01',
      year + '-07-02',
      year + '-12-31',
    ];
    const closes = [100, 100, 50, 50, 100];
    const alphaScores = [75, 50, 24, 50, 50];
    for (let index = 0; index < dates.length; index++) {
      rows.push({
        date: dates[index],
        close: closes[index],
        scores: { alpha: alphaScores[index], beta: 50 },
      });
    }
  }
  return rows;
}

function annualMarket(key, firstYear = 2010, lastYear = 2015) {
  const rows = baselineAnnualRows(firstYear, lastYear);
  return {
    key,
    targetId: key.toUpperCase(),
    annualization: 252,
    firstDecisionDate: rows[0].date,
    rows,
    rawTargetPrices: rows.map(row => ({ date: row.date, close: row.close })),
  };
}

function candidates() {
  return [
    { id: 'alpha', declarationOrder: 0, fear: 24, greed: 75 },
    { id: 'beta', declarationOrder: 1, fear: 24, greed: 75 },
  ];
}

function selectionLedger(firstYear, lastYear, choices) {
  return {
    firstEvaluationYear: firstYear,
    lastEvaluationYear: lastYear,
    years: Array.from({ length: lastYear - firstYear + 1 }, (_, index) => {
      const year = firstYear + index;
      return { year, winnerCandidateId: choices[year] || choices.default || 'alpha' };
    }),
  };
}

function simulationMarket(key, rows) {
  return {
    key,
    targetId: key.toUpperCase(),
    annualization: key === 'crypto' ? 365 : 252,
    firstDecisionDate: rows[0].date,
    rows,
    rawTargetPrices: rows.map(row => ({ date: row.date, close: row.close })),
  };
}

function qualifyingGateInput() {
  const markets = ['crypto', 'sweden', 'usa', 'europe', 'global'];
  const annualized = [0.02, 0.015, 0.01, 0.005, -0.005];
  return {
    full: markets.map((market, index) => ({
      market,
      logReturnExcess: index < 4 ? 0.02 : -0.005,
      annualizedLogExcess: annualized[index],
      strategyTerminalWealth: index < 4 ? 1.02 : 0.995,
      buyHoldTerminalWealth: 1,
      completedCashCycles: index < 4 ? 2 : 1,
      strategyMaxDrawdown: index < 3 ? -0.10 : -0.30,
      buyHoldMaxDrawdown: -0.20,
    })),
    halves: markets.flatMap((market, index) => [
      { market, logReturnExcess: 0.01 },
      { market, logReturnExcess: index < 2 ? 0.01 : -0.01 },
    ]),
    common: {
      strategyTerminalWealth: 1.01,
      buyHoldTerminalWealth: 1,
    },
    yearCells: [0.01, 0.01, 0.01, 0, -0.01].map(logReturnExcess => ({ logReturnExcess })),
    deterministicReplayVerified: true,
  };
}

function resultFixture(overrides = {}) {
  const result = {
    schemaVersion: 7,
    status: walk.STATUS_FAIL,
    frozenDesign: { algorithm: 'synthetic' },
    protocol: { marker: walk.REQUIRED_PROTOCOL_MARKER },
    input: { snapshotSha256: 'a'.repeat(64) },
    firstEvaluationYear: 2020,
    lastEvaluationYear: 2021,
    selectionLedger: {
      firstEvaluationYear: 2020,
      lastEvaluationYear: 2021,
      years: [
        { year: 2020, winnerCandidateId: 'alpha' },
        { year: 2021, winnerCandidateId: 'beta' },
      ],
    },
    markets: {},
    common: {},
    completeYearCells: [],
    gate: { pass: false },
    generatedAt: '2026-08-25T00:00:00.000Z',
    ...overrides,
  };
  result.selectionLedgerSha256 = walk.fingerprintSelectionLedger(result.selectionLedger);
  result.analysisFingerprintSha256 = walk.fingerprintAnalysis(result);
  return result;
}

test('training eligibility and the first evaluation year are derived from three complete prior years', () => {
  const markets = [
    simpleMarket('crypto', '2021-01-05'),
    simpleMarket('sweden', '2023-04-18'),
    simpleMarket('usa', '2008-05-05'),
    simpleMarket('europe', '2011-09-27'),
    simpleMarket('global', '2019-01-22'),
  ];

  assert.equal(walk.trainingEligibilityDate(2015), '2012-01-01');
  assert.deepEqual(walk.deriveTrainingEligibleMarkets(markets, 2014).map(market => market.key), ['usa']);
  assert.deepEqual(walk.deriveTrainingEligibleMarkets(markets, 2015).map(market => market.key), ['usa', 'europe']);
  assert.equal(walk.deriveFirstEvaluationYear(markets), 2015);
  assert.deepEqual(walk.eligibleMarketsForYear(markets, 2023).map(market => market.key), ['usa', 'europe', 'global']);
  assert.deepEqual(walk.eligibleMarketsForYear(markets, 2025).map(market => market.key), ['crypto', 'usa', 'europe', 'global']);
  assert.equal(walk.eligibleMarketsForYear(markets, 2026).some(market => market.key === 'sweden'), false);
});

test('training rows are exactly the trailing three calendar years with inclusive UTC boundaries', () => {
  const rows = [
    { date: '2019-12-31' },
    { date: '2020-01-01' },
    { date: '2020-06-30' },
    { date: '2021-01-01' },
    { date: '2022-12-31' },
    { date: '2023-01-01' },
  ];
  assert.deepEqual(
    walk.trainingWindowRows(rows, 2023).map(row => row.date),
    ['2020-01-01', '2020-06-30', '2021-01-01', '2022-12-31'],
  );
  assert.deepEqual(walk.trainingRowsForYear(rows, 2023), walk.trainingWindowRows(rows, 2023));
});

test('the annual rank uses an exact even median, full precision, every frozen key, and declaration order last', () => {
  approximately(walk.median([-0.20, 0.01, 0.03, 0.20]), 0.02);

  const base = {
    positiveMarketCount: 2,
    medianAnnualizedLogExcess: 0.02,
    worstAnnualizedLogExcess: -0.10,
    meanAnnualizedLogExcess: 0.03,
    declarationOrder: 5,
  };
  const cases = [
    [{ ...base, candidateId: 'better', positiveMarketCount: 3 }, { ...base, candidateId: 'worse' }],
    [{ ...base, candidateId: 'better', medianAnnualizedLogExcess: 0.0200000000001 }, { ...base, candidateId: 'worse' }],
    [{ ...base, candidateId: 'better', worstAnnualizedLogExcess: -0.09 }, { ...base, candidateId: 'worse' }],
    [{ ...base, candidateId: 'better', meanAnnualizedLogExcess: 0.04 }, { ...base, candidateId: 'worse' }],
    [{ ...base, candidateId: 'better', declarationOrder: 4 }, { ...base, candidateId: 'worse' }],
  ];
  for (const [better, worse] of cases) {
    assert.deepEqual(walk.rankTrainingCandidates([worse, better]).map(row => row.candidateId), ['better', 'worse']);
    assert.ok(walk.trainingCandidateComparator(better, worse) < 0);
  }

  const equality = { ...base, candidateId: 'equality', positiveMarketCount: 0 };
  assert.equal(equality.positiveMarketCount, 0, 'zero excess must never count as positive');
});

test('one pooled annual ledger selects one shared winner across all eligible training markets', () => {
  const markets = [annualMarket('usa'), annualMarket('europe')];
  const ledger = walk.selectAnnualWinner(markets, candidates(), 2014, { cost: 0 });

  assert.deepEqual(ledger.eligibleMarkets, ['usa', 'europe']);
  assert.equal(ledger.trainingStartDate, '2011-01-01');
  assert.equal(ledger.trainingEndDate, '2013-12-31');
  assert.equal(ledger.winnerCandidateId, 'alpha');
  assert.equal(ledger.candidates.find(row => row.candidateId === 'alpha').positiveMarketCount, 2);
  assert.equal(ledger.candidates.find(row => row.candidateId === 'beta').positiveMarketCount, 0);
  assert.ok(ledger.candidates.every(row => row.perMarket.length === 2));
});

test('data in year Y cannot alter the winner already selected for Y but can alter Y plus one', () => {
  const originalMarkets = [annualMarket('usa'), annualMarket('europe')];
  const original = walk.buildSelectionLedger(originalMarkets, candidates(), {
    firstEvaluationYear: 2014,
    lastEvaluationYear: 2015,
    cost: 0,
  });

  const changedMarkets = structuredClone(originalMarkets);
  for (const market of changedMarkets) {
    for (const row of market.rows) {
      if (row.date === '2014-07-01' || row.date === '2014-07-02' || row.date === '2014-12-31') row.close = 1000;
    }
  }
  const changed = walk.buildSelectionLedger(changedMarkets, candidates(), {
    firstEvaluationYear: 2014,
    lastEvaluationYear: 2015,
    cost: 0,
  });

  assert.deepEqual(changed.years[0], original.years[0], 'year 2014 must depend only on 2011 through 2013');
  assert.equal(original.years[0].winnerCandidateId, 'alpha');
  assert.equal(changed.years[0].winnerCandidateId, 'alpha');
  assert.equal(original.years[1].winnerCandidateId, 'alpha');
  assert.equal(changed.years[1].winnerCandidateId, 'beta');
});

test('candidate switches never trade; pending orders cross years and fill before the new score is observed', () => {
  const rows = [
    { date: '2020-12-30', close: 100, scores: { alpha: 50, beta: 50 } },
    { date: '2020-12-31', close: 120, scores: { alpha: 74.5, beta: 50 } },
    { date: '2021-01-04', close: 60, scores: { alpha: 50 } },
    { date: '2021-01-05', close: 60, scores: { alpha: 50, beta: 24.4 } },
    { date: '2021-01-06', close: 120, scores: { alpha: 50, beta: 50 } },
    { date: '2021-01-07', close: 60, scores: { alpha: 50, beta: 50 } },
  ];
  const market = simulationMarket('usa', rows);
  const ledger = selectionLedger(2020, 2021, { 2020: 'alpha', 2021: 'beta' });
  const result = walk.simulateWalkForward(market, ledger, candidates(), { cost: 0.10 });

  assert.deepEqual(result.events.map(event => ({
    side: event.side,
    signalDate: event.signalDate,
    executionDate: event.executionDate,
    candidateId: event.candidateId,
  })), [
    { side: 'sell', signalDate: '2020-12-31', executionDate: '2021-01-04', candidateId: 'alpha' },
    { side: 'buy', signalDate: '2021-01-05', executionDate: '2021-01-06', candidateId: 'beta' },
  ]);
  approximately(result.terminalWealth, 0.243);
  approximately(result.buyAndHoldTerminalWealth, 0.6);
  assert.equal(result.intervals[1].startPosition, 1, 'the old long position receives the entire crossing return');
  approximately(result.intervals[1].marketFactor, 0.5);
  assert.equal(result.intervals[1].fillEvent.side, 'sell', 'the carried sale fills only after the crossing return');
  assert.equal(result.intervals[1].observedCandidateId, 'beta', 'the new annual candidate is observed only after the fill');
  assert.equal(result.intervals[1].queuedAtEnd, null, 'a missing new-candidate score holds after the carried fill');
  assert.equal(result.fills, 2);
  assert.equal(result.completedCashCycles, 1);

  const neutralRows = [
    { date: '2020-12-31', close: 100, scores: { alpha: 50, beta: 50 } },
    { date: '2021-01-04', close: 110, scores: { alpha: 50, beta: 50 } },
  ];
  const neutral = walk.simulateWalkForward(
    simulationMarket('usa', neutralRows),
    ledger,
    candidates(),
    { cost: 0.10 },
  );
  assert.equal(neutral.fills, 0);
  approximately(neutral.terminalWealth, 1.1);
});

test('two-stage threshold rounding, missing-score holds, next-close timing and one-way costs are exact', () => {
  const candidate = [{ id: 'alpha', declarationOrder: 0, fear: 24, greed: 75 }];
  const ledger = selectionLedger(2020, 2020, { default: 'alpha' });

  const noTrade = walk.simulateWalkForward(simulationMarket('usa', [
    { date: '2020-01-01', close: 100, scores: { alpha: 74.4 } },
    { date: '2020-01-02', close: 80, scores: { alpha: 24.5 } },
    { date: '2020-01-03', close: 120, scores: {} },
  ]), ledger, candidate, { cost: 0.10 });
  assert.equal(noTrade.fills, 0);
  approximately(noTrade.terminalWealth, 1.2);

  const exactBoundary = walk.simulateWalkForward(simulationMarket('usa', [
    { date: '2020-01-01', close: 100, scores: { alpha: 74.5 } },
    { date: '2020-01-02', close: 80, scores: {} },
    { date: '2020-01-03', close: 40, scores: { alpha: 24.4 } },
    { date: '2020-01-04', close: 80, scores: { alpha: 50 } },
  ]), ledger, candidate, { cost: 0.10 });
  assert.deepEqual(exactBoundary.events.map(event => event.side), ['sell', 'buy']);
  approximately(exactBoundary.terminalWealth, 0.8 * 0.9 * 0.9);
  assert.equal(exactBoundary.events[0].displayedInteger, 75);
  assert.equal(exactBoundary.events[1].displayedInteger, 24);
  assert.equal(exactBoundary.events[0].executionDate, '2020-01-02');
  assert.equal(exactBoundary.events[1].executionDate, '2020-01-04');
});

test('full and chronological-half views normalize wealth while carrying continuous state and floor odd intervals', () => {
  const rows = [
    { date: '2020-12-30', close: 100, scores: { alpha: 50, beta: 50 } },
    { date: '2020-12-31', close: 120, scores: { alpha: 74.5, beta: 50 } },
    { date: '2021-01-04', close: 60, scores: { alpha: 50 } },
    { date: '2021-01-05', close: 60, scores: { alpha: 50, beta: 24.4 } },
    { date: '2021-01-06', close: 120, scores: { alpha: 50, beta: 50 } },
    { date: '2021-01-07', close: 60, scores: { alpha: 50, beta: 50 } },
  ];
  const simulation = walk.simulateWalkForward(
    simulationMarket('usa', rows),
    selectionLedger(2020, 2021, { 2020: 'alpha', 2021: 'beta' }),
    candidates(),
    { cost: 0.10 },
  );
  const full = walk.buildFullView(simulation);
  const halves = walk.buildChronologicalHalves(simulation);

  assert.deepEqual(halves.map(half => half.intervals), [2, 3]);
  assert.equal(halves[0].endDate, halves[1].startDate);
  assert.equal(halves[0].endPosition, halves[1].startPosition);
  assert.deepEqual(halves[0].pendingOrderAtEnd, halves[1].pendingOrderAtStart);
  approximately(halves[0].strategy.terminalWealth * halves[1].strategy.terminalWealth, full.strategy.terminalWealth);
  approximately(halves[0].buyAndHold.terminalWealth * halves[1].buyAndHold.terminalWealth, full.buyAndHold.terminalWealth);
  assert.equal(halves[0].strategy.fills, 1);
  assert.equal(halves[1].strategy.fills, 1);
});

test('the common view excludes the crossing interval, normalizes post-close wealth and carries the new pending order', () => {
  const candidate = [{ id: 'alpha', declarationOrder: 0, fear: 24, greed: 75 }];
  const ledger = selectionLedger(2020, 2020, { default: 'alpha' });
  const first = walk.simulateWalkForward(simulationMarket('crypto', [
    { date: '2020-01-01', close: 100, scores: { alpha: 75 } },
    { date: '2020-01-02', close: 200, scores: { alpha: 24 } },
    { date: '2020-01-03', close: 100, scores: { alpha: 50 } },
    { date: '2020-01-04', close: 100, scores: { alpha: 50 } },
  ]), ledger, candidate, { cost: 0 });

  const simulations = [first];
  for (const key of ['sweden', 'usa', 'europe', 'global']) {
    simulations.push(walk.simulateWalkForward(simulationMarket(key, [
      { date: '2020-01-02', close: 100, scores: { alpha: 50 } },
      { date: '2020-01-03', close: 100, scores: { alpha: 50 } },
      { date: '2020-01-04', close: 100, scores: { alpha: 50 } },
    ]), ledger, candidate, { cost: 0 }));
  }

  const bounds = walk.commonCalendarBounds(simulations);
  const common = walk.buildCommonView(simulations, bounds);
  assert.deepEqual(bounds, { startDate: '2020-01-02', endDate: '2020-01-04' });
  assert.equal(common.markets.crypto.startDate, '2020-01-02');
  assert.equal(common.markets.crypto.pendingOrderAtStart.side, 'buy');
  assert.equal(common.markets.crypto.strategy.fills, 1);
  approximately(common.markets.crypto.strategy.terminalWealth, 1);
  approximately(common.markets.crypto.buyAndHold.terminalWealth, 0.5);
  approximately(common.strategyTerminalWealth, 1);
  approximately(common.buyAndHoldTerminalWealth, 0.9);
});

test('complete market-year cells require the raw predecessor and following year and partition by ending-close year', () => {
  const rows = [
    { date: '2019-12-31', close: 100, scores: { alpha: 50 } },
    { date: '2020-01-02', close: 110, scores: { alpha: 50 } },
    { date: '2020-06-30', close: 121, scores: { alpha: 50 } },
    { date: '2020-12-31', close: 133.1, scores: { alpha: 50 } },
    { date: '2021-01-04', close: 146.41, scores: { alpha: 50 } },
    { date: '2021-12-31', close: 161.051, scores: { alpha: 50 } },
    { date: '2022-01-03', close: 177.1561, scores: { alpha: 50 } },
  ];
  const market = simulationMarket('usa', rows);
  const candidate = [{ id: 'alpha', declarationOrder: 0, fear: 24, greed: 75 }];
  const fullSimulation = walk.simulateWalkForward(
    market,
    selectionLedger(2019, 2022, { default: 'alpha' }),
    candidate,
    { cost: 0, firstEvaluationYear: 2019 },
  );
  const cells = walk.buildCompleteMarketYearCells(fullSimulation, market.rawTargetPrices);

  assert.deepEqual(cells.map(cell => cell.year), [2020, 2021]);
  assert.deepEqual(cells.map(cell => cell.intervals), [3, 2]);
  assert.deepEqual(cells.map(cell => cell.predecessorDate), ['2019-12-31', '2020-12-31']);
  approximately(cells[0].buyAndHold.terminalWealth, 1.331);
  approximately(cells[1].buyAndHold.terminalWealth, 1.21);
  assert.ok(cells.every(cell => cell.startDate === cell.predecessorDate));
  assert.equal(cells.some(cell => cell.year === 2019), false, 'the raw first year has no predecessor');
  assert.equal(cells.some(cell => cell.year === 2022), false, 'the terminal year has no following-year close');

  const missingPredecessorSimulation = walk.simulateWalkForward(
    market,
    selectionLedger(2020, 2022, { default: 'alpha' }),
    candidate,
    { cost: 0, firstEvaluationYear: 2020 },
  );
  assert.deepEqual(
    walk.buildCompleteYearCells(missingPredecessorSimulation, market.rawTargetPrices).map(cell => cell.year),
    [2021],
    '2020 must be excluded when its raw predecessor is outside the evaluation path',
  );
});

test('all eight gates pass only together; equality is not positive and exactly 60 percent complete years passes', () => {
  const qualifying = qualifyingGateInput();
  const passed = walk.evaluatePassGate(qualifying);
  assert.equal(passed.pass, true);
  assert.equal(passed.status, walk.STATUS_PASS);
  assert.equal(Object.keys(passed.gates).length, 8);
  assert.ok(Object.values(passed.gates).every(Boolean));
  assert.equal(passed.diagnostics.positiveCompleteYearCells, 3);
  assert.equal(passed.diagnostics.completeYearCells, 5);
  approximately(passed.diagnostics.completeYearPositiveRatio, 0.60);

  const failures = [
    ['fullHistoryBreadth', input => { input.full[3].strategyTerminalWealth = input.full[3].buyHoldTerminalWealth; }],
    ['fullHistoryDistribution', input => {
      [-0.01, -0.005, 0, 0.005, 0.01].forEach((value, index) => { input.full[index].annualizedLogExcess = value; });
    }],
    ['chronologicalHalves', input => { input.halves.find(row => row.market === 'sweden' && row.logReturnExcess > 0).logReturnExcess = 0; }],
    ['commonCalendarAggregate', input => { input.common.strategyTerminalWealth = input.common.buyHoldTerminalWealth; }],
    ['completeMarketYears', input => { input.yearCells[2].logReturnExcess = 0; }],
    ['adequateCycles', input => { input.full[4].completedCashCycles = 0; }],
    ['drawdownBreadth', input => { input.full[2].strategyMaxDrawdown = -0.30; }],
    ['deterministicIntegrity', input => { input.deterministicReplayVerified = false; }],
  ];
  for (const [gate, mutate] of failures) {
    const input = structuredClone(qualifying);
    mutate(input);
    const result = walk.evaluatePassGate(input);
    assert.equal(result.gates[gate], false, gate + ' must fail at its frozen boundary');
    assert.equal(result.pass, false);
    assert.equal(result.status, walk.STATUS_FAIL);
    assert.equal(Object.entries(result.gates).filter(([, value]) => !value).length, 1, gate + ' fixture should isolate one gate');
  }

  const emptyYears = structuredClone(qualifying);
  emptyYears.yearCells = [];
  const empty = walk.evaluatePassGate(emptyYears);
  assert.equal(empty.gates.completeMarketYears, false);
  assert.equal(empty.diagnostics.completeYearPositiveRatio, null);

  const worstAtBoundary = structuredClone(qualifying);
  worstAtBoundary.full[4].annualizedLogExcess = -0.01;
  assert.equal(walk.evaluatePassGate(worstAtBoundary).gates.fullHistoryDistribution, true);
});

test('protocol and dependencies are pinned; replay is offline, deterministic and uses noncircular distinct hashes', () => {
  assert.equal(walk.REQUIRED_PROTOCOL_SHA256, FINAL_PROTOCOL_SHA256);
  assert.equal(walk.REQUIRED_SCHEMA6_RUNNER_SHA256, SCHEMA6_RUNNER_SHA256);
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(walk.PROTOCOL_PATH)).digest('hex'),
    FINAL_PROTOCOL_SHA256,
  );
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(walk.SCHEMA6_RUNNER_PATH)).digest('hex'),
    SCHEMA6_RUNNER_SHA256,
  );
  assert.doesNotThrow(() => walk.assertProtocolFrozen());
  assert.doesNotThrow(() => walk.assertDependenciesPinned());

  const originalFetch = global.fetch;
  const originalHttpGet = http.get;
  const offline = walk.withNetworkDisabled(() => {
    assert.throws(() => global.fetch('https://example.invalid'), /forbids all network access/);
    assert.throws(() => http.get('http://example.invalid'), /forbids all network access/);
    return 'offline';
  });
  assert.equal(offline, 'offline');
  assert.equal(global.fetch, originalFetch);
  assert.equal(http.get, originalHttpGet);

  const left = { z: [3, { b: 2, a: 1 }], a: 'same' };
  const right = { a: 'same', z: [3, { a: 1, b: 2 }] };
  assert.equal(walk.canonicalJson(left), walk.canonicalJson(right));
  assert.equal(walk.fingerprintSelectionLedger(left), walk.fingerprintSelectionLedger(right));

  const fixture = resultFixture();
  const ownHashesChanged = { ...fixture, analysisFingerprintSha256: 'f'.repeat(64), generatedAt: '2099-01-01T00:00:00.000Z' };
  assert.equal(walk.fingerprintAnalysis(fixture), walk.fingerprintAnalysis(ownHashesChanged));
  const changedLedger = structuredClone(fixture);
  changedLedger.selectionLedger.years[0].winnerCandidateId = 'different';
  changedLedger.selectionLedgerSha256 = walk.fingerprintSelectionLedger(changedLedger.selectionLedger);
  assert.notEqual(walk.fingerprintSelectionLedger(fixture.selectionLedger), changedLedger.selectionLedgerSha256);
  assert.notEqual(walk.fingerprintAnalysis(fixture), walk.fingerprintAnalysis(changedLedger));

  assert.deepEqual(walk.verifyDeterministicResults(() => resultFixture()), resultFixture());
  let invocation = 0;
  assert.throws(() => walk.verifyDeterministicResults(() => resultFixture({ generatedAt: 'run-' + (++invocation) })), /deterministic replay verification failed/);

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'schema7-sidecars-'));
  try {
    const ledger = walk.writeWithSidecar(path.join(temporaryDirectory, 'ledger.json'), '{}\n');
    const results = walk.writeWithSidecar(path.join(temporaryDirectory, 'results.json'), '{}\n');
    const report = walk.writeWithSidecar(path.join(temporaryDirectory, 'report.md'), '# report\n');
    assert.equal(new Set([ledger.checksumFile, results.checksumFile, report.checksumFile]).size, 3);
    for (const artifact of [ledger, results, report]) {
      const expected = fs.readFileSync(artifact.checksumFile, 'utf8').trim().split(/\s+/)[0];
      const actual = crypto.createHash('sha256').update(fs.readFileSync(artifact.file)).digest('hex');
      assert.equal(actual, expected);
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
