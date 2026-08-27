'use strict';

// Extended diagnostic battery (2026-08-27). EXPLORATORY ONLY — the endpoint is
// exposed to schemas 3-12; nothing here can validate anything. Reviewed
// adversarially before its first real-data run (three independent reviewers;
// the terminal-fill accounting, the C/D placebos, the episode-aware bootstrap,
// the BH correction and the degeneracy gates below are their fixes).
// Families:
//   A: fear-entry + fixed time exit                     — 25 combos/market
//   B: event study of forward returns after extremes    — episode-aware block bootstrap, BH-corrected
//   C: cross-market signals (score of X trades Y)       — 20 pairs x 2 rules, 99-shift max placebo
//   D: world composite score (mean of >=4) trades each  — 3 rules/market, 99-shift max placebo
//   E: continuous exposure mapping, 0.10 band           — 2 rules/market
//   F: monthly decision cadence extremes                — 9 combos/market
//   G: long/short at extremes                           — 8 combos/market (+2%/yr borrow in stress)
// Plus a Europe robustness section: 21-anchor sweep and calendar month-end
// variants of the family-F best cell (the anchor sweep is what demoted the
// headline 1.54x to a ~1.16x anchor-median effect).
// Accounting mirrors schema 6 exactly, including the terminal-close fill:
// positions arrays have length = prices.length; index j < n is the exposure over
// interval [j, j+1); the LAST slot is the marked terminal state whose change is
// costed at the final close. Decide at close t, execute at close t+1,
// multiplicative one-way cost * |exposure change|, cash 0%.
// Run: node research/fear_greed_extended_battery.js [--selftest]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const s6 = require('./fear_greed_extreme_strategy.js');
const s9 = require('./fear_greed_core_overlay.js');

const SNAPSHOT = path.join(__dirname, 'local-artifacts', 'v2-validation-final', 'inputs',
  'fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json');
const EXPECTED_SHA = 'ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d';
const OUTPUT_DIR = path.join(__dirname, 'local-artifacts', 'extended-battery');
const PLACEBO_SHIFTS = 99;
const SHORT_BORROW_ANNUAL = 0.02;

function integerOf(score) { return s6.displayedInteger(score); }
function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }

// ---------------------------------------------------------------------------
// Simulator. positions.length === prices.length. positions[j] for j<n is the
// exposure over interval [j, j+1); the last slot is the terminal marked state —
// its change vs the last interval is costed at the final close with no further
// return, matching schema-6's terminal fill.
// ---------------------------------------------------------------------------
function simulatePath(prices, positions, cost, annualization, borrowAnnual = 0) {
  const bars = prices.length;
  const n = bars - 1;
  if (positions.length !== bars) throw new Error('positions must have one entry per bar (last = terminal state)');
  let wealth = 1;
  const curve = [{ date: prices[0].date, wealth: 1 }];
  let previous = positions[0];
  let turnover = 0;
  let bankruptAt = null;
  for (let i = 0; i < n; i++) {
    const held = positions[i];
    if (!(held >= -1 && held <= 1)) throw new Error('exposure out of [-1,1]');
    if (i > 0 && held !== previous) {
      const change = Math.abs(held - previous);
      wealth *= 1 - cost * change;
      turnover += change;
      previous = held;
    }
    const gross = prices[i + 1].close / prices[i].close - 1;
    let r = held * gross;
    if (held < 0 && borrowAnnual > 0) r -= Math.abs(held) * (borrowAnnual / annualization);
    wealth *= 1 + r;
    if (!(wealth > 0)) { bankruptAt = i; wealth = 1e-12; curve.push({ date: prices[i + 1].date, wealth }); break; }
    curve.push({ date: prices[i + 1].date, wealth });
  }
  if (bankruptAt == null && positions[n] !== previous) {
    const change = Math.abs(positions[n] - previous);
    wealth *= 1 - cost * change;
    turnover += change;
    curve[curve.length - 1] = { date: prices[n].date, wealth };
  }
  const realized = bankruptAt == null ? n : bankruptAt + 1;
  const metrics = s6.computePerformanceMetrics(curve, annualization);
  const exposureBars = positions.slice(0, realized).filter(p => p !== 0).length;
  return {
    terminalWealth: bankruptAt == null ? wealth : 0,
    cagr: metrics.cagr, maximumDrawdown: metrics.maximumDrawdown,
    exposure: exposureBars / realized, turnover, bankrupt: bankruptAt != null,
  };
}

// Position builders (arrays of length bars; decision at bar i sets slot i+1;
// a decision at the last bar is ignored = schema-6's unfilled terminal order).

function positionsFearTimeExit(scores, bars, F, H) {
  const positions = new Array(bars).fill(0);
  let i = 0;
  while (i < bars - 1) {
    const s = integerOf(scores[i]);
    if (s != null && s <= F && positions[i] === 0) {
      for (let k = i + 1; k <= Math.min(i + H, bars - 1); k++) positions[k] = 1;
      i = i + H + 1;
    } else i++;
  }
  return positions;
}

function positionsHysteresis(scores, bars, F, G, initial = 1, cadence = 1, anchor = 0) {
  const positions = new Array(bars).fill(initial);
  let position = initial;
  for (let i = 0; i < bars - 1; i++) {
    if (((i - anchor) % cadence + cadence) % cadence === 0) {
      const s = integerOf(scores[i]);
      if (s != null) {
        if (position === 1 && s >= G) position = 0;
        else if (position === 0 && s <= F) position = 1;
      }
    }
    positions[i + 1] = position;
  }
  return positions;
}

// Decisions on the last trading day of each calendar month (date-derived, so
// the rule has no anchor degree of freedom).
function positionsMonthEndHysteresis(scores, prices, F, G, initial = 1) {
  const bars = prices.length;
  const positions = new Array(bars).fill(initial);
  let position = initial;
  for (let i = 0; i < bars - 1; i++) {
    if (prices[i].date.slice(0, 7) !== prices[i + 1].date.slice(0, 7)) {
      const s = integerOf(scores[i]);
      if (s != null) {
        if (position === 1 && s >= G) position = 0;
        else if (position === 0 && s <= F) position = 1;
      }
    }
    positions[i + 1] = position;
  }
  return positions;
}

function positionsLongShort(scores, bars, F, G, mode) {
  const positions = new Array(bars).fill(1);
  let position = 1;
  for (let i = 0; i < bars - 1; i++) {
    const s = integerOf(scores[i]);
    if (s != null) {
      if (mode === 'flat') position = s <= F ? 1 : s >= G ? -1 : 0;
      else position = s >= G ? -1 : 1;
    }
    positions[i + 1] = position;
  }
  return positions;
}

function positionsContinuous(scores, bars, direction) {
  const positions = new Array(bars).fill(1);
  let current = 1;
  for (let i = 0; i < bars - 1; i++) {
    const s = scores[i];
    if (Number.isFinite(s)) {
      const target = direction === 'contrarian' ? (100 - s) / 100 : s / 100;
      if (Math.abs(target - current) > 0.10) current = target;
    }
    positions[i + 1] = current;
  }
  return positions;
}

function positionsScoreVsSma(scores, bars, window) {
  const positions = new Array(bars).fill(1);
  let position = 1;
  const buf = [];
  for (let i = 0; i < bars - 1; i++) {
    const s = scores[i];
    if (Number.isFinite(s)) {
      buf.push(s);
      if (buf.length > window) buf.shift();
      if (buf.length === window) position = s > mean(buf) ? 1 : 0;
    }
    positions[i + 1] = position;
  }
  return positions;
}

function positionsLevel(scores, bars, L) {
  const positions = new Array(bars).fill(1);
  let position = 1;
  for (let i = 0; i < bars - 1; i++) {
    const s = integerOf(scores[i]);
    if (s != null) position = s >= L ? 1 : 0;
    positions[i + 1] = position;
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Data prep
// ---------------------------------------------------------------------------
function loadSnapshot() {
  const buf = fs.readFileSync(SNAPSHOT);
  if (crypto.createHash('sha256').update(buf).digest('hex') !== EXPECTED_SHA) throw new Error('snapshot hash mismatch');
  return JSON.parse(buf.toString('utf8'));
}

function marketData(market) {
  const prices = s6.marketEligiblePrices(market);
  const signalDates = market.signals.map(r => r.date);
  const signalValues = market.signals.map(r => r.publishedScore);
  const scores = carryOntoCalendar(prices, signalDates, signalValues, 7);
  return { key: market.key, annualization: market.annualization, prices, signalDates, signalValues, scores };
}

// Carry the latest ORIGINAL-dated value <= bar date, within staleDays of its
// original date (single staleness budget end to end).
function carryOntoCalendar(prices, dates, values, staleDays) {
  const out = new Array(prices.length).fill(null);
  let j = -1;
  for (let i = 0; i < prices.length; i++) {
    const d = prices[i].date;
    while (j + 1 < dates.length && dates[j + 1] <= d) j++;
    if (j >= 0 && (Date.parse(d) - Date.parse(dates[j])) / 86400000 <= staleDays) out[i] = values[j];
  }
  return out;
}

function rotate(values, offset) {
  const n = values.length;
  return values.map((_, i) => values[(i - offset + n) % n]);
}

// ---------------------------------------------------------------------------
// Grid families A/F/G/E with base+stress costs and max placebo
// ---------------------------------------------------------------------------
function familyCells(family, data, scores, scenario) {
  const { prices, annualization: ann } = data;
  const bars = prices.length;
  const cost = s6.MARKET_COSTS[data.key][scenario];
  const borrow = scenario === 'stress' ? SHORT_BORROW_ANNUAL : 0;
  const cells = [];
  if (family === 'A') {
    for (const F of [10, 15, 20, 25, 30]) for (const H of [5, 10, 21, 63, 126]) {
      cells.push({ id: `A_F${F}_H${H}`, ...simulatePath(prices, positionsFearTimeExit(scores, bars, F, H), cost, ann) });
    }
  } else if (family === 'F') {
    for (const F of [15, 25, 35]) for (const G of [65, 75, 85]) {
      cells.push({ id: `F_F${F}_G${G}_m21`, ...simulatePath(prices, positionsHysteresis(scores, bars, F, G, 1, 21), cost, ann) });
    }
  } else if (family === 'G') {
    for (const F of [15, 25]) for (const G of [75, 85]) for (const mode of ['flat', 'always']) {
      cells.push({ id: `G_F${F}_G${G}_${mode}`, ...simulatePath(prices, positionsLongShort(scores, bars, F, G, mode), cost, ann, borrow) });
    }
  } else if (family === 'E') {
    for (const direction of ['contrarian', 'momentum']) {
      cells.push({ id: `E_${direction}`, ...simulatePath(prices, positionsContinuous(scores, bars, direction), cost, ann) });
    }
  } else throw new Error(`unknown family ${family}`);
  return cells;
}

function bestNonTrivial(cells, bh) {
  const active = cells.filter(c => c.turnover > 0 && !c.bankrupt);
  let best = null;
  for (const c of active) if (!best || c.terminalWealth > best.terminalWealth) best = c;
  return best ? { ...best, ratio: best.terminalWealth / bh } : null;
}

function placeboBlock(actualRatio, shiftRatios) {
  const sorted = shiftRatios.filter(Number.isFinite).sort((a, b) => a - b);
  const below = sorted.filter(v => v < actualRatio).length;
  const ties = sorted.filter(v => v === actualRatio).length;
  const atLeast = sorted.filter(v => v >= actualRatio).length;
  return {
    shiftCount: sorted.length,
    medianBest: sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
    p90Best: sorted[Math.floor(sorted.length * 0.9)],
    maxBest: sorted[sorted.length - 1],
    percentile: (below + 0.5 * ties) / sorted.length,
    tieCount: ties,
    degenerate: sorted.length > 0 && sorted[0] === sorted[sorted.length - 1],
    finiteSampleP: (1 + atLeast) / (1 + sorted.length),
  };
}

function runGridFamilies(data) {
  const { prices, annualization: ann } = data;
  const bh = s6.benchmarkBuyHold({ prices, annualization: ann }).terminalWealth;
  const out = { buyAndHoldTerminalWealth: bh };
  const offsets = s9.deterministicShiftOffsets(data.scores.length, PLACEBO_SHIFTS);
  for (const family of ['A', 'F', 'G', 'E']) {
    const base = familyCells(family, data, data.scores, 'base');
    const stressById = new Map(familyCells(family, data, data.scores, 'stress').map(c => [c.id, c]));
    const best = bestNonTrivial(base, bh);
    const winners = base.filter(c => c.turnover > 0 && c.terminalWealth / bh > 1).length;
    let placebo = null;
    if (best) {
      const shiftBest = offsets.map(off => {
        const b = bestNonTrivial(familyCells(family, data, rotate(data.scores, off), 'base'), bh);
        return b ? b.ratio : 1;
      });
      placebo = placeboBlock(best.ratio, shiftBest);
    }
    out[family] = {
      winnersBase: `${winners}/${base.length}`,
      bestCell: best ? best.id : null,
      bestRatioBase: best ? best.ratio : null,
      bestRatioStress: best ? stressById.get(best.id).terminalWealth / bh : null,
      bestExposure: best ? best.exposure : null,
      bestTurnover: best ? best.turnover : null,
      placebo,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// C: cross-market. Signal X (original dates) carried once onto Y's calendar.
// ---------------------------------------------------------------------------
function crossRules(scores, bars) {
  return [
    ['HYST_C_F25_G75', positionsHysteresis(scores, bars, 25, 75, 1, 1)],
    ['SMAX_M_63', positionsScoreVsSma(scores, bars, 63)],
  ];
}

function crossMarketBest(datasets, offsetBySignal) {
  const rows = [];
  for (const signal of datasets) for (const target of datasets) {
    if (signal.key === target.key) continue;
    const values = offsetBySignal ? rotate(signal.signalValues, offsetBySignal) : signal.signalValues;
    const carried = carryOntoCalendar(target.prices, signal.signalDates, values, 7);
    const firstIdx = carried.findIndex(v => Number.isFinite(v));
    if (firstIdx < 0 || target.prices.length - firstIdx < 260) continue;
    const prices = target.prices.slice(firstIdx);
    const scores = carried.slice(firstIdx);
    const cost = s6.MARKET_COSTS[target.key].base;
    const bh = s6.benchmarkBuyHold({ prices, annualization: target.annualization }).terminalWealth;
    for (const [rule, positions] of crossRules(scores, prices.length)) {
      const sim = simulatePath(prices, positions, cost, target.annualization);
      if (sim.turnover === 0) { rows.push({ signal: signal.key, target: target.key, rule, ratio: 1, degenerate: true }); continue; }
      rows.push({ signal: signal.key, target: target.key, rule, ratio: sim.terminalWealth / bh, window: `${prices[0].date}->${prices.at(-1).date}`, exposure: sim.exposure, turnover: sim.turnover });
    }
  }
  const active = rows.filter(r => !r.degenerate);
  const best = active.reduce((a, b) => (a && a.ratio >= b.ratio ? a : b), null);
  return { rows, active, best };
}

function runCrossMarket(datasets) {
  const actual = crossMarketBest(datasets, 0);
  const offsets = s9.deterministicShiftOffsets(Math.min(...datasets.map(d => d.signalValues.length)), PLACEBO_SHIFTS);
  const shiftBest = offsets.map(off => {
    const r = crossMarketBest(datasets, off).best;
    return r ? r.ratio : 1;
  });
  const winners = actual.active.filter(r => r.ratio > 1);
  return {
    note: 'ratios computed on per-pair windows; max-vs-max placebo is window-symmetric',
    pairsTested: actual.rows.length,
    degenerateNoTrade: actual.rows.filter(r => r.degenerate).length,
    winners: winners.length,
    top5: [...actual.active].sort((a, b) => b.ratio - a.ratio).slice(0, 5),
    placeboOfBest: actual.best ? placeboBlock(actual.best.ratio, shiftBest) : null,
  };
}

// ---------------------------------------------------------------------------
// D: world composite (mean of >=4 same-date scores on original signal dates).
// ---------------------------------------------------------------------------
function worldSeries(datasets) {
  const byDate = new Map();
  for (const d of datasets) {
    d.signalDates.forEach((date, i) => {
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(d.signalValues[i]);
    });
  }
  const dates = [...byDate.keys()].filter(date => byDate.get(date).length >= 4).sort();
  return { dates, values: dates.map(date => mean(byDate.get(date))) };
}

function worldBest(datasets, world, offset) {
  const values = offset ? rotate(world.values, offset) : world.values;
  const rows = [];
  for (const d of datasets) {
    const carried = carryOntoCalendar(d.prices, world.dates, values, 7);
    const firstIdx = carried.findIndex(v => Number.isFinite(v));
    if (firstIdx < 0 || d.prices.length - firstIdx < 260) continue;
    const prices = d.prices.slice(firstIdx);
    const scores = carried.slice(firstIdx);
    const bars = prices.length;
    const cost = s6.MARKET_COSTS[d.key].base;
    const bh = s6.benchmarkBuyHold({ prices, annualization: d.annualization }).terminalWealth;
    for (const [rule, positions] of [
      ['HYST_C_F25_G75', positionsHysteresis(scores, bars, 25, 75, 1, 1)],
      ['LVL_M_50', positionsLevel(scores, bars, 50)],
      ['SMAX_M_63', positionsScoreVsSma(scores, bars, 63)],
    ]) {
      const sim = simulatePath(prices, positions, cost, d.annualization);
      if (sim.turnover === 0) { rows.push({ market: d.key, rule, ratio: 1, degenerate: true }); continue; }
      rows.push({ market: d.key, rule, ratio: sim.terminalWealth / bh, window: `${prices[0].date}->${prices.at(-1).date}`, exposure: sim.exposure, turnover: sim.turnover });
    }
  }
  const active = rows.filter(r => !r.degenerate);
  return { rows, active, best: active.reduce((a, b) => (a && a.ratio >= b.ratio ? a : b), null) };
}

function runWorldComposite(datasets) {
  const world = worldSeries(datasets);
  const actual = worldBest(datasets, world, 0);
  const offsets = s9.deterministicShiftOffsets(world.values.length, PLACEBO_SHIFTS);
  const shiftBest = offsets.map(off => { const b = worldBest(datasets, world, off).best; return b ? b.ratio : 1; });
  return {
    worldDates: world.dates.length,
    tested: actual.rows.length,
    degenerateNoTrade: actual.rows.filter(r => r.degenerate).length,
    winners: actual.active.filter(r => r.ratio > 1).length,
    top5: [...actual.active].sort((a, b) => b.ratio - a.ratio).slice(0, 5),
    placeboOfBest: actual.best ? placeboBlock(actual.best.ratio, shiftBest) : null,
  };
}

// ---------------------------------------------------------------------------
// Europe robustness: 21-anchor sweep and calendar month-end variants of the
// family-F best shape. The anchor sweep quantifies how much of the family-F
// headline came from the arbitrary cadence anchor.
// ---------------------------------------------------------------------------
function runEuropeRobustness(datasets) {
  const d = datasets.find(x => x.key === 'europe');
  if (!d) return null;
  const { prices, annualization: ann, scores } = d;
  const bars = prices.length;
  const cost = s6.MARKET_COSTS.europe.base;
  const bh = s6.benchmarkBuyHold({ prices, annualization: ann }).terminalWealth;
  const anchorRatios = [];
  for (let anchor = 0; anchor < 21; anchor++) {
    const sim = simulatePath(prices, positionsHysteresis(scores, bars, 35, 85, 1, 21, anchor), cost, ann);
    anchorRatios.push(sim.terminalWealth / bh);
  }
  const sorted = [...anchorRatios].sort((a, b) => a - b);
  const monthEnd = {};
  for (const [F, G] of [[35, 85], [25, 85], [35, 80], [25, 75]]) {
    const sim = simulatePath(prices, positionsMonthEndHysteresis(scores, prices, F, G), cost, ann);
    monthEnd[`F${F}_G${G}`] = { ratio: sim.terminalWealth / bh, exposure: sim.exposure, turnover: sim.turnover };
  }
  return {
    anchorSweep_F35_G85_m21: {
      min: sorted[0], median: sorted[10], max: sorted[20],
      winners: anchorRatios.filter(r => r > 1).length, anchors: 21,
      interpretation: 'direction robust across anchors; magnitude of the family-F best cell is anchor luck — the anchor-median is the honest effect size',
    },
    monthEndVariants: monthEnd,
  };
}

// ---------------------------------------------------------------------------
// B: event study — episode-aware block bootstrap + bootstrap p-values, with
// Benjamini-Hochberg correction applied across all cells in main().
// ---------------------------------------------------------------------------
function episodeStats(indices) {
  if (!indices.length) return { episodes: 0, meanLength: 0 };
  let episodes = 1, lengths = [], run = 1;
  for (let k = 1; k < indices.length; k++) {
    if (indices[k] === indices[k - 1] + 1) run++;
    else { lengths.push(run); episodes++; run = 1; }
  }
  lengths.push(run);
  return { episodes, meanLength: mean(lengths) };
}

function blockBootstrapDiffCI(all, bucket, H, reps, extraBlock) {
  const inBucket = new Set(bucket.map(x => x.i));
  const n = all.length;
  const block = Math.min(n, Math.max(H, 5) + Math.ceil(extraBlock || 0));
  let seed = 20260827;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const diffs = [];
  for (let r = 0; r < reps; r++) {
    let sumB = 0, nB = 0, sumA = 0;
    for (let filled = 0; filled < n; filled += block) {
      const start = Math.floor(rand() * (n - block + 1));
      for (let k = 0; k < block && filled + k < n; k++) {
        const row = all[start + k];
        sumA += row.r;
        if (inBucket.has(row.i)) { sumB += row.r; nB++; }
      }
    }
    if (nB >= 5) diffs.push(sumB / nB - sumA / n);
  }
  diffs.sort((a, b) => a - b);
  if (diffs.length < reps / 2) return { ci: [null, null], p: null, validReps: diffs.length };
  const lo = diffs[Math.floor(diffs.length * 0.025)];
  const hi = diffs[Math.floor(diffs.length * 0.975)];
  const fracLE0 = diffs.filter(v => v <= 0).length / diffs.length;
  const fracGE0 = diffs.filter(v => v >= 0).length / diffs.length;
  return { ci: [lo, hi], p: Math.min(1, 2 * Math.min(fracLE0, fracGE0)), validReps: diffs.length };
}

function runEventStudy(data) {
  const { prices, scores } = data;
  const out = {};
  for (const H of [5, 21, 63]) {
    const forward = [];
    for (let i = 0; i + 1 + H < prices.length; i++) {
      forward.push({ i, r: prices[i + 1 + H].close / prices[i + 1].close - 1, s: integerOf(scores[i]) });
    }
    const buckets = {
      extremeFear: forward.filter(x => x.s != null && x.s <= 15),
      fear25: forward.filter(x => x.s != null && x.s <= 25),
      neutral: forward.filter(x => x.s != null && x.s >= 40 && x.s <= 60),
      greed75: forward.filter(x => x.s != null && x.s >= 75),
      extremeGreed: forward.filter(x => x.s != null && x.s >= 85),
    };
    const uncMean = mean(forward.map(x => x.r));
    const res = { unconditionalMean: uncMean, samples: forward.length };
    for (const [name, rows] of Object.entries(buckets)) {
      if (rows.length < 8) { res[name] = { n: rows.length, note: 'too few' }; continue; }
      const ep = episodeStats(rows.map(x => x.i));
      const m = mean(rows.map(x => x.r));
      const boot = blockBootstrapDiffCI(forward, rows, H, 2000, ep.meanLength);
      res[name] = { n: rows.length, episodes: ep.episodes, meanForward: m, minusUnconditional: m - uncMean, ci95: boot.ci, pUncorrected: boot.p, validReps: boot.validReps };
    }
    out[`H${H}`] = res;
  }
  return out;
}

function benjaminiHochberg(cells, q = 0.05) {
  const valid = cells.filter(c => Number.isFinite(c.pUncorrected));
  const sorted = [...valid].sort((a, b) => a.pUncorrected - b.pUncorrected);
  let cutoff = -1;
  sorted.forEach((c, idx) => { if (c.pUncorrected <= ((idx + 1) / sorted.length) * q) cutoff = idx; });
  const significantSet = new Set(sorted.slice(0, cutoff + 1));
  for (const c of valid) c.significantBH = significantSet.has(c);
  return { tests: valid.length, bhSignificant: cutoff + 1 };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
function selftest() {
  const assert = require('node:assert/strict');
  const prices = [100, 110, 121, 108.9, 119.79, 131.769].map((c, i) => ({ date: `2020-01-0${i + 1}`, close: c }));
  let r = simulatePath(prices, [1, 1, 1, 1, 1, 1], 0, 252);
  assert.ok(Math.abs(r.terminalWealth - 1.31769) < 1e-12);
  r = simulatePath(prices, [1, 1, 0, 0, 0, 0], 0.01, 252);
  assert.ok(Math.abs(r.terminalWealth - 1.21 * 0.99) < 1e-12);
  assert.equal(r.turnover, 1);
  r = simulatePath(prices, [1, 1, 1, 1, 1, 0], 0.01, 252);
  assert.ok(Math.abs(r.terminalWealth - 1.31769 * 0.99) < 1e-12);
  r = simulatePath(prices, [1, 1, -1, 1, 1, 1], 0, 252, 0);
  const expected = 1.1 * 1.1 * (1 - (108.9 / 121 - 1)) * (119.79 / 108.9) * (131.769 / 119.79);
  assert.ok(Math.abs(r.terminalWealth - expected) < 1e-12);
  // parity with schema-6 on a costed hysteresis path incl. terminal fill
  const scores6 = [50, 50, 90, 50, 50, 90];
  const pos = positionsHysteresis(scores6, 6, 25, 75, 1, 1);
  assert.deepEqual(pos, [1, 1, 1, 0, 0, 0]);
  const mine = simulatePath(prices, pos, 0.0075, 252);
  const ref = s6.simulateStrategy({ prices, scoreMap: new Map(prices.map((p, i) => [p.date, scores6[i]])), fear: 25, greed: 75, cost: 0.0075, annualization: 252, initialPosition: 'long' });
  assert.ok(Math.abs(mine.terminalWealth - ref.terminalWealth) < 1e-14);
  const scoresT = [50, 50, 50, 50, 90, 50];
  const posT = positionsHysteresis(scoresT, 6, 25, 75, 1, 1);
  assert.deepEqual(posT, [1, 1, 1, 1, 1, 0]);
  const mineT = simulatePath(prices, posT, 0.0075, 252);
  const refT = s6.simulateStrategy({ prices, scoreMap: new Map(prices.map((p, i) => [p.date, scoresT[i]])), fear: 25, greed: 75, cost: 0.0075, annualization: 252, initialPosition: 'long' });
  assert.ok(Math.abs(mineT.terminalWealth - refT.terminalWealth) < 1e-14);
  // anchored cadence
  assert.deepEqual(positionsHysteresis([90, 50, 20, 50, 90], 5, 25, 75, 1, 2, 0), [1, 0, 0, 1, 1]);
  assert.deepEqual(positionsHysteresis([90, 50, 20, 50, 90], 5, 25, 75, 1, 2, 1), [1, 1, 1, 1, 1]);
  // month-end decisions derive from dates, not counters
  const mePrices = [
    { date: '2020-01-30', close: 100 }, { date: '2020-01-31', close: 101 },
    { date: '2020-02-03', close: 102 }, { date: '2020-02-04', close: 103 },
  ];
  assert.deepEqual(positionsMonthEndHysteresis([50, 90, 50, 50], mePrices, 35, 85), [1, 1, 0, 0]);
  // fear-time-exit incl. terminal entry slot
  assert.deepEqual(positionsFearTimeExit([10, 90, 90, 90, 10, 90], 6, 15, 2), [0, 1, 1, 0, 0, 1]);
  // single-staleness carry
  assert.deepEqual(carryOntoCalendar([{ date: '2020-01-01' }, { date: '2020-01-05' }, { date: '2020-01-20' }], ['2020-01-01'], [42], 7), [42, 42, null]);
  assert.deepEqual(positionsContinuous([100, 100, 100], 3, 'contrarian'), [1, 0, 0]);
  // bootstrap start covers the final row
  const all = Array.from({ length: 10 }, (_, i) => ({ i, r: i === 9 ? 5 : 0 }));
  const boot = blockBootstrapDiffCI(all, all.filter(x => x.i >= 5), 1, 400, 0);
  assert.ok(boot.validReps > 0 && boot.ci[1] !== null);
  assert.deepEqual(episodeStats([1, 2, 3, 7, 8, 20]), { episodes: 3, meanLength: 2 });
  return 'selftest ok';
}

// ---------------------------------------------------------------------------
function main() {
  if (process.argv.includes('--selftest')) { console.log(selftest()); return; }
  console.error(selftest());
  const snap = loadSnapshot();
  const datasets = snap.markets.map(marketData);
  const report = {
    metadata: {
      status: 'EXPLORATORY_DIAGNOSTIC_ENDPOINT_EXPOSED_TO_SCHEMAS_3_12',
      disclosure: 'All families searched on history already inspected by prior studies; event-study p-values are Benjamini-Hochberg corrected across every bucket-horizon-market cell; family results are max-of-family vs 99-shift max-of-family placebos with finite-sample floor 0.01; the Europe family-F headline is demoted by the anchor sweep to its anchor-median; nothing here is confirmatory.',
      snapshotSha256: EXPECTED_SHA,
    },
    families: {}, crossMarket: null, worldComposite: null, europeRobustness: null, eventStudy: {},
  };
  const allCells = [];
  for (const d of datasets) {
    report.families[d.key] = runGridFamilies(d);
    const ev = runEventStudy(d);
    report.eventStudy[d.key] = ev;
    for (const H of Object.keys(ev)) for (const b of Object.keys(ev[H])) {
      const cell = ev[H][b];
      if (cell && typeof cell === 'object' && 'pUncorrected' in cell) { cell.market = d.key; cell.horizon = H; cell.bucket = b; allCells.push(cell); }
    }
  }
  report.crossMarket = runCrossMarket(datasets);
  report.worldComposite = runWorldComposite(datasets);
  report.europeRobustness = runEuropeRobustness(datasets);
  report.metadata.eventStudyMultiplicity = benjaminiHochberg(allCells);
  const text = JSON.stringify(report, null, 2);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outFile = path.join(OUTPUT_DIR, 'extended-battery-result.json');
  fs.writeFileSync(outFile, text);
  fs.writeFileSync(`${outFile}.sha256`, `${crypto.createHash('sha256').update(text).digest('hex')}  ${path.basename(outFile)}\n`);
  console.log(text);
}

module.exports = {
  simulatePath, positionsFearTimeExit, positionsHysteresis, positionsMonthEndHysteresis,
  positionsLongShort, positionsContinuous, positionsScoreVsSma, positionsLevel,
  carryOntoCalendar, rotate, familyCells, runEventStudy, blockBootstrapDiffCI,
  episodeStats, benjaminiHochberg, runEuropeRobustness, selftest,
};
if (require.main === module) main();
