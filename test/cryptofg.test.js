'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeCrypto, labelOf, pctScores } = require('../cryptofg');

const SYMBOLS = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD', 'BNB-USD'];

function dateAt(index) {
  const date = new Date('2020-01-01T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
}

function fixture(days = 1000) {
  const map = new Map();
  SYMBOLS.forEach((symbol, assetIndex) => {
    const rows = [];
    let close = 25 + assetIndex * 8;
    for (let i = 0; i < days; i++) {
      // Deterministic but non-monotone paths ensure every percentile component has variation.
      const cyclical = 0.0018 * Math.sin(i / (13 + assetIndex)) + 0.0012 * Math.cos(i / (31 + assetIndex));
      const shock = i % (91 + assetIndex) === 0 ? -0.035 + assetIndex * 0.001 : 0;
      close *= Math.exp(0.0007 + assetIndex * 0.000015 + cyclical + shock);
      rows.push({ date: dateAt(i), close });
    }
    map.set(symbol, {
      symbol,
      name: symbol,
      currency: 'USD',
      rows,
      lastDate: rows.at(-1).date,
      fetchedAt: '2026-08-24T00:00:00Z',
      adjusted: true,
      calendarGaps: 0,
    });
  });
  return map;
}

const CONFIG = {
  modelId: 'test-crypto-model',
  version: 1,
  benchmark: 'BTC-USD',
  symbols: SYMBOLS,
  scoreWindow: 365,
  minScorePoints: 180,
  trendDays: 200,
  highDays: 365,
  volatilityDays: 30,
  volatilityBaselineDays: 90,
  breadthSmaDays: 200,
  relativeReturnDays: 30,
  historyPoints: 8000,
};

test('midrank percentiles use only the trailing window', () => {
  assert.deepEqual(pctScores([1, 2, 3, 1000], 3, 1).map(x => Math.round(x * 10) / 10), [50, 75, 83.3, 83.3]);
});

test('own crypto model is bounded, labelled and exactly equal-weighted', () => {
  const result = computeCrypto(fixture(), CONFIG);
  assert.equal(result.ok, true);
  assert.equal(result.model.owner, 'repository');
  assert.equal(result.total, 5);
  assert.equal(result.n, 5);
  assert.equal(result.assetCount, SYMBOLS.length);
  assert.ok(result.history.length > 300);
  assert.ok(result.value >= 0 && result.value <= 100);
  assert.equal(result.label, labelOf(result.value));
  for (const row of result.history) {
    assert.ok(Number.isFinite(row.value));
    assert.ok(row.value >= 0 && row.value <= 100);
    assert.equal(row.label, labelOf(row.value));
    assert.equal(row.n, 5);
    assert.equal(row.assetCount, SYMBOLS.length);
  }
  const mean = Object.values(result.components).reduce((sum, component) => sum + component.score, 0) / result.total;
  assert.ok(Math.abs(result.value - mean) <= 0.11, `rounded equal-weight mean differs: ${result.value} vs ${mean}`);
  assert.equal(result.components.volatility.dir, -1);
});

test('future observations cannot change earlier scores', () => {
  const original = fixture(1000);
  const changed = fixture(1000);
  for (const series of changed.values()) {
    for (let i = 900; i < series.rows.length; i++) series.rows[i].close *= 1 + (i - 899) * 0.15;
  }
  const first = computeCrypto(original, CONFIG);
  const second = computeCrypto(changed, CONFIG);
  const cutoff = dateAt(899);
  const beforeFirst = first.history.filter(row => row.date <= cutoff).map(row => [row.date, row.value, row.label]);
  const beforeSecond = second.history.filter(row => row.date <= cutoff).map(row => [row.date, row.value, row.label]);
  assert.deepEqual(beforeSecond, beforeFirst);
});

test('the fixed basket is mandatory and cannot silently change', () => {
  const missing = fixture();
  missing.delete('SOL-USD');
  assert.throws(() => computeCrypto(missing, CONFIG), /fixed crypto basket incomplete: SOL-USD/);
});
