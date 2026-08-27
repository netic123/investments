'use strict';

// Schema 8: one frozen, network-free, trend-confirmed Extreme Fear / Extreme
// Greed strategy. This file contains no candidate search or optimization.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const schema5 = require('./fear_greed_v2_validation');

const SCHEMA_VERSION = 8;
const PROTOCOL_PATH = path.join(__dirname, 'FEAR_GREED_TREND_CONFIRM_PROTOCOL.md');
const REQUIRED_PROTOCOL_MARKER = 'FROZEN_SCHEMA8_TREND_CONFIRM_V1';
const REQUIRED_PROTOCOL_FREEZE_AT = '2026-08-25T16:35:00.861Z';
const REQUIRED_PROTOCOL_SHA256 = '5028d05091a9587748f3aeba203221a3825d3dabcf400dc5dd854706e7b42943';
const REQUIRED_RUNNER_NORMALIZED_SHA256 = '4fc79435f90d6dabfb90fa8cf534bcd07cfd700ad493a80b099ab417c1331624';
const REQUIRED_SNAPSHOT_SHA256 = 'ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d';
const DEFAULT_SNAPSHOT_PATH = path.join(__dirname, 'local-artifacts', 'v2-validation-final', 'inputs', 'fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json');
const STRATEGY_ID = 'EFG90_TREND12M_CASH_50BP';
const EXTREME_FEAR_MAX = 24;
const EXTREME_GREED_MIN = 75;
const ARM_CALENDAR_DAYS = 90;
const TREND_CALENDAR_DAYS = 365;
const REFERENCE_MAX_STALENESS_DAYS = 7;
const ONE_WAY_COST = 0.005;
const YEAR_DAYS = 365.2425;
const COMMON_ANNUALIZATION = 252;
const STATUS_PASS = 'RETROSPECTIVE_EXPLORATORY_GATE_PASS';
const STATUS_FAIL = 'RETROSPECTIVE_EXPLORATORY_GATE_FAIL';
const EXPECTED_MARKET_ORDER = Object.freeze(['crypto', 'sweden', 'usa', 'europe', 'global']);

const FROZEN_DESIGN = deepFreeze({
  schemaVersion: SCHEMA_VERSION,
  strategyId: STRATEGY_ID,
  candidateCount: 1,
  marketOrder: EXPECTED_MARKET_ORDER,
  initialState: 'cash',
  initialWealth: 1,
  fearMaximumInclusive: EXTREME_FEAR_MAX,
  greedMinimumInclusive: EXTREME_GREED_MIN,
  armCalendarDaysInclusive: ARM_CALENDAR_DAYS,
  trend: {
    form: 'log(P_t / P_ref)',
    anniversaryCalendarDays: TREND_CALENDAR_DAYS,
    referenceSelection: 'latest completed target close on or before anniversary',
    maximumReferenceStalenessCalendarDaysInclusive: REFERENCE_MAX_STALENESS_DAYS,
    bullish: 'strictly greater than zero',
    bearish: 'strictly less than zero',
    exactZero: 'neutral',
  },
  execution: {
    lagCompletedTargetBars: 1,
    queuedOrderCancellable: false,
    oldPositionEarnsSignalToExecutionReturn: true,
    executionBarSignalSkipped: true,
    unfilledTerminalOrder: true,
    forcedTerminalLiquidation: false,
  },
  cost: {
    oneWay: ONE_WAY_COST,
    buyWealthFactor: 1 / (1 + ONE_WAY_COST),
    sellWealthFactor: 1 - ONE_WAY_COST,
    benchmarkInitialOrTerminalCost: 0,
  },
  cashAnnualReturn: 0,
  maximumGrossExposure: 1,
  leverage: false,
  shorting: false,
  benchmark: 'frictionless matched buy-and-hold from the same window start close',
  halfSplit: 'floor(N/2) intervals in first independent cash-start half; remainder in second',
  commonCalendar: 'intersection of five eligible target dates; own-market execution between exact shared endpoints; equal-capital no-rebalance aggregate sampled on intersection',
  calendarYearDays: YEAR_DAYS,
  commonAnnualization: COMMON_ANNUALIZATION,
  gate: {
    fullHistoryWinsMinimum: 4,
    halfCellWinsMinimum: 7,
    positiveCommonCalendarExcess: true,
    marketsWithCompletedBuySellCycleMinimum: 4,
    marketsWithNoWorseMaximumDrawdownMinimum: 3,
    minimumFullHistoryTerminalWealthRatio: 0.8,
    deterministicHashReplayRequired: true,
  },
  statusBoundary: [STATUS_PASS, STATUS_FAIL],
  interpretation: 'retrospective exploratory only; no confirmatory or reliability claim',
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
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('canonical JSON cannot contain non-finite numbers');
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function normalizedRunnerSource(source = fs.readFileSync(__filename, 'utf8')) {
  const names = ['REQUIRED_PROTOCOL_SHA256', 'REQUIRED_RUNNER_NORMALIZED_SHA256'];
  let normalized = source;
  for (const name of names) {
    const pattern = new RegExp(`(const ${name} = ')[^']+('; )?`);
    const direct = new RegExp(`const ${name} = '[^']+';`);
    if (!direct.test(normalized)) throw new Error(`runner hash literal missing: ${name}`);
    normalized = normalized.replace(direct, `const ${name} = '${'0'.repeat(64)}';`);
  }
  return normalized;
}

function normalizedRunnerSha256(source = fs.readFileSync(__filename, 'utf8')) {
  return sha256Buffer(Buffer.from(normalizedRunnerSource(source), 'utf8'));
}

function parseProtocolState(text = fs.readFileSync(PROTOCOL_PATH, 'utf8')) {
  const marker = /<!--\s*SCHEMA8_FREEZE_MARKER:\s*([^\s]+)\s*-->/.exec(text);
  const frozenAt = /<!--\s*SCHEMA8_FREEZE_AT:\s*([^\s]+)\s*-->/.exec(text);
  const runner = /<!--\s*SCHEMA8_RUNNER_NORMALIZED_SHA256:\s*([^\s]+)\s*-->/.exec(text);
  if (!marker || !frozenAt || !runner) throw new Error('schema-8 protocol freeze identity is incomplete');
  return { marker: marker[1], frozenAt: frozenAt[1], runnerNormalizedSha256: runner[1] };
}

function requireIsoTimestamp(value, label) {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) throw new Error(`${label} is not exact ISO UTC`);
  return milliseconds;
}

function assertProtocolFrozen(state = parseProtocolState()) {
  if (state.marker !== REQUIRED_PROTOCOL_MARKER || state.frozenAt !== REQUIRED_PROTOCOL_FREEZE_AT ||
      state.runnerNormalizedSha256 !== REQUIRED_RUNNER_NORMALIZED_SHA256) {
    throw new Error(`schema-8 protocol is not the exact frozen design: ${JSON.stringify(state)}`);
  }
  requireIsoTimestamp(state.frozenAt, 'schema-8 freezeAt');
  const protocolSha256 = sha256File(PROTOCOL_PATH);
  if (protocolSha256 !== REQUIRED_PROTOCOL_SHA256) {
    throw new Error(`schema-8 protocol hash mismatch: expected ${REQUIRED_PROTOCOL_SHA256}, got ${protocolSha256}`);
  }
  const runnerNormalizedSha256 = normalizedRunnerSha256();
  if (runnerNormalizedSha256 !== REQUIRED_RUNNER_NORMALIZED_SHA256) {
    throw new Error(`schema-8 normalized runner hash mismatch: expected ${REQUIRED_RUNNER_NORMALIZED_SHA256}, got ${runnerNormalizedSha256}`);
  }
  return { ...state, protocolSha256, runnerNormalizedSha256 };
}

function parseIsoDate(date, label = 'date') {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${label} is not YYYY-MM-DD`);
  const milliseconds = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== date) throw new Error(`${label} is not a real UTC date`);
  return milliseconds;
}

function addCalendarDays(date, days) {
  if (!Number.isInteger(days)) throw new Error('calendar-day offset must be an integer');
  return new Date(parseIsoDate(date) + days * 86400000).toISOString().slice(0, 10);
}

function calendarDays(firstDate, lastDate) {
  const days = (parseIsoDate(lastDate, 'lastDate') - parseIsoDate(firstDate, 'firstDate')) / 86400000;
  if (!(days > 0)) throw new Error(`date span must be positive: ${firstDate}..${lastDate}`);
  return days;
}

function validatePrices(prices, label = 'prices') {
  if (!Array.isArray(prices) || prices.length < 2) throw new Error(`${label} requires at least two target closes`);
  let previous = '';
  for (const row of prices) {
    if (!row || typeof row.date !== 'string' || (previous && row.date <= previous) || !(Number(row.close) > 0)) {
      throw new Error(`${label} must contain strictly ordered positive closes`);
    }
    parseIsoDate(row.date, `${label} date`);
    previous = row.date;
  }
  return prices;
}

function buildScoreMap(signals) {
  if (!Array.isArray(signals)) throw new Error('signals must be an array');
  const map = new Map();
  let previous = '';
  for (const row of signals) {
    if (!row || (previous && row.date <= previous) || !Number.isFinite(row.publishedScore) || row.publishedScore < 0 || row.publishedScore > 100) {
      throw new Error('signals must be strictly ordered finite 0..100 published scores');
    }
    parseIsoDate(row.date, 'signal date');
    map.set(row.date, row.publishedScore);
    previous = row.date;
  }
  return map;
}

function buildTrendMap(prices) {
  validatePrices(prices);
  const map = new Map();
  const milliseconds = prices.map(row => parseIsoDate(row.date));
  let referenceIndex = -1;
  for (let index = 0; index < prices.length; index++) {
    const anniversary = milliseconds[index] - TREND_CALENDAR_DAYS * 86400000;
    while (referenceIndex + 1 < index && milliseconds[referenceIndex + 1] <= anniversary) referenceIndex++;
    if (referenceIndex < 0) continue;
    const stalenessDays = (anniversary - milliseconds[referenceIndex]) / 86400000;
    if (stalenessDays < 0 || stalenessDays > REFERENCE_MAX_STALENESS_DAYS) continue;
    const trend = Math.log(prices[index].close / prices[referenceIndex].close);
    if (!Number.isFinite(trend)) throw new Error(`${prices[index].date}: non-finite trend`);
    map.set(prices[index].date, {
      date: prices[index].date,
      close: prices[index].close,
      anniversaryDate: new Date(anniversary).toISOString().slice(0, 10),
      referenceDate: prices[referenceIndex].date,
      referenceClose: prices[referenceIndex].close,
      referenceStalenessCalendarDays: stalenessDays,
      trend,
      direction: trend > 0 ? 'bullish' : trend < 0 ? 'bearish' : 'neutral',
    });
  }
  return map;
}

function firstEligibleDecisionDate(market, trendMap = buildTrendMap(market.prices.rows)) {
  const targetDates = new Set(market.prices.rows.map(row => row.date));
  const row = market.signals.find(signal => targetDates.has(signal.date) && trendMap.has(signal.date));
  if (!row) throw new Error(`${market.key}: no signal has a valid 12-month trend reference`);
  return row.date;
}

function eligiblePrices(market, trendMap = buildTrendMap(market.prices.rows)) {
  const startDate = firstEligibleDecisionDate(market, trendMap);
  const rows = market.prices.rows.filter(row => row.date >= startDate);
  validatePrices(rows, `${market.key} eligible prices`);
  if (rows[0].date !== startDate) throw new Error(`${market.key}: first eligible decision is not an exact target close`);
  return rows;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sampleStandardDeviation(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function summarizeWealthCurve(wealthCurve, annualization) {
  if (!Array.isArray(wealthCurve) || wealthCurve.length < 2) throw new Error('wealth curve requires at least two rows');
  let priorDate = '';
  const returns = [];
  for (let index = 0; index < wealthCurve.length; index++) {
    const row = wealthCurve[index];
    if (!row || (priorDate && row.date <= priorDate) || !(row.wealth > 0)) throw new Error('invalid wealth curve');
    parseIsoDate(row.date, 'wealth date');
    if (index) returns.push(row.wealth / wealthCurve[index - 1].wealth - 1);
    priorDate = row.date;
  }
  const days = calendarDays(wealthCurve[0].date, wealthCurve.at(-1).date);
  const years = days / YEAR_DAYS;
  const terminalWealth = wealthCurve.at(-1).wealth;
  const deviation = sampleStandardDeviation(returns);
  let peak = wealthCurve[0].wealth;
  let maximumDrawdown = 0;
  for (const row of wealthCurve) {
    peak = Math.max(peak, row.wealth);
    maximumDrawdown = Math.min(maximumDrawdown, row.wealth / peak - 1);
  }
  return {
    startDate: wealthCurve[0].date,
    endDate: wealthCurve.at(-1).date,
    targetBars: wealthCurve.length,
    intervals: wealthCurve.length - 1,
    calendarDays: days,
    calendarYears: years,
    terminalWealth,
    totalReturn: terminalWealth - 1,
    cagr: terminalWealth ** (1 / years) - 1,
    annualizedLogReturn: Math.log(terminalWealth) / years,
    annualizedVolatility: deviation == null ? null : deviation * Math.sqrt(annualization),
    maximumDrawdown,
  };
}

function simulateStrategy({ prices, scoreMap, trendMap, cost = ONE_WAY_COST, annualization = 252 }) {
  validatePrices(prices);
  if (!(scoreMap instanceof Map) || !(trendMap instanceof Map)) throw new Error('strategy requires score and trend Maps');
  if (!(cost >= 0 && cost < 1)) throw new Error('cost must be in [0,1)');

  let state = 'cash';
  let wealth = 1;
  let arm = null;
  let pending = null;
  let filledBuys = 0;
  let filledSells = 0;
  let queuedBuys = 0;
  let queuedSells = 0;
  let completedBuySellCycles = 0;
  let cycleOpen = false;
  let longIntervals = 0;
  let fearArmObservations = 0;
  let greedArmObservations = 0;
  let armRefreshes = 0;
  let armExpirations = 0;
  let executionBarsSkipped = 0;
  let currentRunState = null;
  let currentRunLength = 0;
  let longestLongIntervalRun = 0;
  let longestCashIntervalRun = 0;
  let cumulativeExecutionCostFactor = 1;
  const wealthCurve = [{ date: prices[0].date, wealth: 1, state }];
  const events = [];
  const armEvents = [];

  function updateRun(heldState) {
    if (heldState === currentRunState) currentRunLength++;
    else { currentRunState = heldState; currentRunLength = 1; }
    if (heldState === 'long') longestLongIntervalRun = Math.max(longestLongIntervalRun, currentRunLength);
    else longestCashIntervalRun = Math.max(longestCashIntervalRun, currentRunLength);
  }

  function processDecision(index) {
    const row = prices[index];
    if (arm && row.date > arm.expiryDate) {
      armEvents.push({ action: 'expired', type: arm.type, date: row.date, triggerDate: arm.triggerDate, expiryDate: arm.expiryDate });
      armExpirations++;
      arm = null;
    }
    const score = scoreMap.get(row.date);
    if (state === 'cash' && Number.isFinite(score) && score <= EXTREME_FEAR_MAX) {
      const refresh = arm && arm.type === 'fear';
      arm = { type: 'fear', triggerDate: row.date, expiryDate: addCalendarDays(row.date, ARM_CALENDAR_DAYS), score };
      fearArmObservations++;
      if (refresh) armRefreshes++;
      armEvents.push({ action: refresh ? 'refreshed' : 'created', ...arm, date: row.date });
    } else if (state === 'long' && Number.isFinite(score) && score >= EXTREME_GREED_MIN) {
      const refresh = arm && arm.type === 'greed';
      arm = { type: 'greed', triggerDate: row.date, expiryDate: addCalendarDays(row.date, ARM_CALENDAR_DAYS), score };
      greedArmObservations++;
      if (refresh) armRefreshes++;
      armEvents.push({ action: refresh ? 'refreshed' : 'created', ...arm, date: row.date });
    }
    const trend = trendMap.get(row.date);
    let side = null;
    if (state === 'cash' && arm && arm.type === 'fear' && trend && trend.trend > 0) side = 'buy';
    if (state === 'long' && arm && arm.type === 'greed' && trend && trend.trend < 0) side = 'sell';
    if (side) {
      pending = {
        side,
        signalDate: row.date,
        scheduledExecutionDate: prices[index + 1] ? prices[index + 1].date : null,
        score: Number.isFinite(score) ? score : null,
        armTriggerDate: arm.triggerDate,
        armExpiryDate: arm.expiryDate,
        trend: trend.trend,
        trendReferenceDate: trend.referenceDate,
        trendReferenceClose: trend.referenceClose,
      };
      if (side === 'buy') queuedBuys++;
      else queuedSells++;
    }
  }

  processDecision(0);
  for (let index = 0; index < prices.length - 1; index++) {
    const start = prices[index];
    const end = prices[index + 1];
    const startingWealth = wealth;
    const heldState = state;
    updateRun(heldState);
    if (heldState === 'long') {
      longIntervals++;
      wealth *= end.close / start.close;
    }
    const order = pending;
    if (order) {
      if (order.scheduledExecutionDate !== end.date) throw new Error('pending order did not execute on the next processed target close');
      const executionCostFactor = order.side === 'buy' ? 1 / (1 + cost) : 1 - cost;
      wealth *= executionCostFactor;
      cumulativeExecutionCostFactor *= executionCostFactor;
      if (order.side === 'buy') {
        if (state !== 'cash') throw new Error('buy filled while not in cash');
        state = 'long';
        filledBuys++;
        cycleOpen = true;
      } else {
        if (state !== 'long') throw new Error('sell filled while not long');
        state = 'cash';
        filledSells++;
        if (cycleOpen) completedBuySellCycles++;
        cycleOpen = false;
      }
      events.push({ ...order, executionDate: end.date, executionClose: end.close, cost, executionCostFactor, unfilled: false });
      pending = null;
      arm = null;
      executionBarsSkipped++;
    } else {
      processDecision(index + 1);
    }
    if (!(wealth > 0) || !Number.isFinite(wealth)) throw new Error(`${end.date}: invalid strategy wealth`);
    wealthCurve.push({
      date: end.date,
      wealth,
      intervalReturn: wealth / startingWealth - 1,
      heldState,
      state,
      pendingSide: pending && pending.side || null,
      activeArm: arm && arm.type || null,
    });
  }
  let unfilledTerminalOrders = 0;
  if (pending) {
    unfilledTerminalOrders = 1;
    events.push({ ...pending, executionDate: null, executionClose: null, cost: 0, executionCostFactor: 1, unfilled: true });
  }
  const metrics = summarizeWealthCurve(wealthCurve, annualization);
  return {
    ...metrics,
    finalState: state,
    exposure: longIntervals / (prices.length - 1),
    cashShare: 1 - longIntervals / (prices.length - 1),
    fearArmObservations,
    greedArmObservations,
    armRefreshes,
    armExpirations,
    queuedBuys,
    queuedSells,
    filledBuys,
    filledSells,
    fillCount: filledBuys + filledSells,
    completedBuySellCycles,
    unfilledTerminalOrders,
    executionBarsSkipped,
    longestLongIntervalRun,
    longestCashIntervalRun,
    cumulativeExecutionCostFactor,
    activeTerminalArm: arm,
    terminalPendingOrder: pending,
    events,
    armEvents,
    wealthCurve,
  };
}

function benchmarkBuyAndHold({ prices, annualization = 252 }) {
  validatePrices(prices);
  const first = prices[0].close;
  const wealthCurve = prices.map(row => ({ date: row.date, wealth: row.close / first }));
  const summary = summarizeWealthCurve(wealthCurve, annualization);
  const identity = prices.at(-1).close / first;
  if (Math.abs(summary.terminalWealth - identity) > 1e-12 * Math.max(1, Math.abs(identity))) throw new Error('buy-and-hold identity failed');
  return { ...summary, wealthCurve };
}

function enrichComparison(strategy, buyAndHold, zeroCostStrategy) {
  const eventIdentity = value => value.events.map(event => [event.side, event.signalDate, event.executionDate, event.unfilled]);
  if (JSON.stringify(eventIdentity(strategy)) !== JSON.stringify(eventIdentity(zeroCostStrategy))) {
    throw new Error('cost changed the frozen signal/event path');
  }
  return {
    strategy,
    buyAndHold,
    terminalWealthDifference: strategy.terminalWealth - buyAndHold.terminalWealth,
    terminalWealthRatio: strategy.terminalWealth / buyAndHold.terminalWealth,
    excessCagr: strategy.cagr - buyAndHold.cagr,
    annualizedLogReturnExcess: strategy.annualizedLogReturn - buyAndHold.annualizedLogReturn,
    annualizedVolatilityDifference: strategy.annualizedVolatility == null || buyAndHold.annualizedVolatility == null
      ? null : strategy.annualizedVolatility - buyAndHold.annualizedVolatility,
    maximumDrawdownImprovement: strategy.maximumDrawdown - buyAndHold.maximumDrawdown,
    relativeCostHaircut: 1 - strategy.terminalWealth / zeroCostStrategy.terminalWealth,
    absoluteCostHaircut: zeroCostStrategy.terminalWealth - strategy.terminalWealth,
  };
}

function runWindow({ prices, scoreMap, trendMap, annualization, cost = ONE_WAY_COST }) {
  const zeroCostStrategy = simulateStrategy({ prices, scoreMap, trendMap, cost: 0, annualization });
  const strategy = cost === 0 ? zeroCostStrategy : simulateStrategy({ prices, scoreMap, trendMap, cost, annualization });
  const buyAndHold = benchmarkBuyAndHold({ prices, annualization });
  return enrichComparison(strategy, buyAndHold, zeroCostStrategy);
}

function splitPriceWindows(prices) {
  validatePrices(prices);
  const intervals = prices.length - 1;
  const firstIntervals = Math.floor(intervals / 2);
  if (firstIntervals < 1 || intervals - firstIntervals < 1) throw new Error('both chronological halves require at least one interval');
  return [prices.slice(0, firstIntervals + 1), prices.slice(firstIntervals)];
}

function prepareMarket(market) {
  const scoreMap = buildScoreMap(market.signals);
  const trendMap = buildTrendMap(market.prices.rows);
  const fullPrices = eligiblePrices(market, trendMap);
  return { market, scoreMap, trendMap, fullPrices, firstEligibleDecisionDate: fullPrices[0].date };
}

function analyzeMarket(prepared) {
  const { market, scoreMap, trendMap, fullPrices } = prepared;
  return {
    key: market.key,
    targetId: market.targetId,
    annualization: market.annualization,
    firstEligibleDecisionDate: fullPrices[0].date,
    lastDate: fullPrices.at(-1).date,
    full: runWindow({ prices: fullPrices, scoreMap, trendMap, annualization: market.annualization }),
    halves: splitPriceWindows(fullPrices).map((prices, index) => ({
      half: index + 1,
      ...runWindow({ prices, scoreMap, trendMap, annualization: market.annualization }),
    })),
  };
}

function intersectSortedDates(dateLists) {
  if (!Array.isArray(dateLists) || !dateLists.length) throw new Error('date intersection requires lists');
  let intersection = new Set(dateLists[0]);
  for (const dates of dateLists.slice(1)) {
    const current = new Set(dates);
    intersection = new Set([...intersection].filter(date => current.has(date)));
  }
  return [...intersection].sort();
}

function aggregateCommonCalendar(preparedMarkets) {
  if (!Array.isArray(preparedMarkets) || preparedMarkets.length !== 5) throw new Error('common calendar requires exactly five prepared markets');
  const commonDates = intersectSortedDates(preparedMarkets.map(item => item.fullPrices.map(row => row.date)));
  if (commonDates.length < 2) throw new Error('common five-market calendar has fewer than two dates');
  const startDate = commonDates[0];
  const endDate = commonDates.at(-1);
  const marketRuns = {};
  for (const prepared of preparedMarkets) {
    const prices = prepared.market.prices.rows.filter(row => row.date >= startDate && row.date <= endDate);
    validatePrices(prices, `${prepared.market.key} common-bound prices`);
    if (prices[0].date !== startDate || prices.at(-1).date !== endDate) throw new Error(`${prepared.market.key}: common endpoints are not exact target bars`);
    marketRuns[prepared.market.key] = runWindow({
      prices,
      scoreMap: prepared.scoreMap,
      trendMap: prepared.trendMap,
      annualization: prepared.market.annualization,
    });
  }
  function sampledAggregate(selector) {
    const maps = Object.values(marketRuns).map(run => new Map(selector(run).wealthCurve.map(row => [row.date, row.wealth])));
    return commonDates.map(date => {
      const values = maps.map(map => map.get(date));
      if (values.some(value => !(value > 0))) throw new Error(`${date}: common-calendar wealth sampling failed`);
      return { date, wealth: mean(values), constituentWealth: values };
    });
  }
  const strategyWealthCurve = sampledAggregate(run => run.strategy);
  const buyAndHoldWealthCurve = sampledAggregate(run => run.buyAndHold);
  const strategy = summarizeWealthCurve(strategyWealthCurve, COMMON_ANNUALIZATION);
  const buyAndHold = summarizeWealthCurve(buyAndHoldWealthCurve, COMMON_ANNUALIZATION);
  const totalTrades = Object.values(marketRuns).reduce((sum, run) => sum + run.strategy.fillCount, 0);
  const totalCompletedCycles = Object.values(marketRuns).reduce((sum, run) => sum + run.strategy.completedBuySellCycles, 0);
  return {
    startDate,
    endDate,
    commonDateCount: commonDates.length,
    commonDates,
    marketRuns,
    strategy: { ...strategy, totalTrades, totalCompletedCycles, wealthCurve: strategyWealthCurve },
    buyAndHold: { ...buyAndHold, wealthCurve: buyAndHoldWealthCurve },
    terminalWealthDifference: strategy.terminalWealth - buyAndHold.terminalWealth,
    terminalWealthRatio: strategy.terminalWealth / buyAndHold.terminalWealth,
    excessCagr: strategy.cagr - buyAndHold.cagr,
    annualizedLogReturnExcess: strategy.annualizedLogReturn - buyAndHold.annualizedLogReturn,
    maximumDrawdownImprovement: strategy.maximumDrawdown - buyAndHold.maximumDrawdown,
    annualizedVolatilityDifference: strategy.annualizedVolatility - buyAndHold.annualizedVolatility,
  };
}

function evaluateGate(markets, commonCalendar, deterministicIntegrityVerified) {
  const values = Object.values(markets);
  if (values.length !== 5) throw new Error('schema-8 gate requires exactly five markets');
  const fullHistoryWins = values.filter(result => result.full.terminalWealthDifference > 0).length;
  const halfCellWins = values.reduce((sum, result) => sum + result.halves.filter(half => half.terminalWealthDifference > 0).length, 0);
  const marketsWithCompletedCycle = values.filter(result => result.full.strategy.completedBuySellCycles >= 1).length;
  const marketsWithNoWorseDrawdown = values.filter(result => result.full.maximumDrawdownImprovement >= 0).length;
  const terminalWealthRatios = values.map(result => result.full.terminalWealthRatio);
  const gates = {
    fullHistoryBreadth: fullHistoryWins >= 4,
    chronologicalHalvesBreadth: halfCellWins >= 7,
    positiveCommonCalendarExcess: commonCalendar.terminalWealthDifference > 0 && commonCalendar.annualizedLogReturnExcess > 0,
    adequateActualCycles: marketsWithCompletedCycle >= 4,
    maximumDrawdownBreadth: marketsWithNoWorseDrawdown >= 3,
    terminalWealthFloor: Math.min(...terminalWealthRatios) >= 0.8,
    deterministicHashReplay: deterministicIntegrityVerified === true,
  };
  return {
    pass: Object.values(gates).every(Boolean),
    gates,
    diagnostics: {
      fullHistoryWins,
      halfCellWins,
      marketsWithCompletedCycle,
      marketsWithNoWorseDrawdown,
      minimumTerminalWealthRatio: Math.min(...terminalWealthRatios),
      commonCalendarTerminalWealthDifference: commonCalendar.terminalWealthDifference,
      commonCalendarAnnualizedLogReturnExcess: commonCalendar.annualizedLogReturnExcess,
    },
  };
}

function currentSourceHashes() {
  return {
    protocolSha256: sha256File(PROTOCOL_PATH),
    runnerSha256: sha256File(__filename),
    runnerNormalizedSha256: normalizedRunnerSha256(),
    schema5RunnerSha256: sha256File(path.join(__dirname, 'fear_greed_v2_validation.js')),
    schema4MathSha256: sha256File(path.join(__dirname, 'fear_greed_model_search.js')),
    marketfgSha256: sha256File(path.join(__dirname, '..', 'marketfg.js')),
    configSha256: sha256File(path.join(__dirname, '..', 'data', 'config.json')),
    nodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
  };
}

function analysisFingerprint(results) {
  const { analysisFingerprintSha256, ...payload } = results;
  return sha256Buffer(Buffer.from(canonicalJson(payload), 'utf8'));
}

function validateFrozenSnapshotIdentity(snapshot, inputInfo) {
  if (!snapshot || snapshot.schemaVersion !== schema5.SCHEMA_VERSION) throw new Error('schema-8 accepts only the validated schema-5 snapshot');
  if (!inputInfo || inputInfo.sha256 !== REQUIRED_SNAPSHOT_SHA256 || inputInfo.checksumVerified !== true) {
    throw new Error(`schema-8 requires checksum-verified snapshot ${REQUIRED_SNAPSHOT_SHA256}`);
  }
  if (!Array.isArray(snapshot.markets) || snapshot.markets.map(market => market.key).join(',') !== EXPECTED_MARKET_ORDER.join(',')) {
    throw new Error('schema-8 exact five-market order/set drifted');
  }
  return snapshot;
}

function analyzeSnapshot(snapshot, inputInfo, options = {}) {
  const protocol = assertProtocolFrozen();
  validateFrozenSnapshotIdentity(snapshot, inputInfo);
  const prepared = snapshot.markets.map(prepareMarket);
  const markets = Object.fromEntries(prepared.map(item => [item.market.key, analyzeMarket(item)]));
  const commonCalendar = aggregateCommonCalendar(prepared);
  const gate = evaluateGate(markets, commonCalendar, options.deterministicIntegrityVerified === true);
  const sourceHashes = currentSourceHashes();
  const results = {
    schemaVersion: SCHEMA_VERSION,
    strategyId: STRATEGY_ID,
    purpose: 'one frozen trend-confirmed Extreme Fear/Extreme Greed long-or-cash comparison with matched buy-and-hold',
    interpretation: 'retrospective exploratory only; the already-viewed history is not a pristine holdout and cannot establish reliability',
    status: gate.pass ? STATUS_PASS : STATUS_FAIL,
    frozenDesign: FROZEN_DESIGN,
    protocol: { marker: protocol.marker, frozenAt: protocol.frozenAt, ...sourceHashes },
    input: {
      snapshotPath: inputInfo.file,
      snapshotSha256: inputInfo.sha256,
      checksumVerified: inputInfo.checksumVerified,
      snapshotCreatedAt: snapshot.createdAt,
      snapshotSourceCode: snapshot.sourceCode,
    },
    markets,
    commonCalendar,
    gate,
  };
  results.analysisFingerprintSha256 = analysisFingerprint(results);
  return results;
}

function verifyDeterministicResults(factory) {
  if (typeof factory !== 'function') throw new Error('deterministic verifier requires a factory');
  const first = factory();
  const second = factory();
  if (first.analysisFingerprintSha256 !== second.analysisFingerprintSha256 || canonicalJson(first) !== canonicalJson(second)) {
    throw new Error('schema-8 repeated offline analysis is not byte-deterministic');
  }
  return first;
}

function pct(value, digits = 2) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : 'n/a';
}

function number(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

function markdownReport(results) {
  const lines = [
    '# Trend-confirmed Extreme Fear / Extreme Greed strategy',
    '',
    `**Status: ${results.status}**`,
    '',
    'This is a predeclared retrospective exploratory result on already-viewed history. It is not an untouched holdout, proof of reliability, or investment advice.',
    '',
    `Rule: cash start; Fear <= ${EXTREME_FEAR_MAX} arms a buy and Greed >= ${EXTREME_GREED_MIN} arms a sale for ${ARM_CALENDAR_DAYS} calendar days; strict 12-month trend confirmation; next-target-close execution; ${pct(ONE_WAY_COST)} one-way cost.`,
    '',
    `Frozen input SHA-256: \`${results.input.snapshotSha256}\`.`,
    '',
    '## Predeclared gates',
    '',
    '| Gate | Result |',
    '|---|:---:|',
  ];
  for (const [key, passed] of Object.entries(results.gate.gates)) lines.push(`| ${key} | ${passed ? 'PASS' : 'FAIL'} |`);
  lines.push(
    '',
    `Full-history wins: ${results.gate.diagnostics.fullHistoryWins}/5; positive halves: ${results.gate.diagnostics.halfCellWins}/10; markets with a completed buy+sell cycle: ${results.gate.diagnostics.marketsWithCompletedCycle}/5; no-worse drawdown: ${results.gate.diagnostics.marketsWithNoWorseDrawdown}/5; worst wealth ratio: ${number(results.gate.diagnostics.minimumTerminalWealthRatio)}.`,
    '',
    '## Full histories',
    '',
    '| Market | Dates | Strategy wealth | B&H wealth | Excess CAGR | Max DD strategy | Max DD B&H | Vol strategy | Vol B&H | Buys | Sells | Cycles |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  );
  for (const [key, market] of Object.entries(results.markets)) {
    const full = market.full;
    lines.push(`| ${key} | ${full.strategy.startDate}..${full.strategy.endDate} | ${number(full.strategy.terminalWealth)} | ${number(full.buyAndHold.terminalWealth)} | ${pct(full.excessCagr)} | ${pct(full.strategy.maximumDrawdown)} | ${pct(full.buyAndHold.maximumDrawdown)} | ${pct(full.strategy.annualizedVolatility)} | ${pct(full.buyAndHold.annualizedVolatility)} | ${full.strategy.filledBuys} | ${full.strategy.filledSells} | ${full.strategy.completedBuySellCycles} |`);
  }
  lines.push(
    '',
    '## Independent chronological halves',
    '',
    '| Market | Half | Dates | Strategy wealth | B&H wealth | Excess CAGR | Max-DD improvement | Vol difference | Trades | Cycles |',
    '|---|---:|---|---:|---:|---:|---:|---:|---:|---:|',
  );
  for (const [key, market] of Object.entries(results.markets)) {
    for (const half of market.halves) {
      lines.push(`| ${key} | ${half.half} | ${half.strategy.startDate}..${half.strategy.endDate} | ${number(half.strategy.terminalWealth)} | ${number(half.buyAndHold.terminalWealth)} | ${pct(half.excessCagr)} | ${pct(half.maximumDrawdownImprovement)} | ${pct(half.annualizedVolatilityDifference)} | ${half.strategy.fillCount} | ${half.strategy.completedBuySellCycles} |`);
    }
  }
  const common = results.commonCalendar;
  lines.push(
    '',
    '## Literal common-five-market calendar',
    '',
    `Dates ${common.startDate}..${common.endDate}; ${common.commonDateCount} exact shared target dates.`,
    '',
    `Equal-capital strategy wealth ${number(common.strategy.terminalWealth)} versus B&H ${number(common.buyAndHold.terminalWealth)}; excess CAGR ${pct(common.excessCagr)}; annualized log excess ${pct(common.annualizedLogReturnExcess)}; max-DD improvement ${pct(common.maximumDrawdownImprovement)}; volatility difference ${pct(common.annualizedVolatilityDifference)}; ${common.strategy.totalTrades} fills and ${common.strategy.totalCompletedCycles} completed cycles across five underlying runs.`,
    '',
    '## Boundary',
    '',
    '- Every evaluation window starts in cash; B&H starts invested at the identical close.',
    '- A signal at close t can fill only at the next completed target close, after the old position earns or avoids the full interval return.',
    '- Buy cost is implemented as division by 1.005; sell cost as multiplication by 0.995.',
    '- Cash interest, taxes, fund fees, FX, variable slippage/impact, and synthetic-crypto rebalancing costs are excluded.',
    '- Passing these frozen historical hurdles would remain exploratory because the history was already available before schema 8.',
    '',
    `Analysis fingerprint: \`${results.analysisFingerprintSha256}\``,
    `Runner SHA-256: \`${results.protocol.runnerSha256}\``,
    `Normalized runner SHA-256: \`${results.protocol.runnerNormalizedSha256}\``,
    `Protocol SHA-256: \`${results.protocol.protocolSha256}\``,
    '',
  );
  return lines.join('\n');
}

function runStamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

function writeWithSidecar(file, content) {
  fs.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx' });
  const sha256 = sha256File(file);
  const checksumFile = `${file}.sha256`;
  fs.writeFileSync(checksumFile, `${sha256}  ${path.basename(file)}\n`, { encoding: 'utf8', flag: 'wx' });
  return { file: path.resolve(file), checksumFile: path.resolve(checksumFile), sha256 };
}

function writeResults(results, outDir, stamp = runStamp()) {
  fs.mkdirSync(outDir, { recursive: true });
  const json = writeWithSidecar(path.join(outDir, `fear-greed-trend-confirm-${stamp}.json`), canonicalJson(results));
  const report = writeWithSidecar(path.join(outDir, `fear-greed-trend-confirm-${stamp}.md`), `${markdownReport(results)}\n`);
  return { json, report };
}

function readSavedResult(file) {
  const resolved = path.resolve(file);
  const bytes = fs.readFileSync(resolved);
  const sha256 = sha256Buffer(bytes);
  const checksumFile = `${resolved}.sha256`;
  if (!fs.existsSync(checksumFile)) throw new Error(`saved-result checksum sidecar is missing: ${checksumFile}`);
  const parts = fs.readFileSync(checksumFile, 'utf8').trim().split(/\s+/);
  if (parts[0] !== sha256 || parts[1] !== path.basename(resolved)) throw new Error('saved-result checksum or filename identity mismatch');
  const results = JSON.parse(bytes.toString('utf8'));
  if (results.schemaVersion !== SCHEMA_VERSION || results.strategyId !== STRATEGY_ID) throw new Error('saved result is not schema 8');
  if (canonicalJson(results.frozenDesign) !== canonicalJson(FROZEN_DESIGN)) throw new Error('saved-result frozen design drifted');
  if (!results.input || results.input.snapshotSha256 !== REQUIRED_SNAPSHOT_SHA256) throw new Error('saved-result input hash drifted');
  const sources = currentSourceHashes();
  for (const [key, value] of Object.entries(sources)) {
    if (!results.protocol || results.protocol[key] !== value) throw new Error(`saved-result source hash/runtime drifted: ${key}`);
  }
  if (results.analysisFingerprintSha256 !== analysisFingerprint(results)) throw new Error('saved-result analysis fingerprint mismatch');
  return { results, file: resolved, checksumFile, sha256 };
}

function withNetworkDisabled(callback) {
  if (typeof callback !== 'function') throw new Error('network guard requires a callback');
  const originalFetch = global.fetch;
  global.fetch = () => { throw new Error('schema-8 execution forbids all network access'); };
  try { return callback(); }
  finally { global.fetch = originalFetch; }
}

function usage() {
  return 'node research/fear_greed_trend_confirm.js [--snapshot <schema5-input.json>] [--out-dir <directory>] [--replay <saved-schema8-result.json>]';
}

function parseArgs(argv) {
  const args = {
    snapshot: DEFAULT_SNAPSHOT_PATH,
    outDir: path.join(__dirname, 'local-artifacts', 'trend-confirm'),
    replay: null,
  };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--snapshot') args.snapshot = argv[++index];
    else if (token === '--out-dir') args.outDir = argv[++index];
    else if (token === '--replay') args.replay = argv[++index];
    else if (token === '--help' || token === '-h') args.help = true;
    else throw new Error(`unknown argument: ${token}`);
  }
  if (!args.help && (!args.snapshot || !args.outDir)) throw new Error(usage());
  return args;
}

function runStudy(args, runtime = {}) {
  return withNetworkDisabled(() => {
    assertProtocolFrozen();
    const snapshotPath = path.resolve(args.snapshot || DEFAULT_SNAPSHOT_PATH);
    const inputInfo = schema5.readSnapshot(snapshotPath);
    if (inputInfo.sha256 !== REQUIRED_SNAPSHOT_SHA256) throw new Error(`schema-8 requires snapshot ${REQUIRED_SNAPSHOT_SHA256}, got ${inputInfo.sha256}`);
    const saved = args.replay ? readSavedResult(args.replay) : null;
    const results = verifyDeterministicResults(() => analyzeSnapshot(inputInfo.snapshot, inputInfo, { deterministicIntegrityVerified: true }));
    if (saved && canonicalJson(saved.results) !== canonicalJson(results)) throw new Error('saved replay differs byte-for-byte from fresh offline schema-8 analysis');
    const outputs = writeResults(results, path.resolve(args.outDir), runtime.stamp || runStamp(runtime.now || new Date()));
    return {
      execution: {
        networkUsed: false,
        deterministicInProcessVerified: true,
        savedReplayVerified: !!saved,
        replaySource: saved && saved.file || null,
      },
      inputInfo,
      saved,
      results,
      outputs,
    };
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage()); return; }
  const completed = runStudy(args);
  console.log(JSON.stringify({
    status: completed.results.status,
    gate: completed.results.gate,
    analysisFingerprintSha256: completed.results.analysisFingerprintSha256,
    snapshotSha256: completed.inputInfo.sha256,
    savedReplayVerified: completed.execution.savedReplayVerified,
    outputs: completed.outputs,
  }, null, 2));
}

module.exports = {
  SCHEMA_VERSION,
  PROTOCOL_PATH,
  REQUIRED_PROTOCOL_MARKER,
  REQUIRED_PROTOCOL_FREEZE_AT,
  REQUIRED_PROTOCOL_SHA256,
  REQUIRED_RUNNER_NORMALIZED_SHA256,
  REQUIRED_SNAPSHOT_SHA256,
  DEFAULT_SNAPSHOT_PATH,
  STRATEGY_ID,
  EXTREME_FEAR_MAX,
  EXTREME_GREED_MIN,
  ARM_CALENDAR_DAYS,
  TREND_CALENDAR_DAYS,
  REFERENCE_MAX_STALENESS_DAYS,
  ONE_WAY_COST,
  YEAR_DAYS,
  STATUS_PASS,
  STATUS_FAIL,
  FROZEN_DESIGN,
  sha256Buffer,
  sha256File,
  canonicalize,
  canonicalJson,
  normalizedRunnerSource,
  normalizedRunnerSha256,
  parseProtocolState,
  assertProtocolFrozen,
  parseIsoDate,
  addCalendarDays,
  calendarDays,
  validatePrices,
  buildScoreMap,
  buildTrendMap,
  firstEligibleDecisionDate,
  eligiblePrices,
  summarizeWealthCurve,
  simulateStrategy,
  benchmarkBuyAndHold,
  enrichComparison,
  runWindow,
  splitPriceWindows,
  prepareMarket,
  analyzeMarket,
  intersectSortedDates,
  aggregateCommonCalendar,
  evaluateGate,
  currentSourceHashes,
  analysisFingerprint,
  validateFrozenSnapshotIdentity,
  analyzeSnapshot,
  verifyDeterministicResults,
  markdownReport,
  writeWithSidecar,
  writeResults,
  readSavedResult,
  withNetworkDisabled,
  parseArgs,
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
