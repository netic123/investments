'use strict';

// FG-EXTREMES-RETRO-V1 — the per-tab "sell at extreme greed, buy at extreme
// fear" model, frozen 2026-08-27. Documentation and honest status:
// research/FG_EXTREMES_RETRO_V1.md. RETROSPECTIVE ONLY: parameters were
// selected from 1,458 configurations per market on fully exposed history;
// nothing here is predictive or validated, and the same searches proved that
// no single shared configuration wins all five tabs (best 3/5) and that one
// world-score rule on the combined portfolio wins 0/1,458.
//
// Rule form (identical in every tab; parameters differ per tab):
//   - Signal: production v2 composite score, carried onto the target calendar
//     (max 7 calendar days stale), smoothed by a trailing k-observation mean
//     over available values, displayed-integer rounding at decision time.
//   - State machine, initial long: if long and integer >= G at a decision bar,
//     sell; if in cash and integer <= F, buy. Decision cadences: every bar
//     ('d'), every 5th bar from the first ('w', bar-index anchored), or the
//     last trading day of each calendar month ('me').
//   - Execution next close; one-way cost multiplies wealth at each switch,
//     including a terminal-close fill (schema-6 convention).
//   - Out-of-market capital earns the audited DTB3 13-week T-bill accrual
//     (TREASURY_13W_CASH_AUDIT_2026-08-25); outside the cash history it
//     earns 0%.
// Run: node research/fear_greed_extremes_retro_model.js [--selftest]
// The main run recomputes every tab from the frozen snapshot + frozen FRED
// bytes and FAILS if any number drifts from the frozen expectations.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const s6 = require('./fear_greed_extreme_strategy.js');
const bat = require('./fear_greed_extended_battery.js');
const v2 = require('./five_market_proxy_data_v2.js');
const base = require('./five_market_proxy_data.js');

const SNAPSHOT = path.join(__dirname, 'local-artifacts', 'v2-validation-final', 'inputs',
  'fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json');
const EXPECTED_SNAPSHOT_SHA = 'ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d';

// Frozen model: per-tab parameters and the exact frozen outcomes they
// reproduce on the frozen inputs (base one-way costs: crypto 0.25%, others
// 0.10%). placeboP is the same-rule 99-shift finite-sample p recorded at
// freeze time (selection across 1,458 configs/market NOT priced in).
const FROZEN_MODEL = Object.freeze({
  crypto: { fear: 20, greed: 80, smoothing: 10, cadence: 'me', expectedRatio: 1.3550839139888666, expectedTrades: 3, placeboP: 0.19 },
  sweden: { fear: 20, greed: 70, smoothing: 10, cadence: 'd', expectedRatio: 1.1580318222780757, expectedTrades: 7, placeboP: 0.01 },
  usa: { fear: 5, greed: 85, smoothing: 21, cadence: 'me', expectedRatio: 1.0392313893239982, expectedTrades: 2, placeboP: 0.01 },
  europe: { fear: 45, greed: 80, smoothing: 42, cadence: 'd', expectedRatio: 1.743691563851066, expectedTrades: 8, placeboP: 0.01 },
  global: { fear: 45, greed: 75, smoothing: 63, cadence: 'w', expectedRatio: 1.235978113314395, expectedTrades: 6, placeboP: 0.02 },
});

function trailingMeanAvailable(values, window) {
  if (window === 1) return values;
  const out = new Array(values.length).fill(null);
  let sum = 0;
  const queue = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) {
      queue.push(v);
      sum += v;
      if (queue.length > window) sum -= queue.shift();
      if (queue.length === window) out[i] = sum / window;
    }
  }
  return out;
}

function decisionFires(cadence, prices, i) {
  if (cadence === 'me') return prices[i].date.slice(0, 7) !== prices[i + 1].date.slice(0, 7);
  if (cadence === 'w') return i % 5 === 0;
  if (cadence === 'd') return true;
  throw new Error(`unknown cadence ${cadence}`);
}

function buildPositions(smoothedScores, prices, { fear, greed, cadence }) {
  const bars = prices.length;
  const positions = new Array(bars).fill(1);
  let position = 1;
  for (let i = 0; i < bars - 1; i++) {
    if (decisionFires(cadence, prices, i)) {
      const integer = s6.displayedInteger(smoothedScores[i]);
      if (integer != null) {
        if (position === 1 && integer >= greed) position = 0;
        else if (position === 0 && integer <= fear) position = 1;
      }
    }
    positions[i + 1] = position;
  }
  return positions;
}

function simulateWithCash(prices, positions, cost, cashFactor) {
  const bars = prices.length;
  const n = bars - 1;
  if (positions.length !== bars) throw new Error('positions must have one entry per bar');
  let wealth = 1;
  let previous = positions[0];
  let trades = 0;
  for (let i = 0; i < n; i++) {
    const held = positions[i];
    if (i > 0 && held !== previous) { wealth *= 1 - cost; trades++; previous = held; }
    wealth *= held === 1 ? prices[i + 1].close / prices[i].close : cashFactor(prices[i].date, prices[i + 1].date);
  }
  if (positions[n] !== previous) { wealth *= 1 - cost; trades++; }
  return { terminalWealth: wealth, trades, exposure: positions.slice(0, n).filter(p => p === 1).length / n };
}

function loadCashFactor() {
  const raw = v2.readExact(v2.PATHS.fredRaw, v2.EXPECTED.fredRaw);
  const rows = v2.parseFredCsv(raw.bytes);
  const wealthByDate = new Map(base.buildDailyCashWealth(rows, '2026-08-24', 7).rows.map(r => [r.date, r.value]));
  return (d0, d1) => {
    const w0 = wealthByDate.get(d0), w1 = wealthByDate.get(d1);
    return w0 > 0 && w1 > 0 ? w1 / w0 : 1;
  };
}

function runModel() {
  const buf = fs.readFileSync(SNAPSHOT);
  if (crypto.createHash('sha256').update(buf).digest('hex') !== EXPECTED_SNAPSHOT_SHA) throw new Error('snapshot sha256 mismatch');
  const snapshot = JSON.parse(buf.toString('utf8'));
  const cashFactor = loadCashFactor();
  const results = {};
  for (const market of snapshot.markets) {
    const spec = FROZEN_MODEL[market.key];
    if (!spec) throw new Error(`no frozen spec for ${market.key}`);
    const prices = s6.marketEligiblePrices(market);
    const cost = s6.MARKET_COSTS[market.key].base;
    const benchmark = s6.benchmarkBuyHold({ prices, annualization: market.annualization }).terminalWealth;
    const carried = bat.carryOntoCalendar(prices, market.signals.map(r => r.date), market.signals.map(r => r.publishedScore), 7);
    const smoothed = trailingMeanAvailable(carried, spec.smoothing);
    const sim = simulateWithCash(prices, buildPositions(smoothed, prices, spec), cost, cashFactor);
    const ratio = sim.terminalWealth / benchmark;
    if (Math.abs(ratio - spec.expectedRatio) > 1e-9 * Math.max(1, spec.expectedRatio)) {
      throw new Error(`${market.key}: ratio drifted from frozen expectation (${ratio} != ${spec.expectedRatio})`);
    }
    if (sim.trades !== spec.expectedTrades) throw new Error(`${market.key}: trade count drifted`);
    results[market.key] = {
      spec: { fear: spec.fear, greed: spec.greed, smoothing: spec.smoothing, cadence: spec.cadence },
      window: `${prices[0].date}->${prices[prices.length - 1].date}`,
      indexBuyAndHold: benchmark,
      strategyWealth: sim.terminalWealth,
      ratioVsIndex: ratio,
      trades: sim.trades,
      exposure: sim.exposure,
      placeboPSameRule99Shifts: spec.placeboP,
    };
  }
  return {
    modelId: 'FG-EXTREMES-RETRO-V1',
    status: 'RETROSPECTIVE_MINED_MODEL_NOT_PREDICTIVE_NOT_VALIDATED',
    documentation: 'research/FG_EXTREMES_RETRO_V1.md',
    results,
  };
}

function selftest() {
  const assert = require('node:assert/strict');
  const prices = [100, 110, 121, 108.9, 119.79, 131.769].map((c, i) => ({ date: `2020-0${i < 3 ? 1 : 2}-0${(i % 3) + 1}`, close: c }));
  const flatCash = () => 1;
  // long throughout
  let r = simulateWithCash(prices, [1, 1, 1, 1, 1, 1], 0.01, flatCash);
  assert.ok(Math.abs(r.terminalWealth - 1.31769) < 1e-12);
  assert.equal(r.trades, 0);
  // switch to cash with cost and cash factor 1.02 on one interval
  const growingCash = (d0, d1) => (d0 === '2020-02-01' ? 1.02 : 1);
  r = simulateWithCash(prices, [1, 1, 1, 0, 1, 1], 0.01, growingCash);
  // intervals: long,long,long? positions[i] over interval i: [1,1,1,0,1]; switch at i=3 (cost), cash interval 3 earns 1.02 (d0=2020-02-01), switch back at i=4 (cost)
  const expected = 1.1 * 1.1 * (108.9 / 121) * 0.99 * 1.02 * 0.99 * (131.769 / 119.79);
  assert.ok(Math.abs(r.terminalWealth - expected) < 1e-12);
  assert.equal(r.trades, 2);
  // terminal fill costed
  r = simulateWithCash(prices, [1, 1, 1, 1, 1, 0], 0.01, flatCash);
  assert.ok(Math.abs(r.terminalWealth - 1.31769 * 0.99) < 1e-12);
  // smoothing over available values only
  assert.deepEqual(trailingMeanAvailable([1, null, 3, 5], 2), [null, null, 2, 4]);
  // hysteresis with month-end cadence fires only on month boundaries
  const mePrices = [
    { date: '2020-01-30', close: 1 }, { date: '2020-01-31', close: 1 },
    { date: '2020-02-03', close: 1 }, { date: '2020-02-04', close: 1 },
  ];
  assert.deepEqual(buildPositions([50, 90, 50, 50], mePrices, { fear: 20, greed: 80, cadence: 'me' }), [1, 1, 0, 0]);
  assert.deepEqual(buildPositions([50, 90, 50, 50], mePrices, { fear: 20, greed: 80, cadence: 'd' }), [1, 1, 0, 0]);
  // weekly cadence is bar-index anchored: decision at i=0 only within 5 bars
  assert.deepEqual(buildPositions([90, 90, 90, 90], mePrices, { fear: 20, greed: 80, cadence: 'w' }), [1, 0, 0, 0]);
  return 'selftest ok';
}

function main() {
  if (process.argv.includes('--selftest')) { console.log(selftest()); return; }
  console.error(selftest());
  const report = runModel();
  console.log(JSON.stringify(report, null, 2));
  console.error('FG-EXTREMES-RETRO-V1 reproduced exactly: all five tabs beat index buy-and-hold on the frozen history.');
}

module.exports = { FROZEN_MODEL, trailingMeanAvailable, buildPositions, simulateWithCash, decisionFires, runModel, selftest };
if (require.main === module) main();
