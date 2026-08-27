'use strict';

// Schema 12: exploratory development/holdout rule search on the production v2 score.
// Protocol: research/FEAR_GREED_RULE_SEARCH_PROTOCOL.md. This is EXPLORATORY work on
// history already exposed to schemas 3-11; its statuses are deliberately incapable of
// expressing validation. Stage 1 (--stage=development) evaluates all candidates on the
// development window and writes a selection file pinned to the protocol and runner hashes.
// Stage 2 (--stage=holdout) refuses to run without that file, refuses if the protocol or
// runner changed, re-derives the selections by deterministic replay (an edited selection
// file cannot steer the holdout), refuses to overwrite an existing holdout output, and
// evaluates only the replayed selections plus the two price-only controls.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const schema6 = require('./fear_greed_extreme_strategy.js');

const SCHEMA_VERSION = 12;
const PROTOCOL_PATH = path.join(__dirname, 'FEAR_GREED_RULE_SEARCH_PROTOCOL.md');
const REQUIRED_PROTOCOL_MARKER = 'RULE-SEARCH-DESIGN-DECLARED 2026-08-27';
const REQUIRED_SNAPSHOT_SHA256 = 'ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d';
const DEFAULT_SNAPSHOT_PATH = path.join(
  __dirname, 'local-artifacts', 'v2-validation-final', 'inputs',
  'fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json');
const OUTPUT_DIR = path.join(__dirname, 'local-artifacts', 'rule-search');
const SELECTION_PATH = path.join(OUTPUT_DIR, 'development', 'rule-search-selection.json');

const COMMON_WARMUP_SIGNAL_ROWS = 126;
const DEVELOPMENT_FRACTION = 0.60;
const MIN_FILLS = 4;
const MAX_PLACEBO_SHIFTS = 199;
const MARKET_COSTS = schema6.MARKET_COSTS;

const STATUS_NO_SURVIVOR = 'EXPLORATORY_NO_DEVELOPMENT_SURVIVOR';
const STATUS_NO_WINNER = 'EXPLORATORY_NO_HOLDOUT_WINNER';
const STATUS_WINNERS = 'EXPLORATORY_HOLDOUT_WINNERS_LOCKBOX_CANDIDATES_ONLY';

const COMPONENT_KEYS = ['momentum', 'strength', 'volatility', 'safeHaven', 'credit', 'breadth'];

const PRIOR_EXPOSURE = Object.freeze([
  'schema 3: v1 predictive backtest failed in all five markets',
  'schema 4: 15-candidate model search EXPLORATORY_UNDERPOWERED',
  'schema 5: production v2 retrospective collection (no confirmatory outcome by design)',
  'schema 6: 31 contrarian extreme-threshold rules NO_SHARED_HISTORICAL_WINNER',
  'schema 7: annual walk-forward selection NO_WALK_FORWARD_HISTORICAL_WINNER',
  'schema 8: trend-confirmed extremes RETROSPECTIVE_EXPLORATORY_GATE_FAIL',
  'schema 9: 50/100/150 core overlay lost in 5/5 markets',
  'schema 10: Faber MA10 replication FAIL_NO_COMMON_WINNER_1_OF_5',
  'schema 11: v3 shadow failed as a common return predictor and as a buy-and-hold winner',
  'consequence: history through 2026-08-24 is exposed; nothing in schema 12 can be confirmatory',
]);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function trailingMean(values, window) {
  const out = new Array(values.length).fill(null);
  let rolling = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) throw new Error(`non-finite value at index ${i} for trailing mean`);
    rolling += v;
    if (i >= window) rolling -= values[i - window];
    if (i >= window - 1) out[i] = rolling / window;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Candidate definitions. Each candidate consumes a per-bar sentiment vector
// (the shiftable part used by the timing placebo) plus an optional true-dated
// price gate, and returns the desired position (0/1) or null (keep current).
// ---------------------------------------------------------------------------

function buildCandidates() {
  const candidates = [];
  for (const k of [21, 63, 126]) {
    candidates.push({
      id: `SMAX_M_${k}`, family: 'score-sma-cross', direction: 'momentum',
      sentiment: ctx => ctx.bars.map(b => [b.S, b.scoreSma[k]]),
      decide: (v) => (v[0] > v[1] ? 1 : 0),
    });
    candidates.push({
      id: `SMAX_C_${k}`, family: 'score-sma-cross', direction: 'contrarian',
      sentiment: ctx => ctx.bars.map(b => [b.S, b.scoreSma[k]]),
      decide: (v) => (v[0] > v[1] ? 0 : 1),
    });
  }
  for (const k of [5, 21, 63]) {
    candidates.push({
      id: `SLOPE_M_${k}`, family: 'score-slope', direction: 'momentum',
      sentiment: ctx => ctx.bars.map(b => [b.S, b.scoreLag[k]]),
      decide: (v) => (v[0] > v[1] ? 1 : 0),
    });
    candidates.push({
      id: `SLOPE_C_${k}`, family: 'score-slope', direction: 'contrarian',
      sentiment: ctx => ctx.bars.map(b => [b.S, b.scoreLag[k]]),
      decide: (v) => (v[0] > v[1] ? 0 : 1),
    });
  }
  for (const L of [35, 45, 50, 55, 65]) {
    candidates.push({
      id: `LVL_M_${L}`, family: 'score-level', direction: 'momentum',
      sentiment: ctx => ctx.bars.map(b => [b.I]),
      decide: (v) => (v[0] >= L ? 1 : 0),
    });
    candidates.push({
      id: `LVL_C_${L}`, family: 'score-level', direction: 'contrarian',
      sentiment: ctx => ctx.bars.map(b => [b.I]),
      decide: (v) => (v[0] <= L ? 1 : 0),
    });
  }
  for (const [H, L] of [[55, 45], [60, 40], [65, 45], [70, 50]]) {
    candidates.push({
      id: `HYST_M_${H}_${L}`, family: 'hysteresis', direction: 'momentum',
      sentiment: ctx => ctx.bars.map(b => [b.I]),
      decide: (v, gate, position) => {
        if (position === 1 && v[0] <= L) return 0;
        if (position === 0 && v[0] >= H) return 1;
        return null;
      },
    });
  }
  for (const c of COMPONENT_KEYS) {
    candidates.push({
      id: `CSMAX_M_${c}`, family: 'component-sma-cross', direction: 'momentum',
      sentiment: ctx => ctx.bars.map(b => [b.components[c], b.componentSma63[c]]),
      decide: (v) => (v[0] > v[1] ? 1 : 0),
    });
    candidates.push({
      id: `CLVL_M_${c}`, family: 'component-level', direction: 'momentum',
      sentiment: ctx => ctx.bars.map(b => [b.components[c]]),
      decide: (v) => (v[0] > 50 ? 1 : 0),
    });
  }
  for (const n of [3, 4, 5]) {
    candidates.push({
      id: `ENS_M_${n}`, family: 'ensemble-vote', direction: 'momentum',
      sentiment: ctx => ctx.bars.map(b => COMPONENT_KEYS.map(c => b.components[c])),
      decide: (v) => (v.filter(x => x > 50).length >= n ? 1 : 0),
    });
  }
  candidates.push({
    id: 'HYB_TREND_AND_NOTFEAR', family: 'hybrid', direction: 'momentum',
    sentiment: ctx => ctx.bars.map(b => [b.I]),
    priceGate: ctx => ctx.bars.map(b => b.aboveSma125),
    decide: (v, gate) => (gate && v[0] >= 45 ? 1 : 0),
  });
  candidates.push({
    id: 'HYB_TREND_AND_NOTGREED', family: 'hybrid', direction: 'momentum',
    sentiment: ctx => ctx.bars.map(b => [b.I]),
    priceGate: ctx => ctx.bars.map(b => b.aboveSma125),
    decide: (v, gate) => (gate && v[0] <= 74 ? 1 : 0),
  });
  candidates.push({
    id: 'HYB_TREND_OR_GREED', family: 'hybrid', direction: 'momentum',
    sentiment: ctx => ctx.bars.map(b => [b.I]),
    priceGate: ctx => ctx.bars.map(b => b.aboveSma125),
    decide: (v, gate) => (gate || v[0] >= 65 ? 1 : 0),
  });
  candidates.push({
    id: 'HYB_TREND_AND_RISING', family: 'hybrid', direction: 'momentum',
    sentiment: ctx => ctx.bars.map(b => [b.S, b.scoreSma[21]]),
    priceGate: ctx => ctx.bars.map(b => b.aboveSma125),
    decide: (v, gate) => (gate && v[0] > v[1] ? 1 : 0),
  });
  if (candidates.length !== 45) throw new Error(`expected 45 candidates, built ${candidates.length}`);
  const ids = new Set(candidates.map(c => c.id));
  if (ids.size !== candidates.length) throw new Error('duplicate candidate ids');
  return candidates;
}

function buildControls() {
  return [
    {
      id: 'CTRL_PRICE_SMA125', family: 'control', direction: 'price-only',
      sentiment: ctx => ctx.bars.map(() => []),
      priceGate: ctx => ctx.bars.map(b => b.aboveSma125),
      decide: (v, gate) => (gate ? 1 : 0),
    },
    {
      id: 'CTRL_PRICE_SMA210', family: 'control', direction: 'price-only',
      sentiment: ctx => ctx.bars.map(() => []),
      priceGate: ctx => ctx.bars.map(b => b.aboveSma210),
      decide: (v, gate) => (gate ? 1 : 0),
    },
  ];
}

// ---------------------------------------------------------------------------
// Market context: aligned bars over the common decision range.
// ---------------------------------------------------------------------------

function buildMarketContext(market) {
  const signals = market.signals;
  if (!Array.isArray(signals) || signals.length <= COMMON_WARMUP_SIGNAL_ROWS + 2) {
    throw new Error(`${market.key}: not enough signal rows`);
  }
  const rawScores = signals.map(row => {
    if (!Number.isFinite(row.publishedScore)) throw new Error(`${market.key} ${row.date}: non-finite publishedScore`);
    return row.publishedScore;
  });
  const scoreSmaAll = { 21: trailingMean(rawScores, 21), 63: trailingMean(rawScores, 63), 126: trailingMean(rawScores, 126) };
  const componentSeries = {};
  const componentSma63All = {};
  for (const c of COMPONENT_KEYS) {
    componentSeries[c] = signals.map(row => {
      const value = row.components && row.components[c] && row.components[c].score;
      if (!Number.isFinite(value)) throw new Error(`${market.key} ${row.date}: non-finite component ${c}`);
      return value;
    });
    componentSma63All[c] = trailingMean(componentSeries[c], 63);
  }
  const priceRows = market.prices.rows;
  const priceCloses = priceRows.map(row => {
    if (!(Number(row.close) > 0)) throw new Error(`${market.key} ${row.date}: non-positive close`);
    return row.close;
  });
  const priceSma125 = trailingMean(priceCloses, 125);
  const priceSma210 = trailingMean(priceCloses, 210);
  const priceIndexByDate = new Map(priceRows.map((row, index) => [row.date, index]));

  const bars = [];
  for (let i = COMMON_WARMUP_SIGNAL_ROWS; i < signals.length; i++) {
    const date = signals[i].date;
    const priceIndex = priceIndexByDate.get(date);
    if (priceIndex == null) throw new Error(`${market.key}: missing exact target close on ${date}`);
    if (!Number.isFinite(priceSma125[priceIndex]) || !Number.isFinite(priceSma210[priceIndex])) {
      throw new Error(`${market.key} ${date}: price SMA gates not warmed up`);
    }
    const components = {};
    const componentSma63 = {};
    for (const c of COMPONENT_KEYS) {
      components[c] = componentSeries[c][i];
      componentSma63[c] = componentSma63All[c][i];
      if (!Number.isFinite(componentSma63[c])) throw new Error(`${market.key} ${date}: component SMA not warmed up`);
    }
    bars.push({
      date,
      close: priceCloses[priceIndex],
      S: rawScores[i],
      I: schema6.displayedInteger(rawScores[i]),
      scoreSma: { 21: scoreSmaAll[21][i], 63: scoreSmaAll[63][i], 126: scoreSmaAll[126][i] },
      scoreLag: { 5: rawScores[i - 5], 21: rawScores[i - 21], 63: rawScores[i - 63] },
      components,
      componentSma63,
      aboveSma125: priceCloses[priceIndex] > priceSma125[priceIndex],
      aboveSma210: priceCloses[priceIndex] > priceSma210[priceIndex],
    });
  }
  for (const key of [21, 63, 126]) {
    if (!Number.isFinite(bars[0].scoreSma[key])) throw new Error(`${market.key}: score SMA ${key} not warmed up at first bar`);
  }
  const barDates = new Set(bars.map(bar => bar.date));
  const firstBarDate = bars[0].date;
  const lastBarDate = bars[bars.length - 1].date;
  const droppedPriceDates = priceRows
    .filter(row => row.date > firstBarDate && row.date < lastBarDate && !barDates.has(row.date))
    .map(row => row.date);
  const developmentBars = Math.ceil(bars.length * DEVELOPMENT_FRACTION);
  if (developmentBars < 30 || bars.length - developmentBars < 30) throw new Error(`${market.key}: window too small to split`);
  return {
    key: market.key,
    name: market.name,
    annualization: market.annualization,
    bars,
    droppedPriceDates,
    developmentBars,
    windows: {
      development: { firstBar: 0, lastBar: developmentBars - 1 },
      holdout: { firstBar: developmentBars - 1, lastBar: bars.length - 1 },
    },
  };
}

// ---------------------------------------------------------------------------
// Simulation with schema-6 accounting: decision at close t fills at close t+1,
// cost multiplies wealth at fill, cash earns 0%, terminal decision unfilled.
// ---------------------------------------------------------------------------

function simulateCandidate({ context, candidate, sentimentRows, gateRows, window, cost, initialPosition = 1 }) {
  const { firstBar, lastBar } = window;
  const bars = context.bars;
  if (!(cost >= 0 && cost < 1)) throw new Error('cost must be in [0,1)');
  let position = initialPosition;
  let wealth = 1;
  let fills = 0;
  let completedCashCycles = 0;
  let cashCycleOpen = false;
  let longIntervals = 0;
  let unfilledTerminalOrders = 0;
  const wealthCurve = [{ date: bars[firstBar].date, wealth: 1 }];
  for (let i = firstBar; i < lastBar; i++) {
    const held = position;
    if (held === 1) longIntervals++;
    wealth *= held === 1 ? bars[i + 1].close / bars[i].close : 1;
    const target = candidate.decide(sentimentRows[i], gateRows ? gateRows[i] : null, position);
    if (target != null && target !== position) {
      wealth *= 1 - cost;
      fills++;
      if (target === 0) cashCycleOpen = true;
      else if (cashCycleOpen) { completedCashCycles++; cashCycleOpen = false; }
      position = target;
    }
    wealthCurve.push({ date: bars[i + 1].date, wealth });
  }
  const terminalTarget = candidate.decide(sentimentRows[lastBar], gateRows ? gateRows[lastBar] : null, position);
  if (terminalTarget != null && terminalTarget !== position) unfilledTerminalOrders = 1;
  const metrics = schema6.computePerformanceMetrics(
    wealthCurve.map(row => ({ date: row.date, wealth: row.wealth })), context.annualization);
  const intervals = lastBar - firstBar;
  return {
    terminalWealth: metrics.terminalWealth,
    cagr: metrics.cagr,
    annualizedVolatility: metrics.annualizedVolatility,
    sharpe: metrics.sharpe,
    maximumDrawdown: metrics.maximumDrawdown,
    startDate: bars[firstBar].date,
    endDate: bars[lastBar].date,
    intervals,
    exposure: longIntervals / intervals,
    fills,
    completedCashCycles,
    unfilledTerminalOrders,
    finalPosition: position === 1 ? 'long' : 'cash',
  };
}

function benchmarkWindow(context, window) {
  const prices = context.bars.slice(window.firstBar, window.lastBar + 1).map(row => ({ date: row.date, close: row.close }));
  return schema6.benchmarkBuyHold({ prices, annualization: context.annualization });
}

function evaluateCandidateOnWindow(context, candidate, window, sentimentRows = null, initialPosition = 1) {
  const rows = sentimentRows || candidate.sentiment(context);
  const gates = candidate.priceGate ? candidate.priceGate(context) : null;
  const benchmark = benchmarkWindow(context, window);
  const costs = MARKET_COSTS[context.key];
  const byCost = {};
  for (const scenario of ['zero', 'base', 'stress']) {
    const result = simulateCandidate({ context, candidate, sentimentRows: rows, gateRows: gates, window, cost: costs[scenario], initialPosition });
    byCost[scenario] = { ...result, terminalWealthRatio: result.terminalWealth / benchmark.terminalWealth };
  }
  const cashStart = simulateCandidate({ context, candidate, sentimentRows: rows, gateRows: gates, window, cost: costs.base, initialPosition: 0 });
  return {
    candidateId: candidate.id,
    family: candidate.family,
    direction: candidate.direction,
    window: { start: context.bars[window.firstBar].date, end: context.bars[window.lastBar].date, intervals: window.lastBar - window.firstBar },
    buyAndHold: {
      terminalWealth: benchmark.terminalWealth, cagr: benchmark.cagr,
      maximumDrawdown: benchmark.maximumDrawdown, sharpe: benchmark.sharpe,
    },
    scenarios: byCost,
    cashStartBase: { terminalWealth: cashStart.terminalWealth, terminalWealthRatio: cashStart.terminalWealth / benchmark.terminalWealth },
  };
}

// ---------------------------------------------------------------------------
// Timing placebo: circularly shift the sentiment rows across the evaluated
// window while price gates stay true-dated (core-overlay offsets scheme).
// ---------------------------------------------------------------------------

function shiftSentimentRows(sentimentRows, window, offset) {
  const { firstBar, lastBar } = window;
  const length = lastBar - firstBar + 1;
  if (!Number.isInteger(offset) || offset <= 0 || offset >= length) throw new Error('invalid circular shift');
  const shifted = sentimentRows.slice();
  for (let i = 0; i < length; i++) {
    shifted[firstBar + i] = sentimentRows[firstBar + ((i - offset + length) % length)];
  }
  return shifted;
}

function timingPlacebo(context, candidate, window, actualTerminalWealth) {
  const rows = candidate.sentiment(context);
  const gates = candidate.priceGate ? candidate.priceGate(context) : null;
  const cost = MARKET_COSTS[context.key].base;
  const length = window.lastBar - window.firstBar + 1;
  const offsets = deterministicShiftOffsets(length);
  const terminals = offsets.map(offset => {
    const shifted = shiftSentimentRows(rows, window, offset);
    return simulateCandidate({ context, candidate, sentimentRows: shifted, gateRows: gates, window, cost, initialPosition: 1 }).terminalWealth;
  }).sort((a, b) => a - b);
  const n = terminals.length;
  const below = terminals.filter(v => v < actualTerminalWealth).length;
  const ties = terminals.filter(v => v === actualTerminalWealth).length;
  const atLeastActual = terminals.filter(v => v >= actualTerminalWealth).length;
  const median = n % 2 === 1
    ? terminals[(n - 1) / 2]
    : (terminals[n / 2 - 1] + terminals[n / 2]) / 2;
  return {
    shiftCount: n,
    minimumTerminalWealth: terminals[0],
    medianTerminalWealth: median,
    maximumTerminalWealth: terminals[n - 1],
    actualTerminalWealth,
    tieCount: ties,
    degenerate: terminals[0] === terminals[n - 1],
    actualPercentile: (below + 0.5 * ties) / n,
    finiteSampleExceedanceFraction: (1 + atLeastActual) / (1 + n),
  };
}

function deterministicShiftOffsets(length, maximum = MAX_PLACEBO_SHIFTS) {
  if (!Number.isInteger(length) || length < 2) throw new Error('invalid shift length');
  if (length - 1 <= maximum) return Array.from({ length: length - 1 }, (_, i) => i + 1);
  const offsets = new Set();
  for (let rank = 1; rank <= maximum; rank++) {
    const offset = Math.floor(rank * length / (maximum + 1));
    if (offset > 0 && offset < length) offsets.add(offset);
  }
  return [...offsets].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Stage 1: development evaluation + frozen selection.
// ---------------------------------------------------------------------------

function runDevelopment(snapshot) {
  const candidates = buildCandidates();
  const controls = buildControls();
  const markets = snapshot.markets.map(buildMarketContext);
  const perMarket = {};
  for (const context of markets) {
    const rows = [];
    for (const candidate of candidates.concat(controls)) {
      rows.push(evaluateCandidateOnWindow(context, candidate, context.windows.development));
    }
    const eligible = rows.filter(row =>
      row.family !== 'control' &&
      row.scenarios.base.terminalWealthRatio > 1 &&
      row.scenarios.stress.terminalWealthRatio > 1 &&
      row.scenarios.base.fills >= MIN_FILLS);
    eligible.sort((a, b) =>
      b.scenarios.base.terminalWealthRatio - a.scenarios.base.terminalWealthRatio ||
      a.scenarios.base.fills - b.scenarios.base.fills ||
      (a.candidateId < b.candidateId ? -1 : 1));
    perMarket[context.key] = {
      window: rows[0].window,
      buyAndHold: rows[0].buyAndHold,
      droppedPriceDates: context.droppedPriceDates,
      candidateCount: candidates.length,
      eligibleCount: eligible.length,
      selection: eligible.length ? eligible[0].candidateId : null,
      selectionStatus: eligible.length ? 'SELECTED' : 'NO_DEVELOPMENT_SURVIVOR',
      eligibleTop5: eligible.slice(0, 5).map(row => ({
        candidateId: row.candidateId,
        terminalWealthRatioBase: row.scenarios.base.terminalWealthRatio,
        terminalWealthRatioStress: row.scenarios.stress.terminalWealthRatio,
        fills: row.scenarios.base.fills,
        exposure: row.scenarios.base.exposure,
      })),
      results: rows,
    };
  }
  let shared = null;
  let sharedObjective = -Infinity;
  for (const candidate of candidates) {
    let minimumBaseLog = Infinity;
    let allStressPositive = true;
    for (const context of markets) {
      const row = perMarket[context.key].results.find(r => r.candidateId === candidate.id);
      minimumBaseLog = Math.min(minimumBaseLog, Math.log(row.scenarios.base.terminalWealthRatio));
      if (!(row.scenarios.stress.terminalWealthRatio > 1)) allStressPositive = false;
    }
    if (minimumBaseLog > 0 && allStressPositive && minimumBaseLog > sharedObjective) {
      sharedObjective = minimumBaseLog;
      shared = candidate.id;
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    stage: 'development',
    priorExposure: PRIOR_EXPOSURE,
    frozenDesign: {
      commonWarmupSignalRows: COMMON_WARMUP_SIGNAL_ROWS,
      developmentFraction: DEVELOPMENT_FRACTION,
      minimumFills: MIN_FILLS,
      costs: MARKET_COSTS,
      candidateIds: candidates.map(c => c.id),
      controlIds: controls.map(c => c.id),
      eligibility: 'development terminalWealthRatio > 1 at base AND stress cost; fills >= 4',
      perMarketSelection: 'max base-cost development terminalWealthRatio; tiebreak fewer fills then id',
      sharedSelection: 'max over candidates of min over markets ln(base ratio); requires >1 at base and stress in every market',
      holdoutGate: 'holdout terminalWealthRatio > 1 at base AND stress cost',
    },
    markets: Object.fromEntries(Object.entries(perMarket).map(([key, value]) => [key, {
      window: value.window,
      buyAndHold: value.buyAndHold,
      droppedPriceDates: value.droppedPriceDates,
      eligibleCount: value.eligibleCount,
      selection: value.selection,
      selectionStatus: value.selectionStatus,
      eligibleTop5: value.eligibleTop5,
    }])),
    sharedSelection: shared,
    fullResults: Object.fromEntries(Object.entries(perMarket).map(([key, value]) => [key, value.results])),
  };
}

// ---------------------------------------------------------------------------
// Stage 2: holdout evaluation of the selected candidates only.
// ---------------------------------------------------------------------------

function passesWinGate(evaluation) {
  return evaluation.scenarios.base.terminalWealthRatio > 1 && evaluation.scenarios.stress.terminalWealthRatio > 1;
}

function runHoldout(snapshot, selection) {
  const candidates = buildCandidates();
  const controls = buildControls();
  const byId = new Map(candidates.concat(controls).map(c => [c.id, c]));
  const markets = snapshot.markets.map(buildMarketContext);
  const perMarket = {};
  const winners = [];
  const sharedId = selection.sharedSelection || null;
  let sharedWinsAllMarkets = sharedId != null;
  for (const context of markets) {
    const selected = selection.markets[context.key] && selection.markets[context.key].selection;
    const evaluations = {};
    for (const id of [selected, sharedId, 'CTRL_PRICE_SMA125', 'CTRL_PRICE_SMA210'].filter(Boolean)) {
      if (evaluations[id]) continue;
      const candidate = byId.get(id);
      if (!candidate) throw new Error(`unknown selected candidate ${id}`);
      const evaluation = evaluateCandidateOnWindow(context, candidate, context.windows.holdout);
      if (candidate.family !== 'control') {
        evaluation.timingPlacebo = timingPlacebo(context, candidate, context.windows.holdout, evaluation.scenarios.base.terminalWealth);
      }
      evaluations[id] = evaluation;
    }
    const control = evaluations.CTRL_PRICE_SMA125;
    const marketResult = {
      window: Object.values(evaluations)[0] ? Object.values(evaluations)[0].window : null,
      selection: selected || null,
      selectionStatus: selected ? 'SELECTED' : 'NO_DEVELOPMENT_SURVIVOR',
      sharedSelection: sharedId,
      evaluations,
      holdoutWin: null,
      sharedHoldoutWin: null,
    };
    if (selected) {
      const row = evaluations[selected];
      marketResult.holdoutWin = passesWinGate(row);
      if (marketResult.holdoutWin) winners.push({ scope: 'market', market: context.key, candidateId: selected });
      marketResult.beatsPriceOnlyControl =
        row.scenarios.base.terminalWealth > control.scenarios.base.terminalWealth;
    }
    if (sharedId) {
      const row = evaluations[sharedId];
      marketResult.sharedHoldoutWin = passesWinGate(row);
      if (!marketResult.sharedHoldoutWin) sharedWinsAllMarkets = false;
      marketResult.sharedBeatsPriceOnlyControl =
        row.scenarios.base.terminalWealth > control.scenarios.base.terminalWealth;
    }
    perMarket[context.key] = marketResult;
  }
  if (sharedId && sharedWinsAllMarkets) winners.push({ scope: 'shared', candidateId: sharedId });
  const anySelection = Object.values(selection.markets).some(m => m.selection) || sharedId != null;
  const status = !anySelection ? STATUS_NO_SURVIVOR : winners.length === 0 ? STATUS_NO_WINNER : STATUS_WINNERS;
  return {
    schemaVersion: SCHEMA_VERSION,
    stage: 'holdout',
    status,
    priorExposure: PRIOR_EXPOSURE,
    interpretation: status === STATUS_WINNERS
      ? 'Holdout winners are lockbox preregistration candidates only; the holdout years were exposed to schemas 3-11 and this study is the seventh rule family tried against the same endpoint.'
      : 'No rule on the v2 score or its components survived its own development selection and later holdout under the frozen gates.',
    winners,
    markets: perMarket,
  };
}

// ---------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non-finite number in output');
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function assertProtocolDeclared() {
  const text = fs.readFileSync(PROTOCOL_PATH, 'utf8');
  if (!text.includes(REQUIRED_PROTOCOL_MARKER)) throw new Error('protocol design marker missing; refusing to run');
}

function loadSnapshot(snapshotPath) {
  const buffer = fs.readFileSync(snapshotPath);
  const digest = sha256(buffer);
  if (digest !== REQUIRED_SNAPSHOT_SHA256) {
    throw new Error(`snapshot sha256 mismatch: ${digest} != ${REQUIRED_SNAPSHOT_SHA256}`);
  }
  const snapshot = JSON.parse(buffer.toString('utf8'));
  if (snapshot.schemaVersion !== 5) throw new Error('expected schema-5 snapshot');
  return snapshot;
}

function writeWithSidecar(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  fs.writeFileSync(`${file}.sha256`, `${sha256(Buffer.from(text))}  ${path.basename(file)}\n`);
}

function developmentFingerprint(development) {
  return sha256(Buffer.from(canonicalJson(development.fullResults)));
}

const DEVELOPMENT_RESULT_PATH = path.join(OUTPUT_DIR, 'development', 'rule-search-development.json');
const HOLDOUT_RESULT_PATH = path.join(OUTPUT_DIR, 'holdout', 'rule-search-holdout.json');

function refuseExisting(file, forceOverwrite, label) {
  if (fs.existsSync(file) && !forceOverwrite) {
    throw new Error(`${label} refused: ${file} already exists; the stop rule forbids re-runs (pass --force-overwrite only with disclosure)`);
  }
}

function currentStageHashes() {
  return {
    protocolSha256: sha256(fs.readFileSync(PROTOCOL_PATH)),
    runnerSha256: sha256(fs.readFileSync(__filename)),
  };
}

function runStage(stage, snapshotPath = DEFAULT_SNAPSHOT_PATH, options = {}) {
  const forceOverwrite = Boolean(options.forceOverwrite);
  assertProtocolDeclared();
  const snapshot = loadSnapshot(snapshotPath);
  return schema6.withNetworkDisabled(() => {
    if (stage === 'development') {
      refuseExisting(SELECTION_PATH, forceOverwrite, 'development');
      refuseExisting(HOLDOUT_RESULT_PATH, forceOverwrite, 'development');
      const first = runDevelopment(snapshot);
      const second = runDevelopment(snapshot);
      if (canonicalJson(first) !== canonicalJson(second)) throw new Error('development stage is not deterministic');
      const fingerprint = developmentFingerprint(first);
      const selectionRecord = {
        schemaVersion: SCHEMA_VERSION,
        stage: 'selection',
        developmentFingerprint: fingerprint,
        ...currentStageHashes(),
        markets: Object.fromEntries(Object.entries(first.markets).map(([key, value]) => [key, {
          selection: value.selection, selectionStatus: value.selectionStatus, eligibleCount: value.eligibleCount,
        }])),
        sharedSelection: first.sharedSelection,
      };
      const summary = { ...first };
      delete summary.fullResults;
      writeWithSidecar(DEVELOPMENT_RESULT_PATH, canonicalJson({ ...first, developmentFingerprint: fingerprint }));
      writeWithSidecar(SELECTION_PATH, canonicalJson(selectionRecord));
      return { development: summary, selection: selectionRecord };
    }
    if (stage === 'holdout') {
      refuseExisting(HOLDOUT_RESULT_PATH, forceOverwrite, 'holdout');
      if (!fs.existsSync(SELECTION_PATH)) throw new Error('holdout refused: run --stage=development first (selection file missing)');
      const selection = JSON.parse(fs.readFileSync(SELECTION_PATH, 'utf8'));
      const hashes = currentStageHashes();
      if (selection.protocolSha256 !== hashes.protocolSha256) {
        throw new Error('holdout refused: protocol file changed since the selection stage');
      }
      if (selection.runnerSha256 !== hashes.runnerSha256) {
        throw new Error('holdout refused: runner file changed since the selection stage');
      }
      const replay = runDevelopment(snapshot);
      if (developmentFingerprint(replay) !== selection.developmentFingerprint) {
        throw new Error('holdout refused: deterministic development replay does not reproduce the recorded fingerprint (this check binds development results only)');
      }
      for (const key of Object.keys(replay.markets)) {
        const recorded = selection.markets[key] && selection.markets[key].selection;
        if ((recorded || null) !== (replay.markets[key].selection || null)) {
          throw new Error(`holdout refused: selection file does not match deterministic replay for ${key}`);
        }
      }
      if ((selection.sharedSelection || null) !== (replay.sharedSelection || null)) {
        throw new Error('holdout refused: shared selection in file does not match deterministic replay');
      }
      const boundSelection = {
        markets: Object.fromEntries(Object.entries(replay.markets).map(([key, value]) => [key, { selection: value.selection }])),
        sharedSelection: replay.sharedSelection,
      };
      const first = runHoldout(snapshot, boundSelection);
      const second = runHoldout(snapshot, boundSelection);
      if (canonicalJson(first) !== canonicalJson(second)) throw new Error('holdout stage is not deterministic');
      writeWithSidecar(HOLDOUT_RESULT_PATH, canonicalJson(first));
      return first;
    }
    throw new Error(`unknown stage: ${stage}`);
  });
}

function main(argv = process.argv.slice(2)) {
  const stageArg = argv.find(arg => arg.startsWith('--stage='));
  if (!stageArg) throw new Error('usage: node fear_greed_rule_search.js --stage=development|holdout [--force-overwrite]');
  const result = runStage(stageArg.slice('--stage='.length), DEFAULT_SNAPSHOT_PATH, {
    forceOverwrite: argv.includes('--force-overwrite'),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = {
  SCHEMA_VERSION, PROTOCOL_PATH, REQUIRED_PROTOCOL_MARKER, REQUIRED_SNAPSHOT_SHA256,
  DEFAULT_SNAPSHOT_PATH, OUTPUT_DIR, SELECTION_PATH,
  COMMON_WARMUP_SIGNAL_ROWS, DEVELOPMENT_FRACTION, MIN_FILLS, MARKET_COSTS, COMPONENT_KEYS,
  STATUS_NO_SURVIVOR, STATUS_NO_WINNER, STATUS_WINNERS, PRIOR_EXPOSURE,
  trailingMean, buildCandidates, buildControls, buildMarketContext,
  simulateCandidate, benchmarkWindow, evaluateCandidateOnWindow,
  shiftSentimentRows, timingPlacebo, deterministicShiftOffsets, passesWinGate,
  runDevelopment, runHoldout, canonicalize, canonicalJson,
  loadSnapshot, writeWithSidecar, developmentFingerprint, runStage, main,
};

if (require.main === module) main();
