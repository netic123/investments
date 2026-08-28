'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../research/fear_greed_expanding_binary.js');
const adapter = require('../research/run_fear_greed_expanding_binary_frozen.js');

function isoDay(index) {
  const date = new Date('2020-01-01T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
}

function syntheticSnapshot() {
  return {
    schemaVersion: 5,
    markets: adapter.MARKET_SPECS.map((spec) => ({
      key: spec.key,
      name: spec.key,
      targetId: spec.targetId,
      annualization: spec.annualization,
      prices: {
        symbol: spec.targetId,
        adjusted: spec.requiresAdjusted,
        rows: Array.from({ length: 140 }, (_, index) => ({ date: isoDay(index), close: 100 + index })),
      },
      signals: Array.from({ length: 15 }, (_, index) => ({
        date: isoDay(125 + index),
        publishedScore: 50 + (index % 3),
        components: Object.fromEntries(core.COMPONENT_KEYS.map((component, componentIndex) => [
          component,
          { score: 40 + componentIndex + index },
        ])),
      })),
    })),
  };
}

test('frozen adapter pins the exact schema-5 path, hash, order, targets, and suitability labels', () => {
  assert.match(adapter.SNAPSHOT_PATH.replaceAll('\\', '/'), /research\/local-artifacts\/v2-validation-final\/inputs\/fear-greed-v2-validation-input-2026-08-25T12-44-22Z\.json$/);
  assert.equal(adapter.SNAPSHOT_SHA256, 'ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d');
  assert.deepEqual(adapter.MARKET_SPECS.map((spec) => spec.key), ['crypto', 'sweden', 'usa', 'europe', 'global']);
  assert.deepEqual(adapter.MARKET_SPECS.map((spec) => spec.targetId), ['CRYPTO-BROAD-EW', '^OMXSBGI', 'SPY', '^STOXX', 'ACWI']);
  assert.ok(adapter.MARKET_SPECS.every((spec) => /NOT_INVESTABLE|NOT_EXECUTABLE|ZERO_CASH/.test(spec.suitability)));
});

test('snapshot adapter preserves every price and signal row without opening the real snapshot', () => {
  const snapshot = syntheticSnapshot();
  const inputs = adapter.snapshotToInputs(snapshot);
  assert.equal(inputs.length, 5);
  for (const [index, input] of inputs.entries()) {
    assert.equal(input.targetId, adapter.MARKET_SPECS[index].targetId);
    assert.equal(input.targetAdjusted, snapshot.markets[index].prices.adjusted === true);
    assert.equal(input.prices.length, snapshot.markets[index].prices.rows.length);
    assert.equal(input.signals.length, snapshot.markets[index].signals.length);
    assert.deepEqual(Object.keys(input.signals[0].components), core.COMPONENT_KEYS);
    assert.equal(input.signals[0].availableAtUtc, null);
  }
});

test('snapshot adapter rejects target, order, component, date, and schema drift', () => {
  const target = syntheticSnapshot();
  target.markets[0].targetId = 'BTC-USD';
  assert.throws(() => adapter.snapshotToInputs(target), /target identity drifted/);

  const order = syntheticSnapshot();
  [order.markets[0], order.markets[1]] = [order.markets[1], order.markets[0]];
  assert.throws(() => adapter.snapshotToInputs(order), /order or set drifted/);

  const component = syntheticSnapshot();
  delete component.markets[2].signals[0].components.credit;
  assert.throws(() => adapter.snapshotToInputs(component), /component identity\/order drifted/);

  const date = syntheticSnapshot();
  date.markets[4].signals[0].date = '1999-01-01';
  assert.throws(() => adapter.snapshotToInputs(date), /no exact target close/);

  const impossibleDate = syntheticSnapshot();
  impossibleDate.markets[1].prices.rows[20].date = '2020-02-30';
  assert.throws(() => adapter.snapshotToInputs(impossibleDate), /invalid date/);

  const schema = syntheticSnapshot();
  schema.schemaVersion = 6;
  assert.throws(() => adapter.snapshotToInputs(schema), /Expected schema 5/);

  const unadjusted = syntheticSnapshot();
  unadjusted.markets[2].prices.adjusted = false;
  assert.throws(() => adapter.snapshotToInputs(unadjusted), /not an adjusted-close/);
});

test('real-byte parser refuses every payload except the preregistered SHA-256', () => {
  const bytes = Buffer.from(JSON.stringify(syntheticSnapshot()), 'utf8');
  assert.notEqual(adapter.sha256Bytes(bytes), adapter.SNAPSHOT_SHA256);
  assert.throws(() => adapter.parseFrozenSnapshotBytes(bytes), /Frozen snapshot hash drift/);
});

test('snapshot hashing and JSON decoding use one copy and captured native Buffer operations', () => {
  const bytes = Buffer.from('{"authentic":true}', 'utf8');
  const expectedHash = adapter.sha256Bytes(bytes);
  bytes.toString = () => '{"forged":true}';
  const originalPrototypeToString = Buffer.prototype.toString;
  const originalBufferFrom = Buffer.from;
  try {
    Buffer.prototype.toString = () => '{"forgedByPrototype":true}';
    Buffer.from = () => { throw new Error('mutable Buffer.from was used'); };
    const decoded = adapter.copyHashAndDecodeBuffer(bytes);
    assert.equal(decoded.text, '{"authentic":true}');
    assert.equal(decoded.sha256, expectedHash);
  } finally {
    Buffer.prototype.toString = originalPrototypeToString;
    Buffer.from = originalBufferFrom;
  }
});

test('direct CLI execution is gated and importing the adapter performs no real-data read', () => {
  assert.throws(() => adapter.runCli([]), /Direct execution is disabled/);
  assert.throws(() => adapter.runCli(['--wrong']), /Direct execution is disabled/);
  assert.equal(adapter.computeFrozenStudy, undefined,
    'unverified callers must not be able to label arbitrary inputs with the pinned snapshot hash');
  assert.equal(adapter.writeResultArtifact, undefined,
    'only the guarded CLI may create an authoritative result artifact');
});
