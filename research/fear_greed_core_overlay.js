'use strict';

// Schema 9: one frozen, network-free partial core-position overlay.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const schema5 = require('./fear_greed_v2_validation');
const schema8 = require('./fear_greed_trend_confirm');

const SCHEMA_VERSION = 9;
const PROTOCOL_PATH = path.join(__dirname, 'FEAR_GREED_CORE_OVERLAY_PROTOCOL.md');
const REQUIRED_PROTOCOL_MARKER = 'FROZEN_SCHEMA9_CORE_50_STEP_50_V1';
const REQUIRED_PROTOCOL_FREEZE_AT = '2026-08-25T17:10:40.436Z';
const REQUIRED_PROTOCOL_SHA256 = '32ab0b0cda448a723d18e4729e32db3c969e3d89c9a1157dc185c1e14241c4b0';
const REQUIRED_RUNNER_NORMALIZED_SHA256 = '3c493629894265b3bbc0de4aaa2fab85b3a0ae7934c280afe95cf975ca9c2b63';
const REQUIRED_TEST_SHA256 = 'cc04066c384a81f6e88629a83e87962387e76d480194afed685a62ac6f828ec7';
const REQUIRED_SNAPSHOT_SHA256 = 'ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d';
const DEFAULT_SNAPSHOT_PATH = path.join(__dirname, 'local-artifacts', 'v2-validation-final', 'inputs', 'fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json');
const STRATEGY_ID = 'S9_CORE_50_STEP_50';
const EXTREME_FEAR_MAX = 24;
const EXTREME_GREED_MIN = 75;
const FEAR_EXPOSURE = 1.5;
const NEUTRAL_EXPOSURE = 1.0;
const GREED_EXPOSURE = 0.5;
const ONE_WAY_COST = 0.005;
const BORROW_ANNUAL_RATE = 0.05;
const CASH_ANNUAL_RATE = 0;
const YEAR_DAYS = 365.2425;
const COMMON_ANNUALIZATION = 252;
const MAX_PLACEBO_SHIFTS = 199;
const STATUS_PASS = 'RETROSPECTIVE_EXPLORATORY_CANDIDATE';
const STATUS_FAIL = 'NO_CORE_OVERLAY_HISTORICAL_WINNER';
const EXPECTED_MARKET_ORDER = Object.freeze(['crypto', 'sweden', 'usa', 'europe', 'global']);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

const FROZEN_DESIGN = deepFreeze({
  schemaVersion: SCHEMA_VERSION,
  strategyId: STRATEGY_ID,
  candidateCount: 1,
  marketOrder: [...EXPECTED_MARKET_ORDER],
  scoreMapping: {
    extremeFearMaximumInclusive: EXTREME_FEAR_MAX,
    extremeFearExposure: FEAR_EXPOSURE,
    neutralMinimumInclusive: EXTREME_FEAR_MAX + 1,
    neutralMaximumInclusive: EXTREME_GREED_MIN - 1,
    neutralExposure: NEUTRAL_EXPOSURE,
    extremeGreedMinimumInclusive: EXTREME_GREED_MIN,
    extremeGreedExposure: GREED_EXPOSURE,
  },
  execution: {
    initialExposure: NEUTRAL_EXPOSURE,
    lagCompletedTargetBars: 1,
    currentCloseReturnBeforeFill: true,
    currentScoreObservedAfterFill: true,
    repeatedFiniteScoreRebalancesNextClose: true,
    missingScoreQueuesNothing: true,
    terminalOrderUnfilled: true,
    forcedTerminalLiquidation: false,
  },
  financing: {
    positiveCashAnnualRate: CASH_ANNUAL_RATE,
    negativeCashAnnualRate: BORROW_ANNUAL_RATE,
    dayCount: YEAR_DAYS,
    compounding: 'continuous between target closes',
  },
  cost: {
    oneWayOnAbsoluteRiskyNotional: ONE_WAY_COST,
    initialTacticalCost: 0,
    terminalLiquidationCost: 0,
  },
  maximumGrossExposure: FEAR_EXPOSURE,
  minimumGrossExposure: GREED_EXPOSURE,
  shorting: false,
  benchmark: 'frictionless 100% buy-and-hold from the exact same start close',
  placebo: {
    type: 'deterministic evenly-spaced non-zero circular shifts of date-aligned score sequence including missing values',
    maximumShifts: MAX_PLACEBO_SHIFTS,
  },
  gate: {
    fullHistoryWinsMinimum: 4,
    halfCellWinsMinimum: 7,
    positiveCommonCalendarExcess: true,
    marketsWithFearAndGreedFillsMinimum: 4,
    marketsWithNoWorseMaximumDrawdownMinimum: 3,
    minimumFullHistoryTerminalWealthRatio: 0.9,
    marketsAtOrAbovePlacebo90thPercentileMinimum: 3,
    deterministicSavedReplayRequired: true,
  },
  interpretation: 'retrospective exploratory only; already-viewed history cannot establish reliability',
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

function normalizedRunnerSource(source = fs.readFileSync(__filename, 'utf8')) {
  const names = [
    'REQUIRED_PROTOCOL_FREEZE_AT',
    'REQUIRED_PROTOCOL_SHA256',
    'REQUIRED_RUNNER_NORMALIZED_SHA256',
    'REQUIRED_TEST_SHA256',
  ];
  let normalized = source;
  for (const name of names) {
    const direct = new RegExp(`const ${name} = '[^']+';`);
    if (!direct.test(normalized)) throw new Error(`runner identity literal missing: ${name}`);
    normalized = normalized.replace(direct, `const ${name} = '${'0'.repeat(64)}';`);
  }
  return normalized;
}

function normalizedRunnerSha256(source = fs.readFileSync(__filename, 'utf8')) {
  return sha256Buffer(Buffer.from(normalizedRunnerSource(source), 'utf8'));
}

function parseProtocolState(text = fs.readFileSync(PROTOCOL_PATH, 'utf8')) {
  const marker = /<!--\s*SCHEMA9_FREEZE_MARKER:\s*([^\s]+)\s*-->/.exec(text);
  const frozenAt = /<!--\s*SCHEMA9_FREEZE_AT:\s*([^\s]+)\s*-->/.exec(text);
  const runner = /<!--\s*SCHEMA9_RUNNER_NORMALIZED_SHA256:\s*([^\s]+)\s*-->/.exec(text);
  const test = /<!--\s*SCHEMA9_TEST_SHA256:\s*([^\s]+)\s*-->/.exec(text);
  if (!marker || !frozenAt || !runner || !test) throw new Error('schema-9 protocol freeze identity is incomplete');
  return { marker: marker[1], frozenAt: frozenAt[1], runnerNormalizedSha256: runner[1], testSha256: test[1] };
}

function assertExactIsoTimestamp(value, label) {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) throw new Error(`${label} is not exact ISO UTC`);
  return milliseconds;
}

function assertProtocolFrozen(state = parseProtocolState()) {
  if (state.marker !== REQUIRED_PROTOCOL_MARKER ||
      state.frozenAt !== REQUIRED_PROTOCOL_FREEZE_AT ||
      state.runnerNormalizedSha256 !== REQUIRED_RUNNER_NORMALIZED_SHA256 ||
      state.testSha256 !== REQUIRED_TEST_SHA256) {
    throw new Error(`schema-9 protocol is not the exact frozen design: ${JSON.stringify(state)}`);
  }
  assertExactIsoTimestamp(state.frozenAt, 'schema-9 freezeAt');
  const protocolSha256 = sha256File(PROTOCOL_PATH);
  const runnerNormalizedSha256 = normalizedRunnerSha256();
  const testPath = path.join(__dirname, '..', 'test', 'fear_greed_core_overlay.test.js');
  const testSha256 = sha256File(testPath);
  if (protocolSha256 !== REQUIRED_PROTOCOL_SHA256) throw new Error(`schema-9 protocol hash mismatch: expected ${REQUIRED_PROTOCOL_SHA256}, got ${protocolSha256}`);
  if (runnerNormalizedSha256 !== REQUIRED_RUNNER_NORMALIZED_SHA256) throw new Error(`schema-9 normalized runner hash mismatch: expected ${REQUIRED_RUNNER_NORMALIZED_SHA256}, got ${runnerNormalizedSha256}`);
  if (testSha256 !== REQUIRED_TEST_SHA256) throw new Error(`schema-9 test hash mismatch: expected ${REQUIRED_TEST_SHA256}, got ${testSha256}`);
  return { ...state, protocolSha256, runnerNormalizedSha256, testSha256 };
}

function parseIsoDate(date, label = 'date') {
  return schema8.parseIsoDate(date, label);
}

function calendarDays(firstDate, lastDate) {
  return schema8.calendarDays(firstDate, lastDate);
}

function scoreToExposure(score) {
  if (!Number.isFinite(score)) return null;
  if (score < 0 || score > 100) throw new Error(`score outside 0..100: ${score}`);
  if (score <= EXTREME_FEAR_MAX) return FEAR_EXPOSURE;
  if (score >= EXTREME_GREED_MIN) return GREED_EXPOSURE;
  return NEUTRAL_EXPOSURE;
}

function exposureLabel(exposure) {
  if (exposure === FEAR_EXPOSURE) return 'extreme_fear';
  if (exposure === GREED_EXPOSURE) return 'extreme_greed';
  if (exposure === NEUTRAL_EXPOSURE) return 'neutral';
  throw new Error(`unknown target exposure: ${exposure}`);
}

function buildScoreMap(signals) {
  return schema8.buildScoreMap(signals);
}

function eligiblePrices(market) {
  const scoreMap = buildScoreMap(market.signals);
  const prices = schema8.validatePrices(market.prices.rows, `${market.key} target prices`);
  const firstIndex = prices.findIndex(row => scoreMap.has(row.date));
  if (firstIndex < 0 || firstIndex >= prices.length - 1) throw new Error(`${market.key}: fewer than two prices from first exact score date`);
  return prices.slice(firstIndex);
}

function exactRebalance({ wealth, riskyNotional, targetExposure, cost }) {
  if (!(wealth > 0) || !(riskyNotional >= 0) || !(targetExposure >= 0) || !(cost >= 0 && cost < 1)) {
    throw new Error('invalid rebalance inputs');
  }
  const currentExposure = riskyNotional / wealth;
  let postRisky;
  let side = 'none';
  if (Math.abs(currentExposure - targetExposure) <= 1e-14) {
    postRisky = riskyNotional;
  } else if (targetExposure > currentExposure) {
    side = 'buy';
    postRisky = targetExposure * (wealth + cost * riskyNotional) / (1 + targetExposure * cost);
  } else {
    side = 'sell';
    postRisky = targetExposure * (wealth - cost * riskyNotional) / (1 - targetExposure * cost);
  }
  const tradedNotional = Math.abs(postRisky - riskyNotional);
  const costAmount = tradedNotional * cost;
  const postWealth = wealth - costAmount;
  if (!(postWealth > 0) || !(postRisky >= 0)) throw new Error('rebalance caused non-positive NAV or negative risky notional');
  const identityError = Math.abs(postRisky / postWealth - targetExposure);
  if (identityError > 1e-12 * Math.max(1, Math.abs(targetExposure))) {
    throw new Error(`post-cost target identity failed by ${identityError}`);
  }
  return { side, preWealth: wealth, preRiskyNotional: riskyNotional, currentExposure, targetExposure, postWealth, postRisky, postCash: postWealth - postRisky, tradedNotional, costAmount };
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
  const returns = [];
  let priorDate = '';
  let peak = wealthCurve[0].wealth;
  let maximumDrawdown = 0;
  for (let index = 0; index < wealthCurve.length; index++) {
    const row = wealthCurve[index];
    if (!row || (priorDate && row.date <= priorDate) || !(row.wealth >= 0) || !Number.isFinite(row.wealth)) throw new Error('invalid wealth curve');
    parseIsoDate(row.date, 'wealth date');
    if (index) {
      const prior = wealthCurve[index - 1].wealth;
      returns.push(prior > 0 ? row.wealth / prior - 1 : 0);
    }
    peak = Math.max(peak, row.wealth);
    maximumDrawdown = Math.min(maximumDrawdown, peak > 0 ? row.wealth / peak - 1 : -1);
    priorDate = row.date;
  }
  const days = calendarDays(wealthCurve[0].date, wealthCurve.at(-1).date);
  const years = days / YEAR_DAYS;
  const terminalWealth = wealthCurve.at(-1).wealth;
  const deviation = sampleStandardDeviation(returns);
  return {
    startDate: wealthCurve[0].date,
    endDate: wealthCurve.at(-1).date,
    targetBars: wealthCurve.length,
    intervals: wealthCurve.length - 1,
    calendarDays: days,
    calendarYears: years,
    terminalWealth,
    totalReturn: terminalWealth - 1,
    cagr: terminalWealth > 0 ? terminalWealth ** (1 / years) - 1 : -1,
    annualizedLogReturn: terminalWealth > 0 ? Math.log(terminalWealth) / years : null,
    annualizedVolatility: deviation == null ? null : deviation * Math.sqrt(annualization),
    maximumDrawdown,
  };
}

function simulateStrategy({ prices, scoreMap, cost = ONE_WAY_COST, borrowAnnualRate = BORROW_ANNUAL_RATE, cashAnnualRate = CASH_ANNUAL_RATE, annualization = 252 }) {
  schema8.validatePrices(prices);
  if (!(scoreMap instanceof Map)) throw new Error('strategy requires score Map');
  if (!(cost >= 0 && cost < 1) || !(borrowAnnualRate >= 0) || !(cashAnnualRate >= 0)) throw new Error('invalid friction');

  let units = 1 / prices[0].close;
  let cash = 0;
  let wealth = 1;
  let pending = null;
  let bankrupt = false;
  let totalTradedNotional = 0;
  let totalTransactionCost = 0;
  let totalFinancingCost = 0;
  let filledFearTargets = 0;
  let filledGreedTargets = 0;
  let filledNeutralTargets = 0;
  let unfilledTerminalOrders = 0;
  let exposureIntervalSum = 0;
  let exposureIntervalCount = 0;
  const events = [];
  const wealthCurve = [{ date: prices[0].date, wealth, riskyNotional: 1, cash: 0, exposure: 1 }];

  function queueFromScore(index) {
    const score = scoreMap.get(prices[index].date);
    const targetExposure = scoreToExposure(score);
    if (targetExposure == null) return;
    pending = {
      signalDate: prices[index].date,
      scheduledExecutionDate: prices[index + 1] ? prices[index + 1].date : null,
      score,
      targetExposure,
      label: exposureLabel(targetExposure),
    };
  }

  queueFromScore(0);
  for (let index = 0; index < prices.length - 1; index++) {
    const start = prices[index];
    const end = prices[index + 1];
    const startingWealth = wealth;
    if (bankrupt) {
      wealthCurve.push({ date: end.date, wealth: 0, riskyNotional: 0, cash: 0, exposure: null, bankrupt: true });
      continue;
    }

    const startRisky = units * start.close;
    const startExposure = startRisky / wealth;
    exposureIntervalSum += startExposure;
    exposureIntervalCount++;
    const days = calendarDays(start.date, end.date);
    const oldCash = cash;
    const annualRate = cash < 0 ? borrowAnnualRate : cashAnnualRate;
    cash *= Math.exp(annualRate * days / YEAR_DAYS);
    if (oldCash < 0) totalFinancingCost += -(cash - oldCash);
    const riskyNotional = units * end.close;
    wealth = riskyNotional + cash;
    if (!(wealth > 0) || !Number.isFinite(wealth)) {
      bankrupt = true;
      units = 0;
      cash = 0;
      wealth = 0;
      pending = null;
      wealthCurve.push({ date: end.date, wealth, riskyNotional: 0, cash: 0, exposure: null, intervalReturn: -1, bankrupt: true });
      continue;
    }

    if (pending) {
      if (pending.scheduledExecutionDate !== end.date) throw new Error('pending target did not execute at next processed close');
      const fill = exactRebalance({ wealth, riskyNotional, targetExposure: pending.targetExposure, cost });
      wealth = fill.postWealth;
      units = fill.postRisky / end.close;
      cash = fill.postCash;
      totalTradedNotional += fill.tradedNotional;
      totalTransactionCost += fill.costAmount;
      if (pending.label === 'extreme_fear') filledFearTargets++;
      else if (pending.label === 'extreme_greed') filledGreedTargets++;
      else filledNeutralTargets++;
      events.push({ ...pending, executionDate: end.date, executionClose: end.close, ...fill, unfilled: false });
      pending = null;
    }

    const postRisky = units * end.close;
    wealthCurve.push({
      date: end.date,
      wealth,
      riskyNotional: postRisky,
      cash,
      exposure: postRisky / wealth,
      intervalReturn: wealth / startingWealth - 1,
      bankrupt: false,
    });
    queueFromScore(index + 1);
  }

  if (pending) {
    unfilledTerminalOrders = 1;
    events.push({ ...pending, executionDate: null, executionClose: null, tradedNotional: 0, costAmount: 0, unfilled: true });
  }
  const summary = summarizeWealthCurve(wealthCurve, annualization);
  return {
    ...summary,
    bankrupt,
    finalRiskyNotional: bankrupt ? 0 : units * prices.at(-1).close,
    finalCash: cash,
    finalExposure: bankrupt ? null : units * prices.at(-1).close / wealth,
    timeWeightedStartExposure: exposureIntervalCount ? exposureIntervalSum / exposureIntervalCount : null,
    totalTradedNotional,
    totalTransactionCost,
    totalFinancingCost,
    filledFearTargets,
    filledGreedTargets,
    filledNeutralTargets,
    fillCount: filledFearTargets + filledGreedTargets + filledNeutralTargets,
    unfilledTerminalOrders,
    events,
    wealthCurve,
  };
}

function benchmarkBuyAndHold({ prices, annualization = 252 }) {
  const first = prices[0].close;
  const wealthCurve = prices.map(row => ({ date: row.date, wealth: row.close / first }));
  return { ...summarizeWealthCurve(wealthCurve, annualization), wealthCurve };
}

function enrichComparison(strategy, buyAndHold, zeroCostStrategy) {
  const logExcess = strategy.annualizedLogReturn == null ? null : strategy.annualizedLogReturn - buyAndHold.annualizedLogReturn;
  return {
    strategy,
    buyAndHold,
    terminalWealthDifference: strategy.terminalWealth - buyAndHold.terminalWealth,
    terminalWealthRatio: strategy.terminalWealth / buyAndHold.terminalWealth,
    excessCagr: strategy.cagr - buyAndHold.cagr,
    annualizedLogReturnExcess: logExcess,
    annualizedVolatilityDifference: strategy.annualizedVolatility == null || buyAndHold.annualizedVolatility == null ? null : strategy.annualizedVolatility - buyAndHold.annualizedVolatility,
    maximumDrawdownImprovement: strategy.maximumDrawdown - buyAndHold.maximumDrawdown,
    relativeCostHaircut: zeroCostStrategy.terminalWealth > 0 ? 1 - strategy.terminalWealth / zeroCostStrategy.terminalWealth : null,
    absoluteCostHaircut: zeroCostStrategy.terminalWealth - strategy.terminalWealth,
  };
}

function runWindow({ prices, scoreMap, annualization, cost = ONE_WAY_COST }) {
  const zeroCostStrategy = simulateStrategy({ prices, scoreMap, cost: 0, annualization });
  const strategy = cost === 0 ? zeroCostStrategy : simulateStrategy({ prices, scoreMap, cost, annualization });
  const buyAndHold = benchmarkBuyAndHold({ prices, annualization });
  return enrichComparison(strategy, buyAndHold, zeroCostStrategy);
}

function splitPriceWindows(prices) {
  schema8.validatePrices(prices);
  const intervals = prices.length - 1;
  const firstIntervals = Math.floor(intervals / 2);
  if (firstIntervals < 1 || intervals - firstIntervals < 1) throw new Error('both halves require at least one interval');
  return [prices.slice(0, firstIntervals + 1), prices.slice(firstIntervals)];
}

function deterministicShiftOffsets(length, maximum = MAX_PLACEBO_SHIFTS) {
  if (!Number.isInteger(length) || length < 2 || !Number.isInteger(maximum) || maximum < 1) throw new Error('invalid shift dimensions');
  if (length - 1 <= maximum) return Array.from({ length: length - 1 }, (_, index) => index + 1);
  const offsets = new Set();
  for (let rank = 1; rank <= maximum; rank++) {
    const offset = Math.floor(rank * length / (maximum + 1));
    if (offset > 0 && offset < length) offsets.add(offset);
  }
  return [...offsets].sort((a, b) => a - b);
}

function circularShiftScoreMap(prices, scoreMap, offset) {
  const values = prices.map(row => scoreMap.has(row.date) ? scoreMap.get(row.date) : null);
  if (!Number.isInteger(offset) || offset <= 0 || offset >= values.length) throw new Error('invalid circular shift');
  const shifted = new Map();
  for (let index = 0; index < prices.length; index++) {
    const value = values[(index - offset + values.length) % values.length];
    if (Number.isFinite(value)) shifted.set(prices[index].date, value);
  }
  return shifted;
}

function percentileSorted(sorted, probability) {
  if (!sorted.length || probability < 0 || probability > 1) throw new Error('invalid percentile');
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function timingPlacebo({ prices, scoreMap, annualization, actualTerminalWealth }) {
  const offsets = deterministicShiftOffsets(prices.length);
  const rows = offsets.map(offset => {
    const shiftedMap = circularShiftScoreMap(prices, scoreMap, offset);
    const result = simulateStrategy({ prices, scoreMap: shiftedMap, annualization });
    return { offset, terminalWealth: result.terminalWealth, fillCount: result.fillCount, bankrupt: result.bankrupt };
  });
  const terminals = rows.map(row => row.terminalWealth).sort((a, b) => a - b);
  const notExceeding = terminals.filter(value => value <= actualTerminalWealth).length;
  const atLeastActual = terminals.filter(value => value >= actualTerminalWealth).length;
  return {
    shiftCount: rows.length,
    offsets,
    minimumTerminalWealth: terminals[0],
    medianTerminalWealth: percentileSorted(terminals, 0.5),
    percentile90TerminalWealth: percentileSorted(terminals, 0.9),
    maximumTerminalWealth: terminals.at(-1),
    actualTerminalWealth,
    actualPercentile: notExceeding / terminals.length,
    finiteSampleExceedanceFraction: (1 + atLeastActual) / (1 + terminals.length),
    rows,
  };
}

function prepareMarket(market) {
  const scoreMap = buildScoreMap(market.signals);
  const fullPrices = eligiblePrices(market);
  return { market, scoreMap, fullPrices };
}

function analyzeMarket(prepared) {
  const { market, scoreMap, fullPrices } = prepared;
  const full = runWindow({ prices: fullPrices, scoreMap, annualization: market.annualization });
  const placebo = timingPlacebo({ prices: fullPrices, scoreMap, annualization: market.annualization, actualTerminalWealth: full.strategy.terminalWealth });
  return {
    key: market.key,
    targetId: market.targetId,
    annualization: market.annualization,
    firstEligibleDecisionDate: fullPrices[0].date,
    lastDate: fullPrices.at(-1).date,
    full,
    halves: splitPriceWindows(fullPrices).map((prices, index) => ({ half: index + 1, ...runWindow({ prices, scoreMap, annualization: market.annualization }) })),
    placebo,
  };
}

function intersectSortedDates(dateLists) {
  return schema8.intersectSortedDates(dateLists);
}

function aggregateCommonCalendar(preparedMarkets) {
  if (!Array.isArray(preparedMarkets) || preparedMarkets.length !== 5) throw new Error('common calendar requires five markets');
  const commonDates = intersectSortedDates(preparedMarkets.map(item => item.fullPrices.map(row => row.date)));
  if (commonDates.length < 2) throw new Error('common calendar has fewer than two dates');
  const startDate = commonDates[0];
  const endDate = commonDates.at(-1);
  const marketRuns = {};
  for (const prepared of preparedMarkets) {
    const prices = prepared.market.prices.rows.filter(row => row.date >= startDate && row.date <= endDate);
    if (prices[0].date !== startDate || prices.at(-1).date !== endDate) throw new Error(`${prepared.market.key}: common endpoints drifted`);
    marketRuns[prepared.market.key] = runWindow({ prices, scoreMap: prepared.scoreMap, annualization: prepared.market.annualization });
  }
  function aggregate(selector) {
    const maps = Object.values(marketRuns).map(run => new Map(selector(run).wealthCurve.map(row => [row.date, row.wealth])));
    return commonDates.map(date => {
      const constituentWealth = maps.map(map => map.get(date));
      if (constituentWealth.some(value => !(value >= 0) || !Number.isFinite(value))) throw new Error(`${date}: common sampling failed`);
      return { date, wealth: mean(constituentWealth), constituentWealth };
    });
  }
  const strategyWealthCurve = aggregate(run => run.strategy);
  const buyAndHoldWealthCurve = aggregate(run => run.buyAndHold);
  const strategy = summarizeWealthCurve(strategyWealthCurve, COMMON_ANNUALIZATION);
  const buyAndHold = summarizeWealthCurve(buyAndHoldWealthCurve, COMMON_ANNUALIZATION);
  return {
    startDate,
    endDate,
    commonDateCount: commonDates.length,
    commonDates,
    marketRuns,
    strategy: { ...strategy, wealthCurve: strategyWealthCurve },
    buyAndHold: { ...buyAndHold, wealthCurve: buyAndHoldWealthCurve },
    terminalWealthDifference: strategy.terminalWealth - buyAndHold.terminalWealth,
    terminalWealthRatio: strategy.terminalWealth / buyAndHold.terminalWealth,
    excessCagr: strategy.cagr - buyAndHold.cagr,
    annualizedLogReturnExcess: strategy.annualizedLogReturn == null ? null : strategy.annualizedLogReturn - buyAndHold.annualizedLogReturn,
    maximumDrawdownImprovement: strategy.maximumDrawdown - buyAndHold.maximumDrawdown,
    annualizedVolatilityDifference: strategy.annualizedVolatility - buyAndHold.annualizedVolatility,
  };
}

function evaluateGate(markets, commonCalendar, deterministicIntegrityVerified) {
  const values = Object.values(markets);
  if (values.length !== 5) throw new Error('schema-9 gate requires five markets');
  const fullHistoryWins = values.filter(result => result.full.terminalWealthDifference > 0 && result.full.annualizedLogReturnExcess > 0).length;
  const halfCellWins = values.reduce((sum, result) => sum + result.halves.filter(half => half.terminalWealthDifference > 0).length, 0);
  const marketsWithFearAndGreedFills = values.filter(result => result.full.strategy.filledFearTargets > 0 && result.full.strategy.filledGreedTargets > 0).length;
  const marketsWithNoWorseDrawdown = values.filter(result => result.full.maximumDrawdownImprovement >= 0).length;
  const terminalWealthRatios = values.map(result => result.full.terminalWealthRatio);
  const marketsAtOrAbovePlacebo90thPercentile = values.filter(result => result.placebo.actualPercentile >= 0.9).length;
  const gates = {
    fullHistoryBreadth: fullHistoryWins >= 4,
    chronologicalHalvesBreadth: halfCellWins >= 7,
    positiveCommonCalendarExcess: commonCalendar.terminalWealthDifference > 0 && commonCalendar.annualizedLogReturnExcess > 0,
    adequateExtremeRegimeFills: marketsWithFearAndGreedFills >= 4,
    maximumDrawdownBreadth: marketsWithNoWorseDrawdown >= 3,
    terminalWealthFloor: Math.min(...terminalWealthRatios) >= 0.9,
    timingPlaceboBreadth: marketsAtOrAbovePlacebo90thPercentile >= 3,
    deterministicHashReplay: deterministicIntegrityVerified === true,
  };
  return {
    pass: Object.values(gates).every(Boolean),
    gates,
    diagnostics: {
      fullHistoryWins,
      halfCellWins,
      marketsWithFearAndGreedFills,
      marketsWithNoWorseDrawdown,
      minimumTerminalWealthRatio: Math.min(...terminalWealthRatios),
      marketsAtOrAbovePlacebo90thPercentile,
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
    testSha256: sha256File(path.join(__dirname, '..', 'test', 'fear_greed_core_overlay.test.js')),
    schema5RunnerSha256: sha256File(path.join(__dirname, 'fear_greed_v2_validation.js')),
    schema8RunnerSha256: sha256File(path.join(__dirname, 'fear_greed_trend_confirm.js')),
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
  if (!snapshot || snapshot.schemaVersion !== schema5.SCHEMA_VERSION) throw new Error('schema-9 accepts only schema-5 snapshot');
  if (!inputInfo || inputInfo.sha256 !== REQUIRED_SNAPSHOT_SHA256 || inputInfo.checksumVerified !== true) throw new Error('schema-9 requires exact checksum-verified snapshot');
  if (!Array.isArray(snapshot.markets) || snapshot.markets.map(market => market.key).join(',') !== EXPECTED_MARKET_ORDER.join(',')) throw new Error('schema-9 five-market order/set drifted');
  return snapshot;
}

function analyzeSnapshot(snapshot, inputInfo, options = {}) {
  const protocol = assertProtocolFrozen();
  validateFrozenSnapshotIdentity(snapshot, inputInfo);
  const prepared = snapshot.markets.map(prepareMarket);
  const markets = Object.fromEntries(prepared.map(item => [item.market.key, analyzeMarket(item)]));
  const commonCalendar = aggregateCommonCalendar(prepared);
  const gate = evaluateGate(markets, commonCalendar, options.deterministicIntegrityVerified === true);
  const results = {
    schemaVersion: SCHEMA_VERSION,
    strategyId: STRATEGY_ID,
    purpose: 'one frozen 50/100/150 Extreme Fear/neutral/Extreme Greed core overlay versus matched buy-and-hold',
    interpretation: FROZEN_DESIGN.interpretation,
    status: gate.pass ? STATUS_PASS : STATUS_FAIL,
    frozenDesign: FROZEN_DESIGN,
    protocol: { marker: protocol.marker, frozenAt: protocol.frozenAt, ...currentSourceHashes() },
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
  const first = factory();
  const second = factory();
  if (first.analysisFingerprintSha256 !== second.analysisFingerprintSha256 || canonicalJson(first) !== canonicalJson(second)) throw new Error('schema-9 repeated offline analysis is not byte-deterministic');
  return first;
}

function pct(value, digits = 2) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : 'n/a';
}

function num(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

function markdownReport(results) {
  const lines = [
    '# Schema 9 core-position Fear / Greed overlay',
    '',
    `Status: **${results.status}**`,
    '',
    '> Retrospective exploratory evidence on already-reused history. Even a pass is not live validation.',
    '',
    `Strategy: score <=24 -> 150%, 25..74 -> 100%, score >=75 -> 50%; next-close execution; ${(ONE_WAY_COST * 100).toFixed(2)}% of traded notional; ${(BORROW_ANNUAL_RATE * 100).toFixed(2)}% fixed annual borrowing stress.`,
    '',
    '| Market | Dates | Strategy | B&H | Ratio | Excess CAGR | Max-DD improvement | Fear fills | Greed fills | Placebo percentile |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const key of EXPECTED_MARKET_ORDER) {
    const row = results.markets[key];
    lines.push(`| ${key} | ${row.full.strategy.startDate}..${row.full.strategy.endDate} | ${num(row.full.strategy.terminalWealth)} | ${num(row.full.buyAndHold.terminalWealth)} | ${num(row.full.terminalWealthRatio)} | ${pct(row.full.excessCagr)} | ${pct(row.full.maximumDrawdownImprovement)} | ${row.full.strategy.filledFearTargets} | ${row.full.strategy.filledGreedTargets} | ${pct(row.placebo.actualPercentile, 1)} |`);
  }
  lines.push('', '## Chronological halves', '', '| Market | Half | Dates | Strategy | B&H | Ratio |', '| --- | ---: | --- | ---: | ---: | ---: |');
  for (const key of EXPECTED_MARKET_ORDER) {
    for (const half of results.markets[key].halves) lines.push(`| ${key} | ${half.half} | ${half.strategy.startDate}..${half.strategy.endDate} | ${num(half.strategy.terminalWealth)} | ${num(half.buyAndHold.terminalWealth)} | ${num(half.terminalWealthRatio)} |`);
  }
  lines.push(
    '',
    '## Common five-market calendar',
    '',
    `Dates: ${results.commonCalendar.startDate}..${results.commonCalendar.endDate} (${results.commonCalendar.commonDateCount} shared closes).`,
    '',
    `Strategy terminal wealth: **${num(results.commonCalendar.strategy.terminalWealth, 6)}**; buy-and-hold: **${num(results.commonCalendar.buyAndHold.terminalWealth, 6)}**; ratio: **${num(results.commonCalendar.terminalWealthRatio, 6)}**; excess CAGR: **${pct(results.commonCalendar.excessCagr, 4)}**.`,
    '',
    '## Frozen gate',
    '',
  );
  for (const [key, passed] of Object.entries(results.gate.gates)) lines.push(`- ${passed ? 'PASS' : 'FAIL'}: ${key}`);
  lines.push('', 'Diagnostics:', '', '```json', JSON.stringify(results.gate.diagnostics, null, 2), '```', '', `Analysis fingerprint: \`${results.analysisFingerprintSha256}\``, '');
  return `${lines.join('\n')}\n`;
}

function runStamp(now = new Date()) {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

function writeWithSidecar(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  const sha256 = sha256File(file);
  fs.writeFileSync(`${file}.sha256`, `${sha256}  ${path.basename(file)}\n`);
  return { file, sha256, sidecar: `${file}.sha256` };
}

function writeResults(results, outDir, stamp = runStamp()) {
  return {
    json: writeWithSidecar(path.join(outDir, `fear-greed-core-overlay-${stamp}.json`), canonicalJson(results)),
    markdown: writeWithSidecar(path.join(outDir, `fear-greed-core-overlay-${stamp}.md`), markdownReport(results)),
  };
}

function readSavedResult(file) {
  const resolved = path.resolve(file);
  const bytes = fs.readFileSync(resolved);
  const sidecar = `${resolved}.sha256`;
  const expected = fs.readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0];
  const actual = sha256Buffer(bytes);
  if (actual !== expected) throw new Error(`saved result checksum mismatch: expected ${expected}, got ${actual}`);
  const parsed = JSON.parse(bytes.toString('utf8'));
  return { file: resolved, sha256: actual, results: parsed };
}

function withNetworkDisabled(fn) {
  const http = require('http');
  const https = require('https');
  const net = require('net');
  const originals = { httpRequest: http.request, httpGet: http.get, httpsRequest: https.request, httpsGet: https.get, netConnect: net.connect, netCreateConnection: net.createConnection };
  const deny = () => { throw new Error('network disabled during schema-9 analysis'); };
  http.request = deny; http.get = deny; https.request = deny; https.get = deny; net.connect = deny; net.createConnection = deny;
  try { return fn(); }
  finally {
    http.request = originals.httpRequest; http.get = originals.httpGet; https.request = originals.httpsRequest; https.get = originals.httpsGet; net.connect = originals.netConnect; net.createConnection = originals.netCreateConnection;
  }
}

function usage() {
  return 'node research/fear_greed_core_overlay.js --snapshot <input.json> --out-dir <directory> [--replay <saved.json>]';
}

function parseArgs(argv) {
  const args = {};
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
    if (inputInfo.sha256 !== REQUIRED_SNAPSHOT_SHA256) throw new Error(`schema-9 requires snapshot ${REQUIRED_SNAPSHOT_SHA256}, got ${inputInfo.sha256}`);
    const saved = args.replay ? readSavedResult(args.replay) : null;
    const savedReplayVerified = !!saved;
    const results = verifyDeterministicResults(() => analyzeSnapshot(inputInfo.snapshot, inputInfo, { deterministicIntegrityVerified: true }));
    if (saved && canonicalJson(saved.results) !== canonicalJson(results)) throw new Error('saved replay differs byte-for-byte from fresh offline schema-9 analysis');
    const outputs = writeResults(results, path.resolve(args.outDir), runtime.stamp || runStamp(runtime.now || new Date()));
    return { execution: { networkUsed: false, deterministicInProcessVerified: true, savedReplayVerified, replaySource: saved && saved.file || null }, inputInfo, saved, results, outputs };
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage()); return; }
  const completed = runStudy(args);
  console.log(JSON.stringify({ status: completed.results.status, gate: completed.results.gate, analysisFingerprintSha256: completed.results.analysisFingerprintSha256, snapshotSha256: completed.inputInfo.sha256, savedReplayVerified: completed.execution.savedReplayVerified, outputs: completed.outputs }, null, 2));
}

module.exports = {
  SCHEMA_VERSION,
  PROTOCOL_PATH,
  REQUIRED_PROTOCOL_MARKER,
  REQUIRED_PROTOCOL_FREEZE_AT,
  REQUIRED_PROTOCOL_SHA256,
  REQUIRED_RUNNER_NORMALIZED_SHA256,
  REQUIRED_TEST_SHA256,
  REQUIRED_SNAPSHOT_SHA256,
  DEFAULT_SNAPSHOT_PATH,
  STRATEGY_ID,
  EXTREME_FEAR_MAX,
  EXTREME_GREED_MIN,
  FEAR_EXPOSURE,
  NEUTRAL_EXPOSURE,
  GREED_EXPOSURE,
  ONE_WAY_COST,
  BORROW_ANNUAL_RATE,
  CASH_ANNUAL_RATE,
  YEAR_DAYS,
  MAX_PLACEBO_SHIFTS,
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
  scoreToExposure,
  exposureLabel,
  buildScoreMap,
  eligiblePrices,
  exactRebalance,
  summarizeWealthCurve,
  simulateStrategy,
  benchmarkBuyAndHold,
  enrichComparison,
  runWindow,
  splitPriceWindows,
  deterministicShiftOffsets,
  circularShiftScoreMap,
  timingPlacebo,
  prepareMarket,
  analyzeMarket,
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
