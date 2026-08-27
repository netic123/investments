'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const overlay = require('../research/fear_greed_core_overlay');

function dates(count) {
  return Array.from({ length: count }, (_, index) => `2020-01-${String(index + 1).padStart(2, '0')}`);
}

function prices(values) {
  const d = dates(values.length);
  return values.map((close, index) => ({ date: d[index], close }));
}

test('frozen policy is exactly one symmetric 50/100/150 rule for five markets', () => {
  assert.equal(overlay.FROZEN_DESIGN.candidateCount, 1);
  assert.equal(overlay.STRATEGY_ID, 'S9_CORE_50_STEP_50');
  assert.deepEqual(overlay.FROZEN_DESIGN.marketOrder, ['crypto', 'sweden', 'usa', 'europe', 'global']);
  assert.equal(overlay.scoreToExposure(0), 1.5);
  assert.equal(overlay.scoreToExposure(24), 1.5);
  assert.equal(overlay.scoreToExposure(25), 1);
  assert.equal(overlay.scoreToExposure(74), 1);
  assert.equal(overlay.scoreToExposure(75), 0.5);
  assert.equal(overlay.scoreToExposure(100), 0.5);
  assert.equal(overlay.scoreToExposure(null), null);
  assert.throws(() => overlay.scoreToExposure(101), /outside/);
});

test('exact post-cost rebalance solves the target identity for buys and sells', () => {
  const buy = overlay.exactRebalance({ wealth: 1, riskyNotional: 1, targetExposure: 1.5, cost: 0.005 });
  assert.equal(buy.side, 'buy');
  assert.ok(Math.abs(buy.postRisky / buy.postWealth - 1.5) < 1e-14);
  assert.equal(buy.costAmount, buy.tradedNotional * 0.005);

  const sell = overlay.exactRebalance({ wealth: 1, riskyNotional: 1, targetExposure: 0.5, cost: 0.005 });
  assert.equal(sell.side, 'sell');
  assert.ok(Math.abs(sell.postRisky / sell.postWealth - 0.5) < 1e-14);
  assert.equal(sell.costAmount, sell.tradedNotional * 0.005);
});

test('score at a close changes exposure only at the following close', () => {
  const p = prices([100, 200, 300]);
  const scoreMap = new Map([[p[0].date, 24], [p[1].date, 75]]);
  const result = overlay.simulateStrategy({ prices: p, scoreMap, cost: 0, borrowAnnualRate: 0, annualization: 252 });
  assert.equal(result.events[0].signalDate, p[0].date);
  assert.equal(result.events[0].executionDate, p[1].date);
  assert.equal(result.events[0].targetExposure, 1.5);
  assert.equal(result.wealthCurve[1].wealth, 2, 'old 100% position must earn the first interval before the fear fill');
  assert.equal(result.events[1].signalDate, p[1].date);
  assert.equal(result.events[1].executionDate, p[2].date);
  assert.equal(result.events[1].targetExposure, 0.5);
  assert.ok(Math.abs(result.terminalWealth - 3.5) < 1e-12, 'second interval must earn 150% exposure before greed executes');
});

test('repeated extreme score rebalances drifted exposure and pays only traded-notional cost', () => {
  const p = prices([100, 100, 110]);
  const scoreMap = new Map([[p[0].date, 24], [p[1].date, 24]]);
  const result = overlay.simulateStrategy({ prices: p, scoreMap, cost: 0.005, borrowAnnualRate: 0, annualization: 252 });
  assert.equal(result.filledFearTargets, 2);
  assert.equal(result.events[0].targetExposure, 1.5);
  assert.equal(result.events[1].targetExposure, 1.5);
  assert.ok(result.events[1].tradedNotional > 0, 'drifted leveraged weight must be restored');
  assert.ok(Math.abs(result.events[1].postRisky / result.events[1].postWealth - 1.5) < 1e-12);
  assert.ok(Math.abs(result.totalTransactionCost - result.events.reduce((sum, event) => sum + event.costAmount, 0)) < 1e-15);
});

test('positive cash earns zero and negative cash incurs the frozen financing drag', () => {
  const p = prices([100, 100, 100]);
  const fear = overlay.simulateStrategy({ prices: p, scoreMap: new Map([[p[0].date, 24]]), cost: 0, borrowAnnualRate: 0.05, annualization: 252 });
  assert.ok(fear.totalFinancingCost > 0);
  assert.ok(fear.terminalWealth < 1);

  const greed = overlay.simulateStrategy({ prices: p, scoreMap: new Map([[p[0].date, 75]]), cost: 0, borrowAnnualRate: 0.05, cashAnnualRate: 0, annualization: 252 });
  assert.equal(greed.totalFinancingCost, 0);
  assert.equal(greed.terminalWealth, 1);
});

test('missing score queues no order and terminal signal is recorded but not filled', () => {
  const p = prices([100, 101, 102]);
  const missing = overlay.simulateStrategy({ prices: p, scoreMap: new Map(), cost: 0 });
  assert.equal(missing.fillCount, 0);
  assert.equal(missing.terminalWealth, 1.02);

  const terminal = overlay.simulateStrategy({ prices: p, scoreMap: new Map([[p[2].date, 24]]), cost: 0 });
  assert.equal(terminal.fillCount, 0);
  assert.equal(terminal.unfilledTerminalOrders, 1);
  assert.equal(terminal.events.at(-1).unfilled, true);
  assert.equal(terminal.events.at(-1).executionDate, null);
});

test('half split is exact by return intervals and restarts both cells at NAV one', () => {
  const p = prices([1, 2, 4, 8, 16, 32]);
  const halves = overlay.splitPriceWindows(p);
  assert.equal(halves[0].length - 1, 2);
  assert.equal(halves[1].length - 1, 3);
  assert.equal(halves[0].at(-1).date, halves[1][0].date);
  const first = overlay.runWindow({ prices: halves[0], scoreMap: new Map(), annualization: 252, cost: 0 });
  const second = overlay.runWindow({ prices: halves[1], scoreMap: new Map(), annualization: 252, cost: 0 });
  assert.equal(first.strategy.terminalWealth, 4);
  assert.equal(second.strategy.terminalWealth, 8);
});

test('circular shifts are deterministic, non-zero and preserve finite score multiset', () => {
  assert.deepEqual(overlay.deterministicShiftOffsets(5, 199), [1, 2, 3, 4]);
  const p = prices([1, 1, 1, 1, 1]);
  const original = new Map([[p[0].date, 10], [p[2].date, 50], [p[4].date, 90]]);
  const shifted = overlay.circularShiftScoreMap(p, original, 2);
  assert.deepEqual([...shifted.values()].sort((a, b) => a - b), [10, 50, 90]);
  assert.notDeepEqual([...shifted.entries()], [...original.entries()]);
});

function gateFixture() {
  const markets = {};
  const halfWins = [2, 2, 1, 1, 1];
  for (let index = 0; index < 5; index++) {
    markets[`m${index}`] = {
      full: {
        terminalWealthDifference: index < 4 ? 0.1 : -0.01,
        annualizedLogReturnExcess: index < 4 ? 0.01 : -0.001,
        terminalWealthRatio: index === 4 ? 0.9 : 1.1,
        maximumDrawdownImprovement: index < 3 ? 0 : -0.01,
        strategy: { filledFearTargets: index < 4 ? 1 : 0, filledGreedTargets: index < 4 ? 1 : 0 },
      },
      halves: [0, 1].map(half => ({ terminalWealthDifference: half < halfWins[index] ? 0.1 : -0.1 })),
      placebo: { actualPercentile: index < 3 ? 0.9 : 0.5 },
    };
  }
  return { markets, common: { terminalWealthDifference: 0.01, annualizedLogReturnExcess: 0.001 } };
}

test('historical candidate gate passes only its exact predeclared boundaries', () => {
  const fixture = gateFixture();
  const result = overlay.evaluateGate(fixture.markets, fixture.common, true);
  assert.equal(result.pass, true);
  assert.deepEqual(result.diagnostics, {
    fullHistoryWins: 4,
    halfCellWins: 7,
    marketsWithFearAndGreedFills: 4,
    marketsWithNoWorseDrawdown: 3,
    minimumTerminalWealthRatio: 0.9,
    marketsAtOrAbovePlacebo90thPercentile: 3,
    commonCalendarTerminalWealthDifference: 0.01,
    commonCalendarAnnualizedLogReturnExcess: 0.001,
  });
});

test('network guard restores patched APIs after execution', () => {
  const http = require('http');
  const before = http.get;
  assert.throws(() => overlay.withNetworkDisabled(() => http.get('http://127.0.0.1')), /network disabled/);
  assert.equal(http.get, before);
});

