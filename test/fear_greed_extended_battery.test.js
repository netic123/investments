'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const battery = require('../research/fear_greed_extended_battery.js');
const s6 = require('../research/fear_greed_extreme_strategy.js');

test('battery selftest passes (accounting parity with schema 6 incl. terminal fill)', () => {
  assert.equal(battery.selftest(), 'selftest ok');
});

test('simulatePath equals schema-6 simulateStrategy on a random hysteresis path', () => {
  const prices = [];
  let close = 100;
  let seed = 12345;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const scores = [];
  for (let i = 0; i < 400; i++) {
    close *= 1 + (rand() - 0.49) * 0.02;
    prices.push({ date: new Date(Date.UTC(2015, 0, 1) + i * 86400000).toISOString().slice(0, 10), close });
    scores.push(Math.floor(rand() * 101));
  }
  for (const cost of [0, 0.001, 0.0075]) {
    const positions = battery.positionsHysteresis(scores, 400, 24, 75, 1, 1);
    const mine = battery.simulatePath(prices, positions, cost, 252);
    const ref = s6.simulateStrategy({
      prices, scoreMap: new Map(prices.map((p, i) => [p.date, scores[i]])),
      fear: 24, greed: 75, cost, annualization: 252, initialPosition: 'long',
    });
    assert.ok(Math.abs(mine.terminalWealth - ref.terminalWealth) < 1e-12 * Math.max(1, ref.terminalWealth), `cost ${cost}`);
  }
});

test('month-end decisions have no anchor degree of freedom and fire on date boundaries only', () => {
  const prices = [
    { date: '2020-01-30', close: 100 }, { date: '2020-01-31', close: 101 },
    { date: '2020-02-03', close: 102 }, { date: '2020-02-27', close: 103 },
    { date: '2020-02-28', close: 104 }, { date: '2020-03-02', close: 105 },
  ];
  // greed >= 85 only on the mid-month bar: must be ignored (not a month end)
  assert.deepEqual(battery.positionsMonthEndHysteresis([50, 50, 90, 50, 50, 50], prices, 35, 85), [1, 1, 1, 1, 1, 1]);
  // greed on the January month-end bar exits from February; fear on the
  // February month-end re-enters at the terminal slot
  assert.deepEqual(battery.positionsMonthEndHysteresis([50, 90, 50, 50, 20, 50], prices, 35, 85), [1, 1, 0, 0, 0, 1]);
  // without the fear reading at the February month-end, stays in cash
  assert.deepEqual(battery.positionsMonthEndHysteresis([50, 90, 50, 50, 50, 50], prices, 35, 85), [1, 1, 0, 0, 0, 0]);
});

test('carryOntoCalendar enforces one staleness budget from the original date', () => {
  const prices = [{ date: '2020-01-02' }, { date: '2020-01-08' }, { date: '2020-01-10' }];
  assert.deepEqual(battery.carryOntoCalendar(prices, ['2020-01-01'], [55], 7), [55, 55, null]);
});

test('benjaminiHochberg controls the significant set and annotates cells', () => {
  const cells = [
    { pUncorrected: 0.0004 }, { pUncorrected: 0.02 }, { pUncorrected: 0.04 },
    { pUncorrected: 0.2 }, { pUncorrected: 0.8 }, { pUncorrected: null },
  ];
  const out = battery.benjaminiHochberg(cells, 0.05);
  assert.equal(out.tests, 5);
  assert.equal(cells[0].significantBH, true);
  assert.equal(cells[4].significantBH, false);
  assert.ok(!('significantBH' in cells[5]));
});
