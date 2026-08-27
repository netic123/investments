'use strict';

// Frozen predictor-only component-fragility tail-risk falsification.
// The production command is deliberately one-shot, path-locked, offline, and
// unable to compute strategy exposures or wealth.

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const RESULT_SCHEMA = 'component-fragility-tail-risk-result-v1';
const FREEZE_MANIFEST_SCHEMA = 'component-fragility-tail-risk-freeze-manifest-v1';
const ATTEMPT_RECEIPT_SCHEMA = 'component-fragility-tail-risk-attempt-receipt-v1';
const ATTEMPT_RECEIPT_SCOPE = 'shared-git-common-directory';
const ATTEMPT_RECEIPT_GIT_COMMON_RELATIVE = 'codex-one-shot-research/component-fragility-tail-v1/attempt-receipt-2026-08-26.json';
const INPUT_STATUS = 'RETROSPECTIVE_DEVELOPMENT_ONLY_NO_CONFIRMATORY_OUTCOME';
const PROTOCOL_MARKER = 'FROZEN_COMPONENT_FRAGILITY_TAIL_V1';
const FIXED_PREOUTCOME_TAG = 'component-fragility-tail-risk-v1-preoutcome';
const TRAINING_CUTOFF = '2018-12-31';
const EVALUATION_START = '2019-01-01';
const HORIZON = 21;
const HAC_BANDWIDTH = 21;
const MINIMUM_FORECAST_ROWS = 756;
const MINIMUM_NON_OVERLAPPING = 36;
const MINIMUM_CALENDAR_SPAN_DAYS = 1095;
const MINIMUM_RELATIVE_MSE_IMPROVEMENT = 0.005;
const ALPHA = 0.05;
const QR_RANK_TOLERANCE = 1e-10;
const RESIDUAL_FRAGILITY_TOLERANCE = 1e-12;

const STATUS = Object.freeze({
  UNIDENTIFIABLE: 'UNIDENTIFIABLE',
  UNDERPOWERED: 'UNDERPOWERED',
  NO_SIGNAL: 'NO_COMPONENT_FRAGILITY_TAIL_SIGNAL',
  PASSED: 'TAIL_FORECAST_GATE_PASSED_RETROSPECTIVE_ONLY',
});

const MARKET_ORDER = Object.freeze(['crypto', 'sweden', 'usa', 'europe', 'global']);
const TRAINING_MARKETS = Object.freeze(['usa', 'europe']);
const COMPONENT_ORDER = Object.freeze(['momentum', 'strength', 'volatility', 'safeHaven', 'credit', 'breadth']);
const CONTROL_FEATURES = Object.freeze([
  'publishedScore',
  'logReturn1',
  'logReturn5',
  'logReturn20',
  'sigma20',
  'trend125',
  'drawdown63',
]);
const FULL_FEATURES = Object.freeze([...CONTROL_FEATURES, 'fragility']);

const PATHS = Object.freeze({
  protocol: path.join(__dirname, 'COMPONENT_FRAGILITY_TAIL_RISK_PROTOCOL.md'),
  runner: __filename,
  tests: path.join(REPO_ROOT, 'test', 'component_fragility_tail_risk.test.js'),
  launcher: path.join(__dirname, 'component_fragility_tail_risk_launcher.js'),
  manifest: path.join(__dirname, 'component-fragility-tail-risk-freeze-v1.json'),
  schema5Protocol: path.join(__dirname, 'FEAR_GREED_V2_VALIDATION_PROTOCOL.md'),
  schema5Reader: path.join(__dirname, 'fear_greed_v2_validation.js'),
  schema4Math: path.join(__dirname, 'fear_greed_model_search.js'),
  marketEngine: path.join(REPO_ROOT, 'marketfg.js'),
  productionConfig: path.join(REPO_ROOT, 'data', 'config.json'),
  input: path.join(__dirname, 'local-artifacts', 'v2-validation-final', 'inputs', 'fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json'),
  inputSidecar: path.join(__dirname, 'local-artifacts', 'v2-validation-final', 'inputs', 'fear-greed-v2-validation-input-2026-08-25T12-44-22Z.sha256'),
  outputDirectory: path.join(__dirname, 'local-artifacts', 'component-fragility-tail-v1'),
  output: path.join(__dirname, 'local-artifacts', 'component-fragility-tail-v1', 'component-fragility-tail-v1-result-2026-08-26.json'),
  outputSidecar: path.join(__dirname, 'local-artifacts', 'component-fragility-tail-v1', 'component-fragility-tail-v1-result-2026-08-26.json.sha256'),
});

const EXPECTED_SHA256 = Object.freeze({
  protocol: '3f38edba122cbdb0e51af47a3c08ddb320a2ba203a5fecaaef3af5fd29e1ba8b',
  schema5Protocol: '6f00302f57979fc94a60835c19aec8f8c3c88ec482b2ab59778180c2ac789c6d',
  schema5Reader: '846a8812bd08fa3243b3de645ac30c6c02379f7f575ea356cf78eba2dce8c374',
  schema4Math: 'b7cebf64cb0c1db55c22a18e3f41877db67f099ec9484435fae1be0755e93a0a',
  marketEngine: '018954b001df8738d3d152969abd98764b7683516e97f7afecd8b786a9d22090',
  productionConfig: 'c4eeae263da7052d1c16b38a829841aa6ca8cf43e6caffc407fd880d18cca7c7',
  input: 'ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d',
});

const PINNED_DEPENDENCIES = Object.freeze([
  Object.freeze({ key: 'protocol', path: PATHS.protocol, sha256: EXPECTED_SHA256.protocol, marker: PROTOCOL_MARKER }),
  Object.freeze({ key: 'schema5Protocol', path: PATHS.schema5Protocol, sha256: EXPECTED_SHA256.schema5Protocol }),
  Object.freeze({ key: 'schema5Reader', path: PATHS.schema5Reader, sha256: EXPECTED_SHA256.schema5Reader }),
  Object.freeze({ key: 'schema4Math', path: PATHS.schema4Math, sha256: EXPECTED_SHA256.schema4Math }),
  Object.freeze({ key: 'marketEngine', path: PATHS.marketEngine, sha256: EXPECTED_SHA256.marketEngine }),
  Object.freeze({ key: 'productionConfig', path: PATHS.productionConfig, sha256: EXPECTED_SHA256.productionConfig }),
]);

const PRODUCTION_CODE_FREEZE_PATHS = Object.freeze([
  PATHS.protocol,
  PATHS.runner,
  PATHS.tests,
  PATHS.launcher,
  PATHS.schema5Protocol,
  PATHS.schema5Reader,
  PATHS.schema4Math,
  PATHS.marketEngine,
  PATHS.productionConfig,
]);

const MANIFEST_FILE_ORDER = Object.freeze([
  Object.freeze({ key: 'protocol', path: PATHS.protocol }),
  Object.freeze({ key: 'runner', path: PATHS.runner }),
  Object.freeze({ key: 'tests', path: PATHS.tests }),
  Object.freeze({ key: 'launcher', path: PATHS.launcher }),
  Object.freeze({ key: 'schema5Protocol', path: PATHS.schema5Protocol }),
  Object.freeze({ key: 'schema5Reader', path: PATHS.schema5Reader }),
  Object.freeze({ key: 'schema4Math', path: PATHS.schema4Math }),
  Object.freeze({ key: 'marketEngine', path: PATHS.marketEngine }),
  Object.freeze({ key: 'productionConfig', path: PATHS.productionConfig }),
]);

const SOURCE_LIMITATIONS = Object.freeze([
  'Crypto is a synthetic USD spot-price-return basket of seven August-2026-selected coins, rebalanced equal-weight daily and backfilled with hindsight; it is not a point-in-time, survivorship-free all-coin index, total-return series, or directly investable portfolio.',
  'Sweden uses Nasdaq OMXSBGI in SEK, whose provider definition is gross total return; the index level is not a directly investable instrument.',
  'USA uses Yahoo adjusted-close SPY in USD as a dividend-adjusted ETF market-price total-return proxy; it is not the official S&P 500 index return or State Street NAV total return.',
  'Europe uses the STOXX Europe 600 ^STOXX/SXXP EUR price-return index, which omits distributions and is not an executable holding.',
  'Global uses Yahoo adjusted-close ACWI in USD as a dividend-adjusted ETF market-price total-return proxy; it is not official MSCI ACWI Net or BlackRock NAV total return.',
  'Yahoo histories are current-vintage retrospective research data, not a licensed point-in-time archive.',
  'All evaluation dates are a reused chronological pseudo-holdout and cannot establish confirmation or live reliability.',
]);

const PRODUCTION_INPUT_TOKEN = Symbol('component-fragility-tail-production-input');
const CODE_FREEZE_TOKEN = Symbol('component-fragility-tail-code-freeze');
const ATTEMPT_TOKEN = Symbol('component-fragility-tail-attempt');
const LOADED_SCHEMA_TOKEN = Symbol('component-fragility-tail-loaded-schema');

class IntegrityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'IntegrityError';
    this.code = 'INTEGRITY_ERROR';
    this.details = details;
  }
}

function fail(message, details = {}) {
  throw new IntegrityError(message, details);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) fail('canonical result cannot contain a non-finite number');
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function repoPath(file) {
  const relative = path.relative(REPO_ROOT, path.resolve(file));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return path.resolve(file).replace(/\\/g, '/');
  return relative.replace(/\\/g, '/');
}

function assertExactKeys(value, expected, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join('|') !== expected.join('|')) {
    fail(`${context} keys or order drifted`, { expected, actual: value && typeof value === 'object' ? Object.keys(value) : null });
  }
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isGitBlob(value) {
  return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === value;
}

function calendarDays(firstDate, lastDate) {
  if (!isIsoDate(firstDate) || !isIsoDate(lastDate)) return null;
  return (Date.parse(`${lastDate}T00:00:00.000Z`) - Date.parse(`${firstDate}T00:00:00.000Z`)) / 86400000;
}

function arithmeticMean(values) {
  if (!Array.isArray(values) || !values.length || values.some(value => !Number.isFinite(value))) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardDeviation(values) {
  if (!Array.isArray(values) || values.length < 2 || values.some(value => !Number.isFinite(value))) return null;
  const average = arithmeticMean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1));
}

function dot(left, right) {
  let value = 0;
  for (let index = 0; index < left.length; index++) value += left[index] * right[index];
  return value;
}

function componentScores(signal, context = 'signal') {
  if (!signal || !signal.components || Object.keys(signal.components).join('|') !== COMPONENT_ORDER.join('|')) {
    fail(`${context} must contain the exact six components in frozen order`);
  }
  return COMPONENT_ORDER.map(key => {
    const component = signal.components[key];
    const score = component && component.score;
    if (!Number.isFinite(score) || score < 0 || score > 100) fail(`${context}.${key}.score is invalid`);
    if (!isIsoDate(component.asOf) || !isIsoDate(signal.date)) fail(`${context}.${key}.asOf is not an ISO date`);
    const ageDays = calendarDays(component.asOf, signal.date);
    if (!Number.isFinite(ageDays) || ageDays < 0 || ageDays > 7) {
      fail(`${context}.${key}.asOf must be causal and no more than 7 calendar days stale`);
    }
    return score;
  });
}

function componentFragility(currentSignal, laggedSignal) {
  const current = componentScores(currentSignal, `${currentSignal && currentSignal.date || 'current'} current signal`);
  const lagged = componentScores(laggedSignal, `${laggedSignal && laggedSignal.date || 'lagged'} lagged signal`);
  const mean = arithmeticMean(current);
  const dispersion = Math.sqrt(current.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / current.length) / 100;
  const weakening = Math.sqrt(current.reduce((sum, value, index) => {
    const decrease = Math.max(0, lagged[index] - value);
    return sum + decrease ** 2;
  }, 0) / current.length) / 100;
  const fragility = dispersion * weakening;
  if (![mean, dispersion, weakening, fragility].every(Number.isFinite)) fail('component fragility is non-finite');
  return { componentMean: mean, dispersion, weakening, fragility };
}

function validateMarketRowsInput(market) {
  if (!market || typeof market.key !== 'string' || !MARKET_ORDER.includes(market.key)) fail('market key is outside the frozen order');
  const prices = market.prices && market.prices.rows;
  if (!Array.isArray(prices) || prices.length < 149) fail(`${market.key}: insufficient target-price rows`);
  let priorDate = null;
  for (const row of prices) {
    if (!row || !isIsoDate(row.date) || (priorDate && row.date <= priorDate) || !Number.isFinite(row.close) || !(row.close > 0)) {
      fail(`${market.key}: target prices must be positive, unique, and strictly ordered`);
    }
    priorDate = row.date;
  }
  if (!Array.isArray(market.signals) || !market.signals.length) fail(`${market.key}: signals are missing`);
  priorDate = null;
  for (const signal of market.signals) {
    if (!signal || !isIsoDate(signal.date) || (priorDate && signal.date <= priorDate) || !Number.isFinite(signal.publishedScore) || signal.publishedScore < 0 || signal.publishedScore > 100) {
      fail(`${market.key}: signals must be strictly ordered with a valid published score`);
    }
    componentScores(signal, `${market.key}/${signal.date}`);
    priorDate = signal.date;
  }
  return { prices, signals: market.signals };
}

function buildCausalRows(market) {
  const { prices, signals } = validateMarketRowsInput(market);
  const priceIndex = new Map(prices.map((row, index) => [row.date, index]));
  const signalByDate = new Map(signals.map(signal => [signal.date, signal]));
  const audit = {
    signals: signals.length,
    missingExactPriceDate: 0,
    insufficientPriorTargetCloses: 0,
    missingExactLagFiveSignal: 0,
    incompleteOutcome: 0,
    nonPositiveSigma20: 0,
    nonFiniteConstructedRow: 0,
    eligible: 0,
  };
  const rows = [];
  for (const signal of signals) {
    const signalIndex = priceIndex.get(signal.date);
    if (signalIndex == null) { audit.missingExactPriceDate++; continue; }
    if (signalIndex < 125) { audit.insufficientPriorTargetCloses++; continue; }
    const laggedDate = prices[signalIndex - 5].date;
    const laggedSignal = signalByDate.get(laggedDate);
    if (!laggedSignal) { audit.missingExactLagFiveSignal++; continue; }
    const entryIndex = signalIndex + 1;
    const exitIndex = signalIndex + 22;
    if (exitIndex >= prices.length) { audit.incompleteOutcome++; continue; }

    const logReturns20 = [];
    for (let index = signalIndex - 19; index <= signalIndex; index++) {
      logReturns20.push(Math.log(prices[index].close / prices[index - 1].close));
    }
    const sigma20 = sampleStandardDeviation(logReturns20);
    if (!Number.isFinite(sigma20) || !(sigma20 > 0)) { audit.nonPositiveSigma20++; continue; }

    const close = prices[signalIndex].close;
    const average125 = arithmeticMean(prices.slice(signalIndex - 124, signalIndex + 1).map(row => row.close));
    const peak63 = Math.max(...prices.slice(signalIndex - 62, signalIndex + 1).map(row => row.close));
    const fragility = componentFragility(signal, laggedSignal);
    const features = {
      publishedScore: signal.publishedScore / 100,
      logReturn1: Math.log(close / prices[signalIndex - 1].close),
      logReturn5: Math.log(close / prices[signalIndex - 5].close),
      logReturn20: Math.log(close / prices[signalIndex - 20].close),
      sigma20,
      trend125: Math.log(close / average125),
      drawdown63: Math.log(peak63 / close),
      fragility: fragility.fragility,
    };

    let runningPeak = prices[entryIndex].close;
    let maximumDrawdown21 = 0;
    for (let index = entryIndex; index <= exitIndex; index++) {
      runningPeak = Math.max(runningPeak, prices[index].close);
      maximumDrawdown21 = Math.max(maximumDrawdown21, Math.log(runningPeak / prices[index].close));
    }
    const outcome = Math.log(1 + maximumDrawdown21 / (sigma20 * Math.sqrt(HORIZON)));
    const constructed = [...Object.values(features), maximumDrawdown21, outcome];
    if (constructed.some(value => !Number.isFinite(value)) || features.drawdown63 < 0 || maximumDrawdown21 < 0 || outcome < 0) {
      audit.nonFiniteConstructedRow++;
      continue;
    }
    rows.push({
      market: market.key,
      signalDate: signal.date,
      signalIndex,
      entryIndex,
      exitIndex,
      entryDate: prices[entryIndex].date,
      exitDate: prices[exitIndex].date,
      laggedSignalDate: laggedDate,
      features,
      diagnostics: {
        componentDispersion: fragility.dispersion,
        componentWeakening: fragility.weakening,
        maximumDrawdown21,
      },
      outcome,
    });
  }
  audit.eligible = rows.length;
  return { market: market.key, rows, audit };
}

function buildStudyRows(snapshot) {
  if (!snapshot || snapshot.status !== INPUT_STATUS || !Array.isArray(snapshot.markets)) fail('snapshot status or markets are invalid');
  if (snapshot.markets.map(market => market.key).join('|') !== MARKET_ORDER.join('|')) fail('snapshot market order differs from the frozen five-market order');
  const markets = snapshot.markets.map(buildCausalRows);
  const byKey = new Map(markets.map(market => [market.market, market]));
  const training = [];
  for (const key of TRAINING_MARKETS) {
    for (const row of byKey.get(key).rows) if (row.exitDate <= TRAINING_CUTOFF) training.push(row);
  }
  training.sort((left, right) => left.exitDate.localeCompare(right.exitDate) || MARKET_ORDER.indexOf(left.market) - MARKET_ORDER.indexOf(right.market) || left.signalIndex - right.signalIndex);
  const evaluation = {};
  const chronologyAudit = {};
  for (const key of MARKET_ORDER) {
    const all = byKey.get(key).rows;
    evaluation[key] = all.filter(row => row.entryDate >= EVALUATION_START);
    chronologyAudit[key] = {
      eligible: all.length,
      trainingAdmitted: TRAINING_MARKETS.includes(key) ? all.filter(row => row.exitDate <= TRAINING_CUTOFF).length : 0,
      crossingCutoffDropped: all.filter(row => row.entryDate < EVALUATION_START && row.exitDate > TRAINING_CUTOFF).length,
      evaluationAdmitted: evaluation[key].length,
    };
  }
  return { markets, training, evaluation, chronologyAudit };
}

function balancedTrainingWeights(rows) {
  if (!Array.isArray(rows) || !rows.length) return { ok: false, reason: 'pooled training rows are empty' };
  const counts = Object.fromEntries(TRAINING_MARKETS.map(key => [key, rows.filter(row => row.market === key).length]));
  if (TRAINING_MARKETS.some(key => counts[key] === 0)) return { ok: false, reason: 'USA and Europe both require training rows', counts };
  if (rows.some(row => !TRAINING_MARKETS.includes(row.market))) return { ok: false, reason: 'pooled fit contains a forbidden training market', counts };
  const weights = rows.map(row => 0.5 / counts[row.market]);
  const marketTotals = Object.fromEntries(TRAINING_MARKETS.map(key => [key, rows.reduce((sum, row, index) => sum + (row.market === key ? weights[index] : 0), 0)]));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(total) || Math.abs(total - 1) > 1e-12 || TRAINING_MARKETS.some(key => Math.abs(marketTotals[key] - 0.5) > 1e-12)) {
    return { ok: false, reason: 'frozen training weights do not sum to 0.5 per market and one overall', counts, marketTotals, total };
  }
  return { ok: true, weights, counts, marketTotals, total };
}

function featureValue(row, feature) {
  return row && row.features && row.features[feature];
}

function weightedStandardization(rows, weights, featureNames = FULL_FEATURES) {
  if (!Array.isArray(rows) || !Array.isArray(weights) || rows.length !== weights.length || !rows.length) {
    return { ok: false, reason: 'weighted preprocessing rows/weights mismatch' };
  }
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(weightTotal) || Math.abs(weightTotal - 1) > 1e-12 || weights.some(weight => !Number.isFinite(weight) || !(weight > 0))) {
    return { ok: false, reason: 'weighted preprocessing requires positive weights summing to one' };
  }
  const means = {};
  const scales = {};
  for (const feature of featureNames) {
    const values = rows.map(row => featureValue(row, feature));
    if (values.some(value => !Number.isFinite(value))) return { ok: false, reason: `non-finite training feature ${feature}` };
    means[feature] = values.reduce((sum, value, index) => sum + weights[index] * value, 0);
    const variance = values.reduce((sum, value, index) => sum + weights[index] * ((value - means[feature]) ** 2), 0);
    scales[feature] = Math.sqrt(variance);
    if (!Number.isFinite(scales[feature]) || !(scales[feature] > 0)) return { ok: false, reason: `nonpositive weighted scale for ${feature}` };
  }
  return { ok: true, featureNames: featureNames.slice(), means, scales, weightTotal };
}

function standardize(value, feature, preprocessing) {
  return (value - preprocessing.means[feature]) / preprocessing.scales[feature];
}

function designRow(row, featureNames, preprocessing) {
  const values = [1, ...featureNames.map(feature => standardize(featureValue(row, feature), feature, preprocessing))];
  return values.every(Number.isFinite) ? values : null;
}

function twoPassMgsQrSolve(design, outcomes, weights, tolerance = QR_RANK_TOLERANCE) {
  if (!Array.isArray(design) || !design.length || !Array.isArray(outcomes) || !Array.isArray(weights) || design.length !== outcomes.length || design.length !== weights.length) {
    return { ok: false, reason: 'QR input dimensions mismatch' };
  }
  const columns = design[0] && design[0].length;
  if (!Number.isInteger(columns) || columns < 1 || design.some(row => !Array.isArray(row) || row.length !== columns || row.some(value => !Number.isFinite(value))) || outcomes.some(value => !Number.isFinite(value)) || weights.some(weight => !Number.isFinite(weight) || !(weight > 0))) {
    return { ok: false, reason: 'QR inputs are invalid or non-finite' };
  }
  const weightedColumns = Array.from({ length: columns }, (_, column) => design.map((row, index) => Math.sqrt(weights[index]) * row[column]));
  const weightedOutcome = outcomes.map((value, index) => Math.sqrt(weights[index]) * value);
  const q = [];
  const r = Array.from({ length: columns }, () => Array(columns).fill(0));
  const diagonalNorms = [];
  for (let column = 0; column < columns; column++) {
    const residual = weightedColumns[column].slice();
    for (let pass = 0; pass < 2; pass++) {
      for (let prior = 0; prior < column; prior++) {
        const projection = dot(q[prior], residual);
        r[prior][column] += projection;
        for (let row = 0; row < residual.length; row++) residual[row] -= projection * q[prior][row];
      }
    }
    const norm = Math.sqrt(dot(residual, residual));
    diagonalNorms.push(norm);
    if (!Number.isFinite(norm) || norm <= tolerance) {
      return { ok: false, reason: `rank failure at declared column ${column}`, failedColumn: column, diagonalNorms, tolerance };
    }
    r[column][column] = norm;
    q.push(residual.map(value => value / norm));
  }
  const qty = q.map(column => dot(column, weightedOutcome));
  const coefficients = Array(columns).fill(0);
  for (let row = columns - 1; row >= 0; row--) {
    let numerator = qty[row];
    for (let column = row + 1; column < columns; column++) numerator -= r[row][column] * coefficients[column];
    coefficients[row] = numerator / r[row][row];
    if (!Number.isFinite(coefficients[row])) return { ok: false, reason: 'non-finite QR back-substitution coefficient', diagonalNorms, tolerance };
  }
  return { ok: true, coefficients, diagonalNorms, tolerance };
}

function fitWeightedModel(rows, weights, featureNames, preprocessing, outcomeAccessor = row => row.outcome) {
  const design = rows.map(row => designRow(row, featureNames, preprocessing));
  if (design.some(row => !row)) return { ok: false, reason: 'model design contains a non-finite standardized feature' };
  const outcomes = rows.map(outcomeAccessor);
  const solved = twoPassMgsQrSolve(design, outcomes, weights);
  if (!solved.ok) return solved;
  const coefficientByName = { intercept: solved.coefficients[0] };
  featureNames.forEach((feature, index) => { coefficientByName[feature] = solved.coefficients[index + 1]; });
  return {
    ok: true,
    featureNames: featureNames.slice(),
    coefficients: solved.coefficients,
    coefficientByName,
    diagonalNorms: solved.diagonalNorms,
    predict(row) {
      const vector = designRow(row, featureNames, preprocessing);
      if (!vector) return null;
      const prediction = dot(vector, solved.coefficients);
      return Number.isFinite(prediction) ? prediction : null;
    },
  };
}

function fitSharedModels(trainingRows) {
  const balanced = balancedTrainingWeights(trainingRows);
  if (!balanced.ok) return { ok: false, stage: 'training-weights', ...balanced };
  const preprocessing = weightedStandardization(trainingRows, balanced.weights, FULL_FEATURES);
  if (!preprocessing.ok) return { ok: false, stage: 'weighted-preprocessing', reason: preprocessing.reason, weights: balanced };

  const m0 = fitWeightedModel(trainingRows, balanced.weights, CONTROL_FEATURES, preprocessing);
  if (!m0.ok) return { ok: false, stage: 'pooled-m0', reason: m0.reason, details: m0, preprocessing, weights: balanced };

  const fragilityProjection = fitWeightedModel(
    trainingRows,
    balanced.weights,
    CONTROL_FEATURES,
    preprocessing,
    row => standardize(row.features.fragility, 'fragility', preprocessing),
  );
  if (!fragilityProjection.ok) return { ok: false, stage: 'residualized-fragility-projection', reason: fragilityProjection.reason, details: fragilityProjection, preprocessing, weights: balanced };
  const residualizedFragilityVariance = trainingRows.reduce((sum, row, index) => {
    const observed = standardize(row.features.fragility, 'fragility', preprocessing);
    const predicted = fragilityProjection.predict(row);
    return sum + balanced.weights[index] * ((observed - predicted) ** 2);
  }, 0);
  if (!Number.isFinite(residualizedFragilityVariance) || residualizedFragilityVariance <= RESIDUAL_FRAGILITY_TOLERANCE) {
    return {
      ok: false,
      stage: 'residualized-fragility-variance',
      reason: 'standardized fragility has zero residual variation beyond M0',
      residualizedFragilityVariance,
      threshold: RESIDUAL_FRAGILITY_TOLERANCE,
      preprocessing,
      weights: balanced,
    };
  }

  const m1 = fitWeightedModel(trainingRows, balanced.weights, FULL_FEATURES, preprocessing);
  if (!m1.ok) return { ok: false, stage: 'pooled-m1', reason: m1.reason, details: m1, residualizedFragilityVariance, preprocessing, weights: balanced };

  const diagnosticFits = {};
  for (const market of TRAINING_MARKETS) {
    const rows = trainingRows.filter(row => row.market === market);
    const weights = rows.map(() => 1 / rows.length);
    const fitted = fitWeightedModel(rows, weights, FULL_FEATURES, preprocessing);
    if (!fitted.ok) return { ok: false, stage: `${market}-m1`, reason: fitted.reason, details: fitted, residualizedFragilityVariance, preprocessing, weights: balanced };
    diagnosticFits[market] = fitted;
  }

  return {
    ok: true,
    preprocessing,
    weights: balanced,
    residualizedFragilityVariance,
    m0,
    m1,
    diagnostics: diagnosticFits,
    fragilityCoefficients: {
      pooled: m1.coefficientByName.fragility,
      usa: diagnosticFits.usa.coefficientByName.fragility,
      europe: diagnosticFits.europe.coefficientByName.fragility,
    },
  };
}

function erf(value) {
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * absolute);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-absolute * absolute));
}

function normalCdf(value) {
  return 0.5 * (1 + erf(value / Math.sqrt(2)));
}

function neweyWestMeanTest21(values) {
  if (!Array.isArray(values) || !values.length || values.some(value => !Number.isFinite(value))) {
    return { n: Array.isArray(values) ? values.length : 0, mean: null, lrv: null, standardError: null, z: null, pValueOneSidedPositive: null, bandwidth: HAC_BANDWIDTH };
  }
  const n = values.length;
  const average = arithmeticMean(values);
  if (!Number.isFinite(average)) {
    return { n, mean: null, lrv: null, standardError: null, z: null, pValueOneSidedPositive: null, bandwidth: HAC_BANDWIDTH };
  }
  const centered = values.map(value => value - average);
  let lrv = centered.reduce((sum, value) => sum + value * value, 0) / n;
  for (let lag = 1; lag <= HAC_BANDWIDTH; lag++) {
    let covariance = 0;
    for (let index = lag; index < n; index++) covariance += centered[index] * centered[index - lag];
    covariance /= n;
    lrv += 2 * (1 - lag / 22) * covariance;
  }
  if (!Number.isFinite(lrv) || lrv < 0) {
    return { n, mean: average, lrv: finiteOrNull(lrv), standardError: null, z: null, pValueOneSidedPositive: null, bandwidth: HAC_BANDWIDTH };
  }
  if (lrv === 0) {
    const exactlyConstant = values.every(value => value === values[0]);
    if (!exactlyConstant) return { n, mean: average, lrv, standardError: null, z: null, pValueOneSidedPositive: null, bandwidth: HAC_BANDWIDTH };
    return { n, mean: average, lrv, standardError: 0, z: null, pValueOneSidedPositive: average > 0 ? 0 : 1, bandwidth: HAC_BANDWIDTH };
  }
  const standardError = Math.sqrt(lrv / n);
  const z = average / standardError;
  if (!Number.isFinite(standardError) || !Number.isFinite(z)) {
    return { n, mean: average, lrv, standardError: finiteOrNull(standardError), z: null, pValueOneSidedPositive: null, bandwidth: HAC_BANDWIDTH };
  }
  const pValue = Math.max(0, Math.min(1, 1 - normalCdf(z)));
  return { n, mean: average, lrv, standardError, z, pValueOneSidedPositive: finiteOrNull(pValue), bandwidth: HAC_BANDWIDTH };
}

function holmAdjustFive(entries) {
  if (!Array.isArray(entries) || entries.length !== MARKET_ORDER.length || entries.map(entry => entry.market).join('|') !== MARKET_ORDER.join('|')) {
    fail('Holm family must contain exactly the five markets in frozen order');
  }
  if (entries.some(entry => !Number.isFinite(entry.pValue) || entry.pValue < 0 || entry.pValue > 1)) {
    return entries.map(entry => ({ ...entry, adjustedPValue: null }));
  }
  const order = new Map(MARKET_ORDER.map((market, index) => [market, index]));
  const sorted = entries.map(entry => ({ ...entry })).sort((left, right) => left.pValue - right.pValue || order.get(left.market) - order.get(right.market));
  let runningMaximum = 0;
  for (let rank = 0; rank < sorted.length; rank++) {
    const rawAdjusted = Math.min(1, (MARKET_ORDER.length - rank) * sorted[rank].pValue);
    runningMaximum = Math.max(runningMaximum, rawAdjusted);
    sorted[rank].adjustedPValue = runningMaximum;
  }
  const byMarket = new Map(sorted.map(entry => [entry.market, entry]));
  return MARKET_ORDER.map(market => byMarket.get(market));
}

function adequacyForRows(rows) {
  const ordered = [...rows].sort((left, right) => left.entryIndex - right.entryIndex || left.exitIndex - right.exitIndex);
  let nonOverlappingOutcomes = 0;
  let previousExitIndex = -Infinity;
  for (const row of ordered) {
    if (row.entryIndex >= previousExitIndex) {
      nonOverlappingOutcomes++;
      previousExitIndex = row.exitIndex;
    }
  }
  const firstEntryDate = ordered.length ? ordered[0].entryDate : null;
  const lastExitDate = ordered.length ? ordered.at(-1).exitDate : null;
  const calendarSpanDays = ordered.length ? calendarDays(firstEntryDate, lastExitDate) : null;
  const gates = {
    forecastRowsAtLeast756: ordered.length >= MINIMUM_FORECAST_ROWS,
    nonOverlappingOutcomesAtLeast36: nonOverlappingOutcomes >= MINIMUM_NON_OVERLAPPING,
    calendarSpanAtLeast1095Days: Number.isFinite(calendarSpanDays) && calendarSpanDays >= MINIMUM_CALENDAR_SPAN_DAYS,
  };
  return {
    forecastRows: ordered.length,
    firstEntryDate,
    lastExitDate,
    calendarSpanDays,
    nonOverlappingOutcomes,
    greedyRule: 'chronological; admit when entryIndex >= previously admitted exitIndex',
    gates,
    failedGates: Object.entries(gates).filter(([, pass]) => !pass).map(([name]) => name),
    pass: Object.values(gates).every(Boolean),
  };
}

function evaluateMarket(market, rows, models) {
  const adequacy = adequacyForRows(rows);
  const adjustedLosses = [];
  let sumSquaredM0 = 0;
  let sumSquaredM1 = 0;
  let finite = true;
  for (const row of rows) {
    const forecastM0 = models.m0.predict(row);
    const forecastM1 = models.m1.predict(row);
    const errorM0 = Number.isFinite(forecastM0) ? row.outcome - forecastM0 : null;
    const errorM1 = Number.isFinite(forecastM1) ? row.outcome - forecastM1 : null;
    const squaredM0 = Number.isFinite(errorM0) ? errorM0 ** 2 : null;
    const squaredM1 = Number.isFinite(errorM1) ? errorM1 ** 2 : null;
    const adjusted = Number.isFinite(squaredM0) && Number.isFinite(squaredM1)
      ? squaredM0 - squaredM1 + ((forecastM0 - forecastM1) ** 2)
      : null;
    if (![forecastM0, forecastM1, errorM0, errorM1, squaredM0, squaredM1, adjusted].every(Number.isFinite)) finite = false;
    else {
      sumSquaredM0 += squaredM0;
      sumSquaredM1 += squaredM1;
      adjustedLosses.push(adjusted);
    }
  }
  const mseM0 = finite && rows.length ? finiteOrNull(sumSquaredM0 / rows.length) : null;
  const mseM1 = finite && rows.length ? finiteOrNull(sumSquaredM1 / rows.length) : null;
  const relativeImprovement = Number.isFinite(mseM0) && mseM0 > 0 && Number.isFinite(mseM1)
    ? finiteOrNull((mseM0 - mseM1) / mseM0)
    : null;
  const neweyWest = finite ? neweyWestMeanTest21(adjustedLosses) : neweyWestMeanTest21([]);
  const numericGate = finite && Number.isFinite(mseM0) && mseM0 > 0 && Number.isFinite(mseM1) && Number.isFinite(relativeImprovement);
  return {
    market,
    adequacy,
    metrics: { mseM0, mseM1, relativeImprovement, finitePredictionsErrorsAndMse: numericGate },
    clarkWest: neweyWest,
  };
}

function compactModel(model) {
  return {
    featureNames: model.featureNames,
    coefficients: model.coefficientByName,
    qrDiagonalNorms: model.diagonalNorms,
  };
}

function analyzeBuiltRows(built, identities = {}) {
  const models = fitSharedModels(built.training);
  if (!models.ok) {
    return finalizeResult({
      status: STATUS.UNIDENTIFIABLE,
      identities,
      built,
      training: {
        identifiable: false,
        failedStage: models.stage,
        reason: models.reason,
        details: {
          counts: models.counts || models.weights && models.weights.counts || null,
          residualizedFragilityVariance: Number.isFinite(models.residualizedFragilityVariance) ? models.residualizedFragilityVariance : null,
        },
      },
      markets: MARKET_ORDER.map(market => ({ market, adequacy: adequacyForRows(built.evaluation[market]), metrics: null, clarkWest: null, holmAdjustedPValue: null })),
      gate: { pass: false, failedGates: ['identifiability'] },
    });
  }

  const markets = MARKET_ORDER.map(market => evaluateMarket(market, built.evaluation[market], models));
  const adjusted = holmAdjustFive(markets.map(row => ({ market: row.market, pValue: row.clarkWest.pValueOneSidedPositive })));
  const adjustedByMarket = new Map(adjusted.map(row => [row.market, row.adjustedPValue]));
  for (const row of markets) row.holmAdjustedPValue = adjustedByMarket.get(row.market);

  const directional = Object.fromEntries(Object.entries(models.fragilityCoefficients).map(([key, value]) => [key, { coefficient: value, strictlyPositive: Number.isFinite(value) && value > 0 }]));
  const gates = {
    fragilityCoefficientPositivePooledUsaEurope: Object.values(directional).every(row => row.strictlyPositive),
    adequateFiveOfFive: markets.every(row => row.adequacy.pass),
    mseImprovementStrictlyAbovePointFivePercentFiveOfFive: markets.every(row => row.metrics.finitePredictionsErrorsAndMse && row.metrics.relativeImprovement > MINIMUM_RELATIVE_MSE_IMPROVEMENT),
    rawClarkWestPValuesFiniteFiveOfFive: markets.every(row => Number.isFinite(row.clarkWest.pValueOneSidedPositive)),
    holmPValuesStrictlyBelowPointZeroFiveFiveOfFive: markets.every(row => Number.isFinite(row.holmAdjustedPValue) && row.holmAdjustedPValue < ALPHA),
  };
  gates.pass = Object.values(gates).every(Boolean);
  const failedGates = Object.entries(gates).filter(([name, pass]) => name !== 'pass' && !pass).map(([name]) => name);
  let status;
  if (!gates.adequateFiveOfFive) status = STATUS.UNDERPOWERED;
  else if (!gates.pass) status = STATUS.NO_SIGNAL;
  else status = STATUS.PASSED;

  return finalizeResult({
    status,
    identities,
    built,
    training: {
      identifiable: true,
      rowCount: built.training.length,
      marketCounts: models.weights.counts,
      marketWeightTotals: models.weights.marketTotals,
      preprocessing: { means: models.preprocessing.means, scales: models.preprocessing.scales },
      residualizedFragilityVariance: models.residualizedFragilityVariance,
      residualizedFragilityThreshold: RESIDUAL_FRAGILITY_TOLERANCE,
      fragilityCoefficients: directional,
      pooledM0: compactModel(models.m0),
      pooledM1: compactModel(models.m1),
      usaDiagnosticM1: compactModel(models.diagnostics.usa),
      europeDiagnosticM1: compactModel(models.diagnostics.europe),
    },
    markets,
    gate: { ...gates, failedGates },
  });
}

function finalizeResult({ status, identities, built, training, markets, gate }) {
  const result = {
    schema: RESULT_SCHEMA,
    status,
    purpose: 'predictor-only retrospective cross-market component-fragility tail-risk falsification',
    interpretation: 'Retrospective pseudo-holdout only; no exposure mapping, strategy wealth, validation, or production approval.',
    frozenDesign: {
      marketOrder: MARKET_ORDER,
      componentOrder: COMPONENT_ORDER,
      controls: CONTROL_FEATURES,
      addedPredictor: 'fragility = component dispersion * five-target-bar component weakening',
      outcome: 'log(1 + 21-interval maximum log-drawdown / (sigma20 * sqrt(21)))',
      training: 'all eligible USA and Europe outcomes ending no later than 2018-12-31; 0.5 total weight per market',
      evaluation: 'all eligible rows with entry date on or after 2019-01-01; shared fit held fixed',
      qr: { method: 'deterministic two-pass modified Gram-Schmidt on sqrt(weight)-scaled rows', rankTolerance: QR_RANK_TOLERANCE },
      residualizedFragilityTolerance: RESIDUAL_FRAGILITY_TOLERANCE,
      neweyWestBandwidth: HAC_BANDWIDTH,
      minimums: {
        forecastRows: MINIMUM_FORECAST_ROWS,
        greedyNonOverlappingOutcomes: MINIMUM_NON_OVERLAPPING,
        calendarSpanDays: MINIMUM_CALENDAR_SPAN_DAYS,
        relativeMseImprovementStrictlyGreaterThan: MINIMUM_RELATIVE_MSE_IMPROVEMENT,
        holmAdjustedPValueStrictlyBelow: ALPHA,
      },
    },
    identities,
    rowConstruction: {
      marketAudits: Object.fromEntries(built.markets.map(market => [market.market, market.audit])),
      chronologyAudit: built.chronologyAudit,
    },
    training,
    markets,
    gate,
    sourceLimitations: SOURCE_LIMITATIONS,
    stopRule: status === STATUS.PASSED
      ? 'A separate one-rule economic protocol may be frozen before any exposure wealth is inspected; this result alone is not tradable evidence.'
      : 'This exact hypothesis stops. Do not alter its feature, horizon, threshold, market count, normalization, or chronology in response.',
  };
  result.analysisFingerprintSha256 = sha256(canonicalJson(result));
  return result;
}

function analyzeSnapshot(snapshot, identities = {}) {
  return analyzeBuiltRows(buildStudyRows(snapshot), identities);
}

function assertExactProductionPaths() {
  const expectedInputSidecar = PATHS.input.replace(/\.json$/, '.sha256');
  if (path.resolve(PATHS.inputSidecar) !== path.resolve(expectedInputSidecar)) fail('production input sidecar path is not the frozen replace-extension path');
  if (path.resolve(PATHS.outputSidecar) !== path.resolve(`${PATHS.output}.sha256`)) fail('production output sidecar path drifted');
  if (path.resolve(path.dirname(PATHS.output)) !== path.resolve(PATHS.outputDirectory)) fail('production result is not inside the frozen result directory');
  if (path.isAbsolute(ATTEMPT_RECEIPT_GIT_COMMON_RELATIVE) || ATTEMPT_RECEIPT_GIT_COMMON_RELATIVE.includes('..')) fail('repository-global attempt receipt relative path drifted');
  if (repoPath(PATHS.manifest) !== 'research/component-fragility-tail-risk-freeze-v1.json') fail('freeze manifest path drifted');
  if (repoPath(PATHS.launcher) !== 'research/component_fragility_tail_risk_launcher.js') fail('production launcher path drifted');
  return true;
}

function assertResultAbsent({ io = fs } = {}) {
  if (io.existsSync(PATHS.outputDirectory)) fail(`one-shot production result directory already exists: ${PATHS.outputDirectory}`);
  return true;
}

function verifyPinnedDependencies({ io = fs } = {}) {
  const identities = {};
  for (const item of PINNED_DEPENDENCIES) {
    const bytes = io.readFileSync(path.resolve(item.path));
    const digest = sha256(bytes);
    if (digest !== item.sha256) fail(`${repoPath(item.path)} SHA-256 drifted`, { expected: item.sha256, actual: digest });
    if (item.marker && !bytes.toString('utf8').includes(item.marker)) fail(`${repoPath(item.path)} freeze marker drifted`);
    identities[item.key] = { path: repoPath(item.path), sha256: digest, bytes: bytes.length };
  }
  return identities;
}

function validateFreezeManifest(manifest) {
  assertExactKeys(manifest, ['attemptReceipt', 'experimentId', 'files', 'input', 'publication', 'requiredAnnotatedTag', 'runtime', 'schema'], 'freeze manifest');
  if (manifest.schema !== FREEZE_MANIFEST_SCHEMA || manifest.experimentId !== 'component-fragility-tail-v1' || manifest.requiredAnnotatedTag !== FIXED_PREOUTCOME_TAG) {
    fail('freeze manifest top-level identity drifted');
  }
  assertExactKeys(manifest.runtime, ['arch', 'node', 'platform'], 'freeze manifest runtime');
  if (manifest.runtime.node !== 'v22.19.0' || manifest.runtime.platform !== 'win32' || manifest.runtime.arch !== 'x64') fail('freeze manifest runtime identity drifted');
  if (!Array.isArray(manifest.files) || manifest.files.length !== MANIFEST_FILE_ORDER.length) fail('freeze manifest file inventory length drifted');
  const expectedPinned = new Map(PINNED_DEPENDENCIES.map(item => [item.key, item.sha256]));
  manifest.files.forEach((entry, index) => {
    assertExactKeys(entry, ['bytes', 'gitBlob', 'key', 'path', 'sha256'], `freeze manifest files[${index}]`);
    const expected = MANIFEST_FILE_ORDER[index];
    if (entry.key !== expected.key || entry.path !== repoPath(expected.path)) fail(`freeze manifest file order/path drifted at ${index}`);
    if (!Number.isInteger(entry.bytes) || entry.bytes <= 0 || !isSha256(entry.sha256) || !isGitBlob(entry.gitBlob)) fail(`freeze manifest file identity is invalid for ${entry.key}`);
    if (expectedPinned.has(entry.key) && entry.sha256 !== expectedPinned.get(entry.key)) fail(`freeze manifest pinned SHA-256 drifted for ${entry.key}`);
  });
  assertExactKeys(manifest.input, ['lastCompletedTargetDate', 'path', 'sha256', 'sidecarPath', 'status'], 'freeze manifest input');
  if (manifest.input.path !== repoPath(PATHS.input) || manifest.input.sidecarPath !== repoPath(PATHS.inputSidecar) || manifest.input.sha256 !== EXPECTED_SHA256.input || manifest.input.status !== INPUT_STATUS || manifest.input.lastCompletedTargetDate !== '2026-08-24') {
    fail('freeze manifest input identity drifted');
  }
  assertExactKeys(manifest.attemptReceipt, ['path', 'schema', 'scope', 'status'], 'freeze manifest attempt receipt');
  if (manifest.attemptReceipt.scope !== ATTEMPT_RECEIPT_SCOPE || manifest.attemptReceipt.path !== ATTEMPT_RECEIPT_GIT_COMMON_RELATIVE || manifest.attemptReceipt.schema !== ATTEMPT_RECEIPT_SCHEMA || manifest.attemptReceipt.status !== 'PERMANENT_ONE_SHOT_ATTEMPT_RESERVED_BEFORE_INPUT_PARSE') fail('freeze manifest attempt receipt identity drifted');
  assertExactKeys(manifest.publication, ['directory', 'resultPath', 'sidecarPath', 'transaction'], 'freeze manifest publication');
  if (manifest.publication.directory !== repoPath(PATHS.outputDirectory) || manifest.publication.resultPath !== repoPath(PATHS.output) || manifest.publication.sidecarPath !== repoPath(PATHS.outputSidecar) || manifest.publication.transaction !== 'complete adjacent staging directory then one same-volume atomic rename') fail('freeze manifest publication identity drifted');
  return manifest;
}

function readFreezeManifest({ io = fs, manifestPath = PATHS.manifest } = {}) {
  const bytes = io.readFileSync(path.resolve(manifestPath));
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    fail('freeze manifest is not valid JSON');
  }
  validateFreezeManifest(manifest);
  if (bytes.toString('utf8') !== canonicalJson(manifest)) fail('freeze manifest is not canonical JSON');
  return { manifest, path: repoPath(manifestPath), sha256: sha256(bytes), bytes: bytes.length, rawBytes: bytes };
}

function gitText(execFileSync, root, args, context) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    fail(`Git freeze check failed: ${context}`, { stderr: error && error.stderr && String(error.stderr).trim() || null });
  }
}

function assertCommittedCleanFiles(files, { execFileSync = childProcess.execFileSync, io = fs, directory = __dirname, requireLinkedWorktree = true } = {}) {
  if (!Array.isArray(files) || !files.length) fail('production code freeze has no files');
  const root = gitText(execFileSync, path.resolve(directory), ['rev-parse', '--show-toplevel'], 'locate worktree');
  if (requireLinkedWorktree) {
    const gitDirectory = gitText(execFileSync, root, ['rev-parse', '--path-format=absolute', '--git-dir'], 'resolve Git directory');
    const commonDirectory = gitText(execFileSync, root, ['rev-parse', '--path-format=absolute', '--git-common-dir'], 'resolve common Git directory');
    if (path.resolve(gitDirectory) === path.resolve(commonDirectory)) fail('production run requires an isolated linked Git worktree');
  }
  const identities = {};
  for (const file of files) {
    const resolved = path.resolve(file);
    const relative = path.relative(root, resolved).replace(/\\/g, '/');
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) fail(`code-freeze file is outside the worktree: ${resolved}`);
    gitText(execFileSync, root, ['ls-files', '--error-unmatch', '--', relative], `require tracked file ${relative}`);
    const status = gitText(execFileSync, root, ['status', '--porcelain', '--', relative], `require clean file ${relative}`);
    if (status.trim()) fail(`code-freeze file has uncommitted changes: ${resolved}`);
    const committed = gitText(execFileSync, root, ['rev-parse', `HEAD:${relative}`], `resolve committed blob ${relative}`);
    const working = gitText(execFileSync, root, ['hash-object', '--path', relative, resolved], `hash working file ${relative}`);
    if (committed !== working) fail(`code-freeze bytes differ from committed Git blob: ${resolved}`);
    const bytes = io.readFileSync(resolved);
    identities[relative] = { gitBlob: committed, sha256: sha256(bytes), bytes: bytes.length };
  }
  return { root, identities };
}

function assertProductionCodeFreeze(manifestEvidence, { execFileSync = childProcess.execFileSync, io = fs, directory = __dirname, requireLinkedWorktree = true, expectedRepoRoot = REPO_ROOT } = {}) {
  if (!manifestEvidence || !manifestEvidence.manifest || !isSha256(manifestEvidence.sha256)) fail('production code freeze requires verified manifest evidence');
  const manifest = validateFreezeManifest(manifestEvidence.manifest);
  if (process.version !== manifest.runtime.node || process.platform !== manifest.runtime.platform || process.arch !== manifest.runtime.arch) fail('executing Node runtime differs from the frozen manifest runtime');
  const root = gitText(execFileSync, path.resolve(directory), ['rev-parse', '--show-toplevel'], 'locate production worktree');
  if (expectedRepoRoot && path.resolve(root) !== path.resolve(expectedRepoRoot)) fail('production runner is outside the frozen repository root');
  const gitDirectory = path.resolve(gitText(execFileSync, root, ['rev-parse', '--path-format=absolute', '--git-dir'], 'resolve linked Git directory'));
  const commonDirectory = path.resolve(gitText(execFileSync, root, ['rev-parse', '--path-format=absolute', '--git-common-dir'], 'resolve linked common Git directory'));
  if (requireLinkedWorktree && gitDirectory === commonDirectory) fail('production run requires an isolated linked Git worktree');
  const tagRef = `refs/tags/${FIXED_PREOUTCOME_TAG}`;
  if (gitText(execFileSync, root, ['cat-file', '-t', tagRef], 'require annotated pre-outcome tag') !== 'tag') fail('fixed pre-outcome Git tag must be annotated');
  const tagObject = gitText(execFileSync, root, ['rev-parse', tagRef], 'resolve annotated pre-outcome tag object');
  const tagCommit = gitText(execFileSync, root, ['rev-parse', `${tagRef}^{commit}`], 'resolve pre-outcome tag commit');
  const headCommit = gitText(execFileSync, root, ['rev-parse', 'HEAD^{commit}'], 'resolve HEAD commit');
  if (tagCommit !== headCommit) fail('HEAD is not exactly the fixed pre-outcome tag commit', { tagCommit, headCommit });

  const manifestRelative = repoPath(PATHS.manifest);
  const manifestAbsolute = path.join(root, ...manifestRelative.split('/'));
  const manifestStatus = gitText(execFileSync, root, ['status', '--porcelain', '--', manifestRelative], 'require clean freeze manifest');
  if (manifestStatus) fail('freeze manifest has uncommitted changes');
  gitText(execFileSync, root, ['ls-files', '--error-unmatch', '--', manifestRelative], 'require tracked freeze manifest');
  const manifestHeadBlob = gitText(execFileSync, root, ['rev-parse', `HEAD:${manifestRelative}`], 'resolve manifest HEAD blob');
  const manifestTagBlob = gitText(execFileSync, root, ['rev-parse', `${tagCommit}:${manifestRelative}`], 'resolve manifest tag blob');
  const manifestWorkingBlob = gitText(execFileSync, root, ['hash-object', '--path', manifestRelative, manifestAbsolute], 'hash working manifest');
  const manifestWorkingBytes = io.readFileSync(manifestAbsolute);
  if (manifestHeadBlob !== manifestTagBlob || manifestHeadBlob !== manifestWorkingBlob || sha256(manifestWorkingBytes) !== manifestEvidence.sha256 || !manifestWorkingBytes.equals(manifestEvidence.rawBytes)) fail('freeze manifest bytes are not identical across evidence, HEAD, tag, and worktree');

  const identities = {};
  for (const entry of manifest.files) {
    const absolute = path.join(root, ...entry.path.split('/'));
    gitText(execFileSync, root, ['ls-files', '--error-unmatch', '--', entry.path], `require tracked ${entry.key}`);
    if (gitText(execFileSync, root, ['status', '--porcelain', '--', entry.path], `require clean ${entry.key}`)) fail(`${entry.key} has uncommitted changes`);
    const headBlob = gitText(execFileSync, root, ['rev-parse', `HEAD:${entry.path}`], `resolve HEAD blob for ${entry.key}`);
    const tagBlob = gitText(execFileSync, root, ['rev-parse', `${tagCommit}:${entry.path}`], `resolve tag blob for ${entry.key}`);
    const workingBlob = gitText(execFileSync, root, ['hash-object', '--path', entry.path, absolute], `hash working bytes for ${entry.key}`);
    const bytes = io.readFileSync(absolute);
    const digest = sha256(bytes);
    if (headBlob !== entry.gitBlob || tagBlob !== entry.gitBlob || workingBlob !== entry.gitBlob || digest !== entry.sha256 || bytes.length !== entry.bytes) fail(`${entry.key} differs from immutable manifest/tag identity`);
    identities[entry.key] = { path: entry.path, gitBlob: entry.gitBlob, sha256: digest, bytes: bytes.length };
  }
  const result = {
    root: path.resolve(root),
    gitDirectory,
    commonDirectory,
    tag: FIXED_PREOUTCOME_TAG,
    tagObject,
    tagCommit,
    manifest: { path: manifestRelative, sha256: manifestEvidence.sha256, gitBlob: manifestHeadBlob, bytes: manifestWorkingBytes.length },
    identities,
  };
  Object.defineProperty(result, CODE_FREEZE_TOKEN, { value: true });
  return Object.freeze(result);
}

function writeAndFsyncNewFile(target, bytes, io = fs) {
  const descriptor = io.openSync(target, 'wx', 0o600);
  try {
    io.writeFileSync(descriptor, bytes);
    io.fsyncSync(descriptor);
  } finally {
    io.closeSync(descriptor);
  }
}

function verifyClaimedAttemptReceipt(launcherEvidence, codeFreeze, { io = fs } = {}) {
  if (!codeFreeze || codeFreeze[CODE_FREEZE_TOKEN] !== true) fail('claimed receipt verification requires repeated immutable code-freeze evidence');
  const receiptPath = path.join(codeFreeze.commonDirectory, ...ATTEMPT_RECEIPT_GIT_COMMON_RELATIVE.split('/'));
  if (!launcherEvidence || launcherEvidence.scope !== ATTEMPT_RECEIPT_SCOPE || launcherEvidence.path !== ATTEMPT_RECEIPT_GIT_COMMON_RELATIVE || path.resolve(launcherEvidence.absolutePath || '') !== path.resolve(receiptPath) || !isSha256(launcherEvidence.sha256) || !Number.isInteger(launcherEvidence.bytes) || launcherEvidence.bytes <= 0) fail('launcher attempt evidence identity is invalid');
  const bytes = io.readFileSync(receiptPath);
  if (bytes.length !== launcherEvidence.bytes || sha256(bytes) !== launcherEvidence.sha256) fail('permanent attempt receipt differs from launcher evidence');
  let receipt;
  try { receipt = JSON.parse(bytes.toString('utf8')); } catch (error) { fail('permanent attempt receipt is not valid JSON'); }
  if (bytes.toString('utf8') !== canonicalJson(receipt)) fail('permanent attempt receipt is not canonical JSON');
  if (receipt.schema !== ATTEMPT_RECEIPT_SCHEMA || receipt.experimentId !== 'component-fragility-tail-v1' || receipt.status !== 'PERMANENT_ONE_SHOT_ATTEMPT_RESERVED_BEFORE_INPUT_PARSE' || receipt.phase !== 'CLAIMED_BEFORE_SCHEMA5_LOAD_OR_INPUT_OPEN' || receipt.command !== 'node research/component_fragility_tail_risk_launcher.js') fail('permanent attempt receipt identity drifted');
  if (receipt.processId !== process.pid || !receipt.runtime || receipt.runtime.node !== process.version || receipt.runtime.platform !== process.platform || receipt.runtime.arch !== process.arch) fail('permanent attempt receipt does not belong to this launcher process/runtime');
  const expectedInvocation = { argv: [path.resolve(process.execPath), path.resolve(PATHS.launcher)], execArgv: [], kind: 'CLEAN_DIRECT_NODE_SCRIPT_ENTRY', nodeOptions: null, repositoryRequireCache: [path.resolve(PATHS.launcher)] };
  if (canonicalJson(receipt.invocation) !== canonicalJson(expectedInvocation)) fail('permanent attempt receipt clean direct-invocation evidence drifted');
  const expectedCodeFreeze = { files: codeFreeze.identities, manifest: codeFreeze.manifest, tag: codeFreeze.tag, tagObject: codeFreeze.tagObject, tagCommit: codeFreeze.tagCommit };
  if (canonicalJson(receipt.codeFreeze) !== canonicalJson(expectedCodeFreeze)) fail('permanent attempt receipt code-freeze identities drifted');
  if (canonicalJson(receipt.expectedInput) !== canonicalJson({ path: repoPath(PATHS.input), sha256: EXPECTED_SHA256.input, sidecarPath: repoPath(PATHS.inputSidecar) })) fail('permanent attempt receipt input identity drifted');
  if (canonicalJson(receipt.repositoryScope) !== canonicalJson({ commonDirectory: codeFreeze.commonDirectory, receiptPath, relativePath: ATTEMPT_RECEIPT_GIT_COMMON_RELATIVE, scope: ATTEMPT_RECEIPT_SCOPE })) fail('permanent attempt receipt repository scope drifted');
  if (canonicalJson(receipt.winningWorktree) !== canonicalJson({ gitDirectory: codeFreeze.gitDirectory, root: codeFreeze.root })) fail('permanent attempt receipt winning worktree drifted');
  if (canonicalJson(receipt.intendedPublication) !== canonicalJson({ absoluteDirectory: path.resolve(PATHS.outputDirectory), absoluteResultPath: path.resolve(PATHS.output), absoluteSidecarPath: path.resolve(PATHS.outputSidecar), directory: repoPath(PATHS.outputDirectory), resultPath: repoPath(PATHS.output), sidecarPath: repoPath(PATHS.outputSidecar) })) fail('permanent attempt receipt publication identity drifted');
  const evidence = { scope: launcherEvidence.scope, path: launcherEvidence.path, absolutePath: receiptPath, sha256: launcherEvidence.sha256, bytes: launcherEvidence.bytes, payload: receipt };
  Object.defineProperty(evidence, ATTEMPT_TOKEN, { value: true });
  return Object.freeze(evidence);
}

function loadSchema5Reader(attemptEvidence, { loader = require } = {}) {
  if (!attemptEvidence || attemptEvidence[ATTEMPT_TOKEN] !== true) fail('schema-5 reader may load only after permanent attempt reservation');
  const loaded = loader('./fear_greed_v2_validation');
  if (!loaded || typeof loaded.readSnapshot !== 'function' || loaded.STATUS !== INPUT_STATUS || !Array.isArray(loaded.COMPONENT_KEYS) || loaded.COMPONENT_KEYS.join('|') !== COMPONENT_ORDER.join('|')) fail('lazy-loaded schema-5 reader exports drifted');
  const evidence = { readSnapshot: loaded.readSnapshot };
  Object.defineProperty(evidence, LOADED_SCHEMA_TOKEN, { value: true });
  return Object.freeze(evidence);
}

function verifyInputBytesBeforeParse(attemptEvidence, { io = fs } = {}) {
  if (!attemptEvidence || attemptEvidence[ATTEMPT_TOKEN] !== true) fail('production input bytes may open only after permanent attempt reservation');
  assertExactProductionPaths();
  if (!io.existsSync(PATHS.inputSidecar)) fail(`production input checksum sidecar is missing: ${PATHS.inputSidecar}`);
  const sidecarBytes = io.readFileSync(PATHS.inputSidecar);
  const tokens = sidecarBytes.toString('utf8').trim().split(/\s+/);
  if (tokens[0] !== EXPECTED_SHA256.input) fail('production input sidecar expected hash drifted');
  if (tokens.length > 1 && tokens.at(-1) !== path.basename(PATHS.input)) fail('production input sidecar filename drifted');
  const inputBytes = io.readFileSync(PATHS.input);
  const digest = sha256(inputBytes);
  if (digest !== EXPECTED_SHA256.input || digest !== tokens[0]) fail('production input bytes do not match the frozen hash');
  return {
    inputBytes,
    inputSha256: digest,
    inputSidecarSha256: sha256(sidecarBytes),
  };
}

function readProductionInput(attemptEvidence, loadedReader, { io = fs } = {}) {
  if (!loadedReader || loadedReader[LOADED_SCHEMA_TOKEN] !== true) fail('production input requires the post-reservation lazy-loaded schema-5 reader');
  const verified = verifyInputBytesBeforeParse(attemptEvidence, { io });
  const read = loadedReader.readSnapshot(PATHS.input);
  if (!read || read.sha256 !== EXPECTED_SHA256.input || !read.checksumVerified || !read.snapshot) fail('schema-5 reader did not return the exact checksum-verified snapshot');
  if (read.snapshot.status !== INPUT_STATUS || read.snapshot.markets.map(market => market.key).join('|') !== MARKET_ORDER.join('|')) fail('schema-5 production identity drifted after validation');
  for (const market of read.snapshot.markets) {
    if (!market.prices || !Array.isArray(market.prices.rows) || market.prices.rows.at(-1).date !== '2026-08-24') fail(`${market.key}: last completed target date drifted`);
  }
  return {
    [PRODUCTION_INPUT_TOKEN]: true,
    snapshot: read.snapshot,
    identity: {
      path: repoPath(PATHS.input),
      sha256: verified.inputSha256,
      sidecarPath: repoPath(PATHS.inputSidecar),
      sidecarSha256: verified.inputSidecarSha256,
      checksumVerifiedBeforeParse: true,
      schema5Validated: true,
    },
  };
}

function analyzeProductionEvidence(evidence, codeEvidence) {
  if (!evidence || evidence[PRODUCTION_INPUT_TOKEN] !== true || !evidence.snapshot || !evidence.identity || evidence.identity.sha256 !== EXPECTED_SHA256.input) fail('production analysis requires exact sealed input evidence');
  return analyzeSnapshot(evidence.snapshot, { input: evidence.identity, code: codeEvidence });
}

function removeOwnedStagingDirectory(directory, outputDirectory, io = fs) {
  const resolved = path.resolve(directory);
  const parent = path.dirname(path.resolve(outputDirectory));
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith(`.${path.basename(outputDirectory)}.staging-`)) fail('refusing to remove a staging directory outside the frozen publication parent');
  if (io.existsSync(resolved)) io.rmSync(resolved, { recursive: true, force: true });
}

function publishResultBundle(result, { io = fs, outputDirectory, processId = process.pid, nonce = crypto.randomBytes(12).toString('hex') } = {}) {
  if (!outputDirectory) fail('result publication requires an explicit output directory');
  if (!Number.isInteger(processId) || processId < 0 || typeof nonce !== 'string' || !/^[0-9A-Za-z_-]+$/.test(nonce)) fail('result staging identity is invalid');
  if (path.resolve(outputDirectory) === path.resolve(PATHS.outputDirectory)) assertResultAbsent({ io });
  else if (io.existsSync(path.resolve(outputDirectory))) fail(`synthetic result directory already exists: ${outputDirectory}`);
  const bytes = Buffer.from(canonicalJson(result));
  const digest = sha256(bytes);
  const resolvedOutputDirectory = path.resolve(outputDirectory);
  const parent = path.dirname(resolvedOutputDirectory);
  const resultName = path.basename(PATHS.output);
  const sidecarName = path.basename(PATHS.outputSidecar);
  const staging = path.join(parent, `.${path.basename(resolvedOutputDirectory)}.staging-${processId}-${nonce}`);
  const stagedResult = path.join(staging, resultName);
  const stagedSidecar = path.join(staging, sidecarName);
  io.mkdirSync(parent, { recursive: true });
  if (io.existsSync(staging)) fail(`unique result staging directory already exists: ${staging}`);
  io.mkdirSync(staging, { recursive: false });
  let published = false;
  let renameAttempted = false;
  try {
    writeAndFsyncNewFile(stagedResult, bytes, io);
    const sidecarBytes = Buffer.from(`${digest}  ${resultName}\n`);
    writeAndFsyncNewFile(stagedSidecar, sidecarBytes, io);
    const rereadResult = io.readFileSync(stagedResult);
    const rereadSidecar = io.readFileSync(stagedSidecar);
    if (!rereadResult.equals(bytes) || sha256(rereadResult) !== digest || rereadSidecar.toString('utf8') !== sidecarBytes.toString('utf8')) fail('staged result directory failed byte verification');
    const entries = io.readdirSync(staging, { withFileTypes: true });
    if (entries.length !== 2 || entries.map(entry => entry.name).sort().join('|') !== [resultName, sidecarName].sort().join('|') || entries.some(entry => !entry.isFile())) fail('staged result directory must contain exactly two regular files');
    if (io.existsSync(resolvedOutputDirectory)) fail(`one-shot result directory appeared before atomic publication: ${resolvedOutputDirectory}`);
    renameAttempted = true;
    io.renameSync(staging, resolvedOutputDirectory);
    published = true;
  } catch (error) {
    if (!published && io.existsSync(staging)) removeOwnedStagingDirectory(staging, resolvedOutputDirectory, io);
    if (error && error.code === 'INTEGRITY_ERROR') throw error;
    fail('transactional result-directory publication failed', { code: error && error.code || null, renameAttempted, finalDirectoryExists: io.existsSync(resolvedOutputDirectory) });
  }
  return {
    directory: resolvedOutputDirectory,
    path: path.join(resolvedOutputDirectory, resultName),
    sidecarPath: path.join(resolvedOutputDirectory, sidecarName),
    sha256: digest,
    bytes: bytes.length,
  };
}

function publishProductionResult(result, attemptEvidence) {
  if (!attemptEvidence || attemptEvidence[ATTEMPT_TOKEN] !== true) fail('production result publication requires the verified in-process launcher attempt');
  return publishResultBundle(result, { outputDirectory: PATHS.outputDirectory });
}

function publishSyntheticResultForTest(result, options = {}) {
  if (!options.outputDirectory) fail('synthetic publication must use an explicit directory outside the repository');
  const candidate = path.resolve(options.outputDirectory);
  const relativeToRepository = path.relative(REPO_ROOT, candidate);
  if (relativeToRepository === '' || (!relativeToRepository.startsWith('..') && !path.isAbsolute(relativeToRepository))) fail('synthetic publication must use a directory outside the repository');
  return publishResultBundle(result, options);
}

function parseCommand(argv) {
  if (!Array.isArray(argv) || argv.length !== 0) fail('one-shot production runner accepts no arguments and uses only its frozen input/output paths');
  return { input: PATHS.input, output: PATHS.output };
}

function main(argv = process.argv.slice(2), launcherAttemptEvidence = null) {
  parseCommand(argv);
  assertExactProductionPaths();
  assertResultAbsent();
  const pinned = verifyPinnedDependencies();
  const manifest = readFreezeManifest();
  const freeze = assertProductionCodeFreeze(manifest);
  assertResultAbsent();
  if (!launcherAttemptEvidence) fail('production runner requires an in-process attempt receipt from the verified launcher');
  const attempt = verifyClaimedAttemptReceipt(launcherAttemptEvidence, freeze);
  const loadedReader = loadSchema5Reader(attempt);
  const evidence = readProductionInput(attempt, loadedReader);
  const codeEvidence = { pinnedDependencies: pinned, immutableFreeze: { tag: freeze.tag, tagObject: freeze.tagObject, tagCommit: freeze.tagCommit, manifest: freeze.manifest, files: freeze.identities }, attempt: { scope: attempt.scope, path: attempt.path, absolutePath: attempt.absolutePath, sha256: attempt.sha256, bytes: attempt.bytes } };
  const result = analyzeProductionEvidence(evidence, codeEvidence);
  const written = publishProductionResult(result, attempt);
  process.stdout.write(`${JSON.stringify({ status: result.status, output: repoPath(written.path), outputSha256: written.sha256, analysisFingerprintSha256: result.analysisFingerprintSha256 }, null, 2)}\n`);
  return result;
}

module.exports = {
  REPO_ROOT,
  RESULT_SCHEMA,
  FREEZE_MANIFEST_SCHEMA,
  ATTEMPT_RECEIPT_SCHEMA,
  ATTEMPT_RECEIPT_SCOPE,
  ATTEMPT_RECEIPT_GIT_COMMON_RELATIVE,
  INPUT_STATUS,
  PROTOCOL_MARKER,
  FIXED_PREOUTCOME_TAG,
  TRAINING_CUTOFF,
  EVALUATION_START,
  HORIZON,
  HAC_BANDWIDTH,
  MINIMUM_FORECAST_ROWS,
  MINIMUM_NON_OVERLAPPING,
  MINIMUM_CALENDAR_SPAN_DAYS,
  MINIMUM_RELATIVE_MSE_IMPROVEMENT,
  ALPHA,
  QR_RANK_TOLERANCE,
  RESIDUAL_FRAGILITY_TOLERANCE,
  STATUS,
  MARKET_ORDER,
  TRAINING_MARKETS,
  COMPONENT_ORDER,
  CONTROL_FEATURES,
  FULL_FEATURES,
  PATHS,
  EXPECTED_SHA256,
  PINNED_DEPENDENCIES,
  PRODUCTION_CODE_FREEZE_PATHS,
  MANIFEST_FILE_ORDER,
  SOURCE_LIMITATIONS,
  IntegrityError,
  fail,
  sha256,
  finiteOrNull,
  canonicalize,
  canonicalJson,
  isIsoDate,
  calendarDays,
  arithmeticMean,
  sampleStandardDeviation,
  componentScores,
  componentFragility,
  buildCausalRows,
  buildStudyRows,
  balancedTrainingWeights,
  weightedStandardization,
  designRow,
  twoPassMgsQrSolve,
  fitWeightedModel,
  fitSharedModels,
  erf,
  normalCdf,
  neweyWestMeanTest21,
  holmAdjustFive,
  adequacyForRows,
  evaluateMarket,
  analyzeBuiltRows,
  analyzeSnapshot,
  assertExactProductionPaths,
  assertResultAbsent,
  verifyPinnedDependencies,
  validateFreezeManifest,
  readFreezeManifest,
  assertCommittedCleanFiles,
  assertProductionCodeFreeze,
  publishSyntheticResultForTest,
  parseCommand,
  main,
};

if (require.main === module) {
  process.stderr.write(`${JSON.stringify({
    status: 'INTEGRITY_ERROR',
    message: 'Direct runner execution is forbidden; use node research/component_fragility_tail_risk_launcher.js with no arguments.',
    details: {},
  }, null, 2)}\n`);
  process.exitCode = 2;
}
