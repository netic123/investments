'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const trend = require('../research/fear_greed_trend_confirm');

function trendRow(date, value, referenceDate = '2019-01-01', referenceClose = 100) {
  return {
    date,
    close: 100 * Math.exp(value),
    anniversaryDate: referenceDate,
    referenceDate,
    referenceClose,
    referenceStalenessCalendarDays: 0,
    trend: value,
    direction: value > 0 ? 'bullish' : value < 0 ? 'bearish' : 'neutral',
  };
}

function mapOf(rows, key = 'date') {
  return new Map(rows.map(row => [row[key], row]));
}

test('frozen design contains exactly one identical five-market rule', () => {
  assert.equal(trend.FROZEN_DESIGN.candidateCount, 1);
  assert.equal(trend.FROZEN_DESIGN.strategyId, 'EFG90_TREND12M_CASH_50BP');
  assert.deepEqual(trend.FROZEN_DESIGN.marketOrder, ['crypto', 'sweden', 'usa', 'europe', 'global']);
  assert.equal(trend.FROZEN_DESIGN.initialState, 'cash');
  assert.equal(trend.FROZEN_DESIGN.fearMaximumInclusive, 24);
  assert.equal(trend.FROZEN_DESIGN.greedMinimumInclusive, 75);
  assert.equal(trend.FROZEN_DESIGN.armCalendarDaysInclusive, 90);
  assert.equal(trend.FROZEN_DESIGN.trend.anniversaryCalendarDays, 365);
  assert.equal(trend.FROZEN_DESIGN.cost.oneWay, 0.005);
  assert.equal(trend.FROZEN_DESIGN.interpretation.includes('retrospective exploratory'), true);
});

test('12-month reference is causal, on-or-before anniversary, and at most seven days stale', () => {
  const prices = [
    { date: '2020-01-01', close: 90 },
    { date: '2020-01-04', close: 100 },
    { date: '2021-01-03', close: 110 }, // anniversary 2020-01-04, staleness 0
    { date: '2021-01-10', close: 120 }, // anniversary 2020-01-11, staleness 7
    { date: '2021-01-11', close: 121 }, // anniversary 2020-01-12, staleness 8
  ];
  const result = trend.buildTrendMap(prices);
  assert.equal(result.get('2021-01-03').referenceDate, '2020-01-04');
  assert.equal(result.get('2021-01-03').referenceStalenessCalendarDays, 0);
  assert.equal(result.get('2021-01-10').referenceDate, '2020-01-04');
  assert.equal(result.get('2021-01-10').referenceStalenessCalendarDays, 7);
  assert.equal(result.has('2021-01-11'), false);
  assert.ok(Math.abs(result.get('2021-01-03').trend - Math.log(1.1)) < 1e-15);
});

test('future prices cannot change any already-computed trend row', () => {
  const prefix = [
    { date: '2020-01-01', close: 100 },
    { date: '2021-01-01', close: 110 },
    { date: '2021-01-02', close: 111 },
  ];
  const futureA = prefix.concat([{ date: '2021-01-03', close: 1 }]);
  const futureB = prefix.concat([{ date: '2021-01-03', close: 1000000 }]);
  const prefixMap = trend.buildTrendMap(prefix);
  const mapA = trend.buildTrendMap(futureA);
  const mapB = trend.buildTrendMap(futureB);
  for (const [date, row] of prefixMap) {
    assert.deepEqual(mapA.get(date), row);
    assert.deepEqual(mapB.get(date), row);
  }
});

test('first eligible decision requires both exact signal date and valid prior trend', () => {
  const market = {
    key: 'synthetic',
    prices: { rows: [
      { date: '2020-01-01', close: 100 },
      { date: '2020-12-31', close: 105 },
      { date: '2021-01-01', close: 110 },
      { date: '2021-01-02', close: 111 },
    ] },
    signals: [
      { date: '2020-12-31', publishedScore: 10 },
      { date: '2021-01-01', publishedScore: 20 },
      { date: '2021-01-02', publishedScore: 30 },
    ],
  };
  assert.equal(trend.firstEligibleDecisionDate(market), '2020-12-31');
  assert.equal(trend.eligiblePrices(market)[0].date, '2020-12-31');
});

test('fear buys and greed sells only next close; old position earns/avoids full interval; execution-bar score is skipped', () => {
  const prices = [
    { date: '2020-01-01', close: 100 },
    { date: '2020-01-02', close: 200 },
    { date: '2020-01-03', close: 300 },
    { date: '2020-01-04', close: 150 },
  ];
  const scores = new Map([
    ['2020-01-01', 24],
    ['2020-01-02', 100], // must be ignored because this is the buy execution bar
    ['2020-01-03', 75],
  ]);
  const trendMap = mapOf([
    trendRow('2020-01-01', 0.1),
    trendRow('2020-01-02', -0.1),
    trendRow('2020-01-03', -0.2),
  ]);
  const result = trend.simulateStrategy({ prices, scoreMap: scores, trendMap, cost: 0.005, annualization: 252 });
  const expected = (1 / 1.005) * (300 / 200) * (150 / 300) * 0.995;
  assert.ok(Math.abs(result.terminalWealth - expected) < 1e-12);
  assert.equal(result.filledBuys, 1);
  assert.equal(result.filledSells, 1);
  assert.equal(result.completedBuySellCycles, 1);
  assert.equal(result.executionBarsSkipped, 2);
  assert.deepEqual(result.events.map(event => [event.side, event.signalDate, event.executionDate]), [
    ['buy', '2020-01-01', '2020-01-02'],
    ['sell', '2020-01-03', '2020-01-04'],
  ]);
  assert.equal(result.wealthCurve[1].wealth, 1 / 1.005, 'cash must avoid the 100-to-200 return before buying');
});

test('arm expiry is inclusive at day 90 and expired before day 91', () => {
  const trigger = '2020-01-01';
  const day90 = trend.addCalendarDays(trigger, 90);
  const day91 = trend.addCalendarDays(trigger, 91);
  const day92 = trend.addCalendarDays(trigger, 92);
  assert.equal(day90, '2020-03-31');

  const inclusive = trend.simulateStrategy({
    prices: [
      { date: trigger, close: 100 },
      { date: day90, close: 100 },
      { date: day91, close: 100 },
    ],
    scoreMap: new Map([[trigger, 24]]),
    trendMap: mapOf([trendRow(trigger, -0.1), trendRow(day90, 0.1)]),
    cost: 0,
  });
  assert.equal(inclusive.filledBuys, 1);
  assert.equal(inclusive.events[0].signalDate, day90);
  assert.equal(inclusive.events[0].executionDate, day91);

  const expired = trend.simulateStrategy({
    prices: [
      { date: trigger, close: 100 },
      { date: day91, close: 100 },
      { date: day92, close: 100 },
    ],
    scoreMap: new Map([[trigger, 24]]),
    trendMap: mapOf([trendRow(trigger, -0.1), trendRow(day91, 0.1)]),
    cost: 0,
  });
  assert.equal(expired.filledBuys, 0);
  assert.equal(expired.queuedBuys, 0);
  assert.equal(expired.armExpirations, 1);
});

test('repeated extreme refreshes from the newest date and missing later score may still confirm', () => {
  const prices = [
    { date: '2020-01-01', close: 100 },
    { date: '2020-02-01', close: 100 },
    { date: '2020-04-30', close: 100 },
    { date: '2020-05-01', close: 100 },
  ];
  const result = trend.simulateStrategy({
    prices,
    scoreMap: new Map([['2020-01-01', 20], ['2020-02-01', 10]]),
    trendMap: mapOf([
      trendRow('2020-01-01', -0.1),
      trendRow('2020-02-01', -0.1),
      trendRow('2020-04-30', 0.1),
    ]),
    cost: 0,
  });
  assert.equal(result.armRefreshes, 1);
  assert.equal(result.filledBuys, 1);
  assert.equal(result.events[0].signalDate, '2020-04-30');
  assert.equal(result.events[0].score, null);
});

test('terminal confirmation queues but does not invent a fill or forced liquidation', () => {
  const result = trend.simulateStrategy({
    prices: [{ date: '2020-01-01', close: 100 }, { date: '2020-01-02', close: 100 }],
    scoreMap: new Map([['2020-01-02', 24]]),
    trendMap: mapOf([trendRow('2020-01-02', 0.1)]),
    cost: 0.005,
  });
  assert.equal(result.fillCount, 0);
  assert.equal(result.queuedBuys, 1);
  assert.equal(result.unfilledTerminalOrders, 1);
  assert.equal(result.finalState, 'cash');
  assert.equal(result.terminalWealth, 1);
  assert.equal(result.events.at(-1).unfilled, true);
  assert.equal(result.events.at(-1).executionDate, null);
});

test('buy and sell cost factors are exact and signals without fills have no cost', () => {
  assert.equal(trend.FROZEN_DESIGN.cost.buyWealthFactor, 1 / 1.005);
  assert.equal(trend.FROZEN_DESIGN.cost.sellWealthFactor, 0.995);
  const noFill = trend.simulateStrategy({
    prices: [{ date: '2020-01-01', close: 100 }, { date: '2020-01-02', close: 200 }],
    scoreMap: new Map([['2020-01-01', 24]]),
    trendMap: mapOf([trendRow('2020-01-01', -0.1)]),
    cost: 0.005,
  });
  assert.equal(noFill.terminalWealth, 1);
  assert.equal(noFill.cumulativeExecutionCostFactor, 1);
});

test('matched B&H begins at the exact same close and half split is interval exact', () => {
  const prices = [1, 2, 4, 8, 16, 32].map((close, index) => ({ date: `2020-01-0${index + 1}`, close }));
  const benchmark = trend.benchmarkBuyAndHold({ prices, annualization: 252 });
  assert.equal(benchmark.startDate, prices[0].date);
  assert.equal(benchmark.endDate, prices.at(-1).date);
  assert.equal(benchmark.terminalWealth, 32);
  const halves = trend.splitPriceWindows(prices);
  assert.equal(halves[0].length - 1, 2);
  assert.equal(halves[1].length - 1, 3);
  assert.equal(halves[0].at(-1).date, halves[1][0].date);
});

function gateFixture() {
  const markets = {};
  const halfWins = [2, 2, 1, 1, 1];
  for (let index = 0; index < 5; index++) {
    const fullWin = index < 4;
    markets[`m${index}`] = {
      full: {
        terminalWealthDifference: fullWin ? 0.1 : -0.1,
        terminalWealthRatio: index === 4 ? 0.8 : 1.1,
        maximumDrawdownImprovement: index < 3 ? 0 : -0.01,
        strategy: { completedBuySellCycles: index < 4 ? 1 : 0 },
      },
      halves: [0, 1].map(half => ({ terminalWealthDifference: half < halfWins[index] ? 0.1 : -0.1 })),
    };
  }
  return {
    markets,
    common: { terminalWealthDifference: 0.01, annualizedLogReturnExcess: 0.001 },
  };
}

test('gate passes its exact 4/5, 7/10, 4/5, 3/5 and 80% boundaries', () => {
  const fixture = gateFixture();
  const result = trend.evaluateGate(fixture.markets, fixture.common, true);
  assert.equal(result.pass, true);
  assert.deepEqual(result.diagnostics, {
    fullHistoryWins: 4,
    halfCellWins: 7,
    marketsWithCompletedCycle: 4,
    marketsWithNoWorseDrawdown: 3,
    minimumTerminalWealthRatio: 0.8,
    commonCalendarTerminalWealthDifference: 0.01,
    commonCalendarAnnualizedLogReturnExcess: 0.001,
  });
});

test('each predeclared gate independently blocks a pass below its boundary', () => {
  const mutations = [
    fixture => { fixture.markets.m3.full.terminalWealthDifference = -0.1; },
    fixture => { fixture.markets.m4.halves[0].terminalWealthDifference = -0.1; },
    fixture => { fixture.common.terminalWealthDifference = -0.001; fixture.common.annualizedLogReturnExcess = -0.001; },
    fixture => { fixture.markets.m3.full.strategy.completedBuySellCycles = 0; },
    fixture => { fixture.markets.m2.full.maximumDrawdownImprovement = -0.01; },
    fixture => { fixture.markets.m4.full.terminalWealthRatio = 0.799999; },
  ];
  for (const mutate of mutations) {
    const fixture = gateFixture();
    mutate(fixture);
    assert.equal(trend.evaluateGate(fixture.markets, fixture.common, true).pass, false);
  }
  const fixture = gateFixture();
  assert.equal(trend.evaluateGate(fixture.markets, fixture.common, false).pass, false);
});

test('date intersection is literal and deterministic', () => {
  assert.deepEqual(trend.intersectSortedDates([
    ['2020-01-01', '2020-01-02', '2020-01-04'],
    ['2020-01-02', '2020-01-03', '2020-01-04'],
    ['2020-01-02', '2020-01-04'],
  ]), ['2020-01-02', '2020-01-04']);
});

test('deterministic verifier rejects any second-pass mutation', () => {
  assert.deepEqual(trend.verifyDeterministicResults(() => ({ analysisFingerprintSha256: 'x', value: 1 })), {
    analysisFingerprintSha256: 'x', value: 1,
  });
  let count = 0;
  assert.throws(() => trend.verifyDeterministicResults(() => ({ analysisFingerprintSha256: 'x', value: ++count })), /not byte-deterministic/);
});

test('saved result sidecar is verified and raw tampering is rejected without network', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'schema8-trend-'));
  const file = path.join(directory, 'result.json');
  try {
    const saved = {
      schemaVersion: trend.SCHEMA_VERSION,
      strategyId: trend.STRATEGY_ID,
      frozenDesign: trend.FROZEN_DESIGN,
      protocol: trend.currentSourceHashes(),
      input: { snapshotSha256: trend.REQUIRED_SNAPSHOT_SHA256 },
      marker: 'synthetic replay mechanics only',
    };
    saved.analysisFingerprintSha256 = trend.analysisFingerprint(saved);
    trend.writeWithSidecar(file, trend.canonicalJson(saved));
    assert.equal(trend.readSavedResult(file).results.marker, saved.marker);
    fs.appendFileSync(file, ' ');
    assert.throws(() => trend.readSavedResult(file), /checksum/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('network guard rejects fetch and restores the original function', () => {
  const before = global.fetch;
  trend.withNetworkDisabled(() => assert.throws(() => global.fetch('https://example.invalid'), /forbids all network access/));
  assert.equal(global.fetch, before);
});

test('frozen protocol and normalized executable hashes validate', () => {
  const state = trend.assertProtocolFrozen();
  assert.equal(state.marker, trend.REQUIRED_PROTOCOL_MARKER);
  assert.equal(state.frozenAt, trend.REQUIRED_PROTOCOL_FREEZE_AT);
  assert.equal(state.protocolSha256, trend.REQUIRED_PROTOCOL_SHA256);
  assert.equal(state.runnerNormalizedSha256, trend.REQUIRED_RUNNER_NORMALIZED_SHA256);
});
