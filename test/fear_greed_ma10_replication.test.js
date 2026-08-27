'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  monthEndRows,
  buildOrders,
  simulate,
  chronologicalHalves,
  simulateHalf,
  fingerprintResult,
} = require('../research/fear_greed_ma10_replication');

function monthlyRows(months, direction = 1) {
  const rows = [];
  let value = 100;
  for (let m = 0; m < months; m++) {
    const year = 2020 + Math.floor(m / 12);
    const month = String((m % 12) + 1).padStart(2, '0');
    rows.push({ date: `${year}-${month}-20`, close: value });
    value *= direction > 0 ? 1.02 : 0.98;
    rows.push({ date: `${year}-${month}-28`, close: value });
    value *= direction > 0 ? 1.01 : 0.99;
  }
  return rows;
}

test('monthEndRows keeps only the final close of each calendar month', () => {
  const rows = [
    { date: '2026-01-02', close: 10 },
    { date: '2026-01-30', close: 11 },
    { date: '2026-02-27', close: 12 },
  ];
  assert.deepEqual(monthEndRows(rows).map(row => [row.date, row.close]), [
    ['2026-01-30', 11],
    ['2026-02-27', 12],
  ]);
});

test('orders use ten month-end closes and execute strictly on the next row', () => {
  const rows = monthlyRows(12, 1);
  const orders = buildOrders(rows, 10);
  assert.ok(orders.length >= 2);
  for (const order of orders) {
    assert.ok(order.executionDate > order.signalDate);
    assert.equal(rows[order.executionIndex].date, order.executionDate);
  }
  assert.equal(orders[0].signal, 1);
});

test('an uptrend enters long and applies the initial cost symmetrically', () => {
  const result = simulate(monthlyRows(24, 1), 50, 10);
  assert.equal(result.missingExecutions, 0);
  assert.ok(result.exposureChanges >= 1);
  assert.ok(Math.abs(result.terminalStrategy - result.terminalBuyHold) < 1e-12);
});

test('a persistent downtrend remains cash while buy-and-hold loses', () => {
  const result = simulate(monthlyRows(24, -1), 50, 10);
  assert.equal(result.exposureChanges, 0);
  assert.equal(result.terminalStrategy, 1);
  assert.ok(result.terminalBuyHold < 1);
});

test('cost is charged only when exposure changes', () => {
  const noCost = simulate(monthlyRows(24, 1), 0, 10);
  const withCost = simulate(monthlyRows(24, 1), 50, 10);
  assert.equal(noCost.exposureChanges, withCost.exposureChanges);
  assert.ok(withCost.terminalStrategy < noCost.terminalStrategy);
  assert.ok(withCost.terminalBuyHold < noCost.terminalBuyHold);
});

test('second-half evaluation keeps pre-boundary warmup instead of waiting ten new months', () => {
  const rows = monthlyRows(36, 1);
  const halves = chronologicalHalves(rows);
  const result = simulateHalf(halves.secondWithWarmup, 50, halves.secondResultStart);
  assert.ok(result.startDate >= halves.secondResultStart);
  const delayDays = (Date.parse(`${result.startDate}T00:00:00Z`) - Date.parse(`${halves.secondResultStart}T00:00:00Z`)) / 86400000;
  assert.ok(delayDays < 45, `unexpected second-half start delay: ${delayDays} days`);
  assert.ok(result.ledger[0].signalDate < result.startDate);
});

test('analysis fingerprint ignores run timestamp metadata by construction', () => {
  const base = {
    schemaVersion: 10,
    candidate: 'MA10-LF-50',
    inputSha256: 'a'.repeat(64),
    primaryCostBps: 50,
    markets: [{ key: 'usa', primary: { terminalStrategy: 1 }, halves: {}, costGrid: {} }],
    common: { strategy: 1 },
    verdict: { status: 'FAIL_NO_COMMON_WINNER' },
  };
  assert.equal(fingerprintResult({ ...base, createdAt: 'one' }), fingerprintResult({ ...base, createdAt: 'two' }));
});
