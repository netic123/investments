'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const search = require('../research/fear_greed_rule_search.js');

function isoDate(ordinal) {
  const date = new Date(Date.UTC(2015, 0, 1) + ordinal * 86400000);
  return date.toISOString().slice(0, 10);
}

// Synthetic market: price rises 1%/bar while the score square wave is high (80)
// and falls 1%/bar while it is low (20). Momentum rules should beat buy-and-hold.
function syntheticMarket({ key = 'usa', signalRows = 300, priceLead = 250, period = 30 } = {}) {
  const totalPrices = priceLead + signalRows;
  const scoreAt = index => (Math.floor(index / period) % 2 === 0 ? 80 : 20);
  const prices = [];
  let close = 100;
  for (let i = 0; i < totalPrices; i++) {
    const phase = i >= priceLead ? scoreAt(i - priceLead) : 80;
    close *= phase >= 50 ? 1.01 : 0.99;
    prices.push({ date: isoDate(i), close });
  }
  const signals = [];
  for (let i = 0; i < signalRows; i++) {
    const value = scoreAt(i);
    const components = {};
    for (const c of search.COMPONENT_KEYS) components[c] = { score: value, raw: value, asOf: isoDate(priceLead + i) };
    signals.push({ date: isoDate(priceLead + i), publishedScore: value, componentCount: 6, components });
  }
  return { key, name: key.toUpperCase(), annualization: 252, prices: { rows: prices }, signals };
}

function tinyContext(closes) {
  return {
    key: 'usa',
    annualization: 252,
    bars: closes.map((value, index) => ({ date: isoDate(index), close: value })),
  };
}

test('trailingMean matches hand computation and rejects non-finite input', () => {
  assert.deepEqual(search.trailingMean([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  assert.throws(() => search.trailingMean([1, NaN], 2), /non-finite/);
});

test('candidate space is exactly the protocol enumeration', () => {
  const candidates = search.buildCandidates();
  assert.equal(candidates.length, 45);
  assert.equal(new Set(candidates.map(c => c.id)).size, 45);
  const families = new Map();
  for (const c of candidates) families.set(c.family, (families.get(c.family) || 0) + 1);
  assert.deepEqual(Object.fromEntries([...families.entries()].sort()), {
    'component-level': 6, 'component-sma-cross': 6, 'ensemble-vote': 3, hybrid: 4,
    hysteresis: 4, 'score-level': 10, 'score-slope': 6, 'score-sma-cross': 6,
  });
  const controls = search.buildControls();
  assert.deepEqual(controls.map(c => c.id), ['CTRL_PRICE_SMA125', 'CTRL_PRICE_SMA210']);
});

test('simulateCandidate: decision at close t fills at close t+1 with multiplicative cost', () => {
  const context = tinyContext([100, 110, 121, 108.9, 119.79]);
  const sentiment = [[1], [1], [-1], [1], [-1]];
  const candidate = { decide: v => (v[0] > 0 ? 1 : 0) };
  const window = { firstBar: 0, lastBar: 4 };
  const result = search.simulateCandidate({ context, candidate, sentimentRows: sentiment, gateRows: null, window, cost: 0.01 });
  // held long bars 0-2 (1.1 * 1.1 * 0.9 = 1.089), sell fill at bar 3 (*0.99),
  // flat bar 3, buy fill at bar 4 (*0.99), terminal sell unfilled.
  assert.ok(Math.abs(result.terminalWealth - 1.089 * 0.99 * 0.99) < 1e-12);
  assert.equal(result.fills, 2);
  assert.equal(result.completedCashCycles, 1);
  assert.equal(result.unfilledTerminalOrders, 1);
  assert.equal(result.exposure, 3 / 4);
  assert.equal(result.finalPosition, 'long');
});

test('hysteresis holds between bands and switches at boundaries', () => {
  const candidates = search.buildCandidates();
  const hyst = candidates.find(c => c.id === 'HYST_M_60_40');
  assert.equal(hyst.decide([50], null, 1), null);
  assert.equal(hyst.decide([50], null, 0), null);
  assert.equal(hyst.decide([40], null, 1), 0);
  assert.equal(hyst.decide([60], null, 0), 1);
});

test('ensemble vote and hybrid price gate behave as specified', () => {
  const candidates = search.buildCandidates();
  const ens4 = candidates.find(c => c.id === 'ENS_M_4');
  assert.equal(ens4.decide([80, 80, 80, 80, 20, 20], null, 0), 1);
  assert.equal(ens4.decide([80, 80, 80, 20, 20, 20], null, 0), 0);
  const hybrid = candidates.find(c => c.id === 'HYB_TREND_AND_NOTFEAR');
  assert.equal(hybrid.decide([50], true, 0), 1);
  assert.equal(hybrid.decide([50], false, 0), 0);
  assert.equal(hybrid.decide([44], true, 0), 0);
});

test('buildMarketContext warms up all indicators and aligns exact closes', () => {
  const market = syntheticMarket();
  const context = search.buildMarketContext(market);
  assert.equal(context.bars.length, market.signals.length - search.COMMON_WARMUP_SIGNAL_ROWS);
  assert.equal(context.bars[0].date, market.signals[search.COMMON_WARMUP_SIGNAL_ROWS].date);
  for (const key of [21, 63, 126]) assert.ok(Number.isFinite(context.bars[0].scoreSma[key]));
  for (const c of search.COMPONENT_KEYS) assert.ok(Number.isFinite(context.bars[0].componentSma63[c]));
  assert.equal(typeof context.bars[0].aboveSma125, 'boolean');
  const broken = syntheticMarket();
  broken.prices.rows = broken.prices.rows.filter(row => row.date !== broken.signals[200].date);
  assert.throws(() => search.buildMarketContext(broken), /missing exact target close/);
});

test('development and holdout windows share one boundary bar and no return interval', () => {
  const context = search.buildMarketContext(syntheticMarket());
  const dev = context.windows.development;
  const hold = context.windows.holdout;
  assert.equal(dev.firstBar, 0);
  assert.equal(hold.firstBar, dev.lastBar);
  assert.equal(hold.lastBar, context.bars.length - 1);
  assert.equal((dev.lastBar - dev.firstBar) + (hold.lastBar - hold.firstBar), context.bars.length - 1);
});

test('shiftSentimentRows rotates only inside the window', () => {
  const rows = [[0], [1], [2], [3], [4], [5]];
  const shifted = search.shiftSentimentRows(rows, { firstBar: 2, lastBar: 5 }, 1);
  assert.deepEqual(shifted.slice(0, 2), [[0], [1]]);
  assert.deepEqual(shifted.slice(2), [[5], [2], [3], [4]]);
  assert.deepEqual(rows[2], [2]);
  assert.throws(() => search.shiftSentimentRows(rows, { firstBar: 2, lastBar: 5 }, 4), /invalid circular shift/);
});

test('runDevelopment selects a momentum rule on the synthetic regime market and stays deterministic', () => {
  const snapshot = { markets: [syntheticMarket({ key: 'usa' }), syntheticMarket({ key: 'crypto' })] };
  const first = search.runDevelopment(snapshot);
  const second = search.runDevelopment(snapshot);
  assert.equal(search.canonicalJson(first), search.canonicalJson(second));
  const usa = first.markets.usa;
  assert.ok(usa.eligibleCount > 0, 'expected eligible momentum candidates on the regime fixture');
  assert.ok(usa.selection, 'expected a development selection');
  const winner = first.fullResults.usa.find(row => row.candidateId === usa.selection);
  assert.equal(winner.direction, 'momentum');
  assert.ok(winner.scenarios.base.terminalWealthRatio > 1);
  assert.ok(winner.scenarios.stress.terminalWealthRatio > 1);
  assert.ok(winner.scenarios.base.fills >= search.MIN_FILLS);
  const ratios = first.markets.usa.eligibleTop5.map(row => row.terminalWealthRatioBase);
  assert.deepEqual(ratios, [...ratios].sort((a, b) => b - a));
});

test('runHoldout evaluates only selections and controls, applies the frozen win gate', () => {
  const snapshot = { markets: [syntheticMarket({ key: 'usa' })] };
  const development = search.runDevelopment(snapshot);
  const selection = {
    markets: { usa: { selection: development.markets.usa.selection } },
    sharedSelection: development.sharedSelection,
  };
  const holdout = search.runHoldout(snapshot, selection);
  const usa = holdout.markets.usa;
  const evaluatedIds = Object.keys(usa.evaluations).sort();
  const expected = [...new Set([development.markets.usa.selection, development.sharedSelection,
    'CTRL_PRICE_SMA125', 'CTRL_PRICE_SMA210'].filter(Boolean))].sort();
  assert.deepEqual(evaluatedIds, expected);
  assert.equal(typeof usa.holdoutWin, 'boolean');
  const row = usa.evaluations[development.markets.usa.selection];
  assert.equal(usa.holdoutWin, search.passesWinGate(row));
  assert.ok(row.timingPlacebo && row.timingPlacebo.shiftCount > 0);
  assert.ok([search.STATUS_NO_SURVIVOR, search.STATUS_NO_WINNER, search.STATUS_WINNERS].includes(holdout.status));
  assert.ok(!usa.evaluations.CTRL_PRICE_SMA125.timingPlacebo, 'controls get no placebo');
});

test('shared selection is win-gated, tagged in winners, and counts as a survivor', () => {
  const snapshot = { markets: [syntheticMarket({ key: 'usa' }), syntheticMarket({ key: 'crypto' })] };
  const shared = 'LVL_M_50';
  const holdout = search.runHoldout(snapshot, { markets: { usa: {}, crypto: {} }, sharedSelection: shared });
  for (const key of ['usa', 'crypto']) {
    const market = holdout.markets[key];
    assert.equal(market.selectionStatus, 'NO_DEVELOPMENT_SURVIVOR');
    assert.equal(typeof market.sharedHoldoutWin, 'boolean');
    assert.equal(market.sharedHoldoutWin, search.passesWinGate(market.evaluations[shared]));
    assert.equal(typeof market.sharedBeatsPriceOnlyControl, 'boolean');
  }
  assert.notEqual(holdout.status, search.STATUS_NO_SURVIVOR, 'a shared selection is a development survivor');
  const sharedWinsEverywhere = ['usa', 'crypto'].every(key => holdout.markets[key].sharedHoldoutWin);
  const sharedWinner = holdout.winners.find(w => w.scope === 'shared');
  assert.equal(Boolean(sharedWinner), sharedWinsEverywhere);
  if (sharedWinner) assert.equal(sharedWinner.candidateId, shared);
});

test('timing placebo reports mid-rank percentile and flags degenerate distributions', () => {
  const context = search.buildMarketContext(syntheticMarket({ key: 'usa' }));
  const alwaysLong = {
    id: 'X', family: 'score-level', direction: 'momentum',
    sentiment: ctx => ctx.bars.map(b => [b.I]),
    decide: () => 1,
  };
  const window = context.windows.holdout;
  const actual = search.simulateCandidate({
    context, candidate: alwaysLong, sentimentRows: alwaysLong.sentiment(context),
    gateRows: null, window, cost: search.MARKET_COSTS.usa.base,
  }).terminalWealth;
  const placebo = search.timingPlacebo(context, alwaysLong, window, actual);
  assert.equal(placebo.degenerate, true);
  assert.equal(placebo.tieCount, placebo.shiftCount);
  assert.equal(placebo.actualPercentile, 0.5, 'all-tie distribution must mid-rank to 0.5, not 1.0');
});

test('no forbidden vocabulary anywhere in full serialized stage outputs', () => {
  const snapshot = { markets: [syntheticMarket({ key: 'usa' })] };
  const development = search.runDevelopment(snapshot);
  const holdout = search.runHoldout(snapshot, {
    markets: { usa: { selection: development.markets.usa.selection } },
    sharedSelection: development.sharedSelection,
  });
  for (const output of [development, holdout]) {
    const text = JSON.stringify(output);
    for (const forbidden of ['PASS', 'VALIDATED', 'CONFIRMED', 'DEPLOYABLE']) {
      assert.ok(!text.includes(forbidden), `serialized output contains forbidden label ${forbidden}`);
    }
  }
});

test('canonicalJson sorts keys and rejects non-finite numbers', () => {
  assert.equal(search.canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), '{"a":[{"c":3,"d":2}],"b":1}');
  assert.throws(() => search.canonicalJson({ x: Infinity }), /non-finite/);
});
