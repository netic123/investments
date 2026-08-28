'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MODEL_ID = 'FG-ONLINE-RIDGE-PREQ-V1';
const PROTOCOL_FREEZE_MARKER = 'FROZEN_PRE_OUTCOME_2026_08_28_V1';
const PROTOCOL_SHA256 = '8fa20883c3c96d8a98ebe5595eb8c221c283cb98b209552e814e62a3a3b77924';
const PROTOCOL_PATH = path.join(__dirname, 'FEAR_GREED_EXPANDING_BINARY_PROTOCOL.md');
const SCHEMA_VERSION = 1;
const RIDGE_LAMBDA = 1;
const MIN_MATURED_ROWS = 252;
const CURRENT_Z_LIMIT = 5;

const EVIDENCE_STATUS = 'RETROSPECTIVE_PREQUENTIAL_DEVELOPMENT_ONLY';
const FALSIFIED_STATUS = 'RETROSPECTIVE_PREQUENTIAL_FALSIFIED';
const WARMUP_REASON = 'WARMUP_BUY_BASELINE';
const INVALID_REASON = 'FAIL_CLOSED_DATA_INVALID';

const COMPONENT_KEYS = Object.freeze([
  'momentum',
  'strength',
  'volatility',
  'safeHaven',
  'credit',
  'breadth',
]);

const M0_FEATURE_NAMES = Object.freeze([
  'target_log_return_1',
  'target_log_return_5',
  'target_log_return_20',
  'target_log_return_volatility_20',
  'target_log_level_to_mean_125',
]);

const M1_FEATURE_NAMES = Object.freeze([
  ...M0_FEATURE_NAMES,
  'published_score_centered',
  'published_score_centered_squared',
  'published_score_change_1',
  'published_score_change_5',
  'published_score_change_21',
  'component_score_dispersion_6',
  'score_centered_x_target_trend_125',
]);

const COSTS = Object.freeze({
  crypto: Object.freeze({ primary: 0.0025, stress: 0.0075 }),
  equity: Object.freeze({ primary: 0.001, stress: 0.0025 }),
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isExactIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString().slice(0, 10) === value;
}

function isExactUtcTimestamp(value) {
  if (typeof value !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
      || !Number.isFinite(Date.parse(value))) return false;
  const canonical = new Date(value).toISOString();
  return value === canonical || value === canonical.replace('.000Z', 'Z');
}

function normalizeNullableNumber(value) {
  return isFiniteNumber(value) ? value : null;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
    return null;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object' && value !== undefined) {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) result[key] = canonicalize(value[key]);
    }
    return result;
  }
  return null;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashCanonical(value) {
  return sha256Bytes(Buffer.from(canonicalStringify(value), 'utf8'));
}

function getRunnerIdentity() {
  return Object.freeze({
    modelId: MODEL_ID,
    runnerFile: path.basename(__filename),
    runnerSha256: sha256Bytes(fs.readFileSync(__filename)),
  });
}

function getConfigIdentity() {
  const config = {
    schemaVersion: SCHEMA_VERSION,
    modelId: MODEL_ID,
    ridgeLambda: RIDGE_LAMBDA,
    minimumMaturedRows: MIN_MATURED_ROWS,
    currentZClamp: [-CURRENT_Z_LIMIT, CURRENT_Z_LIMIT],
    standardDeviation: 'population',
    trainingObjective: 'mean_squared_error_plus_lambda_l2',
    label: 'log(P[t+2]/P[t+1])',
    costs: COSTS,
    componentKeys: COMPONENT_KEYS,
    m0FeatureNames: M0_FEATURE_NAMES,
    m1FeatureNames: M1_FEATURE_NAMES,
  };
  return Object.freeze({ config, configSha256: hashCanonical(config) });
}

function assertProtocolIdentity(protocolPath = PROTOCOL_PATH) {
  const bytes = fs.readFileSync(protocolPath);
  const text = bytes.toString('utf8');
  const actualSha256 = sha256Bytes(bytes);
  assert(actualSha256 === PROTOCOL_SHA256,
    `Protocol hash drift: expected ${PROTOCOL_SHA256}, got ${actualSha256}`);
  assert(text.includes(`FG_EXPANDING_BINARY_FREEZE_MARKER: ${PROTOCOL_FREEZE_MARKER}`),
    `Protocol freeze marker is not ${PROTOCOL_FREEZE_MARKER}`);
  assert(text.includes(`FG_EXPANDING_BINARY_MODEL_ID: ${MODEL_ID}`),
    `Protocol model id is not ${MODEL_ID}`);
  return Object.freeze({
    protocolFile: path.basename(protocolPath),
    protocolSha256: actualSha256,
    freezeMarker: PROTOCOL_FREEZE_MARKER,
    modelId: MODEL_ID,
  });
}

function extractComponentScores(signal) {
  if (Array.isArray(signal.componentScores)) {
    if (signal.componentScores.length !== COMPONENT_KEYS.length) return Array(COMPONENT_KEYS.length).fill(null);
    return signal.componentScores.map((value) => {
      if (isFiniteNumber(value)) return value;
      if (value && isFiniteNumber(value.score)) return value.score;
      return null;
    });
  }
  const components = signal.components && typeof signal.components === 'object'
    ? signal.components
    : {};
  return COMPONENT_KEYS.map((key) => {
    const value = components[key];
    if (isFiniteNumber(value)) return value;
    if (value && isFiniteNumber(value.score)) return value.score;
    return null;
  });
}

function normalizeMarket(input) {
  assert(input && typeof input === 'object', 'Market input must be an object');
  const rawPrices = Array.isArray(input.prices)
    ? input.prices
    : input.prices && Array.isArray(input.prices.rows) ? input.prices.rows : null;
  assert(rawPrices && rawPrices.length >= 2, 'Market requires at least two price rows');

  const prices = rawPrices.map((row, index) => {
    assert(row && typeof row === 'object', `Price row ${index} must be an object`);
    assert(isExactIsoDate(row.date), `Price row ${index} has an invalid date`);
    assert(isFiniteNumber(row.close) && row.close > 0, `Price row ${index} has invalid close`);
    if (index > 0) assert(rawPrices[index - 1].date < row.date, 'Price dates must be strictly increasing');
    return Object.freeze({ date: row.date, close: row.close });
  });

  assert(Array.isArray(input.signals) && input.signals.length > 0,
    'Market requires at least one signal row');
  const priceIndexByDate = new Map(prices.map((row, index) => [row.date, index]));
  const providedSignals = input.signals.map((row, index) => {
    assert(row && typeof row === 'object', `Signal row ${index} must be an object`);
    assert(isExactIsoDate(row.date), `Signal row ${index} has an invalid date`);
    if (index > 0) assert(input.signals[index - 1].date < row.date,
      'Signal dates must be strictly increasing');
    assert(priceIndexByDate.has(row.date), `Signal date ${row.date} has no exact target close`);
    const availableAtUtc = row.availableAtUtc === null || row.availableAtUtc === undefined
      ? null
      : row.availableAtUtc;
    assert(availableAtUtc === null || isExactUtcTimestamp(availableAtUtc),
      `Signal row ${index} has an invalid availableAtUtc timestamp`);
    if (availableAtUtc !== null) {
      assert(index === input.signals.length - 1
        && priceIndexByDate.get(row.date) === prices.length - 1,
      'Only the current final signal may have unresolved live availability');
    }
    return Object.freeze({
      date: row.date,
      priceIndex: priceIndexByDate.get(row.date),
      availableAtUtc,
      publishedScore: normalizeNullableNumber(row.publishedScore),
      componentScores: Object.freeze(extractComponentScores(row)),
    });
  });

  // Once the first score row exists, every completed target close is a
  // scheduled decision close.  Missing score rows are explicit invalid
  // observations so the ledger emits the mandatory fail-closed SELL state;
  // they are never silently skipped or replaced with a carried-forward score.
  const providedByPriceIndex = new Map(providedSignals.map(signal => [signal.priceIndex, signal]));
  const signals = [];
  for (let priceIndex = providedSignals[0].priceIndex; priceIndex < prices.length; priceIndex += 1) {
    const supplied = providedByPriceIndex.get(priceIndex);
    signals.push(supplied || Object.freeze({
      date: prices[priceIndex].date,
      priceIndex,
      availableAtUtc: null,
      publishedScore: null,
      componentScores: Object.freeze(Array(COMPONENT_KEYS.length).fill(null)),
    }));
  }

  const marketClass = input.marketClass === 'crypto' ? 'crypto' : 'equity';
  const annualization = isFiniteNumber(input.annualization) && input.annualization > 0
    ? input.annualization
    : marketClass === 'crypto' ? 365 : 252;
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    key: String(input.key || input.targetId || 'market'),
    name: String(input.name || input.key || input.targetId || 'market'),
    targetId: String(input.targetId || input.key || 'target'),
    marketClass,
    annualization,
    prices: Object.freeze(prices),
    signals: Object.freeze(signals),
  });
}

function populationStandardDeviation(values) {
  if (!Array.isArray(values) || values.length === 0 || !values.every(isFiniteNumber)) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(Math.max(0, variance));
}

function buildFeatureObservation(normalizedMarket, signalIndex) {
  const market = normalizedMarket.schemaVersion === SCHEMA_VERSION
    ? normalizedMarket
    : normalizeMarket(normalizedMarket);
  assert(Number.isInteger(signalIndex) && signalIndex >= 0 && signalIndex < market.signals.length,
    'signalIndex is out of range');
  const signal = market.signals[signalIndex];
  const priceIndex = signal.priceIndex;
  const prices = market.prices;
  const invalidM0 = [];

  function logReturn(lag, name) {
    if (priceIndex < lag) {
      invalidM0.push(`${name}:INSUFFICIENT_HISTORY`);
      return null;
    }
    const value = Math.log(prices[priceIndex].close / prices[priceIndex - lag].close);
    if (!isFiniteNumber(value)) invalidM0.push(`${name}:NON_FINITE`);
    return normalizeNullableNumber(value);
  }

  const return1 = logReturn(1, M0_FEATURE_NAMES[0]);
  const return5 = logReturn(5, M0_FEATURE_NAMES[1]);
  const return20 = logReturn(20, M0_FEATURE_NAMES[2]);

  let volatility20 = null;
  if (priceIndex < 20) {
    invalidM0.push(`${M0_FEATURE_NAMES[3]}:INSUFFICIENT_HISTORY`);
  } else {
    const returns = [];
    for (let index = priceIndex - 19; index <= priceIndex; index += 1) {
      returns.push(Math.log(prices[index].close / prices[index - 1].close));
    }
    volatility20 = populationStandardDeviation(returns);
    if (!isFiniteNumber(volatility20)) invalidM0.push(`${M0_FEATURE_NAMES[3]}:NON_FINITE`);
  }

  let trend125 = null;
  if (priceIndex < 124) {
    invalidM0.push(`${M0_FEATURE_NAMES[4]}:INSUFFICIENT_HISTORY`);
  } else {
    let sum = 0;
    for (let index = priceIndex - 124; index <= priceIndex; index += 1) sum += prices[index].close;
    const mean = sum / 125;
    trend125 = Math.log(prices[priceIndex].close / mean);
    if (!isFiniteNumber(trend125)) invalidM0.push(`${M0_FEATURE_NAMES[4]}:NON_FINITE`);
  }

  const m0Features = [return1, return5, return20, volatility20, trend125];
  const invalidM1 = [...invalidM0];
  const score = signal.publishedScore;
  let centered = null;
  if (!isFiniteNumber(score)) invalidM1.push('published_score_centered:INVALID_CURRENT_SCORE');
  else centered = score - 50;

  function scoreChange(lag, name) {
    if (signalIndex < lag) {
      invalidM1.push(`${name}:INSUFFICIENT_SCORE_HISTORY`);
      return null;
    }
    const earlier = market.signals[signalIndex - lag].publishedScore;
    if (!isFiniteNumber(score) || !isFiniteNumber(earlier)) {
      invalidM1.push(`${name}:INVALID_SCORE`);
      return null;
    }
    return score - earlier;
  }

  const change1 = scoreChange(1, M1_FEATURE_NAMES[7]);
  const change5 = scoreChange(5, M1_FEATURE_NAMES[8]);
  const change21 = scoreChange(21, M1_FEATURE_NAMES[9]);
  let componentDispersion = null;
  if (signal.componentScores.length !== 6 || !signal.componentScores.every(isFiniteNumber)) {
    invalidM1.push('component_score_dispersion_6:REQUIRES_SIX_FINITE_COMPONENTS');
  } else {
    componentDispersion = populationStandardDeviation(signal.componentScores);
  }
  const square = isFiniteNumber(centered) ? centered ** 2 : null;
  const interaction = isFiniteNumber(centered) && isFiniteNumber(trend125)
    ? centered * trend125
    : null;
  const m1Features = [
    ...m0Features,
    centered,
    square,
    change1,
    change5,
    change21,
    componentDispersion,
    interaction,
  ];
  const m0Valid = invalidM0.length === 0 && m0Features.every(isFiniteNumber);
  const m1Valid = invalidM1.length === 0 && m1Features.every(isFiniteNumber);

  return Object.freeze({
    signalIndex,
    featureIndex: priceIndex,
    featureDate: signal.date,
    maturityIndex: priceIndex + 2,
    maturityDate: priceIndex + 2 < prices.length ? prices[priceIndex + 2].date : null,
    m0Features: Object.freeze(m0Features),
    m1Features: Object.freeze(m1Features),
    m0Valid,
    m1Valid,
    m0InvalidReasons: Object.freeze(invalidM0),
    m1InvalidReasons: Object.freeze(invalidM1),
  });
}

function computeForwardLabel(pricesOrMarket, featureIndex, asOfIndex = Infinity) {
  const prices = Array.isArray(pricesOrMarket) ? pricesOrMarket : pricesOrMarket.prices;
  assert(Array.isArray(prices), 'Prices are required');
  assert(Number.isInteger(featureIndex) && featureIndex >= 0, 'featureIndex must be non-negative');
  const maturityIndex = featureIndex + 2;
  if (maturityIndex >= prices.length || maturityIndex > asOfIndex) return null;
  const label = Math.log(prices[maturityIndex].close / prices[featureIndex + 1].close);
  return isFiniteNumber(label) ? label : null;
}

function createSufficientStatistics(dimension) {
  assert(Number.isInteger(dimension) && dimension > 0, 'dimension must be a positive integer');
  return {
    dimension,
    n: 0,
    meanX: Array(dimension).fill(0),
    meanY: 0,
    m2XX: Array.from({ length: dimension }, () => Array(dimension).fill(0)),
    m2XY: Array(dimension).fill(0),
  };
}

function addObservation(statistics, features, outcome) {
  assert(statistics && Number.isInteger(statistics.dimension), 'Invalid statistics object');
  assert(Array.isArray(features) && features.length === statistics.dimension,
    'Feature dimension does not match statistics');
  assert(features.every(isFiniteNumber) && isFiniteNumber(outcome),
    'Observation must be entirely finite');

  const oldN = statistics.n;
  const nextN = oldN + 1;
  const deltaX = features.map((value, index) => value - statistics.meanX[index]);
  const deltaY = outcome - statistics.meanY;
  const nextMeanX = statistics.meanX.map((mean, index) => mean + (deltaX[index] / nextN));
  const nextMeanY = statistics.meanY + (deltaY / nextN);

  for (let row = 0; row < statistics.dimension; row += 1) {
    statistics.m2XY[row] += deltaX[row] * (outcome - nextMeanY);
    for (let column = 0; column < statistics.dimension; column += 1) {
      statistics.m2XX[row][column] += deltaX[row] * (features[column] - nextMeanX[column]);
    }
  }
  statistics.n = nextN;
  statistics.meanX = nextMeanX;
  statistics.meanY = nextMeanY;
  return statistics;
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  assert(matrix.length === size && matrix.every((row) => row.length === size),
    'Linear system dimensions do not match');
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    }
    if (!isFiniteNumber(augmented[best][pivot]) || Math.abs(augmented[best][pivot]) < 1e-14) return null;
    if (best !== pivot) [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    const divisor = augmented[pivot][pivot];
    for (let column = pivot; column <= size; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const multiplier = augmented[row][pivot];
      if (multiplier === 0) continue;
      for (let column = pivot; column <= size; column += 1) {
        augmented[row][column] -= multiplier * augmented[pivot][column];
      }
    }
  }
  const solution = augmented.map((row) => row[size]);
  return solution.every(isFiniteNumber) ? solution : null;
}

function fitStandardizedRidge(statistics, currentFeatures, options = {}) {
  const lambda = options.lambda === undefined ? RIDGE_LAMBDA : options.lambda;
  const zLimit = options.zLimit === undefined ? CURRENT_Z_LIMIT : options.zLimit;
  if (!statistics || statistics.n === 0 || !Array.isArray(currentFeatures)
      || currentFeatures.length !== statistics.dimension || !currentFeatures.every(isFiniteNumber)
      || !isFiniteNumber(lambda) || lambda < 0 || !isFiniteNumber(zLimit) || zLimit <= 0) {
    return Object.freeze({ ok: false, reason: 'INVALID_FIT_INPUT' });
  }

  const standardDeviations = Array(statistics.dimension).fill(0);
  const active = [];
  for (let feature = 0; feature < statistics.dimension; feature += 1) {
    const variance = Math.max(0, statistics.m2XX[feature][feature] / statistics.n);
    const sd = Math.sqrt(variance);
    if (isFiniteNumber(sd) && sd > 1e-14) {
      standardDeviations[feature] = sd;
      active.push(feature);
    }
  }

  const coefficients = Array(statistics.dimension).fill(0);
  if (active.length > 0) {
    const matrix = active.map((featureJ, row) => active.map((featureK, column) => {
      const symmetricM2 = (statistics.m2XX[featureJ][featureK]
        + statistics.m2XX[featureK][featureJ]) / 2;
      const correlation = symmetricM2 / statistics.n
        / standardDeviations[featureJ] / standardDeviations[featureK];
      return correlation + (row === column ? lambda : 0);
    }));
    const rightHandSide = active.map((feature) => (
      (statistics.m2XY[feature] / statistics.n) / standardDeviations[feature]
    ));
    const solution = solveLinearSystem(matrix, rightHandSide);
    if (!solution) return Object.freeze({ ok: false, reason: 'RIDGE_SOLVE_FAILED' });
    active.forEach((feature, index) => { coefficients[feature] = solution[index]; });
  }

  const standardizedCurrent = currentFeatures.map((value, index) => {
    if (standardDeviations[index] === 0) return 0;
    return clamp((value - statistics.meanX[index]) / standardDeviations[index], -zLimit, zLimit);
  });
  const prediction = statistics.meanY + coefficients.reduce(
    (sum, coefficient, index) => sum + (coefficient * standardizedCurrent[index]), 0,
  );
  if (!isFiniteNumber(prediction)) return Object.freeze({ ok: false, reason: 'NON_FINITE_PREDICTION' });
  return Object.freeze({
    ok: true,
    intercept: statistics.meanY,
    coefficients: Object.freeze(coefficients),
    means: Object.freeze([...statistics.meanX]),
    populationStandardDeviations: Object.freeze(standardDeviations),
    standardizedCurrent: Object.freeze(standardizedCurrent),
    prediction,
    trainingRowCount: statistics.n,
    lambda,
  });
}

function logCostHurdle(oneWayCost) {
  assert(isFiniteNumber(oneWayCost) && oneWayCost >= 0 && oneWayCost < 1,
    'One-way cost must be in [0, 1)');
  return -Math.log(1 - oneWayCost);
}

function chooseBinaryTarget(filledPosition, prediction, stressCost) {
  assert(filledPosition === 'LONG' || filledPosition === 'CASH', 'Filled position must be LONG or CASH');
  assert(isFiniteNumber(prediction), 'Prediction must be finite');
  const hurdle = logCostHurdle(stressCost);
  if (filledPosition === 'CASH' && prediction > hurdle) return 'LONG';
  if (filledPosition === 'LONG' && prediction < -hurdle) return 'CASH';
  return filledPosition;
}

function binaryDecisionRecord({
  market, model, observation, decisionOrdinal, filledPosition, targetPosition,
  prediction, fallbackReason, fit, trainingMeta, statistics,
}) {
  const price = market.prices[observation.featureIndex];
  const signal = market.signals[observation.signalIndex];
  // Retrospective rows have no availability timestamp and use the frozen
  // next-close replay.  A live current decision has an availability timestamp,
  // but no future close/timestamp is present in this input, so the executor is
  // deliberately unresolved rather than falsely assigning featureIndex + 1.
  const executionIndex = signal.availableAtUtc === null
    ? observation.featureIndex + 1
    : null;
  const action = targetPosition === 'LONG' ? 'BUY' : 'SELL';
  const record = {
    model,
    decisionOrdinal,
    signalIndex: observation.signalIndex,
    decisionPriceIndex: observation.featureIndex,
    decisionDate: price.date,
    decisionClose: Object.freeze({ date: price.date, close: price.close }),
    action,
    allocation: targetPosition === 'LONG' ? 1 : 0,
    filledPosition,
    nextCloseTarget: targetPosition,
    targetPosition,
    tradeRequired: targetPosition !== filledPosition,
    executionPriceIndex: executionIndex,
    executionSchedulingStatus: executionIndex === null
      ? 'UNRESOLVED_FIRST_FUTURE_TARGET_CLOSE_AFTER_FEATURE_AND_AVAILABILITY'
      : 'RETROSPECTIVE_NEXT_CLOSE_NO_AVAILABILITY_TIMESTAMP',
    earliestExecutionDate: null,
    earliestExecutionClose: Object.freeze({
      rule: executionIndex === null
        ? 'FIRST_TARGET_CLOSE_STRICTLY_AFTER_FEATURE_CLOSE_AND_AVAILABLE_AT_UTC'
        : 'NEXT_COMPLETED_TARGET_CLOSE_AFTER_DECISION',
      afterDate: price.date,
      availableAtUtc: signal.availableAtUtc,
    }),
    signalAvailableAtUtc: signal.availableAtUtc,
    trainingStartDate: trainingMeta.startFeatureDate,
    trainingEndDate: trainingMeta.endFeatureDate,
    latestMaturedOutcomeClose: trainingMeta.latestOutcomeDate,
    trainingRowCount: statistics.n,
    prediction: isFiniteNumber(prediction) ? prediction : null,
    fallbackReason,
    currentFeaturesValid: model === 'M1'
      ? observation.m1Valid
      : observation.m0Valid && observation.m1Valid,
    currentFeatureInvalidReasons: Object.freeze(model === 'M1'
      ? [...observation.m1InvalidReasons]
      : [...new Set([...observation.m0InvalidReasons, ...observation.m1InvalidReasons])]),
    evidenceStatus: EVIDENCE_STATUS,
    evidence: Object.freeze({
      modelId: MODEL_ID,
      label: 'log(P[t+2]/P[t+1])',
      maturedThroughClose: trainingMeta.latestOutcomeDate,
      fitSucceeded: Boolean(fit && fit.ok),
    }),
  };
  record.decisionSha256 = hashCanonical(record);
  return Object.freeze(record);
}

function buildDecisionLedgers(input) {
  const market = input.schemaVersion === SCHEMA_VERSION ? input : normalizeMarket(input);
  const costs = COSTS[market.marketClass];
  const statsM1 = createSufficientStatistics(M1_FEATURE_NAMES.length);
  const statsM0 = createSufficientStatistics(M0_FEATURE_NAMES.length);
  const decisionsM1 = [];
  const decisionsM0 = [];
  const pendingTargetsM1 = new Map();
  const pendingTargetsM0 = new Map();
  const pendingTraining = new Map();
  const pendingForecastsM1 = new Map();
  const pendingForecastsM0 = new Map();
  const mseM1 = { count: 0, sumSquaredError: 0 };
  const mseM0 = { count: 0, sumSquaredError: 0 };
  const trainingMeta = {
    startFeatureDate: null,
    endFeatureDate: null,
    latestOutcomeDate: null,
  };
  let filledM1 = 'LONG';
  let filledM0 = 'LONG';
  const signalsAtPriceIndex = new Map(market.signals.map((signal, index) => [signal.priceIndex, index]));

  function appendPending(map, index, value) {
    if (!map.has(index)) map.set(index, []);
    map.get(index).push(value);
  }

  function matureForecasts(map, mse, priceIndex) {
    for (const forecast of map.get(priceIndex) || []) {
      const actual = computeForwardLabel(market.prices, forecast.featureIndex, priceIndex);
      if (isFiniteNumber(actual)) {
        const error = actual - forecast.prediction;
        mse.count += 1;
        mse.sumSquaredError += error ** 2;
      }
    }
  }

  for (let priceIndex = 0; priceIndex < market.prices.length; priceIndex += 1) {
    if (pendingTargetsM1.has(priceIndex)) filledM1 = pendingTargetsM1.get(priceIndex);
    if (pendingTargetsM0.has(priceIndex)) filledM0 = pendingTargetsM0.get(priceIndex);

    matureForecasts(pendingForecastsM1, mseM1, priceIndex);
    matureForecasts(pendingForecastsM0, mseM0, priceIndex);

    for (const observation of pendingTraining.get(priceIndex) || []) {
      const outcome = computeForwardLabel(market.prices, observation.featureIndex, priceIndex);
      if (!isFiniteNumber(outcome)) continue;
      addObservation(statsM1, observation.m1Features, outcome);
      addObservation(statsM0, observation.m0Features, outcome);
      if (trainingMeta.startFeatureDate === null) trainingMeta.startFeatureDate = observation.featureDate;
      trainingMeta.endFeatureDate = observation.featureDate;
      trainingMeta.latestOutcomeDate = market.prices[priceIndex].date;
    }

    if (!signalsAtPriceIndex.has(priceIndex)) continue;
    const signalIndex = signalsAtPriceIndex.get(priceIndex);
    const observation = buildFeatureObservation(market, signalIndex);

    function decide(model, statistics, valid, features, filledPosition) {
      let targetPosition;
      let fallbackReason = null;
      let prediction = null;
      let fit = null;
      if (!valid) {
        targetPosition = 'CASH';
        fallbackReason = INVALID_REASON;
      } else if (statistics.n < MIN_MATURED_ROWS) {
        targetPosition = 'LONG';
        fallbackReason = WARMUP_REASON;
      } else {
        fit = fitStandardizedRidge(statistics, features);
        if (!fit.ok) {
          targetPosition = 'CASH';
          fallbackReason = INVALID_REASON;
        } else {
          prediction = fit.prediction;
          targetPosition = chooseBinaryTarget(filledPosition, prediction, costs.stress);
        }
      }
      return { model, targetPosition, fallbackReason, prediction, fit };
    }

    const chosenM1 = decide('M1', statsM1, observation.m1Valid, observation.m1Features, filledM1);
    // M0 is a nested attribution control, not a way to exploit dates on which
    // the Fear & Greed block is unavailable.  Predictions and fallbacks share
    // the exact M1-complete origin set.
    const chosenM0 = decide(
      'M0', statsM0, observation.m0Valid && observation.m1Valid,
      observation.m0Features, filledM0,
    );
    const recordM1 = binaryDecisionRecord({
      market, model: 'M1', observation, decisionOrdinal: decisionsM1.length,
      filledPosition: filledM1, ...chosenM1, trainingMeta, statistics: statsM1,
    });
    const recordM0 = binaryDecisionRecord({
      market, model: 'M0', observation, decisionOrdinal: decisionsM0.length,
      filledPosition: filledM0, ...chosenM0, trainingMeta, statistics: statsM0,
    });
    decisionsM1.push(recordM1);
    decisionsM0.push(recordM0);

    if (Number.isInteger(recordM1.executionPriceIndex)
        && recordM1.executionPriceIndex < market.prices.length) pendingTargetsM1.set(
      recordM1.executionPriceIndex, recordM1.targetPosition,
    );
    if (Number.isInteger(recordM0.executionPriceIndex)
        && recordM0.executionPriceIndex < market.prices.length) pendingTargetsM0.set(
      recordM0.executionPriceIndex, recordM0.targetPosition,
    );
    if (isFiniteNumber(recordM1.prediction) && observation.maturityIndex < market.prices.length) {
      appendPending(pendingForecastsM1, observation.maturityIndex, {
        featureIndex: observation.featureIndex,
        prediction: recordM1.prediction,
      });
    }
    if (isFiniteNumber(recordM0.prediction) && observation.maturityIndex < market.prices.length) {
      appendPending(pendingForecastsM0, observation.maturityIndex, {
        featureIndex: observation.featureIndex,
        prediction: recordM0.prediction,
      });
    }
    if (observation.m1Valid && observation.maturityIndex < market.prices.length) {
      appendPending(pendingTraining, observation.maturityIndex, observation);
    }
  }

  function finishMse(mse) {
    return Object.freeze({
      count: mse.count,
      sumSquaredError: mse.sumSquaredError,
      meanSquaredError: mse.count > 0 ? mse.sumSquaredError / mse.count : null,
    });
  }

  return Object.freeze({
    market,
    M1: Object.freeze({
      decisions: Object.freeze(decisionsM1),
      prequential: finishMse(mseM1),
      sufficientStatistics: statsM1,
    }),
    M0: Object.freeze({
      decisions: Object.freeze(decisionsM0),
      prequential: finishMse(mseM0),
      sufficientStatistics: statsM0,
    }),
    sharedTraining: Object.freeze({
      rowCount: statsM1.n,
      startFeatureDate: trainingMeta.startFeatureDate,
      endFeatureDate: trainingMeta.endFeatureDate,
      latestOutcomeDate: trainingMeta.latestOutcomeDate,
    }),
  });
}

function sampleStandardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function completedCashEpisodes(decisions) {
  let target = 'LONG';
  let cashEpisodeOpen = false;
  let completed = 0;
  for (const decision of decisions) {
    if (target === 'LONG' && decision.targetPosition === 'CASH') cashEpisodeOpen = true;
    if (target === 'CASH' && decision.targetPosition === 'LONG' && cashEpisodeOpen) {
      completed += 1;
      cashEpisodeOpen = false;
    }
    target = decision.targetPosition;
  }
  return completed;
}

function replayDecisionLedger(input, decisions, oneWayCost) {
  const market = input.schemaVersion === SCHEMA_VERSION ? input : normalizeMarket(input);
  assert(Array.isArray(decisions) && decisions.length > 0, 'At least one decision is required');
  assert(isFiniteNumber(oneWayCost) && oneWayCost >= 0 && oneWayCost < 1, 'Invalid one-way cost');
  const startIndex = decisions[0].decisionPriceIndex;
  const endIndex = decisions[decisions.length - 1].decisionPriceIndex;
  assert(startIndex >= 0 && endIndex >= startIndex && endIndex < market.prices.length,
    'Decision replay bounds are invalid');
  const executionTargets = new Map();
  for (const decision of decisions) {
    assert(decision.action === 'BUY' || decision.action === 'SELL', 'Every decision must be BUY or SELL');
    const target = decision.targetPosition || (decision.action === 'BUY' ? 'LONG' : 'CASH');
    if (decision.executionPriceIndex !== null && decision.executionPriceIndex !== undefined) {
      executionTargets.set(decision.executionPriceIndex, target);
    }
  }
  const minimalLedger = decisions.map((decision) => ({
    decisionPriceIndex: decision.decisionPriceIndex,
    executionPriceIndex: decision.executionPriceIndex,
    action: decision.action,
    targetPosition: decision.targetPosition || (decision.action === 'BUY' ? 'LONG' : 'CASH'),
  }));

  let wealth = 1;
  let peak = 1;
  let maximumDrawdown = 0;
  let filledPosition = 'LONG';
  let fills = 0;
  let costRateSum = 0;
  let costMultiplier = 1;
  let exposedIntervals = 0;
  const netReturns = [];
  const pathRows = [{
    priceIndex: startIndex,
    date: market.prices[startIndex].date,
    wealth,
    filledPosition,
    filledTarget: null,
    costCharged: 0,
  }];

  for (let priceIndex = startIndex + 1; priceIndex <= endIndex; priceIndex += 1) {
    const wealthBefore = wealth;
    if (filledPosition === 'LONG') {
      wealth *= market.prices[priceIndex].close / market.prices[priceIndex - 1].close;
      exposedIntervals += 1;
    }
    let filledTarget = null;
    let costCharged = 0;
    if (executionTargets.has(priceIndex)) {
      const target = executionTargets.get(priceIndex);
      if (target !== filledPosition) {
        wealth *= (1 - oneWayCost);
        costMultiplier *= (1 - oneWayCost);
        costRateSum += oneWayCost;
        costCharged = oneWayCost;
        fills += 1;
        filledPosition = target;
      }
      filledTarget = target;
    }
    const netReturn = wealth / wealthBefore - 1;
    netReturns.push(netReturn);
    peak = Math.max(peak, wealth);
    maximumDrawdown = Math.max(maximumDrawdown, 1 - (wealth / peak));
    pathRows.push({
      priceIndex,
      date: market.prices[priceIndex].date,
      wealth,
      filledPosition,
      filledTarget,
      costCharged,
    });
  }
  const intervalCount = Math.max(0, endIndex - startIndex);
  const counts = decisions.reduce((accumulator, decision) => {
    accumulator[decision.targetPosition === 'LONG' ? 'long' : 'cash'] += 1;
    return accumulator;
  }, { long: 0, cash: 0 });
  return Object.freeze({
    oneWayCost,
    ledgerHash: hashCanonical(minimalLedger),
    startDate: market.prices[startIndex].date,
    endDate: market.prices[endIndex].date,
    startPriceIndex: startIndex,
    endPriceIndex: endIndex,
    intervalCount,
    terminalWealth: wealth,
    annualizedLogReturn: intervalCount > 0 ? Math.log(wealth) * market.annualization / intervalCount : 0,
    realizedVolatility: sampleStandardDeviation(netReturns) * Math.sqrt(market.annualization),
    maximumDrawdown,
    exposure: intervalCount > 0 ? exposedIntervals / intervalCount : 1,
    stateCounts: Object.freeze(counts),
    fills,
    completedCashEpisodes: completedCashEpisodes(decisions),
    costRateSum,
    costMultiplier,
    terminalLiquidation: false,
    path: Object.freeze(pathRows.map(Object.freeze)),
  });
}

function buyAndHoldSummary(market, startIndex, endIndex) {
  const pathRows = [];
  const returns = [];
  let peak = 1;
  let maximumDrawdown = 0;
  for (let priceIndex = startIndex; priceIndex <= endIndex; priceIndex += 1) {
    const wealth = market.prices[priceIndex].close / market.prices[startIndex].close;
    pathRows.push(Object.freeze({ priceIndex, date: market.prices[priceIndex].date, wealth }));
    if (priceIndex > startIndex) returns.push(
      market.prices[priceIndex].close / market.prices[priceIndex - 1].close - 1,
    );
    peak = Math.max(peak, wealth);
    maximumDrawdown = Math.max(maximumDrawdown, 1 - (wealth / peak));
  }
  const intervalCount = endIndex - startIndex;
  const terminalWealth = pathRows[pathRows.length - 1].wealth;
  return Object.freeze({
    startDate: market.prices[startIndex].date,
    endDate: market.prices[endIndex].date,
    startPriceIndex: startIndex,
    endPriceIndex: endIndex,
    intervalCount,
    terminalWealth,
    annualizedLogReturn: intervalCount > 0
      ? Math.log(terminalWealth) * market.annualization / intervalCount : 0,
    realizedVolatility: sampleStandardDeviation(returns) * Math.sqrt(market.annualization),
    maximumDrawdown,
    exposure: 1,
    stateCounts: Object.freeze({ long: intervalCount + 1, cash: 0 }),
    fills: 0,
    completedCashEpisodes: 0,
    costRateSum: 0,
    terminalLiquidation: false,
    path: Object.freeze(pathRows),
  });
}

function analyzeMarket(input) {
  const ledgers = buildDecisionLedgers(input);
  const { market } = ledgers;
  const costs = COSTS[market.marketClass];
  const m1Primary = replayDecisionLedger(market, ledgers.M1.decisions, costs.primary);
  const m1Stress = replayDecisionLedger(market, ledgers.M1.decisions, costs.stress);
  const m0Primary = replayDecisionLedger(market, ledgers.M0.decisions, costs.primary);
  const m0Stress = replayDecisionLedger(market, ledgers.M0.decisions, costs.stress);
  assert(m1Primary.ledgerHash === m1Stress.ledgerHash, 'M1 primary/stress ledger mismatch');
  assert(m0Primary.ledgerHash === m0Stress.ledgerHash, 'M0 primary/stress ledger mismatch');
  const firstDecision = ledgers.M1.decisions[0];
  const lastDecision = ledgers.M1.decisions[ledgers.M1.decisions.length - 1];
  const buyAndHold = buyAndHoldSummary(
    market, firstDecision.decisionPriceIndex, lastDecision.decisionPriceIndex,
  );
  const currentDecision = lastDecision;
  const currentSignal = Object.freeze({
    action: currentDecision.action,
    targetPosition: currentDecision.targetPosition,
    targetWeight: currentDecision.allocation,
    decisionClose: currentDecision.decisionClose,
    earliestExecutionClose: currentDecision.earliestExecutionClose,
    trainingRowCount: currentDecision.trainingRowCount,
    prediction: currentDecision.prediction,
    fallbackReason: currentDecision.fallbackReason,
    evidenceStatus: currentDecision.evidenceStatus,
    decisionSha256: currentDecision.decisionSha256,
  });
  const configIdentity = getConfigIdentity();
  const result = {
    schemaVersion: SCHEMA_VERSION,
    modelId: MODEL_ID,
    status: EVIDENCE_STATUS,
    market: Object.freeze({
      key: market.key,
      name: market.name,
      targetId: market.targetId,
      marketClass: market.marketClass,
      annualization: market.annualization,
    }),
    identities: Object.freeze({
      inputSha256: hashCanonical(market),
      protocolSha256: PROTOCOL_SHA256,
      protocolFreezeMarker: PROTOCOL_FREEZE_MARKER,
      runner: getRunnerIdentity(),
      configSha256: configIdentity.configSha256,
    }),
    currentSignal,
    models: Object.freeze({
      M1: Object.freeze({
        published: true,
        decisions: ledgers.M1.decisions,
        prequential: ledgers.M1.prequential,
        primary: m1Primary,
        stress: m1Stress,
      }),
      M0: Object.freeze({
        published: false,
        decisions: ledgers.M0.decisions,
        prequential: ledgers.M0.prequential,
        primary: m0Primary,
        stress: m0Stress,
      }),
    }),
    sharedTraining: ledgers.sharedTraining,
    buyAndHold,
    gateEvaluation: Object.freeze({
      evaluated: false,
      reason: 'DEFERRED_TO_FROZEN_RESULT_ANALYZER',
    }),
    wording: 'RESEARCH SIGNAL - RETROSPECTIVE, NOT VALIDATED',
    limitations: Object.freeze([
      'Retrospective prequential development evidence only.',
      'Cash return is fixed at zero.',
      'No terminal liquidation is applied.',
      'The nested M0 control is never published or substituted for M1.',
    ]),
  };
  result.analysisSha256 = hashCanonical(result);
  return Object.freeze(result);
}

function analyzeMarkets(inputs) {
  assert(Array.isArray(inputs) && inputs.length > 0, 'At least one market is required');
  const markets = inputs.map(analyzeMarket);
  const result = {
    schemaVersion: SCHEMA_VERSION,
    modelId: MODEL_ID,
    status: EVIDENCE_STATUS,
    universalGatePassed: null,
    markets,
    identities: Object.freeze({
      protocolSha256: PROTOCOL_SHA256,
      protocolFreezeMarker: PROTOCOL_FREEZE_MARKER,
      runner: getRunnerIdentity(),
      configSha256: getConfigIdentity().configSha256,
      normalizedInputsSha256: hashCanonical(inputs.map(normalizeMarket)),
    }),
  };
  result.analysisSha256 = hashCanonical(result);
  return Object.freeze(result);
}

module.exports = Object.freeze({
  MODEL_ID,
  PROTOCOL_FREEZE_MARKER,
  PROTOCOL_SHA256,
  PROTOCOL_PATH,
  SCHEMA_VERSION,
  RIDGE_LAMBDA,
  MIN_MATURED_ROWS,
  CURRENT_Z_LIMIT,
  EVIDENCE_STATUS,
  FALSIFIED_STATUS,
  WARMUP_REASON,
  INVALID_REASON,
  COMPONENT_KEYS,
  M0_FEATURE_NAMES,
  M1_FEATURE_NAMES,
  COSTS,
  canonicalize,
  canonicalStringify,
  hashCanonical,
  getRunnerIdentity,
  getConfigIdentity,
  assertProtocolIdentity,
  normalizeMarket,
  isExactIsoDate,
  isExactUtcTimestamp,
  populationStandardDeviation,
  buildFeatureObservation,
  computeForwardLabel,
  createSufficientStatistics,
  addObservation,
  solveLinearSystem,
  fitStandardizedRidge,
  logCostHurdle,
  chooseBinaryTarget,
  buildDecisionLedgers,
  replayDecisionLedger,
  buyAndHoldSummary,
  analyzeMarket,
  analyzeMarkets,
});
