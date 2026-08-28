'use strict';

// Frozen-result gate analyzer for FG-ONLINE-RIDGE-PREQ-V1.
//
// This module intentionally does not fetch or open a snapshot.  Its only trust
// boundary is a market input: it normalizes that input and independently reruns
// the frozen core.  Caller-supplied analyses, ledgers, paths, MSE summaries and
// status strings are rejected.  Existing core results use zero-return cash and
// are therefore always UNSCORABLE for an investable x2 claim, regardless of
// their numbers.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const core = require('./fear_greed_expanding_binary.js');

const ANALYZER_ID = 'FG-ONLINE-RIDGE-PREQ-V1-FROZEN-RESULT-ANALYZER-V1';
const MODEL_ID = core.MODEL_ID;
const SCHEMA_VERSION = 1;

const FROZEN_MARKET_SPECS = Object.freeze([
  Object.freeze({ key: 'crypto', targetId: 'CRYPTO-BROAD-EW', annualization: 365, marketClass: 'crypto', requiresAdjusted: false, suitability: 'SYNTHETIC_ANALYTICAL_BASKET_NOT_INVESTABLE' }),
  Object.freeze({ key: 'sweden', targetId: '^OMXSBGI', annualization: 252, marketClass: 'equity', requiresAdjusted: false, suitability: 'GROSS_RETURN_REFERENCE_INDEX_NOT_EXECUTABLE_INSTRUMENT' }),
  Object.freeze({ key: 'usa', targetId: 'SPY', annualization: 252, marketClass: 'equity', requiresAdjusted: true, suitability: 'INVESTABLE_ETF_TOTAL_RETURN_PROXY_NOT_EXECUTION_RECORD_ZERO_CASH' }),
  Object.freeze({ key: 'europe', targetId: '^STOXX', annualization: 252, marketClass: 'equity', requiresAdjusted: false, suitability: 'PRICE_RETURN_INDEX_OMITS_DIVIDENDS_NOT_INVESTABLE_X2_TARGET' }),
  Object.freeze({ key: 'global', targetId: 'ACWI', annualization: 252, marketClass: 'equity', requiresAdjusted: true, suitability: 'INVESTABLE_ETF_TOTAL_RETURN_PROXY_NOT_EXECUTION_RECORD_ZERO_CASH' }),
]);

const STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  UNDERPOWERED: 'UNDERPOWERED',
  UNSCORABLE: 'UNSCORABLE',
});

const GATE_STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  UNDERPOWERED: 'UNDERPOWERED',
  UNSCORABLE: 'UNSCORABLE',
  MANDATORY_INCOMPLETE: 'MANDATORY_INCOMPLETE',
});

const CONFIG = Object.freeze({
  x2MinimumRatio: 2,
  halfMinimumRatioExclusive: 1,
  minimumMseImprovement: 0.005,
  minimumPostWarmupForecasts: 756,
  minimumForecastCalendarDays: 1095,
  minimumStateShare: 0.10,
  minimumCompletedCashEpisodes: 12,
  volatilityGridStep: 0.001,
  placeboRepetitions: 999,
  placeboMinimumShiftBars: 252,
  placeboMaximumFamilywisePValue: 0.01,
  numericalTolerance: 1e-12,
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function ratio(numerator, denominator) {
  assert(isFiniteNumber(numerator) && numerator > 0, 'Ratio numerator must be finite and positive');
  assert(isFiniteNumber(denominator) && denominator > 0, 'Ratio denominator must be finite and positive');
  const value = numerator / denominator;
  assert(isFiniteNumber(value) && value > 0, 'Derived ratio must be finite and positive');
  return value;
}

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function getAnalyzerIdentity() {
  return Object.freeze({
    analyzerId: ANALYZER_ID,
    analyzerFile: path.basename(__filename),
    analyzerSha256: sha256Bytes(fs.readFileSync(__filename)),
    configSha256: core.hashCanonical(CONFIG),
    frozenMarketFamilySha256: core.hashCanonical(FROZEN_MARKET_SPECS),
    protocol: core.assertProtocolIdentity(),
    coreRunner: core.getRunnerIdentity(),
    coreConfigSha256: core.getConfigIdentity().configSha256,
  });
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function freezeGate(status, passed, details = {}) {
  return Object.freeze({ status, passed: Boolean(passed), ...details });
}

function validatePath(pathRows, label, options = {}) {
  assert(Array.isArray(pathRows) && pathRows.length >= 2, `${label} path requires at least two rows`);
  let previousIndex = null;
  let previousDate = null;
  for (const [ordinal, row] of pathRows.entries()) {
    assert(row && typeof row === 'object', `${label} path row ${ordinal} must be an object`);
    assert(Number.isInteger(row.priceIndex), `${label} path row ${ordinal} has invalid priceIndex`);
    assert(core.isExactIsoDate(row.date),
      `${label} path row ${ordinal} has invalid date`);
    assert(isFiniteNumber(row.wealth) && row.wealth > 0,
      `${label} path row ${ordinal} has invalid wealth`);
    if (previousIndex !== null) {
      assert(row.priceIndex === previousIndex + 1,
        `${label} path must contain every consecutive price index`);
      assert(previousDate < row.date, `${label} path dates must be strictly increasing`);
    }
    if (options.requirePosition) {
      assert(row.filledPosition === 'LONG' || row.filledPosition === 'CASH',
        `${label} path row ${ordinal} has invalid filledPosition`);
    }
    previousIndex = row.priceIndex;
    previousDate = row.date;
  }
  return pathRows;
}

function pathIndex(pathRows) {
  return new Map(pathRows.map((row) => [row.priceIndex, row]));
}

function pathFactor(pathRows, startIndex, endIndex, label) {
  const indexed = pathIndex(pathRows);
  const start = indexed.get(startIndex);
  const end = indexed.get(endIndex);
  assert(start && end, `${label} does not cover requested factor bounds`);
  const factor = end.wealth / start.wealth;
  assert(isFiniteNumber(factor) && factor > 0, `${label} factor is non-finite or non-positive`);
  return factor;
}

function summarizePath(pathRows, annualization, label) {
  validatePath(pathRows, label);
  assert(isFiniteNumber(annualization) && annualization > 0, 'Annualization must be positive');
  const netReturns = [];
  let peak = pathRows[0].wealth;
  let maximumDrawdown = 0;
  for (let index = 1; index < pathRows.length; index += 1) {
    const previous = pathRows[index - 1].wealth;
    const current = pathRows[index].wealth;
    const netReturn = (current / previous) - 1;
    assert(isFiniteNumber(netReturn) && netReturn > -1, `${label} contains an invalid derived return`);
    netReturns.push(netReturn);
    peak = Math.max(peak, current);
    maximumDrawdown = Math.max(maximumDrawdown, 1 - (current / peak));
  }
  const mean = netReturns.reduce((sum, value) => sum + value, 0) / netReturns.length;
  const variance = netReturns.length > 1
    ? netReturns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (netReturns.length - 1)
    : 0;
  const fullFactor = pathRows.at(-1).wealth / pathRows[0].wealth;
  const annualizedLogReturn = Math.log(fullFactor) * annualization / (pathRows.length - 1);
  const realizedVolatility = Math.sqrt(Math.max(0, variance)) * Math.sqrt(annualization);
  assert(isFiniteNumber(mean) && isFiniteNumber(variance) && variance >= 0,
    `${label} return moments are invalid`);
  assert(isFiniteNumber(fullFactor) && fullFactor > 0, `${label} terminal factor is invalid`);
  assert(isFiniteNumber(annualizedLogReturn), `${label} annualized return is invalid`);
  assert(isFiniteNumber(realizedVolatility) && realizedVolatility >= 0,
    `${label} volatility is invalid`);
  assert(isFiniteNumber(maximumDrawdown) && maximumDrawdown >= 0 && maximumDrawdown <= 1,
    `${label} drawdown is invalid`);
  return Object.freeze({
    startPriceIndex: pathRows[0].priceIndex,
    endPriceIndex: pathRows.at(-1).priceIndex,
    intervalCount: pathRows.length - 1,
    terminalWealthFactor: fullFactor,
    annualizedLogReturn,
    realizedVolatility,
    maximumDrawdown,
  });
}

function assertMatchedBounds(paths) {
  const bounds = paths.map((entry) => ({
    name: entry.name,
    start: entry.path[0].priceIndex,
    end: entry.path.at(-1).priceIndex,
  }));
  const expected = bounds[0];
  for (const bound of bounds.slice(1)) {
    assert(bound.start === expected.start && bound.end === expected.end,
      `${bound.name} bounds do not match ${expected.name}`);
  }
  return expected;
}

function relativeWealthMetrics(strategyPath, benchmarkPath, label) {
  validatePath(strategyPath, `${label} strategy`);
  validatePath(benchmarkPath, `${label} benchmark`);
  const bounds = assertMatchedBounds([
    { name: `${label} strategy`, path: strategyPath },
    { name: `${label} benchmark`, path: benchmarkPath },
  ]);
  const intervalCount = bounds.end - bounds.start;
  assert(intervalCount >= 2, `${label} requires at least two intervals for half metrics`);
  const halfBoundaryPriceIndex = bounds.start + Math.floor(intervalCount / 2);

  function intervalRatio(startIndex, endIndex) {
    return ratio(
      pathFactor(strategyPath, startIndex, endIndex, `${label} strategy`),
      pathFactor(benchmarkPath, startIndex, endIndex, `${label} benchmark`),
    );
  }

  return Object.freeze({
    startPriceIndex: bounds.start,
    endPriceIndex: bounds.end,
    intervalCount,
    halfBoundaryPriceIndex,
    full: intervalRatio(bounds.start, bounds.end),
    firstHalf: intervalRatio(bounds.start, halfBoundaryPriceIndex),
    secondHalf: intervalRatio(halfBoundaryPriceIndex, bounds.end),
  });
}

function verifyGeneratedCoreAnalysis(analysis, normalizedMarket) {
  assert(analysis && analysis.schemaVersion === core.SCHEMA_VERSION,
    'Recomputed core analysis schema drifted');
  assert(analysis.modelId === MODEL_ID, 'Recomputed core model identity drifted');
  assert(analysis.status === core.EVIDENCE_STATUS,
    'Recomputed core evidence status drifted');
  assert(analysis.market && analysis.market.key === normalizedMarket.key
    && analysis.market.targetId === normalizedMarket.targetId
    && analysis.market.marketClass === normalizedMarket.marketClass
    && analysis.market.annualization === normalizedMarket.annualization,
  'Recomputed core market identity drifted');

  const protocol = core.assertProtocolIdentity();
  const runner = core.getRunnerIdentity();
  const config = core.getConfigIdentity();
  assert(analysis.identities && analysis.identities.protocolSha256 === protocol.protocolSha256,
    'Recomputed core protocol hash drifted');
  assert(analysis.identities.protocolFreezeMarker === protocol.freezeMarker,
    'Recomputed core protocol marker drifted');
  assert(analysis.identities.runner
    && analysis.identities.runner.runnerSha256 === runner.runnerSha256,
  'Recomputed core runner identity drifted');
  assert(analysis.identities.configSha256 === config.configSha256,
    'Recomputed core config identity drifted');
  assert(analysis.identities.inputSha256 === core.hashCanonical(normalizedMarket),
    'Recomputed normalized-input identity drifted');
  const { analysisSha256, ...payload } = analysis;
  assert(/^[a-f0-9]{64}$/.test(analysisSha256 || '')
    && analysisSha256 === core.hashCanonical(payload),
  'Recomputed core analysis hash drifted');
  return analysis;
}

function snapshotPlainData(value, label) {
  try {
    return structuredClone(value);
  } catch (error) {
    throw new Error(`${label} cannot be copied into a stable plain-data snapshot: ${error.message}`);
  }
}

function materializeAnalysis(input) {
  assert(input && typeof input === 'object', 'Frozen market input must be an object');
  assert(!(input.models || input.ledgers || input.buyAndHold),
    'Caller-supplied analysis/ledgers are not accepted; supply a market input for deterministic recomputation');
  const suppliedMarket = input.market;
  assert(suppliedMarket && typeof suppliedMarket === 'object',
    'A market input is required for deterministic recomputation');
  // Always normalize, even when a caller supplies schemaVersion: 1.  The
  // schema marker is descriptive and must never bypass boundary validation.
  // Copy once first so getters/proxies cannot change data between validation
  // and use.
  const stableMarketInput = snapshotPlainData(suppliedMarket, 'Market input');
  const normalizedMarket = core.normalizeMarket(stableMarketInput);
  const analysis = verifyGeneratedCoreAnalysis(core.analyzeMarket(normalizedMarket), normalizedMarket);
  return Object.freeze({
    sourceKind: 'RECOMPUTED_FROM_NORMALIZED_MARKET_ZERO_CASH_CORE',
    analysis,
    normalizedMarket,
    explicitScoreability: input.scoreability || null,
  });
}

function evaluateScoreability(materialized, options) {
  const { analysis, sourceKind } = materialized;
  const scoreability = options.scoreability || materialized.explicitScoreability || null;
  const reasons = [];
  const limitations = Array.isArray(analysis.limitations) ? analysis.limitations : [];
  const coreZeroCash = analysis.modelId === MODEL_ID
    || sourceKind.includes('ZERO_CASH_CORE')
    || limitations.some((value) => /cash return is fixed at zero/i.test(String(value)));
  if (coreZeroCash) reasons.push('ZERO_RETURN_CASH_LEDGER');
  if (!scoreability) reasons.push('MISSING_SCOREABILITY_ATTESTATION');

  if (scoreability) {
    const risky = scoreability.riskyInstrument || {};
    const cash = scoreability.cashInstrument || {};
    if (risky.executable !== true) reasons.push('RISKY_INSTRUMENT_NOT_EXECUTABLE');
    if (risky.returnType !== 'total_return') reasons.push('RISKY_INSTRUMENT_NOT_TOTAL_RETURN');
    if (cash.executable !== true) reasons.push('CASH_INSTRUMENT_NOT_EXECUTABLE');
    if (cash.returnType !== 'total_return') reasons.push('CASH_INSTRUMENT_NOT_TOTAL_RETURN');
    if (!risky.currency || risky.currency !== cash.currency) reasons.push('RISKY_CASH_CURRENCY_MISMATCH');
    if (scoreability.benchmarkUsesSameRiskyInstrument !== true) {
      reasons.push('BENCHMARK_NOT_SAME_RISKY_INSTRUMENT');
    }
    if (scoreability.cashReturnsIncludedInLabelsAndLedgers !== true) {
      reasons.push('CASH_RETURN_NOT_INCLUDED_IN_LABELS_AND_LEDGERS');
    }
    if (scoreability.targetIdentityFrozen !== true) reasons.push('TARGET_IDENTITY_NOT_FROZEN');
  }

  const uniqueReasons = [...new Set(reasons)].sort();
  return uniqueReasons.length === 0
    ? freezeGate(GATE_STATUS.PASS, true, { reasons: Object.freeze([]) })
    : freezeGate(GATE_STATUS.UNSCORABLE, false, { reasons: Object.freeze(uniqueReasons) });
}

function approximatelyEqual(left, right, tolerance = CONFIG.numericalTolerance) {
  if (!isFiniteNumber(left) || !isFiniteNumber(right)) return false;
  return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
}

function validatePrequentialSummary(summary, label) {
  assert(summary && typeof summary === 'object', `${label} prequential summary is required`);
  assert(Number.isInteger(summary.count) && summary.count >= 0,
    `${label} prequential count must be a non-negative integer`);
  assert(isFiniteNumber(summary.sumSquaredError) && summary.sumSquaredError >= 0,
    `${label} prequential SSE must be finite and non-negative`);
  if (summary.count === 0) {
    assert(summary.sumSquaredError === 0 && summary.meanSquaredError === null,
      `${label} zero-count prequential summary is inconsistent`);
    return Object.freeze({ count: 0, sumSquaredError: 0, meanSquaredError: null });
  }
  const derived = summary.sumSquaredError / summary.count;
  assert(isFiniteNumber(derived) && derived >= 0,
    `${label} derived prequential MSE is invalid`);
  assert(isFiniteNumber(summary.meanSquaredError) && summary.meanSquaredError >= 0
    && approximatelyEqual(summary.meanSquaredError, derived),
  `${label} meanSquaredError differs from SSE/count`);
  return Object.freeze({
    count: summary.count,
    sumSquaredError: summary.sumSquaredError,
    meanSquaredError: derived,
  });
}

function computeMseMetrics(m1Input, m0Input) {
  const m1 = validatePrequentialSummary(m1Input, 'M1');
  const m0 = validatePrequentialSummary(m0Input, 'M0');
  const sameCount = m1.count === m0.count;
  let improvement = null;
  if (sameCount && m0.meanSquaredError !== null && m0.meanSquaredError > 0
      && m1.meanSquaredError !== null) {
    improvement = (m0.meanSquaredError - m1.meanSquaredError) / m0.meanSquaredError;
    assert(isFiniteNumber(improvement), 'Derived MSE improvement is non-finite');
  }
  return Object.freeze({
    m1Count: m1.count,
    m0Count: m0.count,
    sameCount,
    m1Mse: m1.meanSquaredError,
    m0Mse: m0.meanSquaredError,
    improvement,
  });
}

function decisionPosition(decision) {
  if (decision.targetPosition === 'LONG' || decision.targetPosition === 'CASH') {
    return decision.targetPosition;
  }
  if (decision.action === 'BUY') return 'LONG';
  if (decision.action === 'SELL') return 'CASH';
  return null;
}

function validateDecisionTimeline(decisions, pathRows, label) {
  assert(Array.isArray(decisions) && decisions.length === pathRows.length,
    `${label} decisions must cover every evaluation path row`);
  let expectedFilled = 'LONG';
  for (let index = 0; index < decisions.length; index += 1) {
    const decision = decisions[index];
    const pathRow = pathRows[index];
    assert(decision && typeof decision === 'object', `${label} decision ${index} is invalid`);
    assert(decision.decisionOrdinal === index, `${label} decision ordinals are not consecutive`);
    assert(decision.decisionPriceIndex === pathRow.priceIndex,
      `${label} decision/path price indexes differ`);
    assert(decision.decisionDate === pathRow.date, `${label} decision/path dates differ`);
    assert(decision.executionPriceIndex === decision.decisionPriceIndex + 1,
      `${label} execution is not the next target close`);
    const target = decisionPosition(decision);
    assert(target === 'LONG' || target === 'CASH', `${label} decision target is not binary`);
    assert(decision.action === (target === 'LONG' ? 'BUY' : 'SELL'),
      `${label} action and targetPosition disagree`);
    assert(decision.filledPosition === expectedFilled,
      `${label} filled-position continuity drifted`);
    assert(pathRow.filledPosition === expectedFilled,
      `${label} path position and decision state disagree`);
    assert(decision.tradeRequired === (target !== expectedFilled),
      `${label} tradeRequired disagrees with the target transition`);
    assert(/^[a-f0-9]{64}$/.test(decision.decisionSha256 || ''),
      `${label} decision hash is missing`);
    const { decisionSha256, ...decisionPayload } = decision;
    assert(decisionSha256 === core.hashCanonical(decisionPayload),
      `${label} decision hash drifted`);
    expectedFilled = target;
  }
  assert(decisions.at(-1).executionPriceIndex === pathRows.at(-1).priceIndex + 1,
    `${label} final queued action is not exactly one close beyond the evaluation endpoint`);
}

function validateReplayIdentity(model, label, expectedCosts) {
  assert(model && model.primary && model.stress, `${label} replay summaries are missing`);
  assert(/^[a-f0-9]{64}$/.test(model.primary.ledgerHash || '')
    && model.primary.ledgerHash === model.stress.ledgerHash,
  `${label} primary/stress ledger identity drifted`);
  const minimalLedger = model.decisions.map(decision => ({
    decisionPriceIndex: decision.decisionPriceIndex,
    executionPriceIndex: decision.executionPriceIndex,
    action: decision.action,
    targetPosition: decision.targetPosition,
  }));
  assert(model.primary.ledgerHash === core.hashCanonical(minimalLedger),
    `${label} ledger hash does not match decisions`);
  assert(model.primary.oneWayCost === expectedCosts.primary
    && model.stress.oneWayCost === expectedCosts.stress,
  `${label} replay costs drifted from the frozen market class`);
}

function recomputePrequential(decisions, market, label) {
  const origins = [];
  let sumSquaredError = 0;
  for (const decision of decisions) {
    if (!isFiniteNumber(decision.prediction)) continue;
    assert(Number.isInteger(decision.trainingRowCount)
      && decision.trainingRowCount >= core.MIN_MATURED_ROWS,
    `${label} finite prediction was emitted before the frozen warm-up`);
    assert(decision.fallbackReason === null && decision.currentFeaturesValid === true
      && decision.evidence && decision.evidence.fitSucceeded === true,
    `${label} finite prediction is inconsistent with a successful valid fit`);
    const maturityIndex = decision.decisionPriceIndex + 2;
    if (maturityIndex >= market.prices.length) continue;
    const actual = Math.log(
      market.prices[maturityIndex].close / market.prices[decision.decisionPriceIndex + 1].close,
    );
    const error = actual - decision.prediction;
    const squaredError = error ** 2;
    assert(isFiniteNumber(actual) && isFiniteNumber(error)
      && isFiniteNumber(squaredError) && squaredError >= 0,
    `${label} recomputed forecast error is invalid`);
    sumSquaredError += squaredError;
    assert(isFiniteNumber(sumSquaredError), `${label} recomputed SSE overflowed`);
    origins.push(decision.decisionPriceIndex);
  }
  return Object.freeze({
    origins: Object.freeze(origins),
    count: origins.length,
    sumSquaredError,
    meanSquaredError: origins.length > 0 ? sumSquaredError / origins.length : null,
  });
}

function scoredDecisionDiagnostics(decisions, evaluationEndPriceIndex) {
  assert(Array.isArray(decisions), 'Decisions must be an array');
  assert(Number.isInteger(evaluationEndPriceIndex), 'Evaluation end price index must be an integer');
  // The frozen protocol defines the state-share and cash-episode denominators
  // over every emitted decision row, including warm-up, fallback, and the final
  // queued-but-unexecuted target.  Only MSE/model-activity adequacy is restricted
  // to matured post-warm-up predictions.
  const emitted = decisions;
  const stateCounts = { long: 0, cash: 0 };
  for (const decision of emitted) {
    const position = decisionPosition(decision);
    if (position === 'LONG') stateCounts.long += 1;
    if (position === 'CASH') stateCounts.cash += 1;
  }
  const denominator = stateCounts.long + stateCounts.cash;
  const stateShares = {
    long: denominator > 0 ? stateCounts.long / denominator : null,
    cash: denominator > 0 ? stateCounts.cash / denominator : null,
  };

  let filled = emitted.length > 0 ? emitted[0].filledPosition : 'LONG';
  assert(filled === 'LONG' || filled === 'CASH', 'Initial emitted position is invalid');
  let cashEpisodeOpen = false;
  let completedCashEpisodes = 0;
  for (const decision of emitted) {
    assert(Number.isInteger(decision.executionPriceIndex), 'Decision execution index is invalid');
    if (decision.executionPriceIndex > evaluationEndPriceIndex) continue;
    const target = decisionPosition(decision);
    assert(target === 'LONG' || target === 'CASH', 'Decision target is invalid');
    if (filled === 'LONG' && target === 'CASH') cashEpisodeOpen = true;
    if (filled === 'CASH' && target === 'LONG' && cashEpisodeOpen) {
      completedCashEpisodes += 1;
      cashEpisodeOpen = false;
    }
    filled = target;
  }

  return Object.freeze({
    scope: 'ALL_EMITTED_DECISION_ROWS',
    emittedDecisionCount: denominator,
    stateCounts: Object.freeze(stateCounts),
    stateShares: Object.freeze(stateShares),
    completedCashEpisodes,
    completedCashEpisodeScope: 'EXECUTED_TRANSITIONS_THROUGH_EVALUATION_END',
  });
}

function computeForecastAdequacy(analysis, market, recomputedM1, recomputedM0, mseMetrics) {
  const m1Indexes = recomputedM1.origins;
  const m0Indexes = recomputedM0.origins;
  const exactOriginSet = m1Indexes.length === m0Indexes.length
    && m1Indexes.every((value, index) => value === m0Indexes[index]);
  const sharedIndexes = exactOriginSet ? m1Indexes : [];
  const provableCount = sharedIndexes.length;
  const countsExactlyProven = exactOriginSet && mseMetrics.sameCount
    && mseMetrics.m1Count === provableCount
    && recomputedM1.count === provableCount
    && recomputedM0.count === provableCount;

  let calendarSpanDays = null;
  let firstEntryDate = null;
  let lastOutcomeDate = null;
  if (sharedIndexes.length > 0) {
    const firstEntry = market.prices[sharedIndexes[0] + 1];
    const lastOutcome = market.prices[sharedIndexes.at(-1) + 2];
    if (firstEntry && lastOutcome) {
      firstEntryDate = firstEntry.date;
      lastOutcomeDate = lastOutcome.date;
      const milliseconds = Date.parse(lastOutcome.date) - Date.parse(firstEntry.date);
      if (Number.isFinite(milliseconds) && milliseconds >= 0) {
        calendarSpanDays = milliseconds / 86400000;
      }
    }
  }

  const failed = [];
  if (!countsExactlyProven) failed.push('M0_M1_MATURED_FORECAST_SET_NOT_EXACTLY_PROVEN');
  if (provableCount < CONFIG.minimumPostWarmupForecasts) failed.push('FEWER_THAN_756_FORECASTS');
  if (!(calendarSpanDays >= CONFIG.minimumForecastCalendarDays)) failed.push('FORECAST_SPAN_BELOW_1095_DAYS');
  return Object.freeze({
    countsExactlyProven,
    provableCount,
    reportedM1Count: mseMetrics.m1Count,
    reportedM0Count: mseMetrics.m0Count,
    firstEntryDate,
    lastOutcomeDate,
    calendarSpanDays,
    failed: Object.freeze(failed),
  });
}

function exposureFromStrategyPath(pathRows) {
  let exposed = 0;
  for (let index = 1; index < pathRows.length; index += 1) {
    assert(pathRows[index - 1].filledPosition === 'LONG'
      || pathRows[index - 1].filledPosition === 'CASH',
    'Strategy path has an invalid exposure state');
    if (pathRows[index - 1].filledPosition === 'LONG') exposed += 1;
  }
  const exposure = exposed / (pathRows.length - 1);
  assert(isFiniteNumber(exposure) && exposure >= 0 && exposure <= 1,
    'Derived strategy exposure is invalid');
  return exposure;
}

function constantMixFromBenchmarkPath(benchmarkPath, weight, annualization) {
  assert(isFiniteNumber(weight) && weight >= 0 && weight <= 1, 'Constant-mix weight must be in [0,1]');
  validatePath(benchmarkPath, 'constant-mix benchmark');
  let wealth = 1;
  let peak = 1;
  let maximumDrawdown = 0;
  const returns = [];
  for (let index = 1; index < benchmarkPath.length; index += 1) {
    const riskyReturn = benchmarkPath[index].wealth / benchmarkPath[index - 1].wealth - 1;
    const netReturn = weight * riskyReturn;
    assert(isFiniteNumber(riskyReturn) && riskyReturn > -1
      && isFiniteNumber(netReturn) && netReturn > -1,
    'Constant-mix control contains an invalid derived return');
    wealth *= 1 + netReturn;
    assert(isFiniteNumber(wealth) && wealth > 0, 'Constant-mix wealth is invalid');
    returns.push(netReturn);
    peak = Math.max(peak, wealth);
    maximumDrawdown = Math.max(maximumDrawdown, 1 - (wealth / peak));
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.length > 1
    ? returns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (returns.length - 1)
    : 0;
  const realizedVolatility = Math.sqrt(Math.max(0, variance)) * Math.sqrt(annualization);
  assert(isFiniteNumber(mean) && isFiniteNumber(variance) && variance >= 0,
    'Constant-mix return moments are invalid');
  assert(isFiniteNumber(realizedVolatility) && realizedVolatility >= 0,
    'Constant-mix volatility is invalid');
  return Object.freeze({
    weight,
    terminalWealth: wealth,
    realizedVolatility,
    maximumDrawdown,
    costAssumption: 'FRICTIONLESS_DAILY_REBALANCED_CONTROL',
    cashReturnAssumption: 'ZERO_RETURN_CASH',
  });
}

function buildMatchedControls(analysis, m1PrimarySummary, m1StressSummary) {
  const benchmarkPath = analysis.buyAndHold.path;
  const annualization = analysis.market.annualization;
  const exposure = exposureFromStrategyPath(analysis.models.M1.primary.path);
  const exposureMatched = constantMixFromBenchmarkPath(benchmarkPath, exposure, annualization);

  let volatilityMatched = null;
  let bestDistance = Infinity;
  const steps = 1000;
  assert(CONFIG.volatilityGridStep === 1 / steps, 'Frozen volatility grid step drifted');
  for (let step = 0; step <= steps; step += 1) {
    const weight = step / steps;
    const candidate = constantMixFromBenchmarkPath(benchmarkPath, weight, annualization);
    const distance = Math.abs(candidate.realizedVolatility - m1StressSummary.realizedVolatility);
    assert(isFiniteNumber(distance), 'Volatility-grid distance is non-finite');
    // Exact closest grid point.  The ascending scan makes the frozen tie rule
    // deterministic and conservative: equal distances retain the lower weight.
    if (distance < bestDistance) {
      bestDistance = distance;
      volatilityMatched = Object.freeze({ ...candidate, volatilityDistance: distance });
    }
  }
  assert(volatilityMatched && isFiniteNumber(bestDistance), 'No volatility-matched control exists');

  const primaryFactor = m1PrimarySummary.terminalWealthFactor;
  const stressFactor = m1StressSummary.terminalWealthFactor;
  return Object.freeze({
    exposureMatched,
    volatilityMatched,
    exposureGatePass: primaryFactor > exposureMatched.terminalWealth
      && stressFactor > exposureMatched.terminalWealth,
    volatilityGatePass: primaryFactor > volatilityMatched.terminalWealth
      && stressFactor > volatilityMatched.terminalWealth,
  });
}

function evaluatePlaceboEvidence(evidence, marketKey) {
  // The analyzer does not implement the 999 complete causal replays.  A caller
  // supplied summary is not enough: accepting one would make a self-attested
  // JSON object capable of clearing a mandatory gate without recomputation.
  // Keep this gate incomplete until a separately frozen implementation binds
  // every shifted run to the exact normalized inputs and claimed market family.
  return freezeGate(GATE_STATUS.MANDATORY_INCOMPLETE, false, {
    reasons: Object.freeze(['999_SHIFT_FAMILYWISE_PLACEBO_NOT_IMPLEMENTED']),
    required: Object.freeze({
      marketKey,
      repetitions: CONFIG.placeboRepetitions,
      minimumCircularShiftBars: CONFIG.placeboMinimumShiftBars,
      shiftOnlyFearGreedBlock: true,
      priceControlsUnshifted: true,
      familywiseAcrossAllClaimedMarkets: true,
      maximumFamilywisePValue: CONFIG.placeboMaximumFamilywisePValue,
    }),
    callerSuppliedEvidenceRejected: evidence !== null && evidence !== undefined,
  });
}

function analyzeFrozenMarketResult(input, options = {}) {
  const materialized = materializeAnalysis(input);
  const analysis = materialized.analysis;
  const normalizedMarket = materialized.normalizedMarket;
  assert(analysis.modelId === MODEL_ID, `Expected modelId ${MODEL_ID}`);
  assert(analysis.market && typeof analysis.market.key === 'string', 'Market identity is required');
  assert(analysis.models && analysis.models.M1 && analysis.models.M0, 'M1 and M0 are required');
  assert(analysis.buyAndHold && Array.isArray(analysis.buyAndHold.path), 'Matched buy-and-hold path is required');

  const m1PrimaryPath = validatePath(analysis.models.M1.primary.path, 'M1 primary', { requirePosition: true });
  const m1StressPath = validatePath(analysis.models.M1.stress.path, 'M1 stress', { requirePosition: true });
  const m0PrimaryPath = validatePath(analysis.models.M0.primary.path, 'M0 primary', { requirePosition: true });
  const m0StressPath = validatePath(analysis.models.M0.stress.path, 'M0 stress', { requirePosition: true });
  const benchmarkPath = validatePath(analysis.buyAndHold.path, 'buy-and-hold');
  assertMatchedBounds([
    { name: 'M1 primary', path: m1PrimaryPath },
    { name: 'M1 stress', path: m1StressPath },
    { name: 'M0 primary', path: m0PrimaryPath },
    { name: 'M0 stress', path: m0StressPath },
    { name: 'buy-and-hold', path: benchmarkPath },
  ]);

  const integrityFailures = [];
  const m1Decisions = analysis.models.M1.decisions;
  const m0Decisions = analysis.models.M0.decisions;
  validateDecisionTimeline(m1Decisions, m1PrimaryPath, 'M1 primary');
  validateDecisionTimeline(m1Decisions, m1StressPath, 'M1 stress');
  validateDecisionTimeline(m0Decisions, m0PrimaryPath, 'M0 primary');
  validateDecisionTimeline(m0Decisions, m0StressPath, 'M0 stress');
  assert(m1Decisions.length === m0Decisions.length,
    'M0/M1 decision ledgers have different lengths');
  for (let index = 0; index < m1Decisions.length; index += 1) {
    assert(m1Decisions[index].decisionPriceIndex === m0Decisions[index].decisionPriceIndex
      && m1Decisions[index].executionPriceIndex === m0Decisions[index].executionPriceIndex
      && m1Decisions[index].decisionDate === m0Decisions[index].decisionDate,
    'M0/M1 decision origins drifted');
    assert(m1PrimaryPath[index].date === m1StressPath[index].date
      && m1PrimaryPath[index].date === m0PrimaryPath[index].date
      && m1PrimaryPath[index].date === m0StressPath[index].date
      && m1PrimaryPath[index].date === benchmarkPath[index].date,
    'Model/benchmark path dates drifted');
  }
  const costs = core.COSTS[analysis.market.marketClass];
  assert(costs, `Unknown market class ${analysis.market.marketClass}`);
  validateReplayIdentity(analysis.models.M1, 'M1', costs);
  validateReplayIdentity(analysis.models.M0, 'M0', costs);

  const wealthRatios = Object.freeze({
    primary: relativeWealthMetrics(m1PrimaryPath, benchmarkPath, 'M1 primary'),
    stress: relativeWealthMetrics(m1StressPath, benchmarkPath, 'M1 stress'),
  });
  const m1VsM0 = Object.freeze({
    primary: ratio(
      pathFactor(m1PrimaryPath, m1PrimaryPath[0].priceIndex, m1PrimaryPath.at(-1).priceIndex, 'M1 primary'),
      pathFactor(m0PrimaryPath, m0PrimaryPath[0].priceIndex, m0PrimaryPath.at(-1).priceIndex, 'M0 primary'),
    ),
    stress: ratio(
      pathFactor(m1StressPath, m1StressPath[0].priceIndex, m1StressPath.at(-1).priceIndex, 'M1 stress'),
      pathFactor(m0StressPath, m0StressPath[0].priceIndex, m0StressPath.at(-1).priceIndex, 'M0 stress'),
    ),
  });
  const recomputedM1 = recomputePrequential(m1Decisions, normalizedMarket, 'M1');
  const recomputedM0 = recomputePrequential(m0Decisions, normalizedMarket, 'M0');
  const mse = computeMseMetrics(analysis.models.M1.prequential, analysis.models.M0.prequential);
  assert(mse.sameCount, 'M0/M1 prequential counts differ');
  assert(recomputedM1.count === mse.m1Count && recomputedM0.count === mse.m0Count,
    'Reported and recomputed prequential counts differ');
  assert(approximatelyEqual(recomputedM1.sumSquaredError,
    analysis.models.M1.prequential.sumSquaredError)
    && approximatelyEqual(recomputedM0.sumSquaredError,
      analysis.models.M0.prequential.sumSquaredError),
  'Reported and recomputed prequential SSE differ');
  assert(recomputedM1.meanSquaredError === null
    ? mse.m1Mse === null
    : approximatelyEqual(recomputedM1.meanSquaredError, mse.m1Mse),
  'Reported and recomputed M1 MSE differ');
  assert(recomputedM0.meanSquaredError === null
    ? mse.m0Mse === null
    : approximatelyEqual(recomputedM0.meanSquaredError, mse.m0Mse),
  'Reported and recomputed M0 MSE differ');

  const annualization = analysis.market.annualization;
  const summaries = Object.freeze({
    m1Primary: summarizePath(m1PrimaryPath, annualization, 'M1 primary'),
    m1Stress: summarizePath(m1StressPath, annualization, 'M1 stress'),
    m0Primary: summarizePath(m0PrimaryPath, annualization, 'M0 primary'),
    m0Stress: summarizePath(m0StressPath, annualization, 'M0 stress'),
    buyAndHold: summarizePath(benchmarkPath, annualization, 'buy-and-hold'),
  });
  const scoredDecisions = Array.isArray(m1Decisions)
    ? scoredDecisionDiagnostics(m1Decisions, benchmarkPath.at(-1).priceIndex)
    : Object.freeze({
      scope: 'ALL_EMITTED_DECISION_ROWS',
      emittedDecisionCount: 0,
      stateCounts: Object.freeze({ long: 0, cash: 0 }),
      stateShares: Object.freeze({ long: null, cash: null }),
      completedCashEpisodes: 0,
    });
  const adequacy = computeForecastAdequacy(
    analysis, normalizedMarket, recomputedM1, recomputedM0, mse,
  );
  const matchedControls = buildMatchedControls(analysis, summaries.m1Primary, summaries.m1Stress);
  const scoreability = evaluateScoreability(materialized, options);
  const placebo = evaluatePlaceboEvidence(options.placeboEvidence, analysis.market.key);

  const x2Pass = wealthRatios.primary.full >= CONFIG.x2MinimumRatio
    && wealthRatios.stress.full >= CONFIG.x2MinimumRatio;
  const halvesPass = wealthRatios.primary.firstHalf > CONFIG.halfMinimumRatioExclusive
    && wealthRatios.primary.secondHalf > CONFIG.halfMinimumRatioExclusive
    && wealthRatios.stress.firstHalf > CONFIG.halfMinimumRatioExclusive
    && wealthRatios.stress.secondHalf > CONFIG.halfMinimumRatioExclusive;
  const incrementalPass = isFiniteNumber(mse.improvement)
    && mse.improvement >= CONFIG.minimumMseImprovement
    && m1VsM0.primary > 1 && m1VsM0.stress > 1;
  const stateBalancePass = scoredDecisions.stateShares.long !== null
    && scoredDecisions.stateShares.long >= CONFIG.minimumStateShare
    && scoredDecisions.stateShares.cash >= CONFIG.minimumStateShare;
  const episodesPass = scoredDecisions.completedCashEpisodes >= CONFIG.minimumCompletedCashEpisodes;
  const riskPass = summaries.m1Primary.realizedVolatility
      <= summaries.buyAndHold.realizedVolatility + CONFIG.numericalTolerance
    && summaries.m1Stress.realizedVolatility
      <= summaries.buyAndHold.realizedVolatility + CONFIG.numericalTolerance
    && summaries.m1Primary.maximumDrawdown
      <= summaries.buyAndHold.maximumDrawdown + CONFIG.numericalTolerance
    && summaries.m1Stress.maximumDrawdown
      <= summaries.buyAndHold.maximumDrawdown + CONFIG.numericalTolerance;

  const gates = Object.freeze({
    dataIntegrity: integrityFailures.length === 0
      ? freezeGate(GATE_STATUS.PASS, true, { failures: Object.freeze([]) })
      : freezeGate(GATE_STATUS.FAIL, false, { failures: Object.freeze(integrityFailures.sort()) }),
    scoreability,
    adequacy: adequacy.failed.length === 0
      ? freezeGate(GATE_STATUS.PASS, true, adequacy)
      : freezeGate(GATE_STATUS.UNDERPOWERED, false, adequacy),
    x2: freezeGate(x2Pass ? GATE_STATUS.PASS : GATE_STATUS.FAIL, x2Pass, {
      minimum: CONFIG.x2MinimumRatio,
      primaryRatio: wealthRatios.primary.full,
      stressRatio: wealthRatios.stress.full,
    }),
    chronologicalHalves: freezeGate(halvesPass ? GATE_STATUS.PASS : GATE_STATUS.FAIL, halvesPass, {
      minimumExclusive: CONFIG.halfMinimumRatioExclusive,
      primaryFirstHalf: wealthRatios.primary.firstHalf,
      primarySecondHalf: wealthRatios.primary.secondHalf,
      stressFirstHalf: wealthRatios.stress.firstHalf,
      stressSecondHalf: wealthRatios.stress.secondHalf,
      boundaryPriceIndex: wealthRatios.primary.halfBoundaryPriceIndex,
    }),
    m1Incremental: freezeGate(incrementalPass ? GATE_STATUS.PASS : GATE_STATUS.FAIL, incrementalPass, {
      minimumMseImprovement: CONFIG.minimumMseImprovement,
      mseImprovement: mse.improvement,
      primaryWealthRatioVsM0: m1VsM0.primary,
      stressWealthRatioVsM0: m1VsM0.stress,
    }),
    stateBalance: freezeGate(stateBalancePass ? GATE_STATUS.PASS : GATE_STATUS.FAIL, stateBalancePass, {
      minimumEachStateShare: CONFIG.minimumStateShare,
      ...scoredDecisions,
    }),
    cashEpisodes: freezeGate(episodesPass ? GATE_STATUS.PASS : GATE_STATUS.FAIL, episodesPass, {
      minimumCompletedCashEpisodes: CONFIG.minimumCompletedCashEpisodes,
      completedCashEpisodes: scoredDecisions.completedCashEpisodes,
    }),
    risk: freezeGate(riskPass ? GATE_STATUS.PASS : GATE_STATUS.FAIL, riskPass, {
      m1PrimaryVolatility: summaries.m1Primary.realizedVolatility,
      m1StressVolatility: summaries.m1Stress.realizedVolatility,
      benchmarkVolatility: summaries.buyAndHold.realizedVolatility,
      m1PrimaryMaximumDrawdown: summaries.m1Primary.maximumDrawdown,
      m1StressMaximumDrawdown: summaries.m1Stress.maximumDrawdown,
      benchmarkMaximumDrawdown: summaries.buyAndHold.maximumDrawdown,
    }),
    exposureMatchedControl: freezeGate(
      matchedControls.exposureGatePass ? GATE_STATUS.PASS : GATE_STATUS.FAIL,
      matchedControls.exposureGatePass,
      {
        control: matchedControls.exposureMatched,
        m1PrimaryTerminalWealth: summaries.m1Primary.terminalWealthFactor,
        m1StressTerminalWealth: summaries.m1Stress.terminalWealthFactor,
      },
    ),
    volatilityMatchedControl: freezeGate(
      matchedControls.volatilityGatePass ? GATE_STATUS.PASS : GATE_STATUS.FAIL,
      matchedControls.volatilityGatePass,
      {
        control: matchedControls.volatilityMatched,
        m1PrimaryTerminalWealth: summaries.m1Primary.terminalWealthFactor,
        m1StressTerminalWealth: summaries.m1Stress.terminalWealthFactor,
      },
    ),
    placebo,
  });

  let status;
  if (!gates.dataIntegrity.passed) status = STATUS.FAIL;
  else if (!gates.scoreability.passed) status = STATUS.UNSCORABLE;
  else if (!gates.adequacy.passed) status = STATUS.UNDERPOWERED;
  else {
    const mandatory = Object.entries(gates)
      .filter(([name]) => !['dataIntegrity', 'scoreability', 'adequacy'].includes(name))
      .map(([, gate]) => gate);
    status = mandatory.every((gate) => gate.passed) ? STATUS.PASS : STATUS.FAIL;
  }

  const result = {
    schemaVersion: SCHEMA_VERSION,
    analyzerId: ANALYZER_ID,
    modelId: MODEL_ID,
    status,
    evidenceStatus: core.EVIDENCE_STATUS,
    market: Object.freeze({ ...analysis.market }),
    sourceKind: materialized.sourceKind,
    metrics: Object.freeze({
      wealthRatios,
      m1VsM0TerminalWealth: m1VsM0,
      prequentialMse: mse,
      pathSummaries: summaries,
      scoredDecisions,
      matchedControls,
    }),
    gates,
    investmentClaimAllowed: false,
    wording: status === STATUS.UNSCORABLE
      ? 'UNSCORABLE - zero-cash or non-investable diagnostic only; no x2 investment claim.'
      : status === STATUS.UNDERPOWERED
        ? 'UNDERPOWERED - mandatory evidence minimums are not met.'
        : status === STATUS.FAIL
          ? 'FAIL - one or more mandatory frozen gates failed or remain incomplete.'
          : 'PASS - frozen research gates only; not validated, trusted, deployable, or investment advice.',
    identities: Object.freeze({
      analyzer: getAnalyzerIdentity(),
      sourceAnalysisSha256: analysis.analysisSha256,
      placeboAnalysisSha256: null,
    }),
  };
  result.resultSha256 = core.hashCanonical(result);
  return deepFreeze(result);
}

function analyzeFrozenResults(inputs, options = {}) {
  assert(Array.isArray(inputs) && inputs.length === FROZEN_MARKET_SPECS.length,
    'Universal analysis requires exactly five frozen markets');
  const trustedInputs = inputs.map((input, index) => {
    const expected = FROZEN_MARKET_SPECS[index];
    const suppliedMarket = input && input.market;
    assert(suppliedMarket, `Frozen market ${index} input is missing`);
    const stableMarketInput = snapshotPlainData(suppliedMarket, `Frozen market ${index}`);
    const targetAdjusted = stableMarketInput.targetAdjusted;
    const market = core.normalizeMarket(stableMarketInput);
    assert(market.key === expected.key, `Frozen market ${index} key/order drifted`);
    assert(market.targetId === expected.targetId, `${expected.key}: target identity drifted`);
    assert(market.annualization === expected.annualization,
      `${expected.key}: annualization drifted`);
    assert(market.marketClass === expected.marketClass,
      `${expected.key}: market class drifted`);
    if (expected.requiresAdjusted) {
      assert(targetAdjusted === true,
        `${expected.key}: adjusted target evidence is missing`);
    }
    return Object.freeze({ market });
  });
  const markets = trustedInputs.map((input) => analyzeFrozenMarketResult(input, options));
  let status;
  if (markets.some((market) => market.status === STATUS.FAIL)) status = STATUS.FAIL;
  else if (markets.some((market) => market.status === STATUS.UNSCORABLE)) status = STATUS.UNSCORABLE;
  else if (markets.some((market) => market.status === STATUS.UNDERPOWERED)) status = STATUS.UNDERPOWERED;
  else status = STATUS.PASS;
  const result = {
    schemaVersion: SCHEMA_VERSION,
    analyzerId: ANALYZER_ID,
    modelId: MODEL_ID,
    status,
    universalPass: status === STATUS.PASS && markets.every((market) => market.status === STATUS.PASS),
    markets: Object.freeze(markets),
    investmentClaimAllowed: false,
    identities: Object.freeze({
      analyzer: getAnalyzerIdentity(),
      marketResultHashes: Object.freeze(markets.map((market) => market.resultSha256)),
      frozenMarketFamilySha256: core.hashCanonical(FROZEN_MARKET_SPECS),
      orderedMarketKeys: Object.freeze(FROZEN_MARKET_SPECS.map((market) => market.key)),
      orderedTargetIds: Object.freeze(FROZEN_MARKET_SPECS.map((market) => market.targetId)),
    }),
  };
  result.resultSha256 = core.hashCanonical(result);
  return deepFreeze(result);
}

module.exports = Object.freeze({
  ANALYZER_ID,
  MODEL_ID,
  SCHEMA_VERSION,
  FROZEN_MARKET_SPECS,
  STATUS,
  GATE_STATUS,
  CONFIG,
  getAnalyzerIdentity,
  deepFreeze,
  validatePrequentialSummary,
  summarizePath,
  relativeWealthMetrics,
  computeMseMetrics,
  scoredDecisionDiagnostics,
  constantMixFromBenchmarkPath,
  buildMatchedControls,
  evaluatePlaceboEvidence,
  analyzeFrozenMarketResult,
  analyzeFrozenResults,
});
