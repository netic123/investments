'use strict';

// Schema 6: a network-free, direct long/cash backtest of the repository-owned
// Fear & Greed score. The frozen protocol is intentionally separate from this
// implementation so the design existed before any direct strategy outcome.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const marketfg = require('../marketfg');
const schema5 = require('./fear_greed_v2_validation');
const schema4 = require('./fear_greed_model_search');

const SCHEMA_VERSION = 6;
const PROTOCOL_PATH = path.join(__dirname, 'FEAR_GREED_EXTREME_STRATEGY_PROTOCOL.md');
const REQUIRED_PROTOCOL_MARKER = 'FROZEN_SCHEMA6_EXTREME_STRATEGY_V1';
const REQUIRED_PROTOCOL_FREEZE_AT = '2026-08-25T15:22:18.061Z';
const REQUIRED_PROTOCOL_SHA256 = '8f81c86c30df9480af898feb4d3e35e19a41847c8b0a5ea0c8527b90a6f261db';
const REQUIRED_SNAPSHOT_SHA256 = 'ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d';
const DEFAULT_SNAPSHOT_PATH = path.join(__dirname, 'local-artifacts', 'v2-validation-final', 'inputs', 'fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json');
const YEAR_DAYS = 365.2425;
const COMMON_WARMUP_ROWS = 20;
const STATUS_PASS = 'HISTORICALLY_WORKS_RETROSPECTIVELY';
const STATUS_FAIL = 'NO_SHARED_HISTORICAL_WINNER';

const MARKET_COSTS = Object.freeze({
  crypto: Object.freeze({ zero: 0, base: 0.0025, stress: 0.0075 }),
  sweden: Object.freeze({ zero: 0, base: 0.0010, stress: 0.0025 }),
  usa: Object.freeze({ zero: 0, base: 0.0010, stress: 0.0025 }),
  europe: Object.freeze({ zero: 0, base: 0.0010, stress: 0.0025 }),
  global: Object.freeze({ zero: 0, base: 0.0010, stress: 0.0025 }),
});

function sha256Buffer(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('canonical JSON cannot contain a non-finite number');
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}

function parseProtocolState(text = fs.readFileSync(PROTOCOL_PATH, 'utf8')) {
  const marker = /<!--\s*SCHEMA6_FREEZE_MARKER:\s*([^\s]+)\s*-->/.exec(text);
  const frozenAt = /<!--\s*SCHEMA6_FREEZE_AT:\s*([^\s]+)\s*-->/.exec(text);
  if (!marker || !frozenAt) throw new Error('schema-6 protocol freeze lines are missing');
  return { marker: marker[1], frozenAt: frozenAt[1] };
}

function assertProtocolFrozen(state = parseProtocolState()) {
  if (state.marker !== REQUIRED_PROTOCOL_MARKER || state.frozenAt !== REQUIRED_PROTOCOL_FREEZE_AT) {
    throw new Error(`schema-6 protocol is not the required frozen design: ${JSON.stringify(state)}`);
  }
  if (new Date(state.frozenAt).toISOString() !== state.frozenAt) throw new Error('schema-6 frozenAt is not exact ISO UTC');
  const actualSha256 = sha256File(PROTOCOL_PATH);
  if (actualSha256 !== REQUIRED_PROTOCOL_SHA256) throw new Error(`schema-6 frozen protocol hash mismatch: expected ${REQUIRED_PROTOCOL_SHA256}, got ${actualSha256}`);
  return state;
}

function buildCandidates() {
  const candidates = [];
  for (const fear of [15, 20, 24]) {
    for (const greed of [75, 80, 85]) {
      for (const smoothingObservations of [1, 5]) {
        candidates.push({
          id: `P_F${fear}_G${greed}_S${smoothingObservations}`,
          name: `Published score; buy <= ${fear}, sell >= ${greed}; ${smoothingObservations}-observation mean`,
          declarationOrder: candidates.length,
          family: 'published',
          fear,
          greed,
          buyBoundary: fear,
          sellBoundary: greed,
          smoothingObservations,
        });
      }
    }
  }
  const retained = schema5.buildCandidates().filter(candidate => !['equal_s1', 'equal_s5'].includes(candidate.id));
  for (const source of retained) {
    candidates.push({
      id: `W_${source.id}_F24_G75`,
      name: `${source.name}; buy <= 24, sell >= 75`,
      declarationOrder: candidates.length,
      family: 'component',
      fear: 24,
      greed: 75,
      buyBoundary: 24,
      sellBoundary: 75,
      smoothingObservations: source.smoothingObservations,
      sourceCandidateId: source.id,
      componentOrder: source.componentOrder.slice(),
      rawWeights: source.rawWeights.slice(),
      normalizedWeights: source.normalizedWeights.slice(),
      templateId: source.templateId,
    });
  }
  if (candidates.length !== 31) throw new Error(`schema-6 frozen family must contain exactly 31 candidates, got ${candidates.length}`);
  if (new Set(candidates.map(candidate => candidate.id)).size !== candidates.length) throw new Error('schema-6 candidate IDs are not unique');
  return candidates;
}

const FROZEN_CANDIDATES = deepFreeze(buildCandidates());
const FROZEN_DESIGN = deepFreeze({
  schemaVersion: SCHEMA_VERSION,
  statusBoundary: [STATUS_PASS, STATUS_FAIL],
  protocolMarker: REQUIRED_PROTOCOL_MARKER,
  protocolFrozenAt: REQUIRED_PROTOCOL_FREEZE_AT,
  requiredSnapshotSha256: REQUIRED_SNAPSHOT_SHA256,
  candidateCount: 31,
  candidates: FROZEN_CANDIDATES,
  commonWarmupRows: COMMON_WARMUP_ROWS,
  firstDecisionSignalOrdinal: 21,
  initialState: 'long',
  executionLagTargetBars: 1,
  terminalLiquidation: false,
  cashAnnualReturn: 0,
  calendarYearDays: YEAR_DAYS,
  volatilityInput: 'simple net interval returns; sample standard deviation',
  halfSplit: 'floor(N/2) intervals in first half; remainder in second',
  costs: MARKET_COSTS,
  commonAggregate: 'arithmetic mean of five equal inception allocations; no rebalance',
});

function displayedInteger(score) {
  if (!Number.isFinite(score)) return null;
  return Math.round(Math.round(score * 10) / 10);
}

function productionRound1(score) {
  return Number.isFinite(score) ? Math.round(score * 10) / 10 : null;
}

function classifyDecision(score, buyBoundary, sellBoundary) {
  const integer = displayedInteger(score);
  if (integer == null) return 'hold';
  if (integer <= buyBoundary) return 'buy';
  if (integer >= sellBoundary) return 'sell';
  return 'hold';
}

function trailingMeanScoreSeries(rows, window, valueSelector = row => row.publishedScore) {
  if (!Array.isArray(rows) || !Number.isInteger(window) || window < 1) throw new Error('invalid trailing-mean inputs');
  const output = [];
  let rolling = 0;
  for (let index = 0; index < rows.length; index++) {
    const value = Number(valueSelector(rows[index]));
    if (!Number.isFinite(value)) throw new Error(`${rows[index] && rows[index].date || index}: non-finite score`);
    rolling += value;
    if (index >= window) rolling -= Number(valueSelector(rows[index - window]));
    if (index >= window - 1) output.push({ date: rows[index].date, score: rolling / window });
  }
  return output;
}

function buildCandidateScores(signalRows, candidate, sourceCandidates = schema5.buildCandidates()) {
  let series;
  if (candidate.family === 'published' || String(candidate.id).startsWith('P_')) {
    series = trailingMeanScoreSeries(signalRows, candidate.smoothingObservations, row => row.publishedScore);
  } else {
    const sourceId = candidate.sourceCandidateId || candidate.id;
    const source = sourceCandidates.find(item => item.id === sourceId);
    if (!source) throw new Error(`${candidate.id}: missing frozen source candidate`);
    series = schema4.computeCandidateSeries(signalRows, source);
  }
  return series.map(row => ({
    date: row.date,
    score: row.score,
    roundedScore: productionRound1(row.score),
    displayedInteger: displayedInteger(row.score),
  }));
}

function buildCandidateScoreMap(market, candidate, sourceCandidates = schema5.buildCandidates()) {
  const series = buildCandidateScores(market.signals, candidate, sourceCandidates);
  const map = new Map(series.map(row => [row.date, row.score]));
  for (let index = COMMON_WARMUP_ROWS; index < market.signals.length; index++) {
    if (!Number.isFinite(map.get(market.signals[index].date))) throw new Error(`${candidate.id}: score missing after common warm-up on ${market.signals[index].date}`);
  }
  return map;
}

function buildAlignedMarketRows(market, candidates = FROZEN_CANDIDATES) {
  if (!Array.isArray(candidates) || candidates.length !== 31) throw new Error('aligned schema-6 rows require exactly 31 candidates');
  const scoreMaps = new Map(candidates.map(candidate => [candidate.id, buildCandidateScoreMap(market, candidate)]));
  const priceMap = new Map(market.prices.rows.map(row => [row.date, row.close]));
  const commonSignals = market.signals.slice(COMMON_WARMUP_ROWS);
  const rows = commonSignals.map(signal => {
    const close = priceMap.get(signal.date);
    if (!(close > 0)) throw new Error(`${market.key}: missing exact target close on ${signal.date}`);
    return {
      date: signal.date,
      close,
      scores: Object.fromEntries(candidates.map(candidate => [candidate.id, scoreMaps.get(candidate.id).get(signal.date)])),
    };
  });
  return {
    firstDecisionDate: commonSignals[0].date,
    commonSignalDates: commonSignals.map(row => row.date),
    rows,
  };
}

function queuedDecision(position, score, fear, greed) {
  const integer = displayedInteger(score);
  if (integer == null) return null;
  if (position === 1 && integer >= greed) return { desiredPosition: 0, side: 'sell', displayedInteger: integer };
  if (position === 0 && integer <= fear) return { desiredPosition: 1, side: 'buy', displayedInteger: integer };
  return null;
}

function validatePrices(prices) {
  if (!Array.isArray(prices) || prices.length < 2) throw new Error('at least two target closes are required');
  let previous = '';
  for (const row of prices) {
    if (!row || typeof row.date !== 'string' || row.date <= previous || !(Number(row.close) > 0)) throw new Error('prices must be strictly dated, positive target closes');
    previous = row.date;
  }
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sampleStandardDeviation(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function calendarDays(firstDate, lastDate) {
  const days = (Date.parse(`${lastDate}T00:00:00.000Z`) - Date.parse(`${firstDate}T00:00:00.000Z`)) / 86400000;
  if (!(days > 0)) throw new Error(`non-positive date span: ${firstDate}..${lastDate}`);
  return days;
}

function summarizePath({ prices, returns, wealthPath, annualization, terminalWealth }) {
  const days = calendarDays(prices[0].date, prices.at(-1).date);
  const years = days / YEAR_DAYS;
  const standardDeviation = sampleStandardDeviation(returns);
  const annualizedVolatility = standardDeviation == null ? null : standardDeviation * Math.sqrt(annualization);
  const averageReturn = mean(returns);
  const sharpe = annualizedVolatility > 0 ? averageReturn * annualization / annualizedVolatility : null;
  let peak = wealthPath[0];
  let maximumDrawdown = 0;
  for (const wealth of wealthPath) {
    if (wealth > peak) peak = wealth;
    maximumDrawdown = Math.min(maximumDrawdown, wealth / peak - 1);
  }
  return {
    startDate: prices[0].date,
    endDate: prices.at(-1).date,
    targetBars: prices.length,
    intervals: prices.length - 1,
    calendarDays: days,
    calendarYears: years,
    terminalWealth,
    totalReturn: terminalWealth - 1,
    cagr: terminalWealth ** (1 / years) - 1,
    annualizedLogReturn: Math.log(terminalWealth) / years,
    annualizedVolatility,
    sharpe,
    maximumDrawdown,
  };
}

function computePerformanceMetrics(equityRows, annualization = 252) {
  if (!Array.isArray(equityRows) || equityRows.length < 2) throw new Error('at least two equity rows are required');
  const prices = equityRows.map(row => ({ date: row.date, close: row.wealth }));
  validatePrices(prices);
  const returns = [];
  for (let index = 1; index < equityRows.length; index++) returns.push(equityRows[index].wealth / equityRows[index - 1].wealth - 1);
  const summary = summarizePath({
    prices,
    returns,
    wealthPath: equityRows.map(row => row.wealth),
    annualization,
    terminalWealth: equityRows.at(-1).wealth,
  });
  return { ...summary, maxDrawdown: summary.maximumDrawdown };
}

function simulateStrategy(input, legacyOptions = null) {
  let prices;
  let scoreMap;
  let fear;
  let greed;
  let cost;
  let annualization;
  let initialPosition;
  if (Array.isArray(input)) {
    prices = input.map(row => ({ date: row.date, close: row.close }));
    scoreMap = new Map(input.filter(row => Number.isFinite(row.score)).map(row => [row.date, row.score]));
    const options = legacyOptions || {};
    fear = options.buyBoundary;
    greed = options.sellBoundary;
    cost = options.cost == null ? 0 : options.cost;
    annualization = options.annualization || 252;
    initialPosition = options.initialPosition == null ? 1 : options.initialPosition;
  } else {
    ({ prices, scoreMap, fear, greed, cost = 0, annualization = 252, initialPosition = 'long' } = input || {});
  }
  validatePrices(prices);
  if (!(scoreMap instanceof Map)) scoreMap = new Map(Object.entries(scoreMap || {}));
  if (![0, 1].includes(Number(initialPosition)) && !['long', 'cash'].includes(initialPosition)) throw new Error('initialPosition must be long/1 or cash/0');
  if (!(cost >= 0 && cost < 1)) throw new Error('cost must be in [0,1)');
  let position = initialPosition === 'cash' || initialPosition === 0 ? 0 : 1;
  let wealth = 1;
  let cashCycleOpen = false;
  let signalBuys = 0;
  let signalSells = 0;
  let filledBuys = 0;
  let filledSells = 0;
  let completedCashCycles = 0;
  let unfilledTerminalOrders = 0;
  let longIntervals = 0;
  let currentRunPosition = null;
  let currentRun = 0;
  let longestInvestedRunBars = 0;
  let longestCashRunBars = 0;
  const returns = [];
  const wealthPath = [1];
  const wealthCurve = [{ date: prices[0].date, wealth: 1, position }];
  const events = [];

  function addRun(state) {
    if (currentRunPosition === state) currentRun++;
    else { currentRunPosition = state; currentRun = 1; }
    if (state === 1) longestInvestedRunBars = Math.max(longestInvestedRunBars, currentRun);
    else longestCashRunBars = Math.max(longestCashRunBars, currentRun);
  }

  for (let index = 0; index < prices.length - 1; index++) {
    const start = prices[index];
    const end = prices[index + 1];
    const heldPosition = position;
    addRun(heldPosition);
    if (heldPosition === 1) longIntervals++;
    const decision = queuedDecision(position, scoreMap.get(start.date), fear, greed);
    if (decision && decision.side === 'buy') signalBuys++;
    if (decision && decision.side === 'sell') signalSells++;
    let factor = heldPosition === 1 ? end.close / start.close : 1;
    wealth *= factor;
    if (decision && decision.desiredPosition !== position) {
      wealth *= 1 - cost;
      factor *= 1 - cost;
      position = decision.desiredPosition;
      if (decision.side === 'sell') {
        filledSells++;
        cashCycleOpen = true;
      } else {
        filledBuys++;
        if (cashCycleOpen) completedCashCycles++;
        cashCycleOpen = false;
      }
      events.push({ signalDate: start.date, executionDate: end.date, side: decision.side, executionClose: end.close, displayedInteger: decision.displayedInteger, cost });
    }
    returns.push(factor - 1);
    wealthPath.push(wealth);
    wealthCurve.push({ date: end.date, wealth, position });
  }

  const last = prices.at(-1);
  const terminalDecision = queuedDecision(position, scoreMap.get(last.date), fear, greed);
  if (terminalDecision) {
    unfilledTerminalOrders = 1;
    if (terminalDecision.side === 'buy') signalBuys++;
    else signalSells++;
    events.push({ signalDate: last.date, executionDate: null, side: terminalDecision.side, executionClose: null, displayedInteger: terminalDecision.displayedInteger, cost: 0, unfilled: true });
  }
  const metrics = summarizePath({ prices, returns, wealthPath, annualization, terminalWealth: wealth });
  return {
    ...metrics,
    finalPosition: position === 1 ? 'long' : 'cash',
    terminalPosition: position,
    exposure: longIntervals / (prices.length - 1),
    cashShare: 1 - longIntervals / (prices.length - 1),
    fillCount: filledBuys + filledSells,
    fills: filledBuys + filledSells,
    fillEvents: events.filter(event => !event.unfilled),
    signalBuys,
    signalSells,
    filledBuys,
    filledSells,
    completedCashCycles,
    unfilledTerminalOrders,
    longestInvestedRunBars,
    longestCashRunBars,
    longestInvestedBarRun: longestInvestedRunBars,
    longestCashBarRun: longestCashRunBars,
    totalCostHaircut: 1 - (1 - cost) ** (filledBuys + filledSells),
    wealthCurve,
    events,
  };
}

function benchmarkBuyHold({ prices, annualization = 252 }) {
  validatePrices(prices);
  const returns = [];
  const wealthPath = [1];
  let wealth = 1;
  for (let index = 0; index < prices.length - 1; index++) {
    const factor = prices[index + 1].close / prices[index].close;
    wealth *= factor;
    returns.push(factor - 1);
    wealthPath.push(wealth);
  }
  const summary = summarizePath({ prices, returns, wealthPath, annualization, terminalWealth: wealth });
  const exact = prices.at(-1).close / prices[0].close;
  if (Math.abs(summary.terminalWealth - exact) > 1e-10 * Math.max(1, Math.abs(exact))) throw new Error('buy-and-hold wealth identity failed');
  return summary;
}

function enrichComparison(strategy, benchmark, zeroCostStrategy = strategy) {
  return {
    strategy,
    buyAndHold: benchmark,
    terminalWealthDifference: strategy.terminalWealth - benchmark.terminalWealth,
    terminalWealthRatio: strategy.terminalWealth / benchmark.terminalWealth,
    excessCagr: strategy.cagr - benchmark.cagr,
    annualizedLogReturnExcess: strategy.annualizedLogReturn - benchmark.annualizedLogReturn,
    maximumDrawdownImprovement: strategy.maximumDrawdown - benchmark.maximumDrawdown,
    relativeCostHaircut: 1 - strategy.terminalWealth / zeroCostStrategy.terminalWealth,
    absoluteCostHaircut: zeroCostStrategy.terminalWealth - strategy.terminalWealth,
  };
}

function compactSimulation(result) {
  const { events, fillEvents, wealthCurve, ...summary } = result;
  return summary;
}

function runWindow({ prices, scoreMap, candidate, cost, annualization, initialPosition = 'long', includeDetails = true }) {
  const zero = simulateStrategy({ prices, scoreMap, fear: candidate.fear, greed: candidate.greed, cost: 0, annualization, initialPosition });
  const strategy = cost === 0 ? zero : simulateStrategy({ prices, scoreMap, fear: candidate.fear, greed: candidate.greed, cost, annualization, initialPosition });
  const benchmark = benchmarkBuyHold({ prices, annualization });
  const comparison = enrichComparison(strategy, benchmark, zero);
  if (includeDetails) return comparison;
  return { ...comparison, strategy: compactSimulation(comparison.strategy) };
}

function splitPriceWindows(prices) {
  validatePrices(prices);
  const intervals = prices.length - 1;
  const firstIntervals = Math.floor(intervals / 2);
  if (firstIntervals < 1 || intervals - firstIntervals < 1) throw new Error('both chronological halves need at least one interval');
  return [prices.slice(0, firstIntervals + 1), prices.slice(firstIntervals)];
}

function marketEligiblePrices(market) {
  if (!market || !Array.isArray(market.signals) || market.signals.length <= COMMON_WARMUP_ROWS) throw new Error(`${market && market.key}: insufficient signals`);
  const startDate = market.signals[COMMON_WARMUP_ROWS].date;
  const prices = market.prices.rows.filter(row => row.date >= startDate);
  if (!prices.length || prices[0].date !== startDate) throw new Error(`${market.key}: 21st signal date does not match an exact target close`);
  validatePrices(prices);
  return prices;
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function evaluateGate(stressMarkets, stressCommon, deterministicIntegrityVerified = false) {
  const markets = Object.values(stressMarkets);
  if (markets.length !== 5) throw new Error('historical gate requires exactly five markets');
  const excesses = markets.map(result => result.full.annualizedLogReturnExcess);
  const excessCagrs = markets.map(result => result.full.excessCagr);
  const positiveFullMarkets = markets.filter(result => result.full.terminalWealthDifference > 0).length;
  const positiveHalfCells = markets.reduce((count, result) => count + result.halves.filter(half => half.terminalWealthDifference > 0).length, 0);
  const everyMarketPositiveHalf = markets.every(result => result.halves.some(half => half.terminalWealthDifference > 0));
  const atLeastOneCycleEveryMarket = markets.every(result => result.full.strategy.completedCashCycles >= 1);
  const atLeastTwoCyclesMarkets = markets.filter(result => result.full.strategy.completedCashCycles >= 2).length;
  const drawdownImprovedMarkets = markets.filter(result => result.full.maximumDrawdownImprovement >= 0).length;
  const gates = {
    fullHistoryBreadth: positiveFullMarkets >= 4,
    fullHistoryDistribution: mean(excesses) > 0 && median(excesses) > 0 && Math.min(...excesses) >= -0.01,
    chronologicalHalves: positiveHalfCells >= 7 && everyMarketPositiveHalf,
    commonCalendarAggregate: stressCommon.strategyTerminalWealth > stressCommon.buyAndHoldTerminalWealth,
    adequateCycles: atLeastOneCycleEveryMarket && atLeastTwoCyclesMarkets >= 4,
    drawdownBreadth: drawdownImprovedMarkets >= 3,
    deterministicIntegrity: deterministicIntegrityVerified === true,
  };
  return {
    pass: Object.values(gates).every(Boolean),
    gates,
    diagnostics: {
      positiveFullMarkets,
      positiveHalfCells,
      everyMarketPositiveHalf,
      meanFullAnnualizedLogExcess: mean(excesses),
      medianFullAnnualizedLogExcess: median(excesses),
      worstFullAnnualizedLogExcess: Math.min(...excesses),
      meanFullExcessCagr: mean(excessCagrs),
      medianFullExcessCagr: median(excessCagrs),
      worstFullExcessCagr: Math.min(...excessCagrs),
      atLeastTwoCyclesMarkets,
      drawdownImprovedMarkets,
    },
  };
}

function evaluatePassGate(input) {
  if (!input || !Array.isArray(input.full) || !Array.isArray(input.halves) || !input.common) throw new Error('invalid simplified gate input');
  const positiveFullMarkets = input.full.filter(row => row.strategyTerminalWealth > row.buyHoldTerminalWealth).length;
  const excesses = input.full.map(row => row.annualizedLogExcess);
  const positiveHalfCells = input.halves.filter(row => row.strategyTerminalWealth > row.buyHoldTerminalWealth).length;
  const everyMarketPositiveHalf = input.full.every(fullRow => input.halves.some(row => row.market === fullRow.market && row.strategyTerminalWealth > row.buyHoldTerminalWealth));
  const atLeastOneCycleEveryMarket = input.full.every(row => row.completedCashCycles >= 1);
  const atLeastTwoCyclesMarkets = input.full.filter(row => row.completedCashCycles >= 2).length;
  const drawdownImprovedMarkets = input.full.filter(row => row.strategyMaxDrawdown >= row.buyHoldMaxDrawdown).length;
  const gateEntries = [
    ['fullHistoryBreadth', positiveFullMarkets >= 4],
    ['fullHistoryDistribution', mean(excesses) > 0 && median(excesses) > 0 && Math.min(...excesses) >= -0.01],
    ['chronologicalHalves', positiveHalfCells >= 7 && everyMarketPositiveHalf],
    ['commonCalendarAggregate', input.common.strategyTerminalWealth > input.common.buyHoldTerminalWealth],
    ['adequateCycles', atLeastOneCycleEveryMarket && atLeastTwoCyclesMarkets >= 4],
    ['drawdownBreadth', drawdownImprovedMarkets >= 3],
    ['deterministicIntegrity', input.deterministicReplayVerified === true],
  ];
  const gates = gateEntries.map(([id, passed]) => ({ id, passed }));
  const passed = gates.every(gate => gate.passed);
  return { passed, status: passed ? STATUS_PASS : STATUS_FAIL, gates };
}

function rankingKey(result) {
  const diagnostics = result.gate.diagnostics;
  return [
    result.gate.pass ? 1 : 0,
    diagnostics.positiveFullMarkets,
    diagnostics.positiveHalfCells,
    result.scenarios.stress.common.annualizedLogReturnExcess,
    diagnostics.medianFullExcessCagr,
    diagnostics.meanFullExcessCagr,
    diagnostics.worstFullExcessCagr,
    -result.candidate.declarationOrder,
  ];
}

function compareRanked(left, right) {
  const a = rankingKey(left);
  const b = rankingKey(right);
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return b[index] - a[index];
  }
  return 0;
}

function compareCandidates(left, right) {
  const leftValues = [
    left.pass && left.pass.passed ? 1 : 0,
    left.ranking.positiveFullMarkets,
    left.ranking.positiveHalfCells,
    left.ranking.commonAnnualizedLogExcess,
    left.ranking.medianFullAnnualizedLogExcess,
    left.ranking.meanFullAnnualizedLogExcess,
    left.ranking.worstFullAnnualizedLogExcess,
    -left.declarationOrder,
  ];
  const rightValues = [
    right.pass && right.pass.passed ? 1 : 0,
    right.ranking.positiveFullMarkets,
    right.ranking.positiveHalfCells,
    right.ranking.commonAnnualizedLogExcess,
    right.ranking.medianFullAnnualizedLogExcess,
    right.ranking.meanFullAnnualizedLogExcess,
    right.ranking.worstFullAnnualizedLogExcess,
    -right.declarationOrder,
  ];
  for (let index = 0; index < leftValues.length; index++) {
    if (leftValues[index] !== rightValues[index]) return rightValues[index] - leftValues[index];
  }
  return 0;
}

function rankCandidates(candidates) {
  return candidates.slice().sort(compareCandidates);
}

function fingerprint(value) {
  return sha256Buffer(Buffer.from(canonicalJson(value), 'utf8'));
}

function commonBounds(markets) {
  const starts = markets.map(market => marketEligiblePrices(market)[0].date);
  const ends = markets.map(market => market.prices.rows.at(-1).date);
  const startDate = starts.slice().sort().at(-1);
  const endDate = ends.slice().sort()[0];
  if (startDate >= endDate) throw new Error('invalid common-calendar bounds');
  return { startDate, endDate };
}

function analyzeCandidate(snapshot, candidate, bounds, deterministicIntegrityVerified = false) {
  const marketResultsByScenario = { zero: {}, base: {}, stress: {} };
  const scoreMaps = new Map();
  for (const market of snapshot.markets) scoreMaps.set(market.key, buildCandidateScoreMap(market, candidate));
  for (const scenario of ['zero', 'base', 'stress']) {
    for (const market of snapshot.markets) {
      if (!MARKET_COSTS[market.key]) throw new Error(`${market.key}: missing frozen cost`);
      const scoreMap = scoreMaps.get(market.key);
      const fullPrices = marketEligiblePrices(market);
      const halves = splitPriceWindows(fullPrices);
      const commonPrices = market.prices.rows.filter(row => row.date >= bounds.startDate && row.date <= bounds.endDate);
      validatePrices(commonPrices);
      const cost = MARKET_COSTS[market.key][scenario];
      marketResultsByScenario[scenario][market.key] = {
        targetId: market.targetId,
        annualization: market.annualization,
        cost,
        full: runWindow({ prices: fullPrices, scoreMap, candidate, cost, annualization: market.annualization, includeDetails: false }),
        halves: halves.map(prices => runWindow({ prices, scoreMap, candidate, cost, annualization: market.annualization, includeDetails: false })),
        common: runWindow({ prices: commonPrices, scoreMap, candidate, cost, annualization: market.annualization, includeDetails: false }),
        cashStartFullSensitivity: scenario === 'base'
          ? runWindow({ prices: fullPrices, scoreMap, candidate, cost, annualization: market.annualization, initialPosition: 'cash', includeDetails: false })
          : null,
      };
    }
  }
  const scenarios = {};
  const commonYears = calendarDays(bounds.startDate, bounds.endDate) / YEAR_DAYS;
  for (const scenario of ['zero', 'base', 'stress']) {
    const markets = marketResultsByScenario[scenario];
    const commonValues = Object.values(markets).map(result => result.common);
    const strategyTerminalWealth = mean(commonValues.map(result => result.strategy.terminalWealth));
    const buyAndHoldTerminalWealth = mean(commonValues.map(result => result.buyAndHold.terminalWealth));
    scenarios[scenario] = {
      markets,
      common: {
        startDate: bounds.startDate,
        endDate: bounds.endDate,
        marketCount: commonValues.length,
        strategyTerminalWealth,
        buyAndHoldTerminalWealth,
        terminalWealthDifference: strategyTerminalWealth - buyAndHoldTerminalWealth,
        annualizedLogReturnExcess: Math.log(strategyTerminalWealth / buyAndHoldTerminalWealth) / commonYears,
      },
    };
  }
  const gate = evaluateGate(scenarios.stress.markets, scenarios.stress.common, deterministicIntegrityVerified);
  return { candidate, scenarios, gate };
}

function compactCandidateSummary(result) {
  const full = Object.fromEntries(Object.entries(result.scenarios.stress.markets).map(([key, market]) => [key, {
    strategyTerminalWealth: market.full.strategy.terminalWealth,
    buyAndHoldTerminalWealth: market.full.buyAndHold.terminalWealth,
    annualizedLogReturnExcess: market.full.annualizedLogReturnExcess,
    maximumDrawdownImprovement: market.full.maximumDrawdownImprovement,
    completedCashCycles: market.full.strategy.completedCashCycles,
    positiveHalves: market.halves.filter(half => half.terminalWealthDifference > 0).length,
  }]));
  return {
    id: result.candidate.id,
    declarationOrder: result.candidate.declarationOrder,
    pass: result.gate.pass,
    diagnostics: result.gate.diagnostics,
    failedGates: Object.entries(result.gate.gates).filter(([, passed]) => !passed).map(([name]) => name),
    commonAnnualizedLogReturnExcess: result.scenarios.stress.common.annualizedLogReturnExcess,
    full,
  };
}

function fingerprintAnalysis(results) {
  const payload = {
    schemaVersion: results.schemaVersion,
    status: results.status,
    frozenDesign: results.frozenDesign,
    protocol: results.protocol,
    input: { snapshotSha256: results.input.snapshotSha256 },
    commonBounds: results.commonBounds,
    ranking: results.ranking,
    candidates: results.candidates,
  };
  return sha256Buffer(Buffer.from(canonicalJson(payload), 'utf8'));
}

function analyzeSnapshot(snapshot, inputInfo = {}, options = {}) {
  const protocolState = assertProtocolFrozen();
  if (snapshot.schemaVersion !== schema5.SCHEMA_VERSION) throw new Error(`expected schema-5 input, got ${snapshot.schemaVersion}`);
  if (!Array.isArray(snapshot.markets) || snapshot.markets.length !== 5) throw new Error('schema-6 requires exactly five frozen markets');
  const expectedOrder = ['crypto', 'sweden', 'usa', 'europe', 'global'];
  if (snapshot.markets.map(market => market.key).join(',') !== expectedOrder.join(',')) throw new Error('frozen market order or set drifted');
  const bounds = commonBounds(snapshot.markets);
  const deterministicIntegrityVerified = options.deterministicIntegrityVerified === true;
  const evaluated = FROZEN_CANDIDATES.map(candidate => analyzeCandidate(snapshot, candidate, bounds, deterministicIntegrityVerified));
  const ranked = evaluated.slice().sort(compareRanked);
  const top = ranked[0];
  const canonical = evaluated.find(result => result.candidate.id === 'P_F24_G75_S1');
  const selected = top;
  const status = selected.gate.pass ? STATUS_PASS : STATUS_FAIL;
  const sourceHashes = {
    protocolSha256: sha256File(PROTOCOL_PATH),
    runnerSha256: sha256File(__filename),
    schema5RunnerSha256: sha256File(path.join(__dirname, 'fear_greed_v2_validation.js')),
    schema4MathSha256: sha256File(path.join(__dirname, 'fear_greed_model_search.js')),
    marketfgSha256: sha256File(path.join(__dirname, '..', 'marketfg.js')),
  };
  const results = {
    schemaVersion: SCHEMA_VERSION,
    purpose: 'direct Extreme Fear buy / Extreme Greed sell strategy versus matched buy-and-hold',
    interpretation: 'bounded retrospective development only; not prospective validation or investment advice',
    status,
    analysisInputCreatedAt: snapshot.createdAt,
    frozenDesign: FROZEN_DESIGN,
    protocol: { ...protocolState, ...sourceHashes },
    input: {
      snapshotPath: inputInfo.file || null,
      snapshotSha256: inputInfo.sha256 || REQUIRED_SNAPSHOT_SHA256,
      checksumVerified: inputInfo.checksumVerified === true,
      snapshotCreatedAt: snapshot.createdAt,
      lastCompletedBar: bounds.endDate,
    },
    commonBounds: bounds,
    ranking: ranked.map((result, rank) => ({ rank: rank + 1, ...compactCandidateSummary(result) })),
    candidates: evaluated,
    canonicalProduction: canonical,
    selected,
  };
  results.analysisFingerprintSha256 = fingerprintAnalysis(results);
  return results;
}

function pct(value, digits = 2) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : 'n/a';
}

function wealth(value) {
  return Number.isFinite(value) ? value.toFixed(3) : 'n/a';
}

function markdownReport(results) {
  const chosen = results.selected;
  const canonical = results.canonicalProduction;
  const lines = [
    '# Direct Extreme Fear / Extreme Greed backtest',
    '',
    `**Status:** ${results.status}`,
    '',
    `Frozen snapshot: \`${results.input.snapshotSha256}\` through ${results.input.lastCompletedBar}.`,
    '',
    'This is a bounded retrospective strategy search, not independent proof of future reliability.',
    '',
    '## Verdict',
    '',
    chosen.gate.pass
      ? `The shared rule \`${chosen.candidate.id}\` passed every predeclared historical robustness gate under stress costs.`
      : `None of the 31 shared rules passed every predeclared historical robustness gate. The top-ranked failure was \`${chosen.candidate.id}\`.`,
    '',
    `Failed gates for the top-ranked rule: ${Object.entries(chosen.gate.gates).filter(([, pass]) => !pass).map(([key]) => `\`${key}\``).join(', ') || 'none'}.`,
    '',
    '## Top-ranked shared rule: base-cost full histories (primary table)',
    '',
    '| Market | Strategy wealth | Buy & hold wealth | Annualized log excess | Max-DD improvement | Cash cycles | Positive halves |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const [key, market] of Object.entries(chosen.scenarios.base.markets)) {
    lines.push(`| ${key} | ${wealth(market.full.strategy.terminalWealth)} | ${wealth(market.full.buyAndHold.terminalWealth)} | ${pct(market.full.annualizedLogReturnExcess)} | ${pct(market.full.maximumDrawdownImprovement)} | ${market.full.strategy.completedCashCycles} | ${market.halves.filter(half => half.terminalWealthDifference > 0).length}/2 |`);
  }
  lines.push(
    '',
    '## Top-ranked shared rule: stress-cost gate',
    '',
    '| Market | Strategy wealth | Buy & hold wealth | Annualized log excess | Max-DD improvement | Cash cycles | Positive halves |',
    '|---|---:|---:|---:|---:|---:|---:|',
  );
  for (const [key, market] of Object.entries(chosen.scenarios.stress.markets)) {
    lines.push(`| ${key} | ${wealth(market.full.strategy.terminalWealth)} | ${wealth(market.full.buyAndHold.terminalWealth)} | ${pct(market.full.annualizedLogReturnExcess)} | ${pct(market.full.maximumDrawdownImprovement)} | ${market.full.strategy.completedCashCycles} | ${market.halves.filter(half => half.terminalWealthDifference > 0).length}/2 |`);
  }
  lines.push(
    '',
    `Common-window equal-capital wealth: strategy ${wealth(chosen.scenarios.stress.common.strategyTerminalWealth)} vs buy-and-hold ${wealth(chosen.scenarios.stress.common.buyAndHoldTerminalWealth)} (${pct(chosen.scenarios.stress.common.annualizedLogReturnExcess)} annualized log excess).`,
    '',
    '## Current production rule (P_F24_G75_S1): stress-cost full histories',
    '',
    '| Market | Strategy wealth | Buy & hold wealth | Annualized log excess | Max-DD improvement | Cash cycles |',
    '|---|---:|---:|---:|---:|---:|',
  );
  for (const [key, market] of Object.entries(canonical.scenarios.stress.markets)) {
    lines.push(`| ${key} | ${wealth(market.full.strategy.terminalWealth)} | ${wealth(market.full.buyAndHold.terminalWealth)} | ${pct(market.full.annualizedLogReturnExcess)} | ${pct(market.full.maximumDrawdownImprovement)} | ${market.full.strategy.completedCashCycles} |`);
  }
  lines.push(
    '',
    '## Cash-until-first-Fear sensitivity for the top rule (base costs)',
    '',
    '| Market | Cash-start strategy wealth | Buy & hold wealth | Annualized log excess |',
    '|---|---:|---:|---:|',
  );
  for (const [key, market] of Object.entries(chosen.scenarios.base.markets)) {
    const sensitivity = market.cashStartFullSensitivity;
    lines.push(`| ${key} | ${wealth(sensitivity.strategy.terminalWealth)} | ${wealth(sensitivity.buyAndHold.terminalWealth)} | ${pct(sensitivity.annualizedLogReturnExcess)} |`);
  }
  lines.push(
    '',
    '## All 31 frozen candidates (stress-cost ranking)',
    '',
    '| Rank | Candidate | Passed | Full wins | Positive halves | Mean excess CAGR | Worst excess CAGR | Failed gates |',
    '|---:|---|:---:|---:|---:|---:|---:|---|',
  );
  for (const row of results.ranking) {
    lines.push(`| ${row.rank} | ${row.id} | ${row.pass ? 'yes' : 'no'} | ${row.diagnostics.positiveFullMarkets}/5 | ${row.diagnostics.positiveHalfCells}/10 | ${pct(row.diagnostics.meanFullExcessCagr)} | ${pct(row.diagnostics.worstFullExcessCagr)} | ${row.failedGates.join(', ') || 'none'} |`);
  }
  lines.push(
    '',
    '## Method boundary',
    '',
    '- A score observed at close t can trade only at the next target close.',
    '- Primary starts already invested; cash earns 0%; terminal positions are marked to market.',
    '- Stress one-way costs are 0.75% for Crypto and 0.25% for the four equity tabs.',
    '- The same candidate is used in every market. No market-specific winner is substituted.',
    '- Taxes, FX, variable slippage and cash interest are excluded.',
    '- Sweden/Europe index conventions, SPY/ACWI ETF proxies and the synthetic seven-coin Crypto basket are not economically homogeneous.',
    '',
    `Analysis fingerprint: \`${results.analysisFingerprintSha256}\``,
    '',
  );
  return lines.join('\n');
}

function runStamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

function writeWithSidecar(file, content) {
  fs.writeFileSync(file, content, 'utf8');
  const sha256 = sha256File(file);
  const checksumFile = `${file}.sha256`;
  fs.writeFileSync(checksumFile, `${sha256}  ${path.basename(file)}\n`, 'utf8');
  return { file: path.resolve(file), checksumFile: path.resolve(checksumFile), sha256 };
}

function writeResults(results, outDir, stamp = runStamp()) {
  fs.mkdirSync(outDir, { recursive: true });
  const json = writeWithSidecar(path.join(outDir, `fear-greed-extreme-strategy-${stamp}.json`), canonicalJson(results));
  const report = writeWithSidecar(path.join(outDir, `fear-greed-extreme-strategy-${stamp}.md`), `${markdownReport(results)}\n`);
  return { json, report };
}

function usage() {
  return 'node research/fear_greed_extreme_strategy.js [--snapshot <schema5-input.json>] [--out-dir <directory>]';
}

function parseArgs(argv) {
  const args = { snapshot: DEFAULT_SNAPSHOT_PATH, outDir: path.join(__dirname, 'local-artifacts', 'extreme-strategy') };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--snapshot') args.snapshot = argv[++index];
    else if (token === '--out-dir') args.outDir = argv[++index];
    else if (token === '--help' || token === '-h') args.help = true;
    else throw new Error(`unknown argument: ${token}`);
  }
  if (!args.help && (!args.snapshot || !args.outDir)) throw new Error(usage());
  return args;
}

function withNetworkDisabled(callback) {
  if (typeof callback !== 'function') throw new Error('withNetworkDisabled requires a callback');
  const originalFetch = global.fetch;
  global.fetch = () => { throw new Error('schema-6 replay forbids all network access'); };
  try { return callback(); }
  finally { global.fetch = originalFetch; }
}

function verifyDeterministicResults(factory) {
  if (typeof factory !== 'function') throw new Error('deterministic replay verifier requires a result factory');
  const first = factory();
  const second = factory();
  if (!first || !second || first.analysisFingerprintSha256 !== second.analysisFingerprintSha256 || canonicalJson(first) !== canonicalJson(second)) {
    throw new Error('schema-6 deterministic replay verification failed');
  }
  return first;
}

function runStudy(args, runtime = {}) {
  return withNetworkDisabled(() => {
    assertProtocolFrozen();
    const snapshotPath = path.resolve(args.snapshot || DEFAULT_SNAPSHOT_PATH);
    const inputInfo = schema5.readSnapshot(snapshotPath);
    if (inputInfo.sha256 !== REQUIRED_SNAPSHOT_SHA256) throw new Error(`schema-6 requires snapshot ${REQUIRED_SNAPSHOT_SHA256}, got ${inputInfo.sha256}`);
    const results = verifyDeterministicResults(() => analyzeSnapshot(inputInfo.snapshot, inputInfo, { deterministicIntegrityVerified: true }));
    const outputs = writeResults(results, path.resolve(args.outDir), runtime.stamp || runStamp(runtime.now || new Date()));
    return { execution: { networkUsed: false, replay: true, deterministicReplayVerified: true }, inputInfo, results, outputs };
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage()); return; }
  const completed = runStudy(args);
  console.log(JSON.stringify({
    status: completed.results.status,
    selectedCandidate: completed.results.selected.candidate.id,
    selectedPass: completed.results.selected.gate.pass,
    canonicalProductionPass: completed.results.canonicalProduction.gate.pass,
    analysisFingerprintSha256: completed.results.analysisFingerprintSha256,
    input: { file: completed.inputInfo.file, sha256: completed.inputInfo.sha256, checksumVerified: completed.inputInfo.checksumVerified },
    outputs: completed.outputs,
  }, null, 2));
}

module.exports = {
  SCHEMA_VERSION,
  PROTOCOL_PATH,
  REQUIRED_PROTOCOL_MARKER,
  REQUIRED_PROTOCOL_FREEZE_AT,
  REQUIRED_PROTOCOL_SHA256,
  REQUIRED_SNAPSHOT_SHA256,
  DEFAULT_SNAPSHOT_PATH,
  YEAR_DAYS,
  COMMON_WARMUP_ROWS,
  STATUS_PASS,
  STATUS_FAIL,
  MARKET_COSTS,
  FROZEN_DESIGN,
  buildCandidates,
  productionRound1,
  productionDisplayInteger: displayedInteger,
  displayedInteger,
  classifyDecision,
  trailingMeanScoreSeries,
  buildCandidateScores,
  buildCandidateScoreMap,
  buildAlignedMarketRows,
  queuedDecision,
  summarizePath,
  computePerformanceMetrics,
  simulateStrategy,
  benchmarkBuyHold,
  enrichComparison,
  runWindow,
  splitPriceWindows,
  marketEligiblePrices,
  evaluateGate,
  evaluatePassGate,
  rankingKey,
  compareRanked,
  compareCandidates,
  rankCandidates,
  commonBounds,
  analyzeCandidate,
  analyzeSnapshot,
  compactCandidateSummary,
  fingerprintAnalysis,
  fingerprint,
  canonicalJson,
  markdownReport,
  parseProtocolState,
  assertProtocolFrozen,
  parseArgs,
  withNetworkDisabled,
  verifyDeterministicResults,
  writeWithSidecar,
  writeResults,
  runStudy,
  main,
};

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  }
}
