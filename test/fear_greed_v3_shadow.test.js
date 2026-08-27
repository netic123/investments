'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const shadow = require('../research/fear_greed_v3_shadow');

function isoDate(index) {
  const date = new Date('2020-01-01T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
}

function makeRows(points, generator) {
  const rows = [];
  let close = 100;
  for (let index = 0; index < points; index++) {
    close *= Math.exp(generator(index));
    rows.push({ date: isoDate(index), close });
  }
  return rows;
}

function syntheticSnapshot(points = 520) {
  const symbols = ['BOND', 'HY', 'IG', 'SMALL', 'LARGE'];
  const generators = {
    BOND: index => 0.00015 + 0.0007 * Math.sin(index / 13),
    HY: index => 0.00035 + 0.0012 * Math.sin(index / 9.5),
    IG: index => 0.00020 + 0.0008 * Math.sin(index / 11),
    SMALL: index => 0.00055 + 0.0025 * Math.sin(index / 7.2) + 0.0005 * Math.cos(index / 21),
    LARGE: index => 0.00048 + 0.0018 * Math.sin(index / 8.3) + 0.0004 * Math.cos(index / 19),
  };
  const inventory = symbols.map(symbol => ({
    symbol,
    normalizedRows: makeRows(points, generators[symbol]),
  }));
  const benchmarkRows = makeRows(points, index =>
    0.00052 + 0.0020 * Math.sin(index / 8) + 0.00045 * Math.cos(index / 17));
  const markets = shadow.MARKET_KEYS.map(key => ({
    key,
    name: key,
    targetId: `INDEX-${key}`,
    prices: { symbol: `INDEX-${key}`, rows: benchmarkRows.map(row => ({ ...row })) },
    productionMapping: {
      symbols: {
        index: `INDEX-${key}`,
        bond: 'BOND',
        hy: 'HY',
        ig: 'IG',
        small: 'SMALL',
        large: 'LARGE',
      },
    },
  }));
  return {
    status: shadow.SOURCE_STATUS,
    createdAt: shadow.FROZEN_DEVELOPMENT_INPUT.collectedAt,
    sources: { yahoo: { normalizedSeriesInventory: inventory } },
    markets,
  };
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('the v3 shadow identity freezes exactly six equally weighted universal components', () => {
  assert.equal(shadow.STATUS, 'RETROSPECTIVE_DEVELOPMENT_ONLY_NOT_VALIDATED_NOT_LIVE_APPROVED');
  assert.deepEqual(shadow.COMPONENT_KEYS, ['trend', 'strength', 'volatility', 'safeHaven', 'credit', 'breadth']);
  assert.equal(Object.keys(shadow.PARAMETERS.componentWeights).length, 6);
  assert.ok(Math.abs(Object.values(shadow.PARAMETERS.componentWeights).reduce((sum, value) => sum + value, 0) - 1) < 1e-15);
  assert.equal(Object.hasOwn(shadow.PARAMETERS, 'percentileWindow'), false);
  assert.equal(Object.isFrozen(shadow.PARAMETERS), true);
  assert.equal(Object.isFrozen(shadow.PARAMETERS.componentWeights), true);
  const changed = deepClone(shadow.PARAMETERS);
  changed.trendSmaBars = 199;
  assert.throws(() => shadow.assertFrozenParameters(changed), /differ from the frozen universal definition/);
});

test('absolute and volatility-normalized transforms retain their declared anchors', () => {
  assert.equal(shadow.symmetricSigmaScore(-2), 0);
  assert.equal(shadow.symmetricSigmaScore(0), 50);
  assert.equal(shadow.symmetricSigmaScore(2), 100);
  assert.equal(shadow.drawdownSigmaScore(-2), 0);
  assert.equal(shadow.drawdownSigmaScore(-1), 50);
  assert.equal(shadow.drawdownSigmaScore(0), 100);
  assert.equal(shadow.volatilityRatioScore(0.5), 100);
  assert.equal(shadow.volatilityRatioScore(1), 50);
  assert.equal(shadow.volatilityRatioScore(2), 0);
});

test('participation rewards segments above their own trends even when the small/large ratio falls', () => {
  const broad = shadow.normalizeSeries({
    id: 'BROAD',
    rows: makeRows(300, index => 0.0018 + 0.00005 * Math.sin(index / 7)),
  });
  const large = shadow.normalizeSeries({
    id: 'LARGE',
    rows: makeRows(300, index => 0.0015 + 0.00005 * Math.sin(index / 9)),
  });
  const small = shadow.normalizeSeries({
    id: 'SMALL',
    rows: makeRows(300, index => 0.0007 + 0.00005 * Math.sin(index / 11)),
  });
  const lastDate = isoDate(299);
  const ratioAtStart = small.rows[199].close / large.rows[199].close;
  const ratioAtEnd = small.rows[299].close / large.rows[299].close;
  assert.ok(ratioAtEnd < ratioAtStart, 'synthetic small/large relative performance must be negative');

  const component = shadow.participationComponent([broad, large, small], lastDate);
  assert.equal(component.aboveTrendFraction, 1);
  assert.equal(component.segmentCount, 3);
  assert.ok(component.score > 50);
  assert.ok(component.segments.every(segment => segment.aboveOwnTrend));
});

test('a market score uses six complete components and their exact equal-weight mean', () => {
  const snapshot = syntheticSnapshot();
  const market = shadow.scoreMarket(snapshot, snapshot.markets[0]);
  assert.ok(market.rowCount > 100);
  const latest = market.latest;
  assert.equal(latest.componentCount, 6);
  const expected = shadow.mean(shadow.COMPONENT_KEYS.map(key => latest.components[key].score));
  assert.ok(Math.abs(latest.exactScore - expected) < 1e-15);
  assert.equal(latest.score, Math.round(expected * 10) / 10);
  assert.equal(latest.components.breadth.segmentCount, 3);
});

test('future prices cannot change any already-dated shadow score', () => {
  const original = syntheticSnapshot(560);
  const cutoff = isoDate(470);
  const baseline = shadow.scoreMarket(original, original.markets[0]).history.filter(row => row.date <= cutoff);
  assert.ok(baseline.length > 100);

  const changed = deepClone(original);
  for (const market of changed.markets) {
    for (let index = 0; index < market.prices.rows.length; index++) {
      if (market.prices.rows[index].date > cutoff) market.prices.rows[index].close *= 1 + (index - 470) * 0.04;
    }
  }
  for (const source of changed.sources.yahoo.normalizedSeriesInventory) {
    for (let index = 0; index < source.normalizedRows.length; index++) {
      if (source.normalizedRows[index].date > cutoff) source.normalizedRows[index].close *= 1 + (index - 470) * 0.03;
    }
  }
  const replay = shadow.scoreMarket(changed, changed.markets[0]).history.filter(row => row.date <= cutoff);
  assert.deepEqual(replay, baseline);
});

test('the seven-calendar-day carry rule rejects stale auxiliary observations', () => {
  const snapshot = syntheticSnapshot();
  const stale = deepClone(snapshot);
  const lastAllowed = isoDate(500);
  for (const source of stale.sources.yahoo.normalizedSeriesInventory) {
    source.normalizedRows = source.normalizedRows.filter(row => row.date <= lastAllowed);
  }
  const scored = shadow.scoreMarket(stale, stale.markets[0]);
  assert.ok(scored.lastDate <= isoDate(507));
  assert.ok(scored.lastDate < stale.markets[0].prices.rows.at(-1).date);
});

test('snapshot validation rejects a changed interpretation, timestamp or market order', () => {
  const snapshot = syntheticSnapshot();
  assert.equal(shadow.validateDevelopmentSnapshot(snapshot), snapshot);
  const wrongStatus = deepClone(snapshot);
  wrongStatus.status = 'VALIDATED';
  assert.throws(() => shadow.validateDevelopmentSnapshot(wrongStatus), /snapshot status/);
  const wrongTime = deepClone(snapshot);
  wrongTime.createdAt = '2026-08-25T12:44:23.950Z';
  assert.throws(() => shadow.validateDevelopmentSnapshot(wrongTime), /collection timestamp/);
  const wrongOrder = deepClone(snapshot);
  wrongOrder.markets.reverse();
  assert.throws(() => shadow.validateDevelopmentSnapshot(wrongOrder), /market order/);
});

test('the exact frozen schema-5 snapshot replays all five markets as development only', {
  skip: !fs.existsSync(shadow.DEFAULT_SNAPSHOT_PATH),
}, () => {
  const input = shadow.readFrozenDevelopmentSnapshot();
  assert.equal(input.sha256, shadow.FROZEN_DEVELOPMENT_INPUT.sha256);
  const analysis = shadow.analyzeSnapshot(input.snapshot);
  assert.equal(analysis.status, shadow.STATUS);
  assert.deepEqual(analysis.markets.map(market => market.key), shadow.MARKET_KEYS);
  assert.ok(analysis.markets.every(market => market.rowCount > 750));
  assert.ok(analysis.markets.every(market => market.lastDate === '2026-08-24'));

  const usa = analysis.markets.find(market => market.key === 'usa');
  assert.equal(usa.benchmarkId, 'SPY');
  assert.equal(usa.latest.score, 73.7);
  assert.ok(usa.latest.components.strength.score > 50);
  assert.ok(usa.latest.components.breadth.score > 50);
  assert.deepEqual(usa.latest.components.breadth.segments.map(segment => segment.id), ['SPY', 'IWM']);
});
