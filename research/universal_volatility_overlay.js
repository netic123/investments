'use strict';

// Frozen, research-only universal volatility-overlay runner. It intentionally
// contains no downloader and accepts one physically separate stage input.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const PROTOCOL_PATH = path.join(__dirname, 'UNIVERSAL_VOLATILITY_OVERLAY_PROTOCOL.md');
const TEST_PATH = path.join(__dirname, '..', 'test', 'universal_volatility_overlay.test.js');
const PROTOCOL_MARKER = 'FROZEN_UNIVERSAL_VOL_OVERLAY_V1';
const PROTOCOL_SHA256 = '601bb020265d593d057bccc259854871e032a025bd708412eba878d8ab0d9406';
const INPUT_SCHEMA = 'universal-vol-overlay-input-v1';
const SELECTION_MANIFEST_SCHEMA = 'universal-vol-overlay-selection-manifest-v1';
const VALIDATION_MANIFEST_SCHEMA = 'universal-vol-overlay-validation-manifest-v1';
const EVALUATION_RESULT_SCHEMA = 'universal-vol-overlay-evaluation-result-v1';
const MARKET_KEYS = Object.freeze(['crypto', 'sweden', 'usa', 'europe', 'global']);
const DEVELOPMENT_MARKET_KEYS = Object.freeze(['sweden', 'usa', 'europe', 'global']);
const REVISION_STATUSES = Object.freeze([
  'point_in_time_revision_zero',
  'current_vintage_revised_history',
  'provider_backcast',
]);
const YEAR_DAYS = 365.2425;
const MAX_CASH_STALE_DAYS = 7;
const MIN_MONTHLY_INTERVALS = 15;
const ANCHOR_MONTHS = 12;
const NO_TRADE_BAND = 0.10;
const MIN_TARGET = 0.50;
const MIN_EQUITY_TO_LONG_NOTIONAL = 0.40;
const BOOTSTRAP_REPLICATES = 10000;
const BOOTSTRAP_BLOCK_MONTHS = 6;
const BOOTSTRAP_SEED = 20260825;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

const CANDIDATES = deepFreeze([
  { id: 'IVOL_125', p: 0.5, upperCap: 1.25 },
  { id: 'IVOL_150', p: 0.5, upperCap: 1.50 },
  { id: 'IVAR_125', p: 1.0, upperCap: 1.25 },
  { id: 'IVAR_150', p: 1.0, upperCap: 1.50 },
]);

const SCENARIOS = deepFreeze([
  { id: 'primary', oneWayTransactionCost: 0.002, borrowingSpreadAnnual: 0.015 },
  { id: 'stress', oneWayTransactionCost: 0.005, borrowingSpreadAnnual: 0.030 },
]);

const STAGES = deepFreeze({
  development: {
    marketKeys: [...DEVELOPMENT_MARKET_KEYS],
    minimumExecutedMonthlyHoldings: 60,
    warmupVarianceStartDate: null,
    segmentStartDate: null,
    finalCompletedDate: '2018-12-31',
  },
  validation: {
    marketKeys: [...MARKET_KEYS],
    minimumExecutedMonthlyHoldings: 24,
    warmupVarianceStartDate: '2017-12-01',
    segmentStartDate: '2019-01-01',
    finalCompletedDate: '2022-12-31',
  },
  evaluation: {
    marketKeys: [...MARKET_KEYS],
    minimumExecutedMonthlyHoldings: 24,
    warmupVarianceStartDate: '2021-12-01',
    segmentStartDate: '2023-01-01',
    finalCompletedDate: null,
  },
});

const IMPLEMENTATION_CONVENTIONS = deepFreeze({
  volatilityEstimator: 'sample_standard_deviation_of_close_to_close_log_returns',
  sharpeEstimator: 'sample_standard_deviation_of_close_to_close_log_excess_returns',
  deployableDiagnosticDevelopmentMean: 'one pooled calendar-day-weighted mean target across the four Stage-1 equity markets; diagnostic only',
  segmentState: 'each stage restarts NAV from cash and initializes the first permitted signal preceding desired target to 1.00; no pre-segment desired target is carried',
  terminalCloseDeclaration: 'every series declares expectedLastCompletedCloseDate; it must equal the runner-derived exact frozen stage endpoint (Stage 2: 24/7 crypto and cash 2022-12-31, ETFs 2022-12-30; Stage 3: the frozen common executable close), and no terminal-row signal is executed before liquidation',
  partialTerminalMonth: 'an incomplete terminal calendar month remains reported but is not Gate-7-missing unless its state has a next-close execution strictly before terminal liquidation',
  priorStageReplay: 'before opening a current later-stage input, require each exact prior input as a committed clean canonical JSON artifact with a committed exact SHA-256 sidecar and canonically compare a full deterministic prior-stage rebuild',
  chronologyPrecision: 'date-level integrity only: last completed close date <= retrieval UTC calendar date <= input freeze UTC; intraday exchange-close timing still requires external source audit',
  noTradeCalendar: 'every valid monthly desired target is reported, but after entry only target changes outside or exactly at the band create trade events',
  percentileInterpolation: 'R7_linear_interpolation',
  cryptoUnderpoweredThresholdMonths: 60,
  sourceDeclarations: 'validated as schema declarations, not independently authenticated by this offline runner',
});

const INPUT_KEYS = deepFreeze({
  development: ['cashTotalReturn', 'frozenAtUtc', 'markets', 'schema', 'stage'],
  validation: ['cashTotalReturn', 'frozenAtUtc', 'markets', 'schema', 'stage'],
  evaluation: ['cashTotalReturn', 'finalCompletedDate', 'frozenAtUtc', 'markets', 'schema', 'stage'],
});
const COMMON_SERIES_KEYS = deepFreeze([
  'currency', 'executionVenue', 'expectedLastCompletedCloseDate', 'includesReinvestment',
  'instrumentIdentity', 'isPriceOnly', 'knownDataIssues', 'methodology',
  'retrievalUtc', 'revisionStatus', 'returnType', 'rows', 'sessionTimezone', 'source',
]);
const CASH_SERIES_KEYS = deepFreeze([
  ...COMMON_SERIES_KEYS, 'isReconstructedFromYield', 'isYieldSeries', 'role', 'tenorMonths',
]);
const RISKY_SERIES_KEYS = deepFreeze([
  ...COMMON_SERIES_KEYS, 'executable', 'key', 'marginEligible', 'marginRuleSource',
  'maxTargetExposure', 'replicableAtRecordedCloses', 'role', 'usdConversion',
]);
const SELECTION_MANIFEST_KEYS = deepFreeze([
  'allFourCandidateResults', 'developmentInputSha256', 'developmentPooledMeanTargetDiagnostic',
  'nextStageSealedUnlessCommitted', 'protocol', 'researchOnly', 'runnerSha256', 'schema',
  'selectedCandidate', 'selectedCandidateParameters', 'stagePass', 'status', 'testSha256',
]);
const VALIDATION_MANIFEST_KEYS = deepFreeze([
  'frozenDevelopmentMeanTargetDiagnostic', 'protocol', 'researchOnly', 'runnerSha256', 'schema',
  'selectedCandidate', 'selectedCandidateResults', 'selectionManifestSha256', 'stage3SealedUnlessCommittedPass',
  'stagePass', 'status', 'testSha256', 'validationInputSha256',
]);
const EVALUATION_RESULT_KEYS = deepFreeze([
  'evaluationInputSha256', 'frozenDevelopmentMeanTargetDiagnostic', 'interpretation', 'productionApproved',
  'protocol', 'researchOnly', 'runnerSha256', 'schema', 'selectedCandidate', 'selectedCandidateResults',
  'selectionManifestSha256', 'stagePass', 'status', 'testSha256', 'validationManifestSha256',
]);
const REPLAY_RECEIPT_TOKEN = Symbol('universal-vol-overlay-prior-stage-replay');
const COMMITTED_ARTIFACT_TOKEN = Symbol('universal-vol-overlay-committed-artifact');
const ANALYSIS_KEYS = deepFreeze([
  'candidateSummaries', 'candidates', 'equalWeightMarketAverages', 'excludedCostsDisclosure',
  'implementationConventions', 'inputSchema', 'inputSha256', 'inputStage', 'marketDependenceWarning',
  'marketResults', 'protocol', 'revisionEvidence', 'runnerSha256', 'sourceDeclarationWarning',
  'stageConfig', 'stagePass',
]);
const MARKET_RESULT_KEYS = deepFreeze([
  'actualTradeSchedules', 'cashAlignmentRejections', 'desiredTargetCalendars', 'eligibleExecutedMonthlyHoldings',
  'documentedMaximumTargetExposure', 'evidenceClass', 'firstExecutionDate', 'instrumentIdentity', 'intervalRejections', 'knownDataIssues',
  'market', 'minimumExecutedMonthlyHoldings', 'missingRequiredMonths', 'missingVarianceMonths',
  'monthlyStates', 'omittedTerminalExecutionsByCandidate', 'requiredCashAlignmentRejections',
  'requiredIntervalRejections', 'revisionStatus', 'scenarioResults', 'sourceAndIntervalsComplete',
  'staleTargetMonths', 'targetCalendarByCandidate', 'terminalDate', 'unfilledTerminalSignals',
]);
const SCENARIO_RESULT_KEYS = deepFreeze(['benchmarks', 'bootstrap', 'candidate', 'controls', 'gates']);
const CONTROL_KEYS = deepFreeze([
  'constantMeanExposure', 'constantMeanExposureTarget', 'constantVolatilityDistance',
  'constantVolatilityMatched', 'constantVolatilityMatchedTarget', 'frozenDevelopmentMeanDiagnostic',
  'frozenDevelopmentMeanDiagnosticTarget', 'volatilityGridTargetsRejectedAboveDocumentedMarginLimit',
  'volatilityGridTargetsTested',
]);
const SIMULATION_KEYS = deepFreeze(['events', 'executionFailure', 'label', 'metrics', 'navPath', 'terminalLiquidationPerformed', 'valid']);
const METRIC_KEYS = deepFreeze([
  'annualizedLogReturn', 'annualizedVolatility', 'calendarDays', 'elapsedYears', 'endDate',
  'excessReturnSharpeRatio', 'grossBorrowingCost', 'intervalCount', 'maximumDrawdown',
  'maximumRealizedLeverage', 'minimumEquityToLongNotional', 'rebalanceCount', 'scheduledExecutionCount',
  'startDate', 'terminalLiquidationPerformed', 'terminalWealth', 'timeAboveOneExposureCalendarDays',
  'timeAboveOneExposureFraction', 'timeWeightedMeanTarget', 'totalOneWayRiskyTradedNotional',
  'totalOneWayRiskyTurnover', 'transactionCost', 'turnoverPerElapsedYear',
]);

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function runnerSha256() {
  return sha256File(__filename);
}

function testSha256() {
  return sha256File(TEST_PATH);
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

function assertExactKeys(value, expectedKeys, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.join(',') !== expected.join(',')) {
    const missing = expected.filter(key => !actual.includes(key));
    const unexpected = actual.filter(key => !expected.includes(key));
    throw new Error(`${context} keys must be exactly ${expected.join(',')} (missing: ${missing.join(',') || 'none'}; unexpected: ${unexpected.join(',') || 'none'})`);
  }
  return value;
}

function assertProtocolFrozen() {
  const bytes = fs.readFileSync(PROTOCOL_PATH);
  const digest = sha256Buffer(bytes);
  const text = bytes.toString('utf8');
  const marker = /<!--\s*UNIVERSAL_VOL_OVERLAY_FREEZE_MARKER:\s*([^\s]+)\s*-->/.exec(text);
  if (!marker || marker[1] !== PROTOCOL_MARKER) throw new Error(`universal volatility-overlay freeze marker mismatch: ${marker ? marker[1] : 'missing'}`);
  if (digest !== PROTOCOL_SHA256) throw new Error(`universal volatility-overlay protocol hash mismatch: expected ${PROTOCOL_SHA256}, got ${digest}`);
  return { marker: marker[1], sha256: digest };
}

function requireText(value, context) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${context} must be a non-empty string`);
  return value;
}

function parseIsoUtc(value, context) {
  requireText(value, context);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) throw new Error(`${context} must be an exact ISO UTC timestamp`);
  return milliseconds;
}

function dateMilliseconds(value, context = 'date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${context} must be YYYY-MM-DD`);
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== value) throw new Error(`${context} is not a valid calendar date: ${value}`);
  return milliseconds;
}

function calendarDays(first, last) {
  return (dateMilliseconds(last, 'last date') - dateMilliseconds(first, 'first date')) / 86400000;
}

function offsetDate(date, deltaDays) {
  return new Date(dateMilliseconds(date) + deltaDays * 86400000).toISOString().slice(0, 10);
}

function monthKey(date) {
  dateMilliseconds(date);
  return date.slice(0, 7);
}

function offsetMonth(key, delta) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}$/.test(key)) throw new Error(`invalid month key ${key}`);
  const date = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

function monthRange(first, last) {
  const result = [];
  for (let key = first; key <= last; key = offsetMonth(key, 1)) result.push(key);
  return result;
}

function assertKnownDataIssues(value, context) {
  if (!Array.isArray(value) || value.some(issue => typeof issue !== 'string' || !issue.trim())) {
    throw new Error(`${context}.knownDataIssues must be an array of non-empty strings`);
  }
}

function validateRows(rows, context, limits) {
  if (!Array.isArray(rows) || rows.length < 2) throw new Error(`${context}.rows must contain at least two observations`);
  let previous = '';
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!row || Object.keys(row).sort().join(',') !== 'date,value') throw new Error(`${context}.rows[${index}] must contain exactly date and value`);
    dateMilliseconds(row.date, `${context}.rows[${index}].date`);
    if (previous && row.date <= previous) throw new Error(`${context}.rows must be strictly ordered with unique dates`);
    if (typeof row.value !== 'number' || !Number.isFinite(row.value) || !(row.value > 0)) throw new Error(`${context}.rows[${index}].value must be a finite positive number`);
    if (limits.minimum && row.date < limits.minimum) throw new Error(`${context}.rows contains ${row.date} before permitted ${limits.minimum}`);
    if (limits.maximum && row.date > limits.maximum) throw new Error(`${context}.rows contains ${row.date} after permitted ${limits.maximum}`);
    previous = row.date;
  }
  return rows;
}

function validateCommonSeriesMetadata(series, context, frozenAtMilliseconds) {
  requireText(series.source, `${context}.source`);
  requireText(series.methodology, `${context}.methodology`);
  if (series.currency !== 'USD') throw new Error(`${context}.currency must be USD`);
  if (series.returnType !== 'total_return_wealth_index') throw new Error(`${context}.returnType must be total_return_wealth_index`);
  requireText(series.instrumentIdentity, `${context}.instrumentIdentity`);
  requireText(series.executionVenue, `${context}.executionVenue`);
  requireText(series.sessionTimezone, `${context}.sessionTimezone`);
  const retrievalMilliseconds = parseIsoUtc(series.retrievalUtc, `${context}.retrievalUtc`);
  if (retrievalMilliseconds > frozenAtMilliseconds) throw new Error(`${context}.retrievalUtc must not be later than input.frozenAtUtc`);
  dateMilliseconds(series.expectedLastCompletedCloseDate, `${context}.expectedLastCompletedCloseDate`);
  if (series.expectedLastCompletedCloseDate > new Date(retrievalMilliseconds).toISOString().slice(0, 10)) {
    throw new Error(`${context}.expectedLastCompletedCloseDate must not be later than its retrieval UTC date`);
  }
  if (!REVISION_STATUSES.includes(series.revisionStatus)) throw new Error(`${context}.revisionStatus is invalid`);
  if (series.isPriceOnly !== false) throw new Error(`${context}.isPriceOnly must be false`);
  if (series.includesReinvestment !== true) throw new Error(`${context}.includesReinvestment must be true`);
  assertKnownDataIssues(series.knownDataIssues, context);
}

function validateCashSeries(series, stageConfig, frozenAtMilliseconds) {
  const context = 'cashTotalReturn';
  assertExactKeys(series, CASH_SERIES_KEYS, context);
  validateCommonSeriesMetadata(series, context, frozenAtMilliseconds);
  if (series.role !== 'usd_3m_tbill_total_return_wealth_index') throw new Error(`${context}.role must be usd_3m_tbill_total_return_wealth_index`);
  if (series.tenorMonths !== 3) throw new Error(`${context}.tenorMonths must equal 3`);
  if (series.isYieldSeries !== false) throw new Error(`${context}.isYieldSeries must be false`);
  if (series.isReconstructedFromYield !== false) throw new Error(`${context}.isReconstructedFromYield must be false`);
  const identity = `${series.instrumentIdentity} ${series.source} ${series.methodology}`;
  if (/(^|\W)(\^IRX|IRX|DTB3|IEF)(\W|$)|annualized\s+yield|discount[- ]basis\s+yield|zero\s+cash/i.test(identity)) {
    throw new Error(`${context} identifies a forbidden yield, bond-ETF, or zero-cash substitute`);
  }
  // A stage may carry one final risky seed close immediately before the first
  // warm-up variance month, and that seed may itself use a seven-day-old cash
  // close. No earlier cash outcome is admitted.
  const minimum = stageConfig.warmupVarianceStartDate ? offsetDate(stageConfig.warmupVarianceStartDate, -2 * MAX_CASH_STALE_DAYS) : null;
  const rows = validateRows(series.rows, context, { minimum, maximum: stageConfig.finalCompletedDate });
  if (rows.at(-1).date !== series.expectedLastCompletedCloseDate) throw new Error(`${context}.rows must end at declared expectedLastCompletedCloseDate ${series.expectedLastCompletedCloseDate}`);
  return rows;
}

function validateRiskySeries(series, expectedKey, stageConfig, frozenAtMilliseconds) {
  const context = `markets.${expectedKey}`;
  assertExactKeys(series, RISKY_SERIES_KEYS, context);
  validateCommonSeriesMetadata(series, context, frozenAtMilliseconds);
  if (series.key !== expectedKey) throw new Error(`${context}.key must be ${expectedKey}`);
  if (series.role !== 'executable_risky_total_return_wealth_index') throw new Error(`${context}.role must be executable_risky_total_return_wealth_index`);
  if (series.executable !== true || series.replicableAtRecordedCloses !== true) throw new Error(`${context} must be executable and replicable at recorded closes`);
  if (typeof series.marginEligible !== 'boolean') throw new Error(`${context}.marginEligible must be boolean`);
  if (typeof series.maxTargetExposure !== 'number' || !Number.isFinite(series.maxTargetExposure) || series.maxTargetExposure < 1) {
    throw new Error(`${context}.maxTargetExposure must be a documented finite number at least 1`);
  }
  if (!series.marginEligible && series.maxTargetExposure !== 1) throw new Error(`${context} is non-margin-eligible and maxTargetExposure must equal 1`);
  requireText(series.marginRuleSource, `${context}.marginRuleSource`);
  if ((expectedKey === 'sweden' || expectedKey === 'europe') && series.usdConversion !== 'unhedged_to_usd') {
    throw new Error(`${context}.usdConversion must be unhedged_to_usd`);
  }
  if (expectedKey !== 'sweden' && expectedKey !== 'europe' && series.usdConversion !== 'native_usd') {
    throw new Error(`${context}.usdConversion must be native_usd`);
  }
  const rows = validateRows(series.rows, context, { minimum: null, maximum: stageConfig.finalCompletedDate });
  if (rows.at(-1).date !== series.expectedLastCompletedCloseDate) throw new Error(`${context}.rows must end at declared expectedLastCompletedCloseDate ${series.expectedLastCompletedCloseDate}`);
  if (stageConfig.warmupVarianceStartDate) {
    const seedRows = rows.filter(row => row.date < stageConfig.warmupVarianceStartDate);
    if (seedRows.length > 1) throw new Error(`${context}.rows may contain at most one risky seed close before ${stageConfig.warmupVarianceStartDate}`);
    if (seedRows.length === 1) {
      const distance = calendarDays(seedRows[0].date, stageConfig.warmupVarianceStartDate);
      if (distance > MAX_CASH_STALE_DAYS) throw new Error(`${context}.rows risky seed close is more than seven calendar days before ${stageConfig.warmupVarianceStartDate}`);
      if (rows[0] !== seedRows[0]) throw new Error(`${context}.rows risky seed close must be the first row`);
    }
  }
  return rows;
}

function validateInput(input, expectedStage) {
  assertProtocolFrozen();
  if (!STAGES[expectedStage]) throw new Error(`unknown stage ${expectedStage}`);
  assertExactKeys(input, INPUT_KEYS[expectedStage], 'input');
  if (input.schema !== INPUT_SCHEMA) throw new Error(`input.schema must be ${INPUT_SCHEMA}`);
  if (input.stage !== expectedStage) throw new Error(`input.stage must be ${expectedStage}`);
  const frozenAtMilliseconds = parseIsoUtc(input.frozenAtUtc, 'input.frozenAtUtc');
  const base = STAGES[expectedStage];
  const finalCompletedDate = expectedStage === 'evaluation'
    ? (dateMilliseconds(input.finalCompletedDate, 'input.finalCompletedDate'), input.finalCompletedDate)
    : base.finalCompletedDate;
  if (expectedStage === 'evaluation' && finalCompletedDate < base.segmentStartDate) throw new Error('evaluation finalCompletedDate precedes 2023-01-01');
  if (expectedStage === 'evaluation' && finalCompletedDate > new Date(frozenAtMilliseconds).toISOString().slice(0, 10)) {
    throw new Error('evaluation finalCompletedDate is not pre-frozen');
  }
  const stageConfig = { ...base, finalCompletedDate };
  validateCashSeries(input.cashTotalReturn, stageConfig, frozenAtMilliseconds);
  if (!Array.isArray(input.markets) || input.markets.map(market => market && market.key).join(',') !== stageConfig.marketKeys.join(',')) {
    throw new Error(`${expectedStage} markets must be exactly ${stageConfig.marketKeys.join(',')} in that order`);
  }
  input.markets.forEach((market, index) => validateRiskySeries(market, stageConfig.marketKeys[index], stageConfig, frozenAtMilliseconds));
  const declaredTerminalCloses = expectedTerminalCloses(expectedStage, finalCompletedDate);
  if (input.cashTotalReturn.expectedLastCompletedCloseDate !== declaredTerminalCloses.cash) {
    throw new Error(`cashTotalReturn.expectedLastCompletedCloseDate must equal the frozen ${expectedStage} endpoint ${declaredTerminalCloses.cash}`);
  }
  for (const market of input.markets) {
    if (market.expectedLastCompletedCloseDate !== declaredTerminalCloses[market.key]) {
      throw new Error(`markets.${market.key}.expectedLastCompletedCloseDate must equal the frozen ${expectedStage} endpoint ${declaredTerminalCloses[market.key]}`);
    }
  }
  return {
    input,
    stageConfig: {
      ...stageConfig,
      declaredTerminalCloses,
    },
  };
}

function expectedTerminalCloses(stage, finalCompletedDate) {
  if (!STAGES[stage]) throw new Error(`unknown stage ${stage}`);
  dateMilliseconds(finalCompletedDate, `${stage} finalCompletedDate`);
  if (stage === 'development') {
    return Object.freeze({ cash: '2018-12-31', sweden: '2018-12-31', usa: '2018-12-31', europe: '2018-12-31', global: '2018-12-31' });
  }
  if (stage === 'validation') {
    return Object.freeze({
      cash: '2022-12-31',
      crypto: '2022-12-31', // The executable crypto close series is explicitly 24/7.
      sweden: '2022-12-30',
      usa: '2022-12-30',
      europe: '2022-12-30',
      global: '2022-12-30',
    });
  }
  return Object.freeze(Object.fromEntries([
    ['cash', finalCompletedDate],
    ...MARKET_KEYS.map(key => [key, finalCompletedDate]), // Evaluation finalCompletedDate is itself the frozen common executable close.
  ]));
}

function lastIndexOnOrBefore(rows, date) {
  let low = 0;
  let high = rows.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (rows[middle].date <= date) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

function alignCashToRisky(riskyRows, cashRows) {
  const rows = [];
  const rejections = [];
  for (const risky of riskyRows) {
    const cashIndex = lastIndexOnOrBefore(cashRows, risky.date);
    if (cashIndex < 0) {
      rows.push({ ...risky, cashDate: null, cashValue: null });
      rejections.push({ type: 'missing_cash_asof', riskyDate: risky.date });
      continue;
    }
    const cash = cashRows[cashIndex];
    const staleDays = calendarDays(cash.date, risky.date);
    if (staleDays > MAX_CASH_STALE_DAYS) {
      rows.push({ ...risky, cashDate: cash.date, cashValue: null });
      rejections.push({ type: 'stale_cash_asof', riskyDate: risky.date, cashDate: cash.date, staleCalendarDays: staleDays });
      continue;
    }
    rows.push({ ...risky, cashDate: cash.date, cashValue: cash.value, cashStaleCalendarDays: staleDays });
  }
  return { rows, rejections };
}

function median(values) {
  if (!Array.isArray(values) || !values.length || values.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error('median requires finite values');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildMonthlyVarianceStates(alignedRows) {
  if (!Array.isArray(alignedRows) || alignedRows.length < 2) throw new Error('monthly variance requires at least two risky closes');
  const byMonth = new Map();
  const intervalRejections = [];
  const lastRowIndexByMonth = new Map();
  alignedRows.forEach((row, index) => lastRowIndexByMonth.set(monthKey(row.date), index));
  for (let index = 1; index < alignedRows.length; index++) {
    const prior = alignedRows[index - 1];
    const row = alignedRows[index];
    const key = monthKey(row.date);
    const bucket = byMonth.get(key) || { excessReturns: [], intervalCount: 0, rejectedIntervalCount: 0 };
    bucket.intervalCount++;
    if (!(prior.cashValue > 0) || !(row.cashValue > 0)) {
      bucket.rejectedIntervalCount++;
      intervalRejections.push({ type: 'missing_permitted_cash_return', startDate: prior.date, endDate: row.date });
    } else {
      const excessLogReturn = Math.log(row.value / prior.value) - Math.log(row.cashValue / prior.cashValue);
      if (!Number.isFinite(excessLogReturn)) throw new Error(`non-finite excess return ending ${row.date}`);
      bucket.excessReturns.push(excessLogReturn);
    }
    byMonth.set(key, bucket);
  }

  const keys = monthRange(monthKey(alignedRows[0].date), monthKey(alignedRows.at(-1).date));
  const states = keys.map(key => {
    const bucket = byMonth.get(key) || { excessReturns: [], intervalCount: 0, rejectedIntervalCount: 0 };
    const variance = bucket.excessReturns.length >= MIN_MONTHLY_INTERVALS
      ? bucket.excessReturns.reduce((sum, value) => sum + value * value, 0) / bucket.excessReturns.length
      : null;
    const closeIndex = lastRowIndexByMonth.has(key) ? lastRowIndexByMonth.get(key) : null;
    return {
      month: key,
      finalRiskyClose: closeIndex == null ? null : alignedRows[closeIndex].date,
      finalRiskyCloseIndex: closeIndex,
      validIntervalCount: bucket.excessReturns.length,
      observedIntervalCount: bucket.intervalCount,
      rejectedIntervalCount: bucket.rejectedIntervalCount,
      realizedVariance: variance,
      varianceMissingReason: variance == null
        ? (bucket.excessReturns.length < MIN_MONTHLY_INTERVALS ? `fewer_than_${MIN_MONTHLY_INTERVALS}_valid_intervals` : 'missing')
        : null,
      anchorVariance: null,
      varianceRatio: null,
      signalStatus: null,
      executionDate: null,
    };
  });

  for (let index = 0; index < states.length; index++) {
    const state = states[index];
    if (state.realizedVariance == null) {
      state.signalStatus = 'missing_current_month_variance';
      continue;
    }
    if (index < ANCHOR_MONTHS) {
      state.signalStatus = 'insufficient_prior_months';
      continue;
    }
    const prior = states.slice(index - ANCHOR_MONTHS, index);
    if (prior.some((item, offset) => item.month !== offsetMonth(state.month, offset - ANCHOR_MONTHS) || item.realizedVariance == null)) {
      state.signalStatus = 'missing_consecutive_anchor_month';
      continue;
    }
    const anchor = median(prior.map(item => item.realizedVariance));
    if (anchor === 0 && state.realizedVariance === 0) {
      state.signalStatus = 'undefined_zero_anchor_and_variance';
      continue;
    }
    state.anchorVariance = anchor;
    state.varianceRatio = state.realizedVariance === 0 ? Infinity : anchor / state.realizedVariance;
    const nextRow = state.finalRiskyCloseIndex == null ? null : alignedRows[state.finalRiskyCloseIndex + 1];
    if (!nextRow) {
      state.signalStatus = 'valid_but_no_next_executable_close';
      continue;
    }
    if (!(nextRow.date > state.finalRiskyClose)) throw new Error(`same-close execution attempted for ${state.month}`);
    state.executionDate = nextRow.date;
    state.signalStatus = 'valid_next_close_signal';
  }
  return { states, intervalRejections };
}

function assessRequiredCompleteness({
  monthlyStates,
  alignmentRejections,
  intervalRejections,
  knownDataIssues,
  firstExecutionDate,
  terminalDate,
}) {
  const firstRequiredMonth = firstExecutionDate == null ? null : monthKey(firstExecutionDate);
  const terminalMonth = monthKey(terminalDate);
  const requiredMonthlyStates = firstRequiredMonth == null
    ? []
    : monthlyStates.filter(state => state.month >= firstRequiredMonth && state.month <= terminalMonth);
  const requiresExecutableMonthlyState = state => state.month !== terminalMonth ||
    (state.executionDate != null && state.executionDate < terminalDate);
  const missingRequiredMonths = requiredMonthlyStates
    .filter(state => requiresExecutableMonthlyState(state) && state.realizedVariance == null)
    .map(state => ({
      month: state.month,
      finalRiskyClose: state.finalRiskyClose,
      validIntervalCount: state.validIntervalCount,
      observedIntervalCount: state.observedIntervalCount,
      rejectedIntervalCount: state.rejectedIntervalCount,
      reason: state.varianceMissingReason,
    }));
  const staleTargetMonths = requiredMonthlyStates
    .filter(state => requiresExecutableMonthlyState(state) && state.signalStatus !== 'valid_next_close_signal' && state.signalStatus !== 'valid_but_no_next_executable_close')
    .map(state => ({ month: state.month, finalRiskyClose: state.finalRiskyClose, reason: state.signalStatus }));
  const requiredCashAlignmentRejections = firstExecutionDate == null
    ? alignmentRejections
    : alignmentRejections.filter(rejection => rejection.riskyDate >= firstExecutionDate);
  const requiredIntervalRejections = firstExecutionDate == null
    ? intervalRejections
    : intervalRejections.filter(rejection => rejection.endDate >= firstExecutionDate);
  return {
    firstRequiredMonth,
    terminalMonth,
    missingRequiredMonths,
    staleTargetMonths,
    requiredCashAlignmentRejections,
    requiredIntervalRejections,
    sourceAndIntervalsComplete: firstExecutionDate != null && knownDataIssues.length === 0 &&
      requiredCashAlignmentRejections.length === 0 && requiredIntervalRejections.length === 0 &&
      missingRequiredMonths.length === 0 && staleTargetMonths.length === 0,
  };
}

function preliminaryTarget(varianceRatio, candidate) {
  if (!(varianceRatio >= 0) || (!Number.isFinite(varianceRatio) && varianceRatio !== Infinity)) throw new Error('varianceRatio must be non-negative');
  const raw = varianceRatio === Infinity ? Infinity : varianceRatio ** candidate.p;
  return Math.min(candidate.upperCap, Math.max(MIN_TARGET, raw));
}

function compareNoTradeBand(difference) {
  if (!(difference >= 0) || !Number.isFinite(difference)) throw new Error('no-trade-band difference must be finite and non-negative');
  const tolerance = 16 * Number.EPSILON * Math.max(1, Math.abs(difference), NO_TRADE_BAND);
  return {
    hold: difference < NO_TRADE_BAND - tolerance,
    equality: Math.abs(difference - NO_TRADE_BAND) <= tolerance,
  };
}

function buildCandidateSchedule(monthlyStates, candidate, stageConfig) {
  if (!CANDIDATES.some(item => item.id === candidate.id && item.p === candidate.p && item.upperCap === candidate.upperCap)) throw new Error(`candidate is not frozen: ${candidate && candidate.id}`);
  const terminalCloseDate = stageConfig.terminalCloseDate || stageConfig.finalCompletedDate;
  dateMilliseconds(terminalCloseDate, 'stageConfig.terminalCloseDate');
  let precedingDesiredTarget = 1;
  const desiredTargetCalendar = [];
  const actualTradeSchedule = [];
  const omittedTerminalExecutions = [];
  for (const state of monthlyStates) {
    if (state.signalStatus !== 'valid_next_close_signal') continue;
    if (stageConfig.segmentStartDate && state.executionDate < stageConfig.segmentStartDate) continue;
    if (state.executionDate > stageConfig.finalCompletedDate) continue;
    const preliminary = preliminaryTarget(state.varianceRatio, candidate);
    const difference = Math.abs(preliminary - precedingDesiredTarget);
    const band = compareNoTradeBand(difference);
    const desiredTarget = band.hold ? precedingDesiredTarget : preliminary;
    const firstEntry = desiredTargetCalendar.length === 0;
    const event = {
      signalMonth: state.month,
      signalDate: state.finalRiskyClose,
      executionDate: state.executionDate,
      anchorVariance: state.anchorVariance,
      realizedVariance: state.realizedVariance,
      varianceRatio: state.varianceRatio,
      preliminaryTarget: preliminary,
      precedingDesiredTarget,
      desiredTarget,
      noTradeBandHeld: band.hold,
      equalityAtBandTrades: band.equality,
      actualTradeRequired: firstEntry || !band.hold,
      actualTradeReason: firstEntry ? 'initial_entry_from_cash' : band.hold ? 'omitted_inside_no_trade_band' : 'desired_target_changed',
    };
    if (state.executionDate >= terminalCloseDate) {
      omittedTerminalExecutions.push({ ...event, actualTradeRequired: false, actualTradeReason: 'omitted_at_or_after_terminal_close' });
      continue;
    }
    desiredTargetCalendar.push(event);
    if (event.actualTradeRequired) actualTradeSchedule.push(event);
    precedingDesiredTarget = desiredTarget;
  }
  return { desiredTargetCalendar, actualTradeSchedule, omittedTerminalExecutions };
}

function exactRebalance({ wealth, riskyNotional, targetExposure, costRate }) {
  if (!(wealth > 0) || !(riskyNotional >= 0) || !(targetExposure >= 0) || !(costRate >= 0 && costRate < 1)) {
    throw new Error('invalid exact-rebalance inputs');
  }
  const currentExposure = riskyNotional / wealth;
  let postRisky;
  let side;
  if (targetExposure === currentExposure) {
    postRisky = riskyNotional;
    side = 'none';
  } else if (targetExposure > currentExposure) {
    postRisky = targetExposure * (wealth + costRate * riskyNotional) / (1 + targetExposure * costRate);
    side = 'buy';
  } else {
    const denominator = 1 - targetExposure * costRate;
    if (!(denominator > 0)) throw new Error('exact sell solution has no non-negative unique denominator');
    postRisky = targetExposure * (wealth - costRate * riskyNotional) / denominator;
    side = 'sell';
  }
  const tradedNotional = Math.abs(postRisky - riskyNotional);
  const transactionCost = costRate * tradedNotional;
  const postWealth = wealth - transactionCost;
  const postCash = postWealth - postRisky;
  if (!(postWealth > 0) || !(postRisky >= 0) || !Number.isFinite(postCash)) throw new Error('exact rebalance produced invalid post-trade holdings');
  const wealthError = Math.abs(postWealth - (wealth - costRate * Math.abs(postRisky - riskyNotional)));
  const targetError = Math.abs(postRisky - targetExposure * postWealth);
  if (wealthError > 1e-12 * Math.max(1, wealth) || targetError > 1e-12 * Math.max(1, postRisky, postWealth)) {
    throw new Error(`exact post-cost rebalance identity failed: wealthError=${wealthError}, targetError=${targetError}`);
  }
  return {
    side,
    preWealth: wealth,
    preRiskyNotional: riskyNotional,
    currentExposure,
    targetExposure,
    postWealth,
    postRisky,
    postCash,
    tradedNotional,
    transactionCost,
  };
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sampleStandardDeviation(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  let average = 0;
  let m2 = 0;
  for (let index = 0; index < values.length; index++) {
    const delta = values[index] - average;
    average += delta / (index + 1);
    m2 += delta * (values[index] - average);
  }
  return Math.sqrt(m2 / (values.length - 1));
}

function maximumDrawdown(curve) {
  let peak = 1;
  let worst = 0;
  for (const row of curve) {
    peak = Math.max(peak, row.wealth);
    worst = Math.min(worst, row.wealth / peak - 1);
  }
  return worst;
}

function assessHoldings(riskyNotional, cash, date, phase) {
  const wealth = riskyNotional + cash;
  if (!(wealth > 0)) return { failure: { type: 'non_positive_wealth', date, phase, wealth } };
  const leverage = riskyNotional / wealth;
  const equityToLongNotional = riskyNotional > 0 ? wealth / riskyNotional : null;
  if (equityToLongNotional != null && equityToLongNotional < MIN_EQUITY_TO_LONG_NOTIONAL) {
    return {
      failure: {
        type: 'equity_to_long_notional_below_research_floor',
        date,
        phase,
        equityToLongNotional,
        requiredMinimum: MIN_EQUITY_TO_LONG_NOTIONAL,
      },
    };
  }
  return { wealth, leverage, equityToLongNotional };
}

function summarizeSimulation({
  curve,
  totalTurnoverRatio,
  totalTradedNotional,
  rebalanceCount,
  scheduledExecutionCount,
  totalTransactionCost,
  grossBorrowingCost,
  targetDaySum,
  timeAboveOneDays,
  maximumRealizedLeverage,
  minimumEquityToLongNotional,
}) {
  if (!Array.isArray(curve) || curve.length < 2) throw new Error('simulation summary requires at least two close rows');
  const elapsedDays = calendarDays(curve[0].date, curve.at(-1).date);
  if (!(elapsedDays > 0)) throw new Error('simulation has no positive elapsed time');
  const elapsedYears = elapsedDays / YEAR_DAYS;
  const logReturns = [];
  const cashLogReturns = [];
  for (let index = 1; index < curve.length; index++) {
    if (!(curve[index - 1].wealth > 0) || !(curve[index].wealth > 0)) throw new Error('non-positive wealth cannot produce a return observation');
    logReturns.push(Math.log(curve[index].wealth / curve[index - 1].wealth));
    cashLogReturns.push(Math.log(curve[index].cashTriValue / curve[index - 1].cashTriValue));
  }
  const intervalCount = logReturns.length;
  const periodsPerYear = intervalCount / elapsedYears;
  const annualizer = Math.sqrt(periodsPerYear);
  const volatility = sampleStandardDeviation(logReturns);
  const excess = logReturns.map((value, index) => value - cashLogReturns[index]);
  const excessDeviation = sampleStandardDeviation(excess);
  const terminalWealth = curve.at(-1).wealth;
  return {
    startDate: curve[0].date,
    endDate: curve.at(-1).date,
    calendarDays: elapsedDays,
    elapsedYears,
    intervalCount,
    terminalWealth,
    annualizedLogReturn: Math.log(terminalWealth) / elapsedYears,
    annualizedVolatility: volatility == null ? null : volatility * annualizer,
    maximumDrawdown: maximumDrawdown(curve),
    excessReturnSharpeRatio: excessDeviation == null || excessDeviation === 0 ? null : mean(excess) / excessDeviation * annualizer,
    totalOneWayRiskyTurnover: totalTurnoverRatio,
    totalOneWayRiskyTradedNotional: totalTradedNotional,
    turnoverPerElapsedYear: totalTurnoverRatio / elapsedYears,
    rebalanceCount,
    scheduledExecutionCount,
    timeWeightedMeanTarget: targetDaySum / elapsedDays,
    maximumRealizedLeverage,
    minimumEquityToLongNotional,
    grossBorrowingCost,
    transactionCost: totalTransactionCost,
    timeAboveOneExposureCalendarDays: timeAboveOneDays,
    timeAboveOneExposureFraction: timeAboveOneDays / elapsedDays,
    terminalLiquidationPerformed: true,
  };
}

function simulatePolicy({ alignedRows, schedule, scenario, maximumTargetExposure, includePath = true, label = 'policy' }) {
  if (!Array.isArray(alignedRows) || alignedRows.length < 2) throw new Error(`${label} requires at least two aligned closes`);
  if (!Array.isArray(schedule) || !schedule.length) throw new Error(`${label} requires a non-empty execution schedule`);
  if (!scenario || !(scenario.oneWayTransactionCost >= 0) || !(scenario.borrowingSpreadAnnual >= 0)) throw new Error(`${label} has invalid scenario`);
  if (!(maximumTargetExposure >= 1)) throw new Error(`${label} has invalid maximum target exposure`);
  const normalizedSchedule = schedule.map((event, index) => {
    const targetExposure = event.targetExposure == null ? event.desiredTarget : event.targetExposure;
    if (!event || typeof event.executionDate !== 'string' || !(targetExposure >= 0) || !Number.isFinite(targetExposure)) {
      throw new Error(`${label} schedule[${index}] is invalid`);
    }
    return { ...event, targetExposure };
  });
  for (let index = 1; index < normalizedSchedule.length; index++) {
    if (normalizedSchedule[index].executionDate <= normalizedSchedule[index - 1].executionDate) throw new Error(`${label} schedule must have strictly ordered unique execution dates`);
  }
  if (normalizedSchedule[0].executionDate !== alignedRows[0].date) throw new Error(`${label} must start from cash at its first execution close`);
  if (normalizedSchedule.some(event => event.executionDate >= alignedRows.at(-1).date)) {
    throw new Error(`${label} schedule must omit and separately report executions at or after the terminal close`);
  }
  const scheduleMap = new Map(normalizedSchedule.map(event => [event.executionDate, event]));
  const rowDates = new Set(alignedRows.map(row => row.date));
  for (const event of normalizedSchedule) if (!rowDates.has(event.executionDate)) throw new Error(`${label} schedule date is not an executable risky close: ${event.executionDate}`);

  let riskyNotional = 0;
  let cash = 1;
  let wealth = 1;
  let currentTarget = null;
  let totalTurnoverRatio = 0;
  let totalTradedNotional = 0;
  let rebalanceCount = 0;
  let scheduledExecutionCount = 0;
  let totalTransactionCost = 0;
  let grossBorrowingCost = 0;
  let targetDaySum = 0;
  let timeAboveOneDays = 0;
  let maximumRealizedLeverage = 0;
  let minimumEquityToLongNotional = Infinity;
  const events = [];
  const curve = [];

  function failure(type, date, details = {}) {
    return {
      valid: false,
      label,
      executionFailure: { type, date, ...details },
      terminalLiquidationPerformed: false,
      events,
      navPath: includePath ? curve : undefined,
      metrics: null,
    };
  }

  function updateExtremes(assessment) {
    maximumRealizedLeverage = Math.max(maximumRealizedLeverage, assessment.leverage);
    if (assessment.equityToLongNotional != null) minimumEquityToLongNotional = Math.min(minimumEquityToLongNotional, assessment.equityToLongNotional);
  }

  function execute(event, date, eventType) {
    if (event.targetExposure > maximumTargetExposure) {
      return failure('target_above_documented_margin_limit', date, {
        targetExposure: event.targetExposure,
        documentedMaximumTargetExposure: maximumTargetExposure,
        eventType,
      });
    }
    const fill = exactRebalance({
      wealth,
      riskyNotional,
      targetExposure: event.targetExposure,
      costRate: scenario.oneWayTransactionCost,
    });
    totalTurnoverRatio += fill.tradedNotional / wealth;
    totalTradedNotional += fill.tradedNotional;
    totalTransactionCost += fill.transactionCost;
    if (fill.tradedNotional > 1e-14 * Math.max(1, wealth)) rebalanceCount++;
    scheduledExecutionCount++;
    riskyNotional = fill.postRisky;
    cash = fill.postCash;
    wealth = fill.postWealth;
    currentTarget = event.targetExposure;
    const assessment = assessHoldings(riskyNotional, cash, date, 'post_trade');
    if (assessment.failure) return failure(assessment.failure.type, date, assessment.failure);
    updateExtremes(assessment);
    if (includePath) {
      events.push({
        type: eventType,
        date,
        signalDate: event.signalDate || null,
        signalMonth: event.signalMonth || null,
        targetExposure: event.targetExposure,
        preWealth: fill.preWealth,
        postWealth: fill.postWealth,
        preRiskyNotional: fill.preRiskyNotional,
        preCash: fill.preWealth - fill.preRiskyNotional,
        preTradeLeverage: fill.currentExposure,
        preTradeEquityToLongNotional: fill.preRiskyNotional > 0 ? fill.preWealth / fill.preRiskyNotional : null,
        postRiskyNotional: fill.postRisky,
        postCash: fill.postCash,
        postTradeLeverage: fill.postRisky / fill.postWealth,
        postTradeEquityToLongNotional: fill.postRisky > 0 ? fill.postWealth / fill.postRisky : null,
        tradedNotional: fill.tradedNotional,
        transactionCost: fill.transactionCost,
      });
    }
    return null;
  }

  const entryFailure = execute(scheduleMap.get(alignedRows[0].date), alignedRows[0].date, 'entry_or_scheduled_rebalance');
  if (entryFailure) return entryFailure;
  curve.push({
    date: alignedRows[0].date,
    wealth,
    riskyNotional,
    cash,
    leverage: riskyNotional / wealth,
    equityToLongNotional: riskyNotional > 0 ? wealth / riskyNotional : null,
    desiredTarget: currentTarget,
    cashTriDate: alignedRows[0].cashDate,
    cashTriValue: alignedRows[0].cashValue,
  });

  for (let index = 1; index < alignedRows.length; index++) {
    const prior = alignedRows[index - 1];
    const row = alignedRows[index];
    if (!(prior.cashValue > 0) || !(row.cashValue > 0)) return failure('missing_permitted_cash_return', row.date, { priorRiskyDate: prior.date });
    const deltaDays = calendarDays(prior.date, row.date);
    if (!(deltaDays > 0)) throw new Error(`${label} has a non-positive close interval`);
    const startAssessment = assessHoldings(riskyNotional, cash, prior.date, 'interval_start');
    if (startAssessment.failure) return failure(startAssessment.failure.type, prior.date, startAssessment.failure);
    if (startAssessment.leverage > 1) timeAboveOneDays += deltaDays;
    targetDaySum += currentTarget * deltaDays;

    const gRisk = row.value / prior.value;
    const gCash = row.cashValue / prior.cashValue;
    const gBorrow = gCash * Math.exp(scenario.borrowingSpreadAnnual * deltaDays / YEAR_DAYS);
    if (cash < 0) grossBorrowingCost += (-cash) * (gBorrow - 1);
    riskyNotional *= gRisk;
    cash *= cash >= 0 ? gCash : gBorrow;
    wealth = riskyNotional + cash;
    const preTradeAssessment = assessHoldings(riskyNotional, cash, row.date, 'pre_trade_close');
    if (preTradeAssessment.failure) return failure(preTradeAssessment.failure.type, row.date, preTradeAssessment.failure);
    updateExtremes(preTradeAssessment);

    const scheduled = scheduleMap.get(row.date);
    if (scheduled) {
      const scheduledFailure = execute(scheduled, row.date, 'scheduled_rebalance');
      if (scheduledFailure) return scheduledFailure;
    }
    curve.push({
      date: row.date,
      wealth,
      riskyNotional,
      cash,
      leverage: riskyNotional / wealth,
      equityToLongNotional: riskyNotional > 0 ? wealth / riskyNotional : null,
      desiredTarget: currentTarget,
      cashTriDate: row.cashDate,
      cashTriValue: row.cashValue,
    });
  }

  const terminalDate = alignedRows.at(-1).date;
  const liquidation = exactRebalance({
    wealth,
    riskyNotional,
    targetExposure: 0,
    costRate: scenario.oneWayTransactionCost,
  });
  totalTurnoverRatio += liquidation.tradedNotional / wealth;
  totalTradedNotional += liquidation.tradedNotional;
  totalTransactionCost += liquidation.transactionCost;
  if (liquidation.tradedNotional > 1e-14 * Math.max(1, wealth)) rebalanceCount++;
  riskyNotional = liquidation.postRisky;
  cash = liquidation.postCash;
  wealth = liquidation.postWealth;
  if (includePath) {
    events.push({
      type: 'terminal_liquidation',
      date: terminalDate,
      targetExposure: 0,
      preWealth: liquidation.preWealth,
      postWealth: liquidation.postWealth,
      preRiskyNotional: liquidation.preRiskyNotional,
      preCash: liquidation.preWealth - liquidation.preRiskyNotional,
      preTradeLeverage: liquidation.currentExposure,
      preTradeEquityToLongNotional: liquidation.preRiskyNotional > 0 ? liquidation.preWealth / liquidation.preRiskyNotional : null,
      postRiskyNotional: 0,
      postCash: liquidation.postCash,
      postTradeLeverage: 0,
      postTradeEquityToLongNotional: null,
      tradedNotional: liquidation.tradedNotional,
      transactionCost: liquidation.transactionCost,
    });
  }
  curve[curve.length - 1] = {
    ...curve.at(-1),
    wealth,
    riskyNotional: 0,
    cash,
    leverage: 0,
    equityToLongNotional: null,
    terminalLiquidated: true,
  };

  const metrics = summarizeSimulation({
    curve,
    totalTurnoverRatio,
    totalTradedNotional,
    rebalanceCount,
    scheduledExecutionCount,
    totalTransactionCost,
    grossBorrowingCost,
    targetDaySum,
    timeAboveOneDays,
    maximumRealizedLeverage,
    minimumEquityToLongNotional: minimumEquityToLongNotional === Infinity ? null : minimumEquityToLongNotional,
  });
  return {
    valid: true,
    label,
    executionFailure: null,
    terminalLiquidationPerformed: true,
    events: includePath ? events : undefined,
    navPath: includePath ? curve : undefined,
    metrics,
  };
}

function scheduleTargetExposure(schedule, endDate) {
  if (!Array.isArray(schedule) || !schedule.length) throw new Error('target mean requires a schedule');
  let targetDaySum = 0;
  let totalDays = 0;
  for (let index = 0; index < schedule.length; index++) {
    const start = schedule[index].executionDate;
    const next = schedule[index + 1] ? schedule[index + 1].executionDate : endDate;
    const stop = next < endDate ? next : endDate;
    const delta = calendarDays(start, stop);
    if (delta < 0) throw new Error('target schedule extends after its segment');
    const target = schedule[index].targetExposure == null ? schedule[index].desiredTarget : schedule[index].targetExposure;
    targetDaySum += target * delta;
    totalDays += delta;
    if (stop === endDate) break;
  }
  if (!(totalDays > 0)) throw new Error('target schedule has no elapsed holding time');
  return { timeWeightedMeanTarget: targetDaySum / totalDays, targetDaySum, totalDays };
}

function constantSchedule(schedule, targetExposure) {
  if (!(targetExposure >= 0) || !Number.isFinite(targetExposure)) throw new Error('constant target must be finite and non-negative');
  return schedule.map(event => ({
    executionDate: event.executionDate,
    signalDate: event.signalDate || null,
    signalMonth: event.signalMonth || null,
    targetExposure,
  }));
}

function pairedMonthlyLogDifferences(candidateCurve, comparatorCurve) {
  if (!Array.isArray(candidateCurve) || !Array.isArray(comparatorCurve) || candidateCurve.length !== comparatorCurve.length || !candidateCurve.length) {
    throw new Error('paired monthly returns require equal non-empty close paths');
  }
  const candidateMonthEnds = new Map();
  const comparatorMonthEnds = new Map();
  for (let index = 0; index < candidateCurve.length; index++) {
    const candidate = candidateCurve[index];
    const comparator = comparatorCurve[index];
    if (candidate.date !== comparator.date) throw new Error(`unpaired comparator close ${candidate.date} versus ${comparator.date}`);
    if (!(candidate.wealth > 0) || !(comparator.wealth > 0)) throw new Error('paired monthly return has non-positive wealth');
    const key = monthKey(candidate.date);
    candidateMonthEnds.set(key, candidate.wealth);
    comparatorMonthEnds.set(key, comparator.wealth);
  }
  const keys = [...candidateMonthEnds.keys()].sort();
  let priorCandidate = 1;
  let priorComparator = 1;
  return keys.map(key => {
    const candidateWealth = candidateMonthEnds.get(key);
    const comparatorWealth = comparatorMonthEnds.get(key);
    const candidateLogReturn = Math.log(candidateWealth / priorCandidate);
    const comparatorLogReturn = Math.log(comparatorWealth / priorComparator);
    priorCandidate = candidateWealth;
    priorComparator = comparatorWealth;
    return {
      month: key,
      candidateLogReturn,
      comparatorLogReturn,
      pairedLogDifference: candidateLogReturn - comparatorLogReturn,
    };
  });
}

function seededRandom(seed = BOOTSTRAP_SEED) {
  if (!Number.isInteger(seed)) throw new Error('bootstrap seed must be an integer');
  let state = seed >>> 0;
  return function random() {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function percentileR7(sorted, probability) {
  if (!Array.isArray(sorted) || !sorted.length || sorted.some((value, index) => !Number.isFinite(value) || (index && value < sorted[index - 1]))) {
    throw new Error('percentile requires sorted finite values');
  }
  if (!(probability >= 0 && probability <= 1)) throw new Error('percentile probability must be within 0..1');
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower] + fraction * (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]);
}

function movingBlockBootstrap(values, {
  replicates = BOOTSTRAP_REPLICATES,
  blockMonths = BOOTSTRAP_BLOCK_MONTHS,
  seed = BOOTSTRAP_SEED,
} = {}) {
  if (!Array.isArray(values) || !values.length || values.some(value => !Number.isFinite(value))) throw new Error('bootstrap values must be a non-empty finite array');
  if (!Number.isInteger(replicates) || replicates < 1 || !Number.isInteger(blockMonths) || blockMonths < 1) throw new Error('invalid bootstrap dimensions');
  const random = seededRandom(seed);
  const statistics = new Array(replicates);
  for (let replicate = 0; replicate < replicates; replicate++) {
    let sum = 0;
    let sampled = 0;
    while (sampled < values.length) {
      const start = Math.floor(random() * values.length);
      for (let offset = 0; offset < blockMonths && sampled < values.length; offset++, sampled++) {
        sum += values[(start + offset) % values.length];
      }
    }
    statistics[replicate] = sum / values.length * 12;
  }
  statistics.sort((a, b) => a - b);
  return {
    method: 'paired_moving_block_bootstrap_monthly_log_differences',
    statistic: 'annualized_mean_monthly_log_difference',
    replicateCount: replicates,
    circularBlockMonths: blockMonths,
    seed,
    monthCount: values.length,
    pointEstimate: mean(values) * 12,
    percentile90: [percentileR7(statistics, 0.05), percentileR7(statistics, 0.95)],
    percentile95: [percentileR7(statistics, 0.025), percentileR7(statistics, 0.975)],
  };
}

function bootstrapComparator(candidateSimulation, comparatorSimulation, marketKey) {
  if (!candidateSimulation.valid || !comparatorSimulation.valid) return null;
  const paired = pairedMonthlyLogDifferences(candidateSimulation.navPath, comparatorSimulation.navPath);
  const bootstrap = movingBlockBootstrap(paired.map(row => row.pairedLogDifference));
  return {
    ...bootstrap,
    underpowered: marketKey === 'crypto' && paired.length < IMPLEMENTATION_CONVENTIONS.cryptoUnderpoweredThresholdMonths,
    underpoweredReason: marketKey === 'crypto' && paired.length < IMPLEMENTATION_CONVENTIONS.cryptoUnderpoweredThresholdMonths
      ? `crypto has ${paired.length} monthly paired returns, fewer than the explicit ${IMPLEMENTATION_CONVENTIONS.cryptoUnderpoweredThresholdMonths}-month reporting convention`
      : null,
  };
}

function edgeMetrics(candidateSimulation, buyAndHold, constantMean, constantVolatilityMatched) {
  const simulations = [candidateSimulation, buyAndHold, constantMean, constantVolatilityMatched];
  if (simulations.some(simulation => !simulation || !simulation.valid || !simulation.metrics)) {
    return { bhEdgeAnnualLogReturn: null, meanEdgeAnnualLogReturn: null, volEdgeAnnualLogReturn: null, timingEdgeAnnualLogReturn: null };
  }
  const candidate = candidateSimulation.metrics.annualizedLogReturn;
  const bhEdgeAnnualLogReturn = candidate - buyAndHold.metrics.annualizedLogReturn;
  const meanEdgeAnnualLogReturn = candidate - constantMean.metrics.annualizedLogReturn;
  const volEdgeAnnualLogReturn = candidate - constantVolatilityMatched.metrics.annualizedLogReturn;
  return {
    bhEdgeAnnualLogReturn,
    meanEdgeAnnualLogReturn,
    volEdgeAnnualLogReturn,
    timingEdgeAnnualLogReturn: Math.min(meanEdgeAnnualLogReturn, volEdgeAnnualLogReturn),
  };
}

function evaluateSevenGates({
  candidateSimulation,
  buyAndHold,
  constantMean,
  constantVolatilityMatched,
  sourceAndIntervalsComplete,
  eligibleExecutedMonthlyHoldings,
  minimumExecutedMonthlyHoldings,
}) {
  const edges = edgeMetrics(candidateSimulation, buyAndHold, constantMean, constantVolatilityMatched);
  const comparable = candidateSimulation.valid && buyAndHold.valid && constantMean.valid && constantVolatilityMatched.valid;
  const candidateMetrics = candidateSimulation.metrics;
  const buyAndHoldMetrics = buyAndHold.metrics;
  const conditions = {
    bhEdgeAtLeast0025: comparable && edges.bhEdgeAnnualLogReturn >= 0.0025,
    timingEdgeAtLeast0010: comparable && edges.timingEdgeAnnualLogReturn >= 0.0010,
    volatilityNoGreaterThanBuyAndHold: comparable && candidateMetrics.annualizedVolatility != null && buyAndHoldMetrics.annualizedVolatility != null && candidateMetrics.annualizedVolatility <= buyAndHoldMetrics.annualizedVolatility,
    maximumDrawdownNoDeeperThanBuyAndHold: comparable && candidateMetrics.maximumDrawdown >= buyAndHoldMetrics.maximumDrawdown,
    turnoverNoGreaterThanFourPerYear: candidateSimulation.valid && candidateMetrics.turnoverPerElapsedYear <= 4.0,
    executionIntegrity: candidateSimulation.valid && candidateSimulation.terminalLiquidationPerformed &&
      (candidateMetrics.minimumEquityToLongNotional == null || candidateMetrics.minimumEquityToLongNotional >= MIN_EQUITY_TO_LONG_NOTIONAL),
    requiredSourceIntervalsAndLiquidationComplete: sourceAndIntervalsComplete && candidateSimulation.valid && candidateSimulation.terminalLiquidationPerformed,
  };
  const sampleRequirement = {
    eligibleExecutedMonthlyHoldings,
    requiredMinimum: minimumExecutedMonthlyHoldings,
    pass: eligibleExecutedMonthlyHoldings >= minimumExecutedMonthlyHoldings,
  };
  return {
    conditions,
    originalSevenGatePass: Object.values(conditions).every(Boolean),
    sampleRequirement,
    marketScenarioPass: sampleRequirement.pass && Object.values(conditions).every(Boolean),
    edges,
  };
}

function executableGridTargets(maximumTargetExposure) {
  const targets = [];
  let rejectedAboveDocumentedLimit = 0;
  for (let integer = 5000; integer <= 15000; integer++) {
    const target = integer / 10000;
    if (target <= maximumTargetExposure) targets.push(target);
    else rejectedAboveDocumentedLimit++;
  }
  return { targets, rejectedAboveDocumentedLimit };
}

function prepareSimulationFactors(rows, scenario, executionDates = null) {
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('simulation factors require at least two aligned closes');
  if (!scenario || !(scenario.oneWayTransactionCost >= 0) || !(scenario.borrowingSpreadAnnual >= 0)) throw new Error('simulation factors require a valid scenario');
  if (executionDates != null && !(executionDates instanceof Set)) throw new Error('executionDates must be a Set');
  const intervals = [];
  for (let index = 1; index < rows.length; index++) {
    const prior = rows[index - 1];
    const row = rows[index];
    const deltaDays = calendarDays(prior.date, row.date);
    intervals.push({
      index,
      date: row.date,
      deltaDays,
      riskyGrowth: row.value / prior.value,
      cashGrowth: (!(prior.cashValue > 0) || !(row.cashValue > 0)) ? null : row.cashValue / prior.cashValue,
      borrowingGrowth: (!(prior.cashValue > 0) || !(row.cashValue > 0))
        ? null
        : row.cashValue / prior.cashValue * Math.exp(scenario.borrowingSpreadAnnual * deltaDays / YEAR_DAYS),
      execute: executionDates == null ? null : executionDates.has(row.date),
    });
  }
  return {
    firstDate: rows[0].date,
    terminalDate: rows.at(-1).date,
    intervalCount: intervals.length,
    elapsedYears: calendarDays(rows[0].date, rows.at(-1).date) / YEAR_DAYS,
    intervals,
  };
}

function simulateConstantTargetVolatilityOnly({ rows, executionDates, targetExposure, scenario, maximumTargetExposure, preparedFactors = null }) {
  if (!Array.isArray(rows) || rows.length < 2 || !(executionDates instanceof Set) || !executionDates.has(rows[0].date)) {
    throw new Error('compact constant-target simulation has invalid rows or execution dates');
  }
  if (targetExposure > maximumTargetExposure) return { valid: false, annualizedVolatility: null };
  const factors = preparedFactors || prepareSimulationFactors(rows, scenario, executionDates);
  if (factors.firstDate !== rows[0].date || factors.terminalDate !== rows.at(-1).date || factors.intervals.length !== rows.length - 1) {
    throw new Error('prepared compact-simulation factors do not match rows');
  }
  let riskyNotional = 0;
  let cash = 1;
  let wealth = 1;
  let fill = exactRebalance({ wealth, riskyNotional, targetExposure, costRate: scenario.oneWayTransactionCost });
  riskyNotional = fill.postRisky;
  cash = fill.postCash;
  wealth = fill.postWealth;
  if (assessHoldings(riskyNotional, cash, rows[0].date, 'post_trade').failure) return { valid: false, annualizedVolatility: null };
  let priorCloseWealth = wealth;
  let returnCount = 0;
  let returnMean = 0;
  let returnM2 = 0;
  for (const interval of factors.intervals) {
    const row = rows[interval.index];
    if (!(interval.cashGrowth > 0) || !(interval.borrowingGrowth > 0)) return { valid: false, annualizedVolatility: null };
    riskyNotional *= interval.riskyGrowth;
    cash *= cash >= 0 ? interval.cashGrowth : interval.borrowingGrowth;
    wealth = riskyNotional + cash;
    if (assessHoldings(riskyNotional, cash, row.date, 'pre_trade_close').failure) return { valid: false, annualizedVolatility: null };
    const execute = interval.execute == null ? executionDates.has(row.date) : interval.execute;
    if (execute) {
      fill = exactRebalance({ wealth, riskyNotional, targetExposure, costRate: scenario.oneWayTransactionCost });
      riskyNotional = fill.postRisky;
      cash = fill.postCash;
      wealth = fill.postWealth;
      if (assessHoldings(riskyNotional, cash, row.date, 'post_trade').failure) return { valid: false, annualizedVolatility: null };
    }
    if (interval.index === rows.length - 1) {
      fill = exactRebalance({ wealth, riskyNotional, targetExposure: 0, costRate: scenario.oneWayTransactionCost });
      riskyNotional = 0;
      cash = fill.postCash;
      wealth = fill.postWealth;
    }
    if (!(wealth > 0)) return { valid: false, annualizedVolatility: null };
    const logReturn = Math.log(wealth / priorCloseWealth);
    returnCount++;
    const delta = logReturn - returnMean;
    returnMean += delta / returnCount;
    returnM2 += delta * (logReturn - returnMean);
    priorCloseWealth = wealth;
  }
  if (returnCount < 2) return { valid: true, annualizedVolatility: null };
  return {
    valid: true,
    annualizedVolatility: Math.sqrt(returnM2 / (returnCount - 1)) * Math.sqrt(returnCount / factors.elapsedYears),
  };
}

function chooseVolatilityMatchedControls({
  rows,
  candidateSchedules,
  candidateSimulations,
  scenario,
  maximumTargetExposure,
}) {
  const candidateIds = Object.keys(candidateSchedules).filter(id => candidateSimulations[id] && candidateSimulations[id].valid && candidateSimulations[id].metrics.annualizedVolatility != null);
  const best = Object.fromEntries(candidateIds.map(id => [id, null]));
  const grid = executableGridTargets(maximumTargetExposure);
  if (!candidateIds.length) {
    return Object.fromEntries(Object.keys(candidateSchedules).map(id => [id, {
      selectedTarget: null,
      volatilityDistance: null,
      gridTargetsTested: 0,
      gridTargetsRejectedAboveDocumentedMarginLimit: grid.rejectedAboveDocumentedLimit,
      simulation: invalidSimulation('constant_volatility_matched', 'candidate_has_no_valid_volatility_observation'),
    }]));
  }
  const groups = new Map();
  for (const id of candidateIds) {
    const schedule = candidateSchedules[id];
    if (!Array.isArray(schedule) || !schedule.length) throw new Error(`${id} has no actual trade schedule for volatility matching`);
    const signature = schedule.map(event => event.executionDate).join('|');
    if (!groups.has(signature)) groups.set(signature, { ids: [], executionDates: new Set(schedule.map(event => event.executionDate)) });
    groups.get(signature).ids.push(id);
  }
  for (const group of groups.values()) {
    const preparedFactors = prepareSimulationFactors(rows, scenario, group.executionDates);
    for (const target of grid.targets) {
      const simulation = simulateConstantTargetVolatilityOnly({
        rows,
        executionDates: group.executionDates,
        targetExposure: target,
        scenario,
        maximumTargetExposure,
        preparedFactors,
      });
      if (!simulation.valid || simulation.annualizedVolatility == null) continue;
      for (const id of group.ids) {
        const distance = Math.abs(simulation.annualizedVolatility - candidateSimulations[id].metrics.annualizedVolatility);
        const incumbent = best[id];
        if (!incumbent || distance < incumbent.distance || (distance === incumbent.distance && target < incumbent.target)) best[id] = { target, distance };
      }
    }
  }
  const controls = {};
  for (const id of Object.keys(candidateSchedules)) {
    if (!best[id]) {
      controls[id] = {
        selectedTarget: null,
        volatilityDistance: null,
        gridTargetsTested: grid.targets.length,
        gridTargetsRejectedAboveDocumentedMarginLimit: grid.rejectedAboveDocumentedLimit,
        simulation: invalidSimulation('constant_volatility_matched', 'no_executable_volatility_matched_grid_control'),
      };
      continue;
    }
    const simulation = simulatePolicy({
      alignedRows: rows,
      schedule: constantSchedule(candidateSchedules[id], best[id].target),
      scenario,
      maximumTargetExposure,
      includePath: true,
      label: `constant_volatility_matched_${best[id].target.toFixed(4)}`,
    });
    const exactDistance = simulation.valid && simulation.metrics.annualizedVolatility != null
      ? Math.abs(simulation.metrics.annualizedVolatility - candidateSimulations[id].metrics.annualizedVolatility)
      : null;
    if (exactDistance !== best[id].distance) throw new Error(`${id} compact volatility control differs from the fully reported simulation`);
    controls[id] = {
      selectedTarget: best[id].target,
      volatilityDistance: exactDistance,
      gridTargetsTested: grid.targets.length,
      gridTargetsRejectedAboveDocumentedMarginLimit: grid.rejectedAboveDocumentedLimit,
      simulation,
    };
  }
  return controls;
}

function verifyVolatilityMatchedControl({ rows, schedule, candidateSimulation, scenario, maximumTargetExposure, reported, context = 'volatility-matched control' }) {
  const replayed = chooseVolatilityMatchedControls({
    rows,
    candidateSchedules: { candidate: schedule },
    candidateSimulations: { candidate: candidateSimulation },
    scenario,
    maximumTargetExposure,
  }).candidate;
  assertCanonicalEqual(reported, replayed, `${context} deterministic 10,001-grid replay`);
  return replayed;
}

function invalidSimulation(label, type, details = {}) {
  return {
    valid: false,
    label,
    executionFailure: { type, ...details },
    terminalLiquidationPerformed: false,
    events: [],
    navPath: [],
    metrics: null,
  };
}

function analyzeMarket({ input, market, stageConfig, candidates, frozenDevelopmentMeanTarget = null }) {
  const alignment = alignCashToRisky(market.rows, input.cashTotalReturn.rows);
  const monthly = buildMonthlyVarianceStates(alignment.rows);
  const terminalDate = alignment.rows.at(-1).date;
  const scheduleBundles = Object.fromEntries(candidates.map(candidate => [candidate.id, buildCandidateSchedule(monthly.states, candidate, {
    ...stageConfig,
    terminalCloseDate: terminalDate,
  })]));
  const desiredTargetCalendars = Object.fromEntries(candidates.map(candidate => [candidate.id, scheduleBundles[candidate.id].desiredTargetCalendar]));
  const actualTradeSchedules = Object.fromEntries(candidates.map(candidate => [candidate.id, scheduleBundles[candidate.id].actualTradeSchedule]));
  const omittedTerminalExecutionsByCandidate = Object.fromEntries(candidates.map(candidate => [candidate.id, scheduleBundles[candidate.id].omittedTerminalExecutions]));
  const firstDesiredTargetCalendar = desiredTargetCalendars[candidates[0].id];
  const firstActualTradeSchedule = actualTradeSchedules[candidates[0].id];
  const firstExecutionDate = firstActualTradeSchedule.length ? firstActualTradeSchedule[0].executionDate : null;
  const firstExecutionIndex = firstExecutionDate == null ? -1 : alignment.rows.findIndex(row => row.date === firstExecutionDate);
  const rows = firstExecutionIndex >= 0 ? alignment.rows.slice(firstExecutionIndex) : [];
  const eligibleExecutedMonthlyHoldings = firstDesiredTargetCalendar.length;
  const knownDataIssues = [
    ...input.cashTotalReturn.knownDataIssues.map(issue => ({ series: 'cash', issue })),
    ...market.knownDataIssues.map(issue => ({ series: market.key, issue })),
  ];
  const completeness = assessRequiredCompleteness({
    monthlyStates: monthly.states,
    alignmentRejections: alignment.rejections,
    intervalRejections: monthly.intervalRejections,
    knownDataIssues,
    firstExecutionDate,
    terminalDate,
  });
  const {
    missingRequiredMonths,
    staleTargetMonths,
    requiredCashAlignmentRejections: requiredAlignmentRejections,
    requiredIntervalRejections,
    sourceAndIntervalsComplete,
  } = completeness;
  const targetCalendarByCandidate = {};
  for (const candidate of candidates) {
    try {
      targetCalendarByCandidate[candidate.id] = scheduleTargetExposure(desiredTargetCalendars[candidate.id], terminalDate);
    } catch (error) {
      targetCalendarByCandidate[candidate.id] = { timeWeightedMeanTarget: null, targetDaySum: 0, totalDays: 0, error: error.message };
    }
  }

  const scenarioResults = {};
  for (const scenario of SCENARIOS) {
    if (rows.length < 2 || !firstActualTradeSchedule.length) {
      scenarioResults[scenario.id] = Object.fromEntries(candidates.map(candidate => [candidate.id, {
        candidate: invalidSimulation(candidate.id, 'no_executable_next_close_signal_in_stage'),
        benchmarks: {
          buyAndHold: invalidSimulation('buy_and_hold', 'no_common_stage_start'),
          cash: invalidSimulation('cash', 'no_common_stage_start'),
        },
        controls: {
          constantMeanExposure: invalidSimulation('constant_mean_exposure', 'no_common_stage_start'),
          constantMeanExposureTarget: null,
          constantVolatilityMatched: invalidSimulation('constant_volatility_matched', 'no_common_stage_start'),
          constantVolatilityMatchedTarget: null,
          constantVolatilityDistance: null,
          volatilityGridTargetsTested: 0,
          volatilityGridTargetsRejectedAboveDocumentedMarginLimit: executableGridTargets(market.maxTargetExposure).rejectedAboveDocumentedLimit,
          frozenDevelopmentMeanDiagnostic: frozenDevelopmentMeanTarget == null
            ? null
            : invalidSimulation(`frozen_development_mean_diagnostic_${frozenDevelopmentMeanTarget}`, 'no_common_stage_start'),
          frozenDevelopmentMeanDiagnosticTarget: frozenDevelopmentMeanTarget,
        },
        gates: evaluateSevenGates({
          candidateSimulation: invalidSimulation(candidate.id, 'no_common_stage_start'),
          buyAndHold: invalidSimulation('buy_and_hold', 'no_common_stage_start'),
          constantMean: invalidSimulation('constant_mean', 'no_common_stage_start'),
          constantVolatilityMatched: invalidSimulation('constant_volatility', 'no_common_stage_start'),
          sourceAndIntervalsComplete,
          eligibleExecutedMonthlyHoldings,
          minimumExecutedMonthlyHoldings: stageConfig.minimumExecutedMonthlyHoldings,
        }),
        bootstrap: null,
      }]));
      continue;
    }

    const candidateSimulations = {};
    const meanControls = {};
    for (const candidate of candidates) {
      const schedule = actualTradeSchedules[candidate.id];
      candidateSimulations[candidate.id] = simulatePolicy({
        alignedRows: rows,
        schedule,
        scenario,
        maximumTargetExposure: market.maxTargetExposure,
        includePath: true,
        label: candidate.id,
      });
      const meanTarget = targetCalendarByCandidate[candidate.id].timeWeightedMeanTarget;
      meanControls[candidate.id] = meanTarget == null
        ? invalidSimulation('constant_mean_exposure', 'no_elapsed_candidate_target_calendar')
        : simulatePolicy({
          alignedRows: rows,
          schedule: constantSchedule(schedule, meanTarget),
          scenario,
          maximumTargetExposure: market.maxTargetExposure,
          includePath: true,
          label: `constant_mean_exposure_${meanTarget}`,
        });
    }
    const buyAndHold = simulatePolicy({
      alignedRows: rows,
      schedule: [{ executionDate: rows[0].date, targetExposure: 1 }],
      scenario,
      maximumTargetExposure: market.maxTargetExposure,
      includePath: true,
      label: 'buy_and_hold',
    });
    const cash = simulatePolicy({
      alignedRows: rows,
      schedule: [{ executionDate: rows[0].date, targetExposure: 0 }],
      scenario,
      maximumTargetExposure: market.maxTargetExposure,
      includePath: true,
      label: 'cash',
    });
    const volatilityControls = chooseVolatilityMatchedControls({
      rows,
      candidateSchedules: actualTradeSchedules,
      candidateSimulations,
      scenario,
      maximumTargetExposure: market.maxTargetExposure,
    });

    scenarioResults[scenario.id] = {};
    for (const candidate of candidates) {
      const id = candidate.id;
      const volControl = volatilityControls[id].simulation;
      const frozenDiagnostic = frozenDevelopmentMeanTarget == null
        ? null
        : simulatePolicy({
          alignedRows: rows,
          schedule: constantSchedule(actualTradeSchedules[id], frozenDevelopmentMeanTarget),
          scenario,
          maximumTargetExposure: market.maxTargetExposure,
          includePath: true,
          label: `frozen_development_mean_diagnostic_${frozenDevelopmentMeanTarget}`,
        });
      const gates = evaluateSevenGates({
        candidateSimulation: candidateSimulations[id],
        buyAndHold,
        constantMean: meanControls[id],
        constantVolatilityMatched: volControl,
        sourceAndIntervalsComplete,
        eligibleExecutedMonthlyHoldings,
        minimumExecutedMonthlyHoldings: stageConfig.minimumExecutedMonthlyHoldings,
      });
      scenarioResults[scenario.id][id] = {
        candidate: candidateSimulations[id],
        benchmarks: { buyAndHold, cash },
        controls: {
          constantMeanExposure: meanControls[id],
          constantMeanExposureTarget: targetCalendarByCandidate[id].timeWeightedMeanTarget,
          constantVolatilityMatched: volControl,
          constantVolatilityMatchedTarget: volatilityControls[id].selectedTarget,
          constantVolatilityDistance: volatilityControls[id].volatilityDistance,
          volatilityGridTargetsTested: volatilityControls[id].gridTargetsTested,
          volatilityGridTargetsRejectedAboveDocumentedMarginLimit: volatilityControls[id].gridTargetsRejectedAboveDocumentedMarginLimit,
          frozenDevelopmentMeanDiagnostic: frozenDiagnostic,
          frozenDevelopmentMeanDiagnosticTarget: frozenDevelopmentMeanTarget,
        },
        gates,
        bootstrap: candidateSimulations[id].valid && buyAndHold.valid && meanControls[id].valid && volControl.valid
          ? {
            buyAndHold: bootstrapComparator(candidateSimulations[id], buyAndHold, market.key),
            constantMeanExposure: bootstrapComparator(candidateSimulations[id], meanControls[id], market.key),
            constantVolatilityMatched: bootstrapComparator(candidateSimulations[id], volControl, market.key),
            cash: bootstrapComparator(candidateSimulations[id], cash, market.key),
          }
          : null,
      };
    }
  }

  return {
    market: market.key,
    instrumentIdentity: market.instrumentIdentity,
    documentedMaximumTargetExposure: market.maxTargetExposure,
    revisionStatus: market.revisionStatus,
    evidenceClass: market.revisionStatus === 'point_in_time_revision_zero'
      ? 'point_in_time_capable_if_source_declarations_are_independently_verified'
      : 'retrospective_falsification_only',
    firstExecutionDate,
    terminalDate,
    eligibleExecutedMonthlyHoldings,
    minimumExecutedMonthlyHoldings: stageConfig.minimumExecutedMonthlyHoldings,
    sourceAndIntervalsComplete,
    knownDataIssues,
    cashAlignmentRejections: alignment.rejections,
    requiredCashAlignmentRejections: requiredAlignmentRejections,
    intervalRejections: monthly.intervalRejections,
    requiredIntervalRejections,
    missingVarianceMonths: monthly.states.filter(state => state.realizedVariance == null).map(state => ({
      month: state.month,
      validIntervalCount: state.validIntervalCount,
      observedIntervalCount: state.observedIntervalCount,
      reason: state.varianceMissingReason,
    })),
    missingRequiredMonths,
    staleTargetMonths,
    unfilledTerminalSignals: monthly.states.filter(state => state.signalStatus === 'valid_but_no_next_executable_close').map(state => ({ month: state.month, signalDate: state.finalRiskyClose })),
    omittedTerminalExecutionsByCandidate,
    monthlyStates: monthly.states,
    desiredTargetCalendars,
    actualTradeSchedules,
    targetCalendarByCandidate,
    scenarioResults,
  };
}

function verifyMarketResultReplay(reported, analysisArguments, context = 'market result') {
  const rebuilt = analyzeMarket(analysisArguments);
  assertCanonicalEqual(reported, rebuilt, `${context} deterministic input replay`);
  return rebuilt;
}

function candidateStageSummaries(marketResults, candidates) {
  return Object.fromEntries(candidates.map(candidate => {
    const cells = [];
    for (const market of marketResults) {
      for (const scenario of SCENARIOS) {
        const result = market.scenarioResults[scenario.id][candidate.id];
        cells.push({
          market: market.market,
          scenario: scenario.id,
          pass: result.gates.marketScenarioPass,
          timingEdgeAnnualLogReturn: result.gates.edges.timingEdgeAnnualLogReturn,
        });
      }
    }
    const stressEdges = cells.filter(cell => cell.scenario === 'stress').map(cell => cell.timingEdgeAnnualLogReturn);
    return [candidate.id, {
      candidate,
      eligible: cells.every(cell => cell.pass),
      cells,
      worstMarketStressTimingEdgeAnnualLogReturn: stressEdges.length && stressEdges.every(Number.isFinite) ? Math.min(...stressEdges) : null,
    }];
  }));
}

function selectDevelopmentCandidate(summaries) {
  const eligible = CANDIDATES.map((candidate, tableOrder) => ({ ...summaries[candidate.id], tableOrder }))
    .filter(summary => summary.eligible && Number.isFinite(summary.worstMarketStressTimingEdgeAnnualLogReturn));
  if (!eligible.length) return null;
  const maximum = Math.max(...eligible.map(summary => summary.worstMarketStressTimingEdgeAnnualLogReturn));
  const tieTolerance = 16 * Number.EPSILON * Math.max(1, Math.abs(maximum));
  const withinOneBasisPoint = eligible.filter(summary => maximum - summary.worstMarketStressTimingEdgeAnnualLogReturn <= 0.0001 + tieTolerance);
  withinOneBasisPoint.sort((left, right) =>
    left.candidate.upperCap - right.candidate.upperCap ||
    left.candidate.p - right.candidate.p ||
    left.tableOrder - right.tableOrder
  );
  return withinOneBasisPoint[0].candidate;
}

function aggregateMarketAverages(marketResults, candidates) {
  const aggregate = {};
  for (const scenario of SCENARIOS) {
    aggregate[scenario.id] = {};
    for (const candidate of candidates) {
      const cells = marketResults.map(market => market.scenarioResults[scenario.id][candidate.id]);
      const valid = cells.filter(cell => cell.candidate.valid && cell.candidate.metrics);
      aggregate[scenario.id][candidate.id] = {
        interpretation: 'equal-weight arithmetic average across market metrics; not a compensating portfolio gate',
        marketCount: cells.length,
        passingMarketCount: cells.filter(cell => cell.gates.marketScenarioPass).length,
        meanCandidateAnnualizedLogReturn: valid.length ? mean(valid.map(cell => cell.candidate.metrics.annualizedLogReturn)) : null,
        meanBhEdgeAnnualLogReturn: cells.every(cell => Number.isFinite(cell.gates.edges.bhEdgeAnnualLogReturn)) ? mean(cells.map(cell => cell.gates.edges.bhEdgeAnnualLogReturn)) : null,
        meanTimingEdgeAnnualLogReturn: cells.every(cell => Number.isFinite(cell.gates.edges.timingEdgeAnnualLogReturn)) ? mean(cells.map(cell => cell.gates.edges.timingEdgeAnnualLogReturn)) : null,
      };
    }
  }
  return aggregate;
}

function analyzeStage(input, expectedStage, { selectedCandidate = null, frozenDevelopmentMeanTarget = null, inputSha256 = null } = {}) {
  const { stageConfig } = validateInput(input, expectedStage);
  const candidates = expectedStage === 'development'
    ? CANDIDATES
    : [CANDIDATES.find(candidate => candidate.id === selectedCandidate) || (() => { throw new Error(`selected candidate is not frozen: ${selectedCandidate}`); })()];
  const marketResults = input.markets.map(market => analyzeMarket({ input, market, stageConfig, candidates, frozenDevelopmentMeanTarget }));
  const summaries = candidateStageSummaries(marketResults, candidates);
  const stagePass = expectedStage === 'development'
    ? candidates.some(candidate => summaries[candidate.id].eligible)
    : candidates.every(candidate => summaries[candidate.id].eligible);
  return {
    protocol: assertProtocolFrozen(),
    runnerSha256: runnerSha256(),
    inputSchema: input.schema,
    inputStage: expectedStage,
    inputSha256,
    stageConfig,
    implementationConventions: IMPLEMENTATION_CONVENTIONS,
    excludedCostsDisclosure: ['taxes', 'market impact', 'custody', 'locate fees', 'index-replication costs'],
    sourceDeclarationWarning: 'Offline schema validation does not independently authenticate provider methodology, revision history, historical margin eligibility, or executable closes.',
    revisionEvidence: {
      cash: input.cashTotalReturn.revisionStatus,
      markets: Object.fromEntries(input.markets.map(market => [market.key, market.revisionStatus])),
      allPointInTimeRevisionZero: input.cashTotalReturn.revisionStatus === 'point_in_time_revision_zero' && input.markets.every(market => market.revisionStatus === 'point_in_time_revision_zero'),
      claimLimit: input.cashTotalReturn.revisionStatus === 'point_in_time_revision_zero' && input.markets.every(market => market.revisionStatus === 'point_in_time_revision_zero')
        ? 'Point-in-time claim is schema-capable only if source declarations are independently verified.'
        : 'Current-vintage revised history or provider backcast can falsify retrospectively but cannot confirm a point-in-time claim.',
    },
    marketDependenceWarning: 'Sweden, Europe, USA, and Global overlap economically; market passes are not independent statistical observations.',
    candidates: candidates.map(candidate => candidate.id),
    marketResults,
    candidateSummaries: summaries,
    equalWeightMarketAverages: aggregateMarketAverages(marketResults, candidates),
    stagePass,
  };
}

function pooledDevelopmentMeanTarget(analysis, selectedCandidateId) {
  let targetDaySum = 0;
  let totalDays = 0;
  const byMarket = {};
  for (const market of analysis.marketResults) {
    const calendar = market.targetCalendarByCandidate[selectedCandidateId];
    if (!calendar || !(calendar.totalDays > 0) || !Number.isFinite(calendar.targetDaySum)) throw new Error(`${market.market} has no development target calendar for ${selectedCandidateId}`);
    targetDaySum += calendar.targetDaySum;
    totalDays += calendar.totalDays;
    byMarket[market.market] = {
      timeWeightedMeanTarget: calendar.timeWeightedMeanTarget,
      targetDaySum: calendar.targetDaySum,
      calendarDays: calendar.totalDays,
    };
  }
  return {
    target: targetDaySum / totalDays,
    targetDaySum,
    calendarDays: totalDays,
    byMarket,
    convention: IMPLEMENTATION_CONVENTIONS.deployableDiagnosticDevelopmentMean,
    affectsSelectionOrGates: false,
  };
}

function assertCanonicalEqual(actual, expected, context) {
  const actualCanonical = canonicalJson(jsonSafe(actual));
  const expectedCanonical = canonicalJson(jsonSafe(expected));
  if (actualCanonical !== expectedCanonical) throw new Error(`${context} does not match its canonically recomputed value`);
  return actual;
}

function restoreJsonSafeNumber(value) {
  if (value === 'Infinity') return Infinity;
  if (value === '-Infinity') return -Infinity;
  if (value === 'NaN') return NaN;
  return value;
}

function assertCanonicalJsonBytes(bytes, payload, context) {
  if (!Buffer.isBuffer(bytes)) throw new Error(`${context} bytes must be a Buffer`);
  const expected = Buffer.from(canonicalJson(jsonSafe(payload)), 'utf8');
  if (!bytes.equals(expected)) throw new Error(`${context} bytes are not the exact canonical JSON serialization`);
  return true;
}

function assertSha256(value, context) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error(`${context} must be lowercase SHA-256`);
  return value;
}

function assertCandidateMap(value, candidateIds, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...candidateIds].sort().join(',')) {
    throw new Error(`${context} must contain exactly ${candidateIds.join(',')}`);
  }
  return value;
}

function assertSimulationSchema(simulation, context) {
  assertExactKeys(simulation, SIMULATION_KEYS, context);
  if (typeof simulation.valid !== 'boolean' || typeof simulation.terminalLiquidationPerformed !== 'boolean') throw new Error(`${context} validity fields must be Boolean`);
  requireText(simulation.label, `${context}.label`);
  if (!Array.isArray(simulation.events) || !Array.isArray(simulation.navPath)) throw new Error(`${context} paths must be arrays`);
  simulation.events.forEach((event, index) => {
    const keys = event.type === 'terminal_liquidation'
      ? ['date', 'postCash', 'postRiskyNotional', 'postTradeEquityToLongNotional', 'postTradeLeverage', 'postWealth', 'preCash', 'preRiskyNotional', 'preTradeEquityToLongNotional', 'preTradeLeverage', 'preWealth', 'targetExposure', 'tradedNotional', 'transactionCost', 'type']
      : ['date', 'postCash', 'postRiskyNotional', 'postTradeEquityToLongNotional', 'postTradeLeverage', 'postWealth', 'preCash', 'preRiskyNotional', 'preTradeEquityToLongNotional', 'preTradeLeverage', 'preWealth', 'signalDate', 'signalMonth', 'targetExposure', 'tradedNotional', 'transactionCost', 'type'];
    assertExactKeys(event, keys, `${context}.events[${index}]`);
  });
  simulation.navPath.forEach((row, index) => assertExactKeys(row, row.terminalLiquidated === true
    ? ['cash', 'cashTriDate', 'cashTriValue', 'date', 'desiredTarget', 'equityToLongNotional', 'leverage', 'riskyNotional', 'terminalLiquidated', 'wealth']
    : ['cash', 'cashTriDate', 'cashTriValue', 'date', 'desiredTarget', 'equityToLongNotional', 'leverage', 'riskyNotional', 'wealth'], `${context}.navPath[${index}]`));
  if (simulation.valid) {
    if (simulation.executionFailure !== null || !simulation.terminalLiquidationPerformed) throw new Error(`${context} valid simulation integrity mismatch`);
    assertExactKeys(simulation.metrics, METRIC_KEYS, `${context}.metrics`);
    if (simulation.metrics.terminalLiquidationPerformed !== true) throw new Error(`${context}.metrics must record terminal liquidation`);
  } else {
    if (!simulation.executionFailure || typeof simulation.executionFailure !== 'object' || typeof simulation.executionFailure.type !== 'string') throw new Error(`${context} invalid simulation must identify its execution failure`);
    const failureKeys = {
      target_above_documented_margin_limit: ['date', 'documentedMaximumTargetExposure', 'eventType', 'targetExposure', 'type'],
      non_positive_wealth: ['date', 'phase', 'type', 'wealth'],
      equity_to_long_notional_below_research_floor: ['date', 'equityToLongNotional', 'phase', 'requiredMinimum', 'type'],
      missing_permitted_cash_return: ['date', 'priorRiskyDate', 'type'],
    }[simulation.executionFailure.type] || ['type'];
    assertExactKeys(simulation.executionFailure, failureKeys, `${context}.executionFailure`);
    if (simulation.metrics !== null || simulation.terminalLiquidationPerformed) throw new Error(`${context} invalid simulation must not report metrics or liquidation completion`);
  }
  return simulation;
}

function recomputeSimulationMetrics(simulation, scenario, context = 'simulation') {
  assertSimulationSchema(simulation, context);
  if (!simulation.valid) return null;
  const curve = simulation.navPath;
  const events = simulation.events;
  if (curve.length < 2) throw new Error(`${context} valid simulation must contain at least two NAV path rows`);
  if (events.length < 2) throw new Error(`${context} valid simulation must contain entry and terminal-liquidation events`);
  for (let index = 0; index < curve.length; index++) {
    const row = curve[index];
    dateMilliseconds(row.date, `${context}.navPath[${index}].date`);
    if (index && row.date <= curve[index - 1].date) throw new Error(`${context}.navPath dates must be strictly increasing`);
    for (const key of ['wealth', 'riskyNotional', 'cash', 'leverage', 'cashTriValue']) {
      if (typeof row[key] !== 'number' || !Number.isFinite(row[key])) throw new Error(`${context}.navPath[${index}].${key} must be finite`);
    }
    dateMilliseconds(row.cashTriDate, `${context}.navPath[${index}].cashTriDate`);
    if (row.cashTriDate > row.date || calendarDays(row.cashTriDate, row.date) > MAX_CASH_STALE_DAYS) throw new Error(`${context}.navPath[${index}] has an impermissible cash as-of date`);
    if (!(row.wealth > 0) || !(row.riskyNotional >= 0) || !(row.cashTriValue > 0) ||
        typeof row.desiredTarget !== 'number' || !Number.isFinite(row.desiredTarget) || row.desiredTarget < 0) {
      throw new Error(`${context}.navPath[${index}] has invalid holdings, target, or cash TRI`);
    }
    if (Math.abs(row.wealth - (row.riskyNotional + row.cash)) > 1e-12 * Math.max(1, row.wealth)) throw new Error(`${context}.navPath[${index}] wealth identity mismatch`);
    if (row.leverage !== row.riskyNotional / row.wealth || row.equityToLongNotional !== (row.riskyNotional > 0 ? row.wealth / row.riskyNotional : null)) {
      throw new Error(`${context}.navPath[${index}] leverage/equity identity mismatch`);
    }
  }
  const terminalEvents = events.filter(event => event.type === 'terminal_liquidation');
  if (terminalEvents.length !== 1 || events.at(-1) !== terminalEvents[0]) throw new Error(`${context} must contain exactly one final terminal-liquidation event`);
  const terminalEvent = terminalEvents[0];
  if (terminalEvent.date !== curve.at(-1).date || curve.at(-1).terminalLiquidated !== true) throw new Error(`${context} terminal path/event mismatch`);
  const nonTerminalEvents = events.filter(event => event.type !== 'terminal_liquidation');
  if (!nonTerminalEvents.length || nonTerminalEvents[0].date !== curve[0].date) throw new Error(`${context} has no entry event at its first path date`);
  if (nonTerminalEvents[0].preWealth !== 1 || nonTerminalEvents[0].preRiskyNotional !== 0 || nonTerminalEvents[0].preCash !== 1) {
    throw new Error(`${context} entry event does not reset NAV from cash at 1.00`);
  }
  const rowsByDate = new Map(curve.map(row => [row.date, row]));
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (!['entry_or_scheduled_rebalance', 'scheduled_rebalance', 'terminal_liquidation'].includes(event.type)) throw new Error(`${context}.events[${index}].type is invalid`);
    dateMilliseconds(event.date, `${context}.events[${index}].date`);
    if (index && event.date <= events[index - 1].date) throw new Error(`${context}.events dates must be strictly increasing`);
    const row = rowsByDate.get(event.date);
    if (!row) throw new Error(`${context}.events[${index}] has no matching NAV row`);
    for (const key of ['preWealth', 'postWealth', 'preRiskyNotional', 'preCash', 'postRiskyNotional', 'postCash', 'tradedNotional', 'transactionCost', 'targetExposure']) {
      if (typeof event[key] !== 'number' || !Number.isFinite(event[key])) throw new Error(`${context}.events[${index}].${key} must be finite`);
    }
    const exact = exactRebalance({
      wealth: event.preWealth,
      riskyNotional: event.preRiskyNotional,
      targetExposure: event.targetExposure,
      costRate: scenario.oneWayTransactionCost,
    });
    if (event.preCash !== exact.preWealth - exact.preRiskyNotional || event.preTradeLeverage !== exact.currentExposure ||
        event.preTradeEquityToLongNotional !== (exact.preRiskyNotional > 0 ? exact.preWealth / exact.preRiskyNotional : null) ||
        event.postWealth !== exact.postWealth || event.postRiskyNotional !== exact.postRisky || event.postCash !== exact.postCash ||
        event.postTradeLeverage !== exact.postRisky / exact.postWealth ||
        event.postTradeEquityToLongNotional !== (exact.postRisky > 0 ? exact.postWealth / exact.postRisky : null) ||
        event.tradedNotional !== exact.tradedNotional || event.transactionCost !== exact.transactionCost) {
      throw new Error(`${context}.events[${index}] exact post-cost rebalance identity mismatch`);
    }
    if (row.wealth !== event.postWealth || row.riskyNotional !== event.postRiskyNotional || row.cash !== event.postCash) {
      throw new Error(`${context}.events[${index}] post-trade holdings do not equal the matching NAV row`);
    }
    if (event.type === 'terminal_liquidation') {
      if (event.targetExposure !== 0 || row.riskyNotional !== 0) throw new Error(`${context} terminal liquidation did not reach zero risky exposure`);
    } else if (row.desiredTarget !== event.targetExposure) {
      throw new Error(`${context}.events[${index}] target differs from its matching NAV desired target`);
    }
  }
  let grossBorrowingCost = 0;
  let targetDaySum = 0;
  let timeAboveOneDays = 0;
  for (let index = 1; index < curve.length; index++) {
    const prior = curve[index - 1];
    const row = curve[index];
    const deltaDays = calendarDays(prior.date, row.date);
    const gCash = row.cashTriValue / prior.cashTriValue;
    if (prior.cash < 0) grossBorrowingCost += (-prior.cash) * (gCash * Math.exp(scenario.borrowingSpreadAnnual * deltaDays / YEAR_DAYS) - 1);
    targetDaySum += prior.desiredTarget * deltaDays;
    if (prior.leverage > 1) timeAboveOneDays += deltaDays;
  }
  const exposurePoints = [
    ...curve.map(row => ({ leverage: row.leverage, equityToLongNotional: row.equityToLongNotional })),
    ...events.flatMap(event => [
      { leverage: event.preTradeLeverage, equityToLongNotional: event.preTradeEquityToLongNotional },
      { leverage: event.postTradeLeverage, equityToLongNotional: event.postTradeEquityToLongNotional },
    ]),
  ];
  const leverageValues = exposurePoints.map(point => point.leverage).filter(Number.isFinite);
  const equityValues = exposurePoints.map(point => point.equityToLongNotional).filter(Number.isFinite);
  const totalTurnoverRatio = events.reduce((sum, event) => sum + event.tradedNotional / event.preWealth, 0);
  const totalTradedNotional = events.reduce((sum, event) => sum + event.tradedNotional, 0);
  const totalTransactionCost = events.reduce((sum, event) => sum + event.transactionCost, 0);
  const rebalanceCount = events.filter(event => event.tradedNotional > 1e-14 * Math.max(1, event.preWealth)).length;
  const metrics = summarizeSimulation({
    curve,
    totalTurnoverRatio,
    totalTradedNotional,
    rebalanceCount,
    scheduledExecutionCount: nonTerminalEvents.length,
    totalTransactionCost,
    grossBorrowingCost,
    targetDaySum,
    timeAboveOneDays,
    maximumRealizedLeverage: Math.max(...leverageValues),
    minimumEquityToLongNotional: equityValues.length ? Math.min(...equityValues) : null,
  });
  assertCanonicalEqual(simulation.metrics, metrics, `${context}.metrics`);
  return metrics;
}

function assertSimulationBacksSchedule(simulation, schedule, context) {
  if (!simulation.valid) return true;
  if (!Array.isArray(schedule) || !schedule.length) throw new Error(`${context} valid simulation has no expected execution schedule`);
  const tradeEvents = simulation.events.filter(event => event.type !== 'terminal_liquidation');
  if (tradeEvents.length !== schedule.length) throw new Error(`${context} trade events do not match the expected execution schedule length`);
  for (let index = 0; index < schedule.length; index++) {
    const expected = schedule[index];
    const actual = tradeEvents[index];
    const expectedTarget = expected.targetExposure == null ? expected.desiredTarget : expected.targetExposure;
    const expectedType = index === 0 ? 'entry_or_scheduled_rebalance' : 'scheduled_rebalance';
    if (actual.type !== expectedType || actual.date !== expected.executionDate || actual.targetExposure !== expectedTarget ||
        actual.signalDate !== (expected.signalDate || null) || actual.signalMonth !== (expected.signalMonth || null)) {
      throw new Error(`${context} trade event ${index} does not match its expected schedule event`);
    }
  }
  return true;
}

function assertBootstrapSchema(bootstrap, context) {
  if (bootstrap === null) return;
  assertExactKeys(bootstrap, ['buyAndHold', 'cash', 'constantMeanExposure', 'constantVolatilityMatched'], context);
  for (const [key, value] of Object.entries(bootstrap)) {
    assertExactKeys(value, [
      'circularBlockMonths', 'method', 'monthCount', 'percentile90', 'percentile95', 'pointEstimate',
      'replicateCount', 'seed', 'statistic', 'underpowered', 'underpoweredReason',
    ], `${context}.${key}`);
    if (!Array.isArray(value.percentile90) || value.percentile90.length !== 2 || !Array.isArray(value.percentile95) || value.percentile95.length !== 2) {
      throw new Error(`${context}.${key} percentile intervals must each contain exactly two endpoints`);
    }
  }
}

function assertScenarioResultSchema(result, context) {
  assertExactKeys(result, SCENARIO_RESULT_KEYS, context);
  assertSimulationSchema(result.candidate, `${context}.candidate`);
  assertExactKeys(result.benchmarks, ['buyAndHold', 'cash'], `${context}.benchmarks`);
  assertSimulationSchema(result.benchmarks.buyAndHold, `${context}.benchmarks.buyAndHold`);
  assertSimulationSchema(result.benchmarks.cash, `${context}.benchmarks.cash`);
  assertExactKeys(result.controls, CONTROL_KEYS, `${context}.controls`);
  assertSimulationSchema(result.controls.constantMeanExposure, `${context}.controls.constantMeanExposure`);
  assertSimulationSchema(result.controls.constantVolatilityMatched, `${context}.controls.constantVolatilityMatched`);
  if (result.controls.frozenDevelopmentMeanDiagnostic !== null) {
    assertSimulationSchema(result.controls.frozenDevelopmentMeanDiagnostic, `${context}.controls.frozenDevelopmentMeanDiagnostic`);
  }
  assertExactKeys(result.gates, ['conditions', 'edges', 'marketScenarioPass', 'originalSevenGatePass', 'sampleRequirement'], `${context}.gates`);
  assertExactKeys(result.gates.conditions, [
    'bhEdgeAtLeast0025', 'executionIntegrity', 'maximumDrawdownNoDeeperThanBuyAndHold',
    'requiredSourceIntervalsAndLiquidationComplete', 'timingEdgeAtLeast0010',
    'turnoverNoGreaterThanFourPerYear', 'volatilityNoGreaterThanBuyAndHold',
  ], `${context}.gates.conditions`);
  assertExactKeys(result.gates.edges, [
    'bhEdgeAnnualLogReturn', 'meanEdgeAnnualLogReturn', 'timingEdgeAnnualLogReturn', 'volEdgeAnnualLogReturn',
  ], `${context}.gates.edges`);
  assertExactKeys(result.gates.sampleRequirement, ['eligibleExecutedMonthlyHoldings', 'pass', 'requiredMinimum'], `${context}.gates.sampleRequirement`);
  assertBootstrapSchema(result.bootstrap, `${context}.bootstrap`);
  const bootstrapRequired = result.candidate.valid && result.benchmarks.buyAndHold.valid &&
    result.controls.constantMeanExposure.valid && result.controls.constantVolatilityMatched.valid;
  if ((result.bootstrap !== null) !== bootstrapRequired) throw new Error(`${context}.bootstrap presence does not match valid comparator paths`);
}

function assertScheduleEventSchema(event, context) {
  assertExactKeys(event, [
    'actualTradeReason', 'actualTradeRequired', 'anchorVariance', 'desiredTarget', 'equalityAtBandTrades',
    'executionDate', 'noTradeBandHeld', 'precedingDesiredTarget', 'preliminaryTarget', 'realizedVariance',
    'signalDate', 'signalMonth', 'varianceRatio',
  ], context);
}

function assertMarketResultSchema(market, candidateIds, context) {
  assertExactKeys(market, MARKET_RESULT_KEYS, context);
  if (!Array.isArray(market.knownDataIssues)) throw new Error(`${context}.knownDataIssues must be an array`);
  market.knownDataIssues.forEach((issue, index) => assertExactKeys(issue, ['issue', 'series'], `${context}.knownDataIssues[${index}]`));
  if (!Array.isArray(market.cashAlignmentRejections) || !Array.isArray(market.intervalRejections)) throw new Error(`${context} rejection inventories must be arrays`);
  market.cashAlignmentRejections.forEach((rejection, index) => assertExactKeys(rejection,
    rejection.type === 'stale_cash_asof'
      ? ['cashDate', 'riskyDate', 'staleCalendarDays', 'type']
      : ['riskyDate', 'type'], `${context}.cashAlignmentRejections[${index}]`));
  market.intervalRejections.forEach((rejection, index) => assertExactKeys(rejection, ['endDate', 'startDate', 'type'], `${context}.intervalRejections[${index}]`));
  for (const key of ['desiredTargetCalendars', 'actualTradeSchedules', 'omittedTerminalExecutionsByCandidate', 'targetCalendarByCandidate']) {
    assertCandidateMap(market[key], candidateIds, `${context}.${key}`);
  }
  for (const id of candidateIds) {
    for (const [key, events] of [
      ['desiredTargetCalendars', market.desiredTargetCalendars[id]],
      ['actualTradeSchedules', market.actualTradeSchedules[id]],
      ['omittedTerminalExecutionsByCandidate', market.omittedTerminalExecutionsByCandidate[id]],
    ]) {
      if (!Array.isArray(events)) throw new Error(`${context}.${key}.${id} must be an array`);
      events.forEach((event, index) => assertScheduleEventSchema(event, `${context}.${key}.${id}[${index}]`));
    }
    const calendar = market.targetCalendarByCandidate[id];
    const keys = Object.keys(calendar || {}).sort().join(',');
    if (keys === ['timeWeightedMeanTarget', 'targetDaySum', 'totalDays'].sort().join(',')) {
      assertExactKeys(calendar, ['timeWeightedMeanTarget', 'targetDaySum', 'totalDays'], `${context}.targetCalendarByCandidate.${id}`);
    } else {
      assertExactKeys(calendar, ['error', 'targetDaySum', 'timeWeightedMeanTarget', 'totalDays'], `${context}.targetCalendarByCandidate.${id}`);
    }
  }
  if (!Array.isArray(market.monthlyStates)) throw new Error(`${context}.monthlyStates must be an array`);
  market.monthlyStates.forEach((state, index) => assertExactKeys(state, [
    'anchorVariance', 'executionDate', 'finalRiskyClose', 'finalRiskyCloseIndex', 'month',
    'observedIntervalCount', 'realizedVariance', 'rejectedIntervalCount', 'signalStatus',
    'validIntervalCount', 'varianceMissingReason', 'varianceRatio',
  ], `${context}.monthlyStates[${index}]`));
  assertExactKeys(market.scenarioResults, SCENARIOS.map(scenario => scenario.id), `${context}.scenarioResults`);
  for (const scenario of SCENARIOS) {
    assertCandidateMap(market.scenarioResults[scenario.id], candidateIds, `${context}.scenarioResults.${scenario.id}`);
    for (const id of candidateIds) assertScenarioResultSchema(market.scenarioResults[scenario.id][id], `${context}.scenarioResults.${scenario.id}.${id}`);
  }
}

function recomputeAnalysisIntegrity(analysis, expectedStage, expectedCandidateIds, { frozenDevelopmentMeanTarget = undefined } = {}) {
  assertExactKeys(analysis, ANALYSIS_KEYS, `${expectedStage} analysis`);
  if (analysis.inputSchema !== INPUT_SCHEMA || analysis.inputStage !== expectedStage) throw new Error(`${expectedStage} analysis input identity mismatch`);
  assertSha256(analysis.inputSha256, `${expectedStage} analysis.inputSha256`);
  if (analysis.runnerSha256 !== runnerSha256()) throw new Error(`${expectedStage} analysis runner hash mismatch`);
  assertCanonicalEqual(analysis.protocol, assertProtocolFrozen(), `${expectedStage} analysis protocol`);
  assertCanonicalEqual(analysis.implementationConventions, IMPLEMENTATION_CONVENTIONS, `${expectedStage} analysis implementation conventions`);
  assertCanonicalEqual(analysis.excludedCostsDisclosure, ['taxes', 'market impact', 'custody', 'locate fees', 'index-replication costs'], `${expectedStage} analysis excluded-cost disclosure`);
  if (analysis.sourceDeclarationWarning !== 'Offline schema validation does not independently authenticate provider methodology, revision history, historical margin eligibility, or executable closes.') {
    throw new Error(`${expectedStage} analysis source-declaration warning changed`);
  }
  if (analysis.marketDependenceWarning !== 'Sweden, Europe, USA, and Global overlap economically; market passes are not independent statistical observations.') {
    throw new Error(`${expectedStage} analysis market-dependence warning changed`);
  }
  if (!Array.isArray(analysis.candidates) || analysis.candidates.join(',') !== expectedCandidateIds.join(',')) throw new Error(`${expectedStage} analysis candidate set mismatch`);
  assertExactKeys(analysis.stageConfig, [
    'declaredTerminalCloses', 'finalCompletedDate', 'marketKeys', 'minimumExecutedMonthlyHoldings',
    'segmentStartDate', 'warmupVarianceStartDate',
  ], `${expectedStage} analysis.stageConfig`);
  const frozenStage = STAGES[expectedStage];
  if (analysis.stageConfig.marketKeys.join(',') !== frozenStage.marketKeys.join(',') ||
      analysis.stageConfig.minimumExecutedMonthlyHoldings !== frozenStage.minimumExecutedMonthlyHoldings ||
      analysis.stageConfig.segmentStartDate !== frozenStage.segmentStartDate ||
      analysis.stageConfig.warmupVarianceStartDate !== frozenStage.warmupVarianceStartDate ||
      (expectedStage !== 'evaluation' && analysis.stageConfig.finalCompletedDate !== frozenStage.finalCompletedDate)) {
    throw new Error(`${expectedStage} analysis stage configuration changed`);
  }
  dateMilliseconds(analysis.stageConfig.finalCompletedDate, `${expectedStage} analysis.stageConfig.finalCompletedDate`);
  assertExactKeys(analysis.stageConfig.declaredTerminalCloses, ['cash', ...frozenStage.marketKeys], `${expectedStage} analysis.stageConfig.declaredTerminalCloses`);
  for (const [key, date] of Object.entries(analysis.stageConfig.declaredTerminalCloses)) dateMilliseconds(date, `${expectedStage} analysis.stageConfig.declaredTerminalCloses.${key}`);
  assertCanonicalEqual(
    analysis.stageConfig.declaredTerminalCloses,
    expectedTerminalCloses(expectedStage, analysis.stageConfig.finalCompletedDate),
    `${expectedStage} analysis exact terminal endpoints`,
  );
  assertExactKeys(analysis.revisionEvidence, ['allPointInTimeRevisionZero', 'cash', 'claimLimit', 'markets'], `${expectedStage} analysis.revisionEvidence`);
  if (!REVISION_STATUSES.includes(analysis.revisionEvidence.cash)) throw new Error(`${expectedStage} analysis cash revision status is invalid`);
  assertExactKeys(analysis.revisionEvidence.markets, frozenStage.marketKeys, `${expectedStage} analysis.revisionEvidence.markets`);
  if (!Array.isArray(analysis.marketResults) || analysis.marketResults.map(market => market.market).join(',') !== frozenStage.marketKeys.join(',')) {
    throw new Error(`${expectedStage} analysis markets mismatch`);
  }
  let resolvedFrozenDevelopmentMeanTarget = expectedStage === 'development' ? null : frozenDevelopmentMeanTarget;
  assertCanonicalEqual(
    analysis.revisionEvidence.markets,
    Object.fromEntries(analysis.marketResults.map(market => [market.market, market.revisionStatus])),
    `${expectedStage} analysis revision evidence by market`,
  );
  const allPointInTimeRevisionZero = analysis.revisionEvidence.cash === 'point_in_time_revision_zero' &&
    analysis.marketResults.every(market => market.revisionStatus === 'point_in_time_revision_zero');
  if (analysis.revisionEvidence.allPointInTimeRevisionZero !== allPointInTimeRevisionZero) throw new Error(`${expectedStage} analysis point-in-time revision summary changed`);
  const expectedClaimLimit = allPointInTimeRevisionZero
    ? 'Point-in-time claim is schema-capable only if source declarations are independently verified.'
    : 'Current-vintage revised history or provider backcast can falsify retrospectively but cannot confirm a point-in-time claim.';
  if (analysis.revisionEvidence.claimLimit !== expectedClaimLimit) throw new Error(`${expectedStage} analysis revision claim limit changed`);
  for (const [index, market] of analysis.marketResults.entries()) {
    const context = `${expectedStage} analysis.marketResults[${index}]`;
    assertMarketResultSchema(market, expectedCandidateIds, context);
    requireText(market.instrumentIdentity, `${context}.instrumentIdentity`);
    if (typeof market.documentedMaximumTargetExposure !== 'number' || !Number.isFinite(market.documentedMaximumTargetExposure) || market.documentedMaximumTargetExposure < 1) {
      throw new Error(`${context}.documentedMaximumTargetExposure must be finite and at least 1`);
    }
    if (!REVISION_STATUSES.includes(market.revisionStatus)) throw new Error(`${context}.revisionStatus is invalid`);
    const expectedEvidenceClass = market.revisionStatus === 'point_in_time_revision_zero'
      ? 'point_in_time_capable_if_source_declarations_are_independently_verified'
      : 'retrospective_falsification_only';
    if (market.evidenceClass !== expectedEvidenceClass) throw new Error(`${context}.evidenceClass does not match revisionStatus`);
    if (market.terminalDate !== analysis.stageConfig.declaredTerminalCloses[market.market]) throw new Error(`${context}.terminalDate differs from declared terminal close`);
    if (analysis.stageConfig.declaredTerminalCloses.cash < market.terminalDate) throw new Error(`${context} extends beyond declared cash support`);
    if (market.minimumExecutedMonthlyHoldings !== frozenStage.minimumExecutedMonthlyHoldings) throw new Error(`${context}.minimumExecutedMonthlyHoldings changed`);
    for (const id of expectedCandidateIds) {
      const candidate = CANDIDATES.find(item => item.id === id);
      const restoredMonthlyStates = market.monthlyStates.map(state => ({
        ...state,
        anchorVariance: restoreJsonSafeNumber(state.anchorVariance),
        realizedVariance: restoreJsonSafeNumber(state.realizedVariance),
        varianceRatio: restoreJsonSafeNumber(state.varianceRatio),
      }));
      const schedules = buildCandidateSchedule(restoredMonthlyStates, candidate, { ...analysis.stageConfig, terminalCloseDate: market.terminalDate });
      assertCanonicalEqual(market.desiredTargetCalendars[id], schedules.desiredTargetCalendar, `${context}.desiredTargetCalendars.${id}`);
      assertCanonicalEqual(market.actualTradeSchedules[id], schedules.actualTradeSchedule, `${context}.actualTradeSchedules.${id}`);
      assertCanonicalEqual(market.omittedTerminalExecutionsByCandidate[id], schedules.omittedTerminalExecutions, `${context}.omittedTerminalExecutionsByCandidate.${id}`);
      let targetCalendar;
      try {
        targetCalendar = scheduleTargetExposure(schedules.desiredTargetCalendar, market.terminalDate);
      } catch (error) {
        targetCalendar = { timeWeightedMeanTarget: null, targetDaySum: 0, totalDays: 0, error: error.message };
      }
      assertCanonicalEqual(market.targetCalendarByCandidate[id], targetCalendar, `${context}.targetCalendarByCandidate.${id}`);
    }
    const expectedFirstSchedule = market.actualTradeSchedules[expectedCandidateIds[0]];
    const expectedFirstExecutionDate = expectedFirstSchedule.length ? expectedFirstSchedule[0].executionDate : null;
    if (market.firstExecutionDate !== expectedFirstExecutionDate) throw new Error(`${context}.firstExecutionDate does not match its actual trade schedule`);
    if (market.eligibleExecutedMonthlyHoldings !== market.desiredTargetCalendars[expectedCandidateIds[0]].length) throw new Error(`${context}.eligibleExecutedMonthlyHoldings does not match its desired-target calendar`);
    const recomputedCompleteness = assessRequiredCompleteness({
      monthlyStates: market.monthlyStates,
      alignmentRejections: market.cashAlignmentRejections,
      intervalRejections: market.intervalRejections,
      knownDataIssues: market.knownDataIssues,
      firstExecutionDate: market.firstExecutionDate,
      terminalDate: market.terminalDate,
    });
    assertCanonicalEqual(market.requiredCashAlignmentRejections, recomputedCompleteness.requiredCashAlignmentRejections, `${context}.requiredCashAlignmentRejections`);
    assertCanonicalEqual(market.requiredIntervalRejections, recomputedCompleteness.requiredIntervalRejections, `${context}.requiredIntervalRejections`);
    assertCanonicalEqual(market.missingRequiredMonths, recomputedCompleteness.missingRequiredMonths, `${context}.missingRequiredMonths`);
    assertCanonicalEqual(market.staleTargetMonths, recomputedCompleteness.staleTargetMonths, `${context}.staleTargetMonths`);
    if (market.sourceAndIntervalsComplete !== recomputedCompleteness.sourceAndIntervalsComplete) throw new Error(`${context}.sourceAndIntervalsComplete does not match detailed completeness evidence`);
    const expectedMissingVarianceMonths = market.monthlyStates.filter(state => state.realizedVariance == null).map(state => ({
      month: state.month,
      validIntervalCount: state.validIntervalCount,
      observedIntervalCount: state.observedIntervalCount,
      reason: state.varianceMissingReason,
    }));
    assertCanonicalEqual(market.missingVarianceMonths, expectedMissingVarianceMonths, `${context}.missingVarianceMonths`);
    const expectedUnfilledTerminalSignals = market.monthlyStates.filter(state => state.signalStatus === 'valid_but_no_next_executable_close')
      .map(state => ({ month: state.month, signalDate: state.finalRiskyClose }));
    assertCanonicalEqual(market.unfilledTerminalSignals, expectedUnfilledTerminalSignals, `${context}.unfilledTerminalSignals`);
    for (const scenario of SCENARIOS) {
      for (const id of expectedCandidateIds) {
        const cell = market.scenarioResults[scenario.id][id];
        for (const [label, simulation] of [
          ['candidate', cell.candidate],
          ['buyAndHold', cell.benchmarks.buyAndHold],
          ['cash', cell.benchmarks.cash],
          ['constantMeanExposure', cell.controls.constantMeanExposure],
          ['constantVolatilityMatched', cell.controls.constantVolatilityMatched],
          ['frozenDevelopmentMeanDiagnostic', cell.controls.frozenDevelopmentMeanDiagnostic],
        ]) {
          if (simulation && simulation.valid && (simulation.metrics.startDate !== market.firstExecutionDate || simulation.metrics.endDate !== market.terminalDate)) {
            throw new Error(`${context}.${scenario.id}.${id}.${label} does not use the common market segment dates`);
          }
        }
        const scheduledCount = market.actualTradeSchedules[id].length;
        for (const [label, simulation] of [
          ['candidate', cell.candidate],
          ['constantMeanExposure', cell.controls.constantMeanExposure],
          ['constantVolatilityMatched', cell.controls.constantVolatilityMatched],
          ['frozenDevelopmentMeanDiagnostic', cell.controls.frozenDevelopmentMeanDiagnostic],
        ]) {
          if (simulation && simulation.valid && simulation.metrics.scheduledExecutionCount !== scheduledCount) {
            throw new Error(`${context}.${scenario.id}.${id}.${label} scheduled execution count differs from the candidate actual trade schedule`);
          }
        }
        for (const [label, simulation] of [['buyAndHold', cell.benchmarks.buyAndHold], ['cash', cell.benchmarks.cash]]) {
          if (simulation.valid && simulation.metrics.scheduledExecutionCount !== 1) throw new Error(`${context}.${scenario.id}.${id}.${label} must have one entry schedule event`);
        }
        for (const [label, simulation] of [
          ['candidate', cell.candidate],
          ['buyAndHold', cell.benchmarks.buyAndHold],
          ['cash', cell.benchmarks.cash],
          ['constantMeanExposure', cell.controls.constantMeanExposure],
          ['constantVolatilityMatched', cell.controls.constantVolatilityMatched],
          ['frozenDevelopmentMeanDiagnostic', cell.controls.frozenDevelopmentMeanDiagnostic],
        ]) {
          if (simulation) recomputeSimulationMetrics(simulation, scenario, `${context}.${scenario.id}.${id}.${label}`);
        }
        if (cell.candidate.label !== id || cell.benchmarks.buyAndHold.label !== 'buy_and_hold' || cell.benchmarks.cash.label !== 'cash') {
          throw new Error(`${context}.${scenario.id}.${id} simulation labels changed`);
        }
        assertSimulationBacksSchedule(cell.candidate, market.actualTradeSchedules[id], `${context}.${scenario.id}.${id}.candidate`);
        assertSimulationBacksSchedule(cell.benchmarks.buyAndHold,
          market.firstExecutionDate == null ? [] : [{ executionDate: market.firstExecutionDate, targetExposure: 1 }],
          `${context}.${scenario.id}.${id}.buyAndHold`);
        assertSimulationBacksSchedule(cell.benchmarks.cash,
          market.firstExecutionDate == null ? [] : [{ executionDate: market.firstExecutionDate, targetExposure: 0 }],
          `${context}.${scenario.id}.${id}.cash`);
        const targetCalendar = market.targetCalendarByCandidate[id];
        if (cell.controls.constantMeanExposureTarget !== targetCalendar.timeWeightedMeanTarget) throw new Error(`${context}.${scenario.id}.${id} constant-mean target differs from the candidate reporting calendar`);
        if (cell.controls.constantMeanExposureTarget != null) {
          if (cell.controls.constantMeanExposure.label !== `constant_mean_exposure_${cell.controls.constantMeanExposureTarget}`) throw new Error(`${context}.${scenario.id}.${id} constant-mean label changed`);
          assertSimulationBacksSchedule(cell.controls.constantMeanExposure,
            constantSchedule(market.actualTradeSchedules[id], cell.controls.constantMeanExposureTarget),
            `${context}.${scenario.id}.${id}.constantMeanExposure`);
        }
        if (cell.candidate.valid && cell.candidate.metrics.timeWeightedMeanTarget !== targetCalendar.timeWeightedMeanTarget) throw new Error(`${context}.${scenario.id}.${id} candidate mean target differs from its reporting calendar`);
        if (cell.controls.constantMeanExposure.valid && cell.controls.constantMeanExposure.metrics.timeWeightedMeanTarget !== cell.controls.constantMeanExposureTarget) throw new Error(`${context}.${scenario.id}.${id} constant-mean simulation target mismatch`);
        if (cell.controls.constantVolatilityMatched.valid && cell.controls.constantVolatilityMatched.metrics.timeWeightedMeanTarget !== cell.controls.constantVolatilityMatchedTarget) throw new Error(`${context}.${scenario.id}.${id} volatility-control target mismatch`);
        const grid = executableGridTargets(market.documentedMaximumTargetExposure);
        const anyCandidateHasVolatility = expectedCandidateIds.some(candidateId => {
          const candidateSimulation = market.scenarioResults[scenario.id][candidateId].candidate;
          return candidateSimulation.valid && candidateSimulation.metrics.annualizedVolatility != null;
        });
        if (cell.controls.volatilityGridTargetsTested !== (anyCandidateHasVolatility ? grid.targets.length : 0) ||
            cell.controls.volatilityGridTargetsRejectedAboveDocumentedMarginLimit !== grid.rejectedAboveDocumentedLimit) {
          throw new Error(`${context}.${scenario.id}.${id} volatility grid receipt mismatch`);
        }
        if (cell.controls.constantVolatilityMatchedTarget != null) {
          const target = cell.controls.constantVolatilityMatchedTarget;
          if (!grid.targets.includes(target) || cell.controls.constantVolatilityMatched.label !== `constant_volatility_matched_${target.toFixed(4)}`) {
            throw new Error(`${context}.${scenario.id}.${id} volatility control is not an exact executable grid target`);
          }
          assertSimulationBacksSchedule(cell.controls.constantVolatilityMatched,
            constantSchedule(market.actualTradeSchedules[id], target),
            `${context}.${scenario.id}.${id}.constantVolatilityMatched`);
        }
        const expectedVolatilityDistance = cell.candidate.valid && cell.controls.constantVolatilityMatched.valid &&
          cell.candidate.metrics.annualizedVolatility != null && cell.controls.constantVolatilityMatched.metrics.annualizedVolatility != null
          ? Math.abs(cell.controls.constantVolatilityMatched.metrics.annualizedVolatility - cell.candidate.metrics.annualizedVolatility)
          : null;
        if (cell.controls.constantVolatilityDistance !== expectedVolatilityDistance) throw new Error(`${context}.${scenario.id}.${id} volatility distance mismatch`);
        if (resolvedFrozenDevelopmentMeanTarget === undefined) resolvedFrozenDevelopmentMeanTarget = cell.controls.frozenDevelopmentMeanDiagnosticTarget;
        if (cell.controls.frozenDevelopmentMeanDiagnosticTarget !== resolvedFrozenDevelopmentMeanTarget ||
            (cell.controls.frozenDevelopmentMeanDiagnostic === null) !== (resolvedFrozenDevelopmentMeanTarget === null)) {
          throw new Error(`${context}.${scenario.id}.${id} frozen development mean diagnostic changed`);
        }
        if (cell.controls.frozenDevelopmentMeanDiagnostic && cell.controls.frozenDevelopmentMeanDiagnostic.valid &&
            cell.controls.frozenDevelopmentMeanDiagnostic.metrics.timeWeightedMeanTarget !== resolvedFrozenDevelopmentMeanTarget) {
          throw new Error(`${context}.${scenario.id}.${id} frozen development mean simulation target mismatch`);
        }
        if (cell.controls.frozenDevelopmentMeanDiagnostic) {
          if (cell.controls.frozenDevelopmentMeanDiagnostic.label !== `frozen_development_mean_diagnostic_${resolvedFrozenDevelopmentMeanTarget}`) {
            throw new Error(`${context}.${scenario.id}.${id} frozen development mean diagnostic label changed`);
          }
          assertSimulationBacksSchedule(cell.controls.frozenDevelopmentMeanDiagnostic,
            constantSchedule(market.actualTradeSchedules[id], resolvedFrozenDevelopmentMeanTarget),
            `${context}.${scenario.id}.${id}.frozenDevelopmentMeanDiagnostic`);
        }
        const expectedBootstrap = cell.candidate.valid && cell.benchmarks.buyAndHold.valid &&
          cell.controls.constantMeanExposure.valid && cell.controls.constantVolatilityMatched.valid
          ? {
            buyAndHold: bootstrapComparator(cell.candidate, cell.benchmarks.buyAndHold, market.market),
            constantMeanExposure: bootstrapComparator(cell.candidate, cell.controls.constantMeanExposure, market.market),
            constantVolatilityMatched: bootstrapComparator(cell.candidate, cell.controls.constantVolatilityMatched, market.market),
            cash: bootstrapComparator(cell.candidate, cell.benchmarks.cash, market.market),
          }
          : null;
        assertCanonicalEqual(cell.bootstrap, expectedBootstrap, `${context}.${scenario.id}.${id}.bootstrap`);
        const recomputedGates = evaluateSevenGates({
          candidateSimulation: cell.candidate,
          buyAndHold: cell.benchmarks.buyAndHold,
          constantMean: cell.controls.constantMeanExposure,
          constantVolatilityMatched: cell.controls.constantVolatilityMatched,
          sourceAndIntervalsComplete: market.sourceAndIntervalsComplete,
          eligibleExecutedMonthlyHoldings: market.eligibleExecutedMonthlyHoldings,
          minimumExecutedMonthlyHoldings: market.minimumExecutedMonthlyHoldings,
        });
        assertCanonicalEqual(cell.gates, recomputedGates, `${context}.${scenario.id}.${id}.gates`);
      }
    }
  }
  const summaries = candidateStageSummaries(analysis.marketResults, expectedCandidateIds.map(id => CANDIDATES.find(candidate => candidate.id === id)));
  assertCanonicalEqual(analysis.candidateSummaries, summaries, `${expectedStage} analysis candidate summaries`);
  const averages = aggregateMarketAverages(analysis.marketResults, expectedCandidateIds.map(id => CANDIDATES.find(candidate => candidate.id === id)));
  assertCanonicalEqual(analysis.equalWeightMarketAverages, averages, `${expectedStage} analysis equal-weight averages`);
  const stagePass = expectedStage === 'development'
    ? expectedCandidateIds.some(id => summaries[id].eligible)
    : expectedCandidateIds.every(id => summaries[id].eligible);
  if (analysis.stagePass !== stagePass) throw new Error(`${expectedStage} analysis.stagePass does not match its recomputed market/scenario gates`);
  return { summaries, stagePass, frozenDevelopmentMeanTarget: resolvedFrozenDevelopmentMeanTarget };
}

function assertPriorInputEvidence(artifact, expectedStage, context) {
  assertExactKeys(artifact, ['bytes', 'payload', 'resolved', 'sha256'], context);
  if (artifact[COMMITTED_ARTIFACT_TOKEN] !== true || !Object.isFrozen(artifact)) {
    throw new Error(`${context} must originate from the committed-clean canonical artifact reader`);
  }
  requireText(artifact.resolved, `${context}.resolved`);
  if (!Buffer.isBuffer(artifact.bytes)) throw new Error(`${context}.bytes must be a Buffer`);
  assertSha256(artifact.sha256, `${context}.sha256`);
  const computed = sha256Buffer(artifact.bytes);
  if (computed !== artifact.sha256) throw new Error(`${context}.sha256 does not match its exact bytes`);
  assertCanonicalJsonBytes(artifact.bytes, artifact.payload, context);
  if (!artifact.payload || artifact.payload.schema !== INPUT_SCHEMA || artifact.payload.stage !== expectedStage) {
    throw new Error(`${context} must contain exact ${expectedStage} ${INPUT_SCHEMA} input`);
  }
  return artifact;
}

function makeReplayReceipt(kind, manifest, inputSha256, selectionReplay = null) {
  const receipt = {
    kind,
    manifest,
    manifestSha256: sha256Buffer(Buffer.from(canonicalJson(jsonSafe(manifest)), 'utf8')),
    inputSha256,
    selectionReplay,
  };
  Object.defineProperty(receipt, REPLAY_RECEIPT_TOKEN, { value: true, enumerable: false });
  return Object.freeze(receipt);
}

function requireReplayReceipt(receipt, expectedKind, context) {
  if (!receipt || receipt[REPLAY_RECEIPT_TOKEN] !== true || receipt.kind !== expectedKind || !Object.isFrozen(receipt)) {
    throw new Error(`${context} requires an in-process ${expectedKind} replay receipt bound to committed prior-input evidence`);
  }
  assertSha256(receipt.inputSha256, `${context}.inputSha256`);
  const currentManifestSha256 = sha256Buffer(Buffer.from(canonicalJson(jsonSafe(receipt.manifest)), 'utf8'));
  if (currentManifestSha256 !== receipt.manifestSha256) throw new Error(`${context} replay receipt manifest changed after replay`);
  if (expectedKind === 'stage2') requireReplayReceipt(receipt.selectionReplay, 'stage1', `${context}.selectionReplay`);
  return receipt;
}

function buildDevelopmentManifest(input, inputSha256) {
  const analysis = analyzeStage(input, 'development', { inputSha256 });
  const selected = selectDevelopmentCandidate(analysis.candidateSummaries);
  const pooled = selected ? pooledDevelopmentMeanTarget(analysis, selected.id) : null;
  return {
    schema: SELECTION_MANIFEST_SCHEMA,
    status: selected ? 'STAGE_1_SELECTED_CANDIDATE' : 'NO_UNIVERSAL_CANDIDATE',
    researchOnly: true,
    protocol: analysis.protocol,
    runnerSha256: analysis.runnerSha256,
    testSha256: testSha256(),
    developmentInputSha256: inputSha256,
    selectedCandidate: selected ? selected.id : null,
    selectedCandidateParameters: selected,
    developmentPooledMeanTargetDiagnostic: pooled,
    allFourCandidateResults: analysis,
    stagePass: Boolean(selected),
    nextStageSealedUnlessCommitted: true,
  };
}

function assertManifestIdentity(manifest, schema, context) {
  if (!manifest || manifest.schema !== schema) throw new Error(`${context}.schema must be ${schema}`);
  assertExactKeys(manifest.protocol, ['marker', 'sha256'], `${context}.protocol`);
  if (manifest.protocol.marker !== PROTOCOL_MARKER || manifest.protocol.sha256 !== PROTOCOL_SHA256) throw new Error(`${context} protocol identity mismatch`);
  if (manifest.runnerSha256 !== runnerSha256()) throw new Error(`${context} runner hash does not match the executing frozen runner`);
  if (manifest.testSha256 !== testSha256()) throw new Error(`${context} synthetic-test hash does not match the frozen test file`);
}

function validateSelectionManifest(manifest, developmentInputEvidence) {
  assertExactKeys(manifest, SELECTION_MANIFEST_KEYS, 'selection manifest');
  assertManifestIdentity(manifest, SELECTION_MANIFEST_SCHEMA, 'selection manifest');
  if (manifest.researchOnly !== true || manifest.nextStageSealedUnlessCommitted !== true) throw new Error('selection manifest research/sealing declarations changed');
  const evidence = assertPriorInputEvidence(developmentInputEvidence, 'development', 'committed development input');
  if (manifest.developmentInputSha256 !== evidence.sha256) throw new Error('selection manifest developmentInputSha256 does not match the committed development input');
  const rebuilt = buildDevelopmentManifest(evidence.payload, evidence.sha256);
  assertCanonicalEqual(manifest, rebuilt, 'selection manifest deterministic Stage-1 replay');
  if (!rebuilt.stagePass || !rebuilt.selectedCandidate) throw new Error('selection manifest did not pass replayed Stage 1');
  return makeReplayReceipt('stage1', manifest, evidence.sha256);
}

function buildValidationManifest(input, inputSha256, selectionReplay) {
  const selectionReceipt = requireReplayReceipt(selectionReplay, 'stage1', 'validation builder');
  const selectionManifest = selectionReceipt.manifest;
  const analysis = analyzeStage(input, 'validation', {
    selectedCandidate: selectionManifest.selectedCandidate,
    frozenDevelopmentMeanTarget: selectionManifest.developmentPooledMeanTargetDiagnostic.target,
    inputSha256,
  });
  return {
    schema: VALIDATION_MANIFEST_SCHEMA,
    status: analysis.stagePass ? 'STAGE_2_PASS' : 'STAGE_2_SELECTED_CANDIDATE_FAILED',
    researchOnly: true,
    protocol: analysis.protocol,
    runnerSha256: analysis.runnerSha256,
    testSha256: testSha256(),
    selectionManifestSha256: selectionReceipt.manifestSha256,
    validationInputSha256: inputSha256,
    selectedCandidate: selectionManifest.selectedCandidate,
    frozenDevelopmentMeanTargetDiagnostic: selectionManifest.developmentPooledMeanTargetDiagnostic,
    selectedCandidateResults: analysis,
    stagePass: analysis.stagePass,
    stage3SealedUnlessCommittedPass: true,
  };
}

function validateValidationManifest(manifest, selectionReplay, validationInputEvidence) {
  const selectionReceipt = requireReplayReceipt(selectionReplay, 'stage1', 'validation manifest validator');
  const selectionManifest = selectionReceipt.manifest;
  assertExactKeys(manifest, VALIDATION_MANIFEST_KEYS, 'validation manifest');
  assertManifestIdentity(manifest, VALIDATION_MANIFEST_SCHEMA, 'validation manifest');
  if (manifest.researchOnly !== true || manifest.stage3SealedUnlessCommittedPass !== true) throw new Error('validation manifest research/sealing declarations changed');
  const evidence = assertPriorInputEvidence(validationInputEvidence, 'validation', 'committed validation input');
  if (manifest.validationInputSha256 !== evidence.sha256) throw new Error('validation manifest validationInputSha256 does not match the committed validation input');
  if (manifest.selectionManifestSha256 !== selectionReceipt.manifestSha256) throw new Error('validation manifest is not bound to the replayed Stage-1 manifest');
  const rebuilt = buildValidationManifest(evidence.payload, evidence.sha256, selectionReceipt);
  assertCanonicalEqual(manifest, rebuilt, 'validation manifest deterministic Stage-2 replay');
  if (!rebuilt.stagePass) throw new Error('validation manifest did not pass replayed Stage 2; Stage 3 remains sealed');
  return makeReplayReceipt('stage2', manifest, evidence.sha256, selectionReceipt);
}

function assertReplayChain(selectionReplay, validationReplay, context) {
  const selectionReceipt = requireReplayReceipt(selectionReplay, 'stage1', `${context}.selectionReplay`);
  const validationReceipt = requireReplayReceipt(validationReplay, 'stage2', `${context}.validationReplay`);
  if (validationReceipt.selectionReplay.manifestSha256 !== selectionReceipt.manifestSha256) {
    throw new Error(`${context} Stage-2 replay is not bound to the supplied Stage-1 replay`);
  }
  return { selectionReceipt, validationReceipt };
}

function buildEvaluationResult(input, inputSha256, selectionReplay, validationReplay) {
  const { selectionReceipt, validationReceipt } = assertReplayChain(selectionReplay, validationReplay, 'evaluation builder');
  const selectionManifest = selectionReceipt.manifest;
  const validationManifest = validationReceipt.manifest;
  const analysis = analyzeStage(input, 'evaluation', {
    selectedCandidate: selectionManifest.selectedCandidate,
    frozenDevelopmentMeanTarget: selectionManifest.developmentPooledMeanTargetDiagnostic.target,
    inputSha256,
  });
  return {
    schema: EVALUATION_RESULT_SCHEMA,
    status: analysis.stagePass ? 'STAGE_3_RETROSPECTIVE_TEMPORAL_PASS' : 'STAGE_3_RETROSPECTIVE_TEMPORAL_FAILURE',
    researchOnly: true,
    productionApproved: false,
    protocol: analysis.protocol,
    runnerSha256: analysis.runnerSha256,
    testSha256: testSha256(),
    selectionManifestSha256: selectionReceipt.manifestSha256,
    validationManifestSha256: validationReceipt.manifestSha256,
    evaluationInputSha256: inputSha256,
    selectedCandidate: selectionManifest.selectedCandidate,
    frozenDevelopmentMeanTargetDiagnostic: selectionManifest.developmentPooledMeanTargetDiagnostic,
    selectedCandidateResults: analysis,
    stagePass: analysis.stagePass,
    interpretation: analysis.stagePass
      ? 'Retrospective temporal evidence only; no dashboard, production signal, or live allocation is authorized.'
      : 'The unchanged selected candidate failed the retrospective temporal evaluation; no fallback candidate is permitted.',
  };
}

function validateEvaluationResult(result, selectionReplay, validationReplay) {
  const { selectionReceipt, validationReceipt } = assertReplayChain(selectionReplay, validationReplay, 'evaluation result validator');
  const selectionManifest = selectionReceipt.manifest;
  assertExactKeys(result, EVALUATION_RESULT_KEYS, 'evaluation result');
  assertManifestIdentity(result, EVALUATION_RESULT_SCHEMA, 'evaluation result');
  if (result.researchOnly !== true || result.productionApproved !== false || result.selectedCandidate !== selectionManifest.selectedCandidate) {
    throw new Error('evaluation result research/candidate declarations changed');
  }
  assertSha256(result.evaluationInputSha256, 'evaluation result evaluationInputSha256');
  assertCanonicalEqual(result.frozenDevelopmentMeanTargetDiagnostic, selectionManifest.developmentPooledMeanTargetDiagnostic, 'evaluation result frozen development mean diagnostic');
  if (result.selectionManifestSha256 !== selectionReceipt.manifestSha256 || result.validationManifestSha256 !== validationReceipt.manifestSha256) {
    throw new Error('evaluation result is not bound to the replayed prior-stage manifests');
  }
  const recomputedAnalysis = recomputeAnalysisIntegrity(result.selectedCandidateResults, 'evaluation', [result.selectedCandidate], {
    frozenDevelopmentMeanTarget: selectionManifest.developmentPooledMeanTargetDiagnostic.target,
  });
  const expectedStatus = recomputedAnalysis.stagePass ? 'STAGE_3_RETROSPECTIVE_TEMPORAL_PASS' : 'STAGE_3_RETROSPECTIVE_TEMPORAL_FAILURE';
  const expectedInterpretation = recomputedAnalysis.stagePass
    ? 'Retrospective temporal evidence only; no dashboard, production signal, or live allocation is authorized.'
    : 'The unchanged selected candidate failed the retrospective temporal evaluation; no fallback candidate is permitted.';
  if (result.stagePass !== recomputedAnalysis.stagePass || result.status !== expectedStatus || result.interpretation !== expectedInterpretation ||
      result.selectedCandidateResults.inputSha256 !== result.evaluationInputSha256) {
    throw new Error('evaluation result status/stagePass does not match recomputed Stage 3 results');
  }
  return result;
}

function jsonSafe(value) {
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]));
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
  return value;
}

function readJsonFile(file, context) {
  const resolved = path.resolve(file);
  const bytes = fs.readFileSync(resolved);
  let payload;
  try {
    payload = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${context} is not valid JSON: ${error.message}`);
  }
  return { resolved, bytes, sha256: sha256Buffer(bytes), payload };
}

function assertCommittedArtifact(file, { execFileSync = childProcess.execFileSync } = {}) {
  const resolved = path.resolve(file);
  const directory = path.dirname(resolved);
  let root;
  try {
    root = execFileSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    throw new Error(`stage manifest is not inside a Git worktree: ${resolved}`);
  }
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`stage manifest is outside its Git worktree: ${resolved}`);
  for (const target of [resolved, `${resolved}.sha256`]) {
    const targetRelative = path.relative(root, target).split(path.sep).join('/');
    try {
      execFileSync('git', ['-C', root, 'ls-files', '--error-unmatch', '--', targetRelative], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      throw new Error(`required stage artifact is not committed: ${target}`);
    }
    const status = execFileSync('git', ['-C', root, 'status', '--porcelain', '--', targetRelative], { encoding: 'utf8' });
    if (status.trim()) throw new Error(`required stage artifact has uncommitted changes: ${target}`);
    const committedObject = execFileSync('git', ['-C', root, 'rev-parse', `HEAD:${targetRelative}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const workingObject = execFileSync('git', ['-C', root, 'hash-object', '--path', targetRelative, target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (workingObject !== committedObject) {
      throw new Error(`required stage artifact bytes differ from the committed Git blob: ${target}`);
    }
  }
  return true;
}

function assertCodeFreezeCommitted({
  directory = path.dirname(__filename),
  targets = [PROTOCOL_PATH, __filename, TEST_PATH],
  execFileSync = childProcess.execFileSync,
} = {}) {
  if (!Array.isArray(targets) || targets.length !== 3) throw new Error('code freeze requires exactly protocol, runner, and synthetic-test targets');
  const resolvedTargets = targets.map(target => path.resolve(target));
  let root;
  try {
    root = execFileSync('git', ['-C', path.resolve(directory), 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    throw new Error('runner is not inside a Git worktree');
  }
  for (const target of resolvedTargets) {
    const relative = path.relative(root, target).split(path.sep).join('/');
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error(`code-freeze file is outside the Git worktree: ${target}`);
    try {
      execFileSync('git', ['-C', root, 'ls-files', '--error-unmatch', '--', relative], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      throw new Error(`code-freeze file is not committed: ${target}`);
    }
    const status = execFileSync('git', ['-C', root, 'status', '--porcelain', '--', relative], { encoding: 'utf8' });
    if (status.trim()) throw new Error(`code-freeze file has uncommitted changes: ${target}`);
    const committedObject = execFileSync('git', ['-C', root, 'rev-parse', `HEAD:${relative}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const workingObject = execFileSync('git', ['-C', root, 'hash-object', '--path', relative, target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (workingObject !== committedObject) {
      throw new Error(`code-freeze file bytes differ from the committed Git blob: ${target}`);
    }
  }
  return {
    protocolSha256: sha256Buffer(fs.readFileSync(resolvedTargets[0])),
    runnerSha256: sha256Buffer(fs.readFileSync(resolvedTargets[1])),
    testSha256: sha256Buffer(fs.readFileSync(resolvedTargets[2])),
  };
}

function readCommittedManifest(file, context, { committedArtifactCheck = assertCommittedArtifact } = {}) {
  committedArtifactCheck(file);
  const artifact = readJsonFile(file, context);
  assertCanonicalJsonBytes(artifact.bytes, artifact.payload, context);
  const sidecar = fs.readFileSync(`${artifact.resolved}.sha256`);
  if (!sidecar.equals(Buffer.from(`${artifact.sha256}\n`, 'utf8'))) throw new Error(`${context} SHA-256 sidecar mismatch`);
  Object.defineProperty(artifact, COMMITTED_ARTIFACT_TOKEN, { value: true, enumerable: false });
  return Object.freeze(artifact);
}

function writeArtifact(file, value) {
  const resolved = path.resolve(file);
  const sidecar = `${resolved}.sha256`;
  if (fs.existsSync(resolved) || fs.existsSync(sidecar)) throw new Error(`refusing to overwrite existing artifact or sidecar: ${resolved}`);
  if (!fs.existsSync(path.dirname(resolved))) throw new Error(`output directory does not exist: ${path.dirname(resolved)}`);
  const bytes = Buffer.from(canonicalJson(jsonSafe(value)), 'utf8');
  const digest = sha256Buffer(bytes);
  fs.writeFileSync(resolved, bytes, { flag: 'wx' });
  fs.writeFileSync(sidecar, `${digest}\n`, { flag: 'wx' });
  return { resolved, sha256: digest, sidecar };
}

function parseCommand(argv) {
  if (!Array.isArray(argv) || !argv.length || !STAGES[argv[0]]) throw new Error('first argument must be exactly development, validation, or evaluation; an all-stages command is forbidden');
  const stage = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (!['--input', '--output', '--selection-manifest', '--validation-manifest', '--development-input', '--validation-input'].includes(flag)) throw new Error(`unknown argument ${flag}`);
    if (options[flag]) throw new Error(`duplicate argument ${flag}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a path`);
    options[flag] = value;
  }
  for (const required of ['--input', '--output']) if (!options[required]) throw new Error(`${stage} requires ${required}`);
  if (stage === 'development' && (options['--selection-manifest'] || options['--validation-manifest'] || options['--development-input'] || options['--validation-input'])) {
    throw new Error('development command may not receive or open prior/later-stage manifests or inputs');
  }
  if (stage === 'validation' && (!options['--selection-manifest'] || !options['--development-input'] || options['--validation-manifest'] || options['--validation-input'])) {
    throw new Error('validation requires exactly --selection-manifest and --development-input before its current-stage input');
  }
  if (stage === 'evaluation' && (!options['--selection-manifest'] || !options['--development-input'] || !options['--validation-manifest'] || !options['--validation-input'])) {
    throw new Error('evaluation requires committed selection/validation manifests and exact development/validation inputs');
  }
  return { stage, options };
}

function main(argv = process.argv.slice(2), dependencies = {}) {
  const operations = {
    assertProtocolFrozen,
    assertCodeFreezeCommitted,
    readCommittedManifest,
    validateSelectionManifest,
    validateValidationManifest,
    readJsonFile,
    assertCanonicalJsonBytes,
    buildDevelopmentManifest,
    buildValidationManifest,
    buildEvaluationResult,
    writeArtifact,
    writeStatus: value => process.stdout.write(value),
    ...dependencies,
  };
  operations.assertProtocolFrozen(); // This deliberately precedes parsing, code sealing, and every stage-input read.
  const command = parseCommand(argv);
  operations.assertCodeFreezeCommitted(); // Outcomes remain sealed until protocol, runner, and synthetic tests are committed.
  let selectionReplay = null;
  let validationReplay = null;
  if (command.stage === 'validation' || command.stage === 'evaluation') {
    const selection = operations.readCommittedManifest(command.options['--selection-manifest'], 'selection manifest').payload;
    const developmentInput = operations.readCommittedManifest(command.options['--development-input'], 'committed development input');
    selectionReplay = operations.validateSelectionManifest(selection, developmentInput);
  }
  if (command.stage === 'evaluation') {
    const validation = operations.readCommittedManifest(command.options['--validation-manifest'], 'validation manifest').payload;
    const validationInput = operations.readCommittedManifest(command.options['--validation-input'], 'committed validation input');
    validationReplay = operations.validateValidationManifest(validation, selectionReplay, validationInput);
  }
  const stageInput = operations.readJsonFile(command.options['--input'], `${command.stage} input`);
  operations.assertCanonicalJsonBytes(stageInput.bytes, stageInput.payload, `${command.stage} input`);
  let output;
  if (command.stage === 'development') output = operations.buildDevelopmentManifest(stageInput.payload, stageInput.sha256);
  else if (command.stage === 'validation') output = operations.buildValidationManifest(stageInput.payload, stageInput.sha256, selectionReplay);
  else output = operations.buildEvaluationResult(stageInput.payload, stageInput.sha256, selectionReplay, validationReplay);
  const written = operations.writeArtifact(command.options['--output'], output);
  operations.writeStatus(`${JSON.stringify({ stage: command.stage, status: output.status, selectedCandidate: output.selectedCandidate, outputFile: written.resolved, outputSha256: written.sha256 }, null, 2)}\n`);
  return output;
}

module.exports = {
  PROTOCOL_PATH,
  TEST_PATH,
  PROTOCOL_MARKER,
  PROTOCOL_SHA256,
  INPUT_SCHEMA,
  SELECTION_MANIFEST_SCHEMA,
  VALIDATION_MANIFEST_SCHEMA,
  EVALUATION_RESULT_SCHEMA,
  MARKET_KEYS,
  DEVELOPMENT_MARKET_KEYS,
  REVISION_STATUSES,
  YEAR_DAYS,
  MAX_CASH_STALE_DAYS,
  MIN_MONTHLY_INTERVALS,
  ANCHOR_MONTHS,
  NO_TRADE_BAND,
  MIN_TARGET,
  MIN_EQUITY_TO_LONG_NOTIONAL,
  BOOTSTRAP_REPLICATES,
  BOOTSTRAP_BLOCK_MONTHS,
  BOOTSTRAP_SEED,
  CANDIDATES,
  SCENARIOS,
  STAGES,
  IMPLEMENTATION_CONVENTIONS,
  sha256Buffer,
  canonicalJson,
  runnerSha256,
  testSha256,
  assertExactKeys,
  assertProtocolFrozen,
  dateMilliseconds,
  calendarDays,
  validateRows,
  validateCashSeries,
  validateRiskySeries,
  validateInput,
  expectedTerminalCloses,
  lastIndexOnOrBefore,
  alignCashToRisky,
  median,
  buildMonthlyVarianceStates,
  assessRequiredCompleteness,
  preliminaryTarget,
  compareNoTradeBand,
  buildCandidateSchedule,
  exactRebalance,
  sampleStandardDeviation,
  maximumDrawdown,
  summarizeSimulation,
  simulatePolicy,
  scheduleTargetExposure,
  constantSchedule,
  pairedMonthlyLogDifferences,
  seededRandom,
  percentileR7,
  movingBlockBootstrap,
  edgeMetrics,
  evaluateSevenGates,
  executableGridTargets,
  prepareSimulationFactors,
  simulateConstantTargetVolatilityOnly,
  chooseVolatilityMatchedControls,
  verifyVolatilityMatchedControl,
  analyzeMarket,
  verifyMarketResultReplay,
  candidateStageSummaries,
  selectDevelopmentCandidate,
  aggregateMarketAverages,
  analyzeStage,
  pooledDevelopmentMeanTarget,
  recomputeSimulationMetrics,
  assertSimulationBacksSchedule,
  recomputeAnalysisIntegrity,
  assertCanonicalJsonBytes,
  buildDevelopmentManifest,
  validateSelectionManifest,
  buildValidationManifest,
  validateValidationManifest,
  buildEvaluationResult,
  validateEvaluationResult,
  assertCommittedArtifact,
  assertCodeFreezeCommitted,
  readCommittedManifest,
  parseCommand,
  main,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error && error.stack || error}\n`);
    process.exitCode = 1;
  }
}
