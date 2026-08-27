'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const evaluation = require('../research/fear_greed_v3_evaluation');

function prices(count = 320) {
  const start = new Date('2024-01-01T00:00:00Z');
  const rows = [];
  let close = 100;
  for (let index = 0; index < count; index++) {
    const date = new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10);
    close *= Math.exp(0.0003 + 0.002 * Math.sin(index / 7));
    rows.push({ date, close });
  }
  return rows;
}

test('displayed integer follows the dashboard two-stage label rounding', () => {
  assert.equal(evaluation.displayedInteger(74.44), 74);
  assert.equal(evaluation.displayedInteger(74.45), 75);
  assert.equal(evaluation.displayedInteger(24.44), 24);
  assert.equal(evaluation.displayedInteger(24.45), 25);
});

test('Holm adjustment is monotone in ordered p-values and restored to market order', () => {
  const result = evaluation.holmAdjust([
    { key: 'a', pValue: 0.03 },
    { key: 'b', pValue: 0.001 },
    { key: 'c', pValue: 0.02 },
  ]);
  assert.deepEqual(result.map(row => row.key), ['a', 'b', 'c']);
  assert.deepEqual(result.map(row => Number(row.adjustedPValue.toFixed(3))), [0.04, 0.003, 0.04]);
});

test('forecast rows use t plus one entry and t plus twenty-two exit', () => {
  const target = prices();
  const history = target.slice(140, 290).map((row, index) => ({ date: row.date, exactScore: 40 + index / 10 }));
  const built = evaluation.buildForecastRows({ annualization: 252, prices: { rows: target } }, history);
  assert.ok(built.rows.length > 100);
  for (const row of built.rows) {
    assert.equal(row.entryIndex, row.signalIndex + 1);
    assert.equal(row.exitIndex, row.signalIndex + 22);
    assert.equal(row.entryDate, target[row.entryIndex].date);
    assert.equal(row.exitDate, target[row.exitIndex].date);
  }
});

test('development segment preserves an exact 252-row fitting seed', () => {
  const rows = Array.from({ length: 1008 }, (_, index) => ({ signalDate: `d${index}` }));
  const segment = evaluation.developmentSegment(rows);
  assert.equal(segment.start, 252);
  assert.equal(segment.end, 1008);
  assert.equal(segment.count, 756);
});
