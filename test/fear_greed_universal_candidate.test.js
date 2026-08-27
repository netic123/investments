'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const candidate = require('../research/fear_greed_universal_candidate');

test('grid is deterministic, bounded, and contains only universal declarations', () => {
  assert.equal(candidate.CANDIDATES.length, 28);
  assert.deepEqual(candidate.buildCandidateGrid(), candidate.CANDIDATES.map(row => ({ ...row })));
  assert.equal(new Set(candidate.CANDIDATES.map(row => row.id)).size, 28);
  assert.deepEqual(new Set(candidate.CANDIDATES.map(row => row.maximumExposure)), new Set([1.5]));
});

test('trend, volatility and crash features map to the frozen exposure rules', () => {
  const base = { close: 110, sma100: 100, sma200: 100, vol20: 0.10, vol63: 0.10, drawdown252: 0, participation: 1 };
  const trend = candidate.CANDIDATES.find(row => row.family === 'trend' && row.trendBars === 100 && row.bearExposure === 0);
  assert.equal(candidate.exposureFor(trend, base), 1);
  assert.equal(candidate.exposureFor(trend, { ...base, close: 90 }), 0);
  const scaled = candidate.CANDIDATES.find(row => row.family === 'trend_vol' && row.targetVolatility === 0.15 && row.volatilityLookback === 20);
  assert.ok(Math.abs(candidate.exposureFor(scaled, base) - 1.5) < 1e-12);
  const participation = candidate.CANDIDATES.find(row => row.crashFilter === 'participation_50');
  assert.equal(candidate.exposureFor(participation, { ...base, participation: 0.4 }), 0.25);
});

test('60/20/20 split leaves a non-empty sealed final segment', () => {
  const states = Array.from({ length: 101 }, (_, index) => ({ date: String(index) }));
  const split = candidate.splitStates(states);
  assert.deepEqual(split, {
    train: { start: 0, end: 60 },
    development: { start: 60, end: 80 },
    final: { start: 80, end: 101 },
  });
});

test('strategy decision at t fills only at the next close', () => {
  const prices = [
    { date: '2026-01-01', close: 100 },
    { date: '2026-01-02', close: 200 },
    { date: '2026-01-03', close: 200 },
  ];
  const state = { date: prices[0].date, close: 90, sma100: 100, sma200: 100, vol20: 0.1, vol63: 0.1, drawdown252: 0, participation: 1 };
  const gridRow = candidate.CANDIDATES.find(row => row.family === 'trend' && row.bearExposure === 0);
  const result = candidate.simulateCandidate(prices, new Map([[state.date, state]]), gridRow, 0);
  assert.equal(result.terminalWealth, 2);
  assert.equal(result.buyAndHoldTerminalWealth, 2);
});

test('candidate source contains an explicit prohibition on final evaluation', () => {
  assert.match(candidate.DESIGN.finalPolicy, /no candidate performance/i);
  assert.equal(candidate.DESIGN.status, 'RETROSPECTIVE_DEVELOPMENT_ONLY_FINAL_HOLDOUT_SEALED_NOT_EVALUATED');
});
