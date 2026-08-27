'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../research/fear_greed_extremes_retro_model.js');

test('model selftest passes (simulator, smoothing, cadences, terminal fill)', () => {
  assert.equal(model.selftest(), 'selftest ok');
});

test('frozen model spec is complete, coherent and carries frozen expectations', () => {
  const keys = Object.keys(model.FROZEN_MODEL).sort();
  assert.deepEqual(keys, ['crypto', 'europe', 'global', 'sweden', 'usa']);
  for (const [key, spec] of Object.entries(model.FROZEN_MODEL)) {
    assert.ok(spec.fear >= 0 && spec.fear < spec.greed && spec.greed <= 100, key);
    assert.ok([1, 5, 10, 21, 42, 63].includes(spec.smoothing), key);
    assert.ok(['d', 'w', 'me'].includes(spec.cadence), key);
    assert.ok(spec.expectedRatio > 1, `${key} must beat its index on the frozen history`);
    assert.ok(Number.isInteger(spec.expectedTrades) && spec.expectedTrades >= 2, key);
    assert.ok(spec.placeboP >= 0.01 && spec.placeboP <= 1, key);
  }
});

test('hysteresis is stateful: no re-entry until fear threshold, no exit until greed', () => {
  const prices = Array.from({ length: 6 }, (_, i) => ({ date: `2021-01-0${i + 1}`, close: 100 }));
  const scores = [50, 85, 60, 40, 20, 50];
  const positions = model.buildPositions(scores, prices, { fear: 20, greed: 80, cadence: 'd' });
  // sell after bar 1 (85 >= 80); stays out through 60 and 40; re-enters after bar 4 (20 <= 20)
  assert.deepEqual(positions, [1, 1, 0, 0, 0, 1]);
});

test('cash factor is applied only on flat intervals and cost only on switches', () => {
  const prices = [
    { date: 'a', close: 100 }, { date: 'b', close: 200 }, { date: 'c', close: 100 },
  ];
  const cash = (d0) => (d0 === 'b' ? 1.5 : 99);
  const r = model.simulateWithCash(prices, [1, 0, 0], 0.1, cash);
  // long interval 1 (x2), switch (x0.9), flat interval 2 earns cash from 'b' (x1.5)
  assert.ok(Math.abs(r.terminalWealth - 2 * 0.9 * 1.5) < 1e-12);
  assert.equal(r.trades, 1);
  assert.equal(r.exposure, 0.5);
});
